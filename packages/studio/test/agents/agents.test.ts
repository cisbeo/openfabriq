import { join } from "node:path";
import { loadFactory, withWiki } from "@openfabriq/core";
import { readFactoryFolder } from "@openfabriq/runner";
import { expect, it } from "vitest";
import { agentsView } from "../../src/agents/agents.js";

const files = readFactoryFolder(
	join(import.meta.dirname, "../../../../fixtures/valid/sdlc/openfabriq"),
);
files["factory.yaml"] += "timezone: Europe/Paris\nwiki: true\n";
files["automations/nightly/automation.md"] =
	'---\nwhen:\n  schedule: { cron: "0 2 * * *" }\nagent: implementer\nconcurrency: repository\n---\nImprove the code.\n';
const implement = "automations/implement-ready-issues/automation.md";
files[implement] = (files[implement] ?? "").replace(
	"agent: implementer\n",
	"agent: implementer\nreviewed_by: reviewer\n",
);
const loaded = loadFactory(files).factory;
if (!loaded) throw new Error("the fixture does not load");
const factory = withWiki(loaded);

it("lists the agents in the order the work reaches them, with the automations that use them", () => {
	const view = agentsView("acme/task-app", files, factory, new Date());
	expect(view.repository).toBe("acme/task-app");
	expect(view.name).toBe("Task app factory");
	expect(view.timezone).toBe("Europe/Paris");
	// The nightly schedule starts the work at the implementer.
	expect(view.agents.map((a) => a.name)).toEqual([
		"implementer",
		"triage",
		"investigator",
		"reviewer",
		"rework",
		"wiki",
	]);
	const implementer = view.agents.find((a) => a.name === "implementer");
	expect(implementer?.automations.map((a) => a.name)).toEqual(
		expect.arrayContaining(["implement-ready-issues", "nightly"]),
	);
	expect(implementer?.skillDocs).toEqual(expect.any(Array));
});

it("gives a reviewer the automations it reviews, and each agent its agent.md as written", () => {
	const view = agentsView("acme/task-app", files, factory, new Date());
	const reviewer = view.agents.find((a) => a.name === "reviewer");
	expect(reviewer?.reviews.map((a) => a.name)).toEqual([
		"implement-ready-issues",
	]);
	expect(reviewer?.source).toBe(files["agents/reviewer/agent.md"]);
	expect(reviewer?.source).toContain("tools: [read, shell]");
	const implementer = view.agents.find((a) => a.name === "implementer");
	expect(implementer?.reviews).toEqual([]);
	// The engine's wiki agent has no file in openfabriq/.
	expect(view.agents.find((a) => a.name === "wiki")?.source).toBeUndefined();
});

it("gives each schedule in words and its next run after now, in the factory's time zone", () => {
	// 03:00 in Paris on 10 October 2026 (summer time, UTC+2): the next 02:00 is the day after.
	const now = new Date("2026-10-10T01:00:00Z");
	const nightly = agentsView("acme/task-app", files, factory, now)
		.agents.find((a) => a.name === "implementer")
		?.automations.find((a) => a.name === "nightly");
	expect(nightly).toMatchObject({
		schedules: [
			{
				cron: "0 2 * * *",
				words: "every day at 02:00",
				next: "2026-10-11T00:00:00.000Z",
			},
		],
	});
	const event = agentsView("acme/task-app", files, factory, now)
		.agents.find((a) => a.name === "implementer")
		?.automations.find((a) => a.name === "implement-ready-issues");
	expect(event).not.toHaveProperty("schedules");
});
