import type { RunRecord } from "@openfabriq/runner";
import { expect, it } from "vitest";
import {
	filterRuns,
	trigger,
} from "../../../app/src/features/runs/run-filters.js";

const run = (id: string, agent: string, status: RunRecord["status"]) =>
	({
		id,
		agent,
		status,
		event: "issue.labeled",
	}) as RunRecord;

const runs = [
	run("1", "triage", "failed"),
	run("2", "implementer", "succeeded"),
	run("3", "triage", "succeeded"),
	run("4", "triage", "failed"),
];

it("filters by agent then by status, and counts the agent's runs per status", () => {
	const { agents, shown, count } = filterRuns(runs, "triage", "failed");
	expect(agents).toEqual(["implementer", "triage"]);
	expect(shown.map((r) => r.id)).toEqual(["1", "4"]);
	expect(count(undefined)).toBe(3);
	expect(count("failed")).toBe(2);
	expect(count("running")).toBe(0);
});

it("shows every run without filters", () => {
	expect(filterRuns(runs, undefined, undefined).shown).toBe(runs);
});

it("says what started a run in plain words, with its label or its source", () => {
	expect(
		trigger({
			...run("1", "a", "queued"),
			event: "slack.mentioned",
			source: { kind: "slack", label: "#factory" },
		}),
	).toBe("Slack mention · #factory");
	expect(
		trigger({ ...run("1", "a", "queued"), label: "ready-for-agent" }),
	).toBe("Issue labeled · ready-for-agent");
	expect(
		trigger({
			...run("1", "a", "queued"),
			event: "pull_request.opened",
			source: { kind: "github", label: "#23" },
		}),
	).toBe("PR opened");
	expect(
		trigger({ ...run("1", "a", "queued"), event: "default_branch.updated" }),
	).toBe("Push to main");
	expect(trigger({ ...run("1", "a", "queued"), event: "custom.thing" })).toBe(
		"custom.thing",
	);
	expect(
		trigger({ ...run("1", "a", "queued"), event: "schedule", manual: "Ada" }),
	).toBe("Manual run · Ada");
});

it("finds runs by the words they show, whatever the case, then filters and counts within them", () => {
	const shown = [
		{
			...run("a", "triage", "failed"),
			title: "Bouton Add trop petit",
			number: 12,
		},
		{
			...run("b", "implementer", "succeeded"),
			automation: "implement-ready-issues",
			number: 9,
		},
		{
			...run("c", "quality", "failed"),
			event: "schedule",
			manual: "Ada",
			reason: "interrupted: the engine stopped",
		},
	] as RunRecord[];
	const ids = (text: string, status?: string) =>
		filterRuns(shown, undefined, status, text).shown.map((r) => r.id);
	expect(ids("bouton add")).toEqual(["a"]);
	expect(ids("#9")).toEqual(["b"]);
	expect(ids("READY-ISSUES")).toEqual(["b"]);
	expect(ids("interrupted")).toEqual(["c"]);
	expect(ids("manual run")).toEqual(["c"]);
	expect(ids("  ")).toEqual(["a", "b", "c"]);
	expect(ids("t", "failed")).toEqual(["a", "c"]);
	const { agents, count } = filterRuns(shown, undefined, undefined, "bouton");
	expect(agents).toEqual(["implementer", "quality", "triage"]);
	expect(count("failed")).toBe(1);
});
