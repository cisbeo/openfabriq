import type { Automation } from "@openfabriq/core";
import type { RunRecord } from "@openfabriq/runner";
import { expect, it } from "vitest";
import {
	agentStats,
	agentTab,
	agentTabs,
	automationChips,
	automationOutputs,
	byArea,
	harnessOf,
	nextRun,
	shownAutomations,
	triggerTokens,
	writesOf,
} from "../../../app/src/features/agents/agent-facts.js";

const run = (over: Partial<RunRecord>): RunRecord => ({
	id: "r",
	repository: "acme/shop",
	automation: "a",
	agent: "implementer",
	event: "issue.labeled",
	isPullRequest: false,
	status: "succeeded",
	queuedAt: "2026-11-03T10:00:00.000Z",
	outputs: [],
	...over,
});

it("averages the runs that have a duration, and leaves the others out", () => {
	const stats = agentStats([
		run({ id: "r3", status: "running" }),
		run({ id: "r2", status: "failed", durationMs: 1000, costUsd: 0.5 }),
		run({ id: "r1", durationMs: 3000, costUsd: 1 }),
	]);
	expect(stats).toMatchObject({
		runs: 3,
		succeeded: 1,
		failed: 1,
		costUsd: 1.5,
		averageMs: 2000,
		working: true,
	});
	expect(stats.last?.id).toBe("r3");
});

it("has no average and no last run for an agent that never ran", () => {
	const stats = agentStats([]);
	expect(stats).toEqual({
		runs: 0,
		succeeded: 0,
		failed: 0,
		costUsd: 0,
		working: false,
	});
});

it("lets the agent run the commands only with the commands tool, and checks only code it can change", () => {
	const data = {
		commands: { test: "npm test", lint: "npm run lint" },
		checks: ["test"],
	};
	expect(harnessOf(data, ["read", "commands"])).toEqual({
		named: ["test", "lint"],
		checks: [],
	});
	expect(harnessOf(data, ["edit"])).toEqual({ named: [], checks: ["test"] });
	expect(harnessOf({}, ["shell", "commands"])).toEqual({
		named: [],
		checks: [],
	});
});

it("folds labels added and removed into one box, any label when the list is free", () => {
	const automation = {
		can: [
			{ action: "add_labels", labels: ["ready-for-agent"] },
			{ action: "add_comment" },
			{ action: "remove_labels" },
		],
	} as unknown as Automation;
	expect(automationOutputs(automation)).toEqual([
		{
			key: "labels",
			action: "add_labels",
			label: "Labels",
			tokens: ["+ ready-for-agent", "− any label"],
		},
		{ key: "add_comment", action: "add_comment", label: "Comment", tokens: [] },
	]);
});

type Trigger = Automation["when"][number];

it("tags a trigger with its labels, its schedule in words, its query and the paths it skips", () => {
	const labeled = {
		event: "issue.labeled",
		labels: ["ready", "bug"],
		query: "is:open",
		ignore_paths: ["docs/**"],
	} as Trigger;
	expect(triggerTokens(labeled, undefined)).toEqual([
		"ready",
		"bug",
		"is:open",
		"skip docs/**",
	]);
	const nightly = { event: "schedule", cron: "0 2 * * *" } as Trigger;
	expect(
		triggerTokens(nightly, [
			{ cron: "0 2 * * *", words: "every day at 02:00" },
		]),
	).toEqual(["every day at 02:00"]);
	expect(triggerTokens(nightly, [])).toEqual(["0 2 * * *"]);
	const bare = { event: "pull_request.opened", ignore_paths: [] } as Trigger;
	expect(triggerTokens(bare, undefined)).toEqual([]);
	const answering = {
		event: "pull_request.commented",
		mentions: "@openfabriq",
		openedBy: "implementer",
	} as Trigger;
	expect(triggerTokens(answering, undefined)).toEqual([
		"@openfabriq",
		"opened by implementer",
	]);
	const decision = {
		event: "issue.commented",
		labels: ["migration:decision"],
	} as Trigger;
	expect(triggerTokens(decision, undefined)).toEqual([
		"labeled migration:decision",
	]);
});

it("takes the soonest next run of the schedules", () => {
	expect(
		nextRun([
			{ cron: "0 9 * * *", words: "", next: "2026-11-04T09:00:00.000Z" },
			{ cron: "0 2 * * *", words: "" },
			{ cron: "0 3 * * *", words: "", next: "2026-11-04T03:00:00.000Z" },
		]),
	).toBe("2026-11-04T03:00:00.000Z");
	expect(nextRun(undefined)).toBeUndefined();
});

it("lists each action an agent may propose once", () => {
	const automations = [
		{ can: [{ action: "add_comment" }, { action: "add_labels" }] },
		{ can: [{ action: "add_comment" }] },
	] as unknown as Automation[];
	expect(writesOf(automations)).toEqual(["add_comment", "add_labels"]);
});

it("names who can start an automation and how many of its runs go at once, with what each means", () => {
	const [who, howMany] = automationChips({
		from: "maintainers",
		concurrency: "issue",
		when: [{ event: "issue.labeled" }],
	} as Automation);
	expect(who?.label).toBe("Maintainers");
	expect(who?.hint).toContain("Only the maintainers of factory.yaml");
	expect(howMany?.label).toBe("1 per issue");
	expect(howMany?.hint).toContain("waits for it to end");
	const [anyone, repo] = automationChips({
		from: "anyone",
		concurrency: "repository",
		when: [{ event: "issue.opened" }],
	} as Automation);
	expect(anyone?.label).toBe("Anyone");
	expect(anyone?.hint).toContain("untrusted");
	expect(repo?.label).toBe("1 per repo");
});

it("says who starts an automation of Slack, Linear, Sentry, a webhook or a schedule: maintainers is for GitHub", () => {
	const who = (event: string) =>
		automationChips({
			from: "maintainers",
			concurrency: "issue",
			when: [{ event }],
		} as Automation)[0]?.label;
	expect(who("slack.mentioned")).toBe("Slack channel");
	expect(who("linear.issue.delegated")).toBe("Linear team");
	expect(who("sentry.issue.created")).toBe("Sentry");
	expect(who("webhook.received")).toBe("Webhook");
	expect(who("schedule")).toBe("Schedule");
	expect(
		automationChips({
			from: "maintainers",
			concurrency: "issue",
			when: [{ event: "slack.mentioned" }],
		} as Automation)[1]?.label,
	).toBe("1 per thread");
	expect(who("pull_request.opened")).toBe("Maintainers");
});

it("groups the agents by area: those at the root first, untitled, then each area by name, each in the work's order", () => {
	const agents = [
		{ name: "auditor", area: "security" },
		{ name: "triage" },
		{ name: "tester", area: "qa" },
		{ name: "fixer", area: "security" },
	];
	expect(
		byArea(agents).map((g) => [g.area, g.agents.map((a) => a.name)]),
	).toEqual([
		[undefined, ["triage"]],
		["qa", ["tester"]],
		["security", ["auditor", "fixer"]],
	]);
	const one = [{ name: "a" }];
	expect(byArea(one)).toEqual([{ agents: one }]);
});

it("hides the engine's answer to mentions on the agent's page, and only it", () => {
	const automations: Pick<Automation, "name" | "builtIn">[] = [
		{ name: "build-tickets" },
		{ name: "answer-mentions-astro-builder", builtIn: true },
		{ name: "answer-mentions-astro-builder" }, // the factory's own, if it had one
		{ name: "wiki", builtIn: true },
	];
	expect(
		shownAutomations({ name: "astro-builder", automations }).map((a) => [
			a.name,
			a.builtIn ?? false,
		]),
	).toEqual([
		["build-tickets", false],
		["answer-mentions-astro-builder", false],
		["wiki", true],
	]);
});

it("gives an agent its automations first, and its brief and runs only when it has some", () => {
	const agent = {
		name: "implementer",
		automations: [
			{ name: "implement" },
			{ name: "answer-mentions-implementer", builtIn: true as const },
		],
		reviews: [],
		skillDocs: [{}, {}],
		instructions: "You implement issues.",
	};
	expect(agentTabs(agent, 12)).toEqual([
		{ id: "automations", label: "Automations", count: 1 },
		{ id: "skills", label: "Skills", count: 2 },
		{ id: "resources", label: "Resources" },
		{ id: "brief", label: "Brief" },
		{ id: "runs", label: "Runs", count: 12 },
	]);
	expect(
		agentTabs({ ...agent, automations: [], instructions: "  \n" }, 0).map(
			(t) => t.id,
		),
	).toEqual(["automations", "skills", "resources"]);
	// A reviewer counts the automations it reviews.
	expect(
		agentTabs(
			{
				name: "reviewer",
				automations: [],
				reviews: [{ name: "implement" }, { name: "answer-mentions" }],
				skillDocs: [],
				instructions: "Review.",
			},
			0,
		)[0],
	).toEqual({ id: "automations", label: "Automations", count: 2 });
});

it("opens the tab a link asks for when the agent's page shows it, else its automations", () => {
	const tabs = agentTabs(
		{
			name: "triager",
			automations: [],
			reviews: [],
			skillDocs: [],
			instructions: "Triage.",
		},
		0,
	);
	expect(agentTab("brief", tabs)).toBe("brief");
	expect(agentTab("runs", tabs)).toBe("automations");
	expect(agentTab("nonsense", tabs)).toBe("automations");
	expect(agentTab(undefined, tabs)).toBe("automations");
});
