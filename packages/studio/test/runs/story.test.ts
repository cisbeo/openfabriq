import { join } from "node:path";
import { loadFactory, workflowGraph } from "@openfabriq/core";
import { type RunRecord, readFactoryFolder } from "@openfabriq/runner";
import { expect, it } from "vitest";
import { runStory } from "../../src/runs/story.js";

const { factory } = loadFactory(
	readFactoryFolder(
		join(import.meta.dirname, "../../../../fixtures/valid/sdlc/openfabriq"),
	),
);
if (!factory) throw new Error("the sdlc example does not load");
const graph = workflowGraph(factory);

const at = (min: number) =>
	new Date(Date.UTC(2026, 10, 2, 0, min)).toISOString();
const run = (r: Partial<RunRecord> & Pick<RunRecord, "id">): RunRecord => ({
	repository: "acme/app",
	automation: "triage-issues",
	agent: "triage",
	event: "issue.opened",
	number: 4,
	isPullRequest: false,
	status: "succeeded",
	queuedAt: at(0),
	endedAt: at(1),
	outputs: [],
	...r,
});

const triage = run({
	id: "triage",
	outputs: [
		{ action: "add_labels", summary: "ready-for-agent", status: "applied" },
		{ action: "add_comment", summary: "Ready", status: "applied" },
	],
});
const implement = run({
	id: "implement",
	automation: "implement-ready-issues",
	agent: "implementer",
	event: "issue.labeled",
	label: "ready-for-agent",
	queuedAt: at(2),
	endedAt: at(5),
	outputs: [
		{
			action: "create_pull_request",
			summary: "Add a counter",
			status: "applied",
			url: "https://github.com/acme/app/pull/9",
		},
	],
});
const review = run({
	id: "review",
	automation: "review-pull-requests",
	agent: "reviewer",
	event: "pull_request.opened",
	number: 9,
	isPullRequest: true,
	queuedAt: at(6),
	endedAt: at(8),
	outputs: [
		{ action: "add_comment", summary: "Review", status: "applied" },
		{ action: "request_changes", summary: "Two defects", status: "applied" },
	],
});
const runs = [triage, implement, review];

it("links a run to the run whose output started it, across issue and pull request", () => {
	expect(runStory(implement, runs, graph).cause).toMatchObject({
		id: "triage",
		output: 0,
	});
	expect(runStory(review, runs, graph).cause).toMatchObject({
		id: "implement",
		output: 0,
	});
	expect(runStory(triage, runs, graph).cause).toBeUndefined();
});

it("lists the runs a run started, and the automations its outputs should start", () => {
	const story = runStory(triage, runs, graph);
	expect(story.effects.map((e) => [e.id, e.output])).toEqual([
		["implement", 0],
	]);
	expect(story.followers).toEqual([
		[{ automation: "implement-ready-issues", agent: "implementer" }],
		[],
	]);
	expect(runStory(review, runs, graph).followers[1]).toEqual([
		{ automation: "rework-pull-requests", agent: "rework" },
	]);
});

it("links a label to the run it started, whatever its case", () => {
	const upper = {
		...triage,
		outputs: [
			{
				action: "add_labels" as const,
				summary: "Ready-For-Agent",
				status: "applied" as const,
			},
		],
	};
	expect(runStory(implement, [upper, implement], graph).cause?.id).toBe(
		"triage",
	);
});

it("does not link a run to an output that landed long before, or on another subject", () => {
	const late = { ...implement, id: "late", queuedAt: at(50) };
	const other = { ...implement, id: "other", number: 5 };
	expect(runStory(late, [triage, late], graph).cause).toBeUndefined();
	expect(runStory(other, [triage, other], graph).cause).toBeUndefined();
});

it("links runs on a Linear issue by its url, which has no number", () => {
	const linear = (id: string, issue: string, min: number): RunRecord => {
		const { number: _, ...r } = run({
			id,
			event: "linear.issue.labeled",
			label: "ready-for-agent",
			source: {
				kind: "linear",
				label: issue,
				url: `https://linear.app/a/issue/${issue}`,
			},
			queuedAt: at(min),
			endedAt: at(min + 1),
			outputs: [
				{ action: "add_labels", summary: "ready-for-agent", status: "applied" },
			],
		});
		return r;
	};
	const first = linear("first", "ENG-1", 0);
	const next = linear("next", "ENG-1", 2);
	const other = linear("other", "ENG-2", 2);
	const journal = [first, next, other];
	expect(runStory(next, journal).cause?.id).toBe("first");
	expect(runStory(other, journal).cause).toBeUndefined();
	expect(runStory(first, journal).effects.map((e) => e.id)).toEqual(["next"]);
});

it("says when a person should act, most pressing first", () => {
	const handoff = [
		{ action: "add_labels", summary: "needs-human", status: "applied" },
		{ action: "add_comment", summary: "handoff", status: "applied" },
	] satisfies RunRecord["outputs"];
	const attention = (r: Partial<RunRecord>) =>
		runStory(run({ id: "x", ...r }), []).attention;
	expect(attention({ status: "failed", outputs: handoff })).toEqual({
		kind: "failed",
	});
	expect(attention({ status: "skipped", outputs: handoff })).toEqual({
		kind: "handed-over",
		by: "engine",
	});
	expect(attention({ outputs: handoff.slice(0, 1) })).toEqual({
		kind: "handed-over",
		by: "agent",
	});
	// The internal review left the pull request it opened to a person: needs-human went on with it.
	expect(
		attention({
			reason: "the internal review asks for a person: reviewer gave no verdict",
			outputs: [
				{
					action: "create_pull_request",
					summary: "Add a counter",
					status: "applied",
					url: "https://github.com/acme/app/pull/9",
				},
			],
		}),
	).toEqual({ kind: "handed-over", by: "engine" });
	expect(
		attention({
			status: "skipped",
			reason: "the daily cost limit of 10 USD is reached (usd_per_day)",
		}),
	).toEqual({ kind: "cost-limit" });
	expect(
		attention({
			outputs: [
				{ action: "add_labels", summary: "x", status: "refused", reason: "no" },
			],
		}),
	).toEqual({ kind: "not-applied", count: 1 });
	expect(attention({ outputs: triage.outputs })).toBeUndefined();
	expect(attention({ outputs: [] })).toEqual({ kind: "no-output" });
	expect(attention({ status: "skipped", outputs: [] })).toBeUndefined();
});

it("expects no automation after the person's label", () => {
	const handed = run({
		id: "h",
		automation: "review-pull-requests",
		agent: "reviewer",
		isPullRequest: true,
		outputs: [
			{ action: "add_labels", summary: "needs-human", status: "applied" },
		],
	});
	expect(runStory(handed, [], graph).followers).toEqual([[]]);
});

it("finds the effects of a run among 5,000 without comparing every pair", () => {
	// Pairs on one issue: run 2j labels it, run 2j+1 is queued a minute later by that label.
	const journal = Array.from({ length: 5000 }, (_, i) =>
		run({
			id: `r${i}`,
			event: "issue.labeled",
			label: "ready-for-agent",
			number: Math.floor(i / 2),
			queuedAt: at(i),
			endedAt: new Date(Date.parse(at(i)) + 30_000).toISOString(),
			outputs: [
				{ action: "add_labels", summary: "ready-for-agent", status: "applied" },
			],
		}),
	);
	// Linear here is a few tens of ms; comparing every pair (25 million) takes seconds. 1 s holds on a busy machine.
	const started = performance.now();
	const story = runStory(journal[2500] as RunRecord, journal);
	expect(performance.now() - started).toBeLessThan(1000);
	expect(story.effects.map((e) => e.id)).toEqual(["r2501"]);
	const { endedAt, ...unfinished } = journal[2500] as RunRecord;
	expect(endedAt).toBeDefined();
	expect(runStory(unfinished, journal).effects).toEqual([]);
});

it("links a run the engine stopped to the run it queued again, never to an earlier attempt", () => {
	// The nightly pass, about the whole repository: no issue number.
	const nightly = (
		r: Partial<RunRecord> & Pick<RunRecord, "id">,
	): RunRecord => {
		const {
			number: _,
			endedAt: __,
			...rest
		} = run({
			automation: "nightly",
			agent: "quality",
			event: "schedule",
			...r,
		});
		return { ...rest, ...(r.endedAt ? { endedAt: r.endedAt } : {}) };
	};
	const first = nightly({
		id: "first",
		status: "failed",
		reason: "interrupted: the engine stopped",
		startedAt: at(0),
		endedAt: at(1),
	});
	const second = nightly({ id: "second", status: "running", startedAt: at(2) });
	expect(runStory(first, [first, second]).rerun).toEqual({
		id: "second",
		agent: "quality",
		status: "running",
	});
	expect(runStory(first, [first, second]).attention).toEqual({
		kind: "interrupted",
	});
	const again = nightly({
		id: "second",
		status: "failed",
		reason: "interrupted: the engine stopped",
		startedAt: at(2),
		endedAt: at(3),
	});
	expect(runStory(again, [first, again]).rerun).toBeUndefined();
	expect(runStory(again, [first, again]).attention).toEqual({ kind: "failed" });
});

it("says what comes after a pushed pull request with the engine's own filters: who opened it, which files it changes", () => {
	const migration = loadFactory({
		...readFactoryFolder(
			join(
				import.meta.dirname,
				"../../../../examples/26-webflow-to-astro/openfabriq",
			),
		),
		"automations/check-plan/automation.md":
			"---\nwhen:\n  pull_request.opened: { opened_by: planner }\nagent: parity-reviewer\ncan: [add_comment]\n---\nCheck the plan.\n",
		// A review on GitHub, and its rework, that skip the migration's own files.
		"automations/review-parity/automation.md":
			'---\nwhen:\n  pull_request.opened: { ignore_paths: ["migration/**"] }\n  pull_request.updated: { ignore_paths: ["migration/**"] }\nagent: parity-reviewer\ncan: [add_comment]\n---\nReview it.\n',
		"automations/rework-pull-requests/automation.md":
			"---\nwhen: pull_request.changes_requested\nagent: astro-builder\ncan: [push_to_pull_request]\n---\nRework it.\n",
	}).factory;
	if (!migration) throw new Error("26-webflow-to-astro does not load");
	const pushed = (agent: string, automation: string, files?: string[]) =>
		runStory(
			run({
				id: `${agent}-run`,
				agent,
				automation,
				event: "issue.commented",
				outputs: [
					{
						action: "create_pull_request",
						summary: "Pull request",
						status: "applied",
						url: "https://github.com/acme/app/pull/12",
						...(files ? { files } : {}),
					},
				],
			}),
			[],
			workflowGraph(migration),
			migration,
		).followers[0]?.map((f) => f.automation);
	expect(
		pushed("planner", "plan-migration", ["migration/decisions.md"]),
	).toEqual(["check-plan"]);
	expect(
		pushed("astro-builder", "build-tickets", ["src/pages/index.astro"]),
	).toEqual(["review-parity"]);
	// An older journal names no files: every automation that may follow stays.
	expect(pushed("planner", "plan-migration")?.sort()).toEqual([
		"check-plan",
		"review-parity",
	]);

	// A push to a pull request: the engine compares ignore_paths with every file of the pull
	// request, not the push's, and the opener is this repository's, not another's #12.
	const opened = (repository: string, agent: string) =>
		run({
			id: `${repository}-${agent}`,
			repository,
			agent,
			outputs: [
				{
					action: "create_pull_request",
					summary: "Pull request",
					status: "applied",
					url: `https://github.com/${repository}/pull/12`,
				},
			],
		});
	const rework = run({
		id: "rework",
		agent: "astro-builder",
		automation: "rework-pull-requests",
		event: "pull_request.changes_requested",
		number: 12,
		isPullRequest: true,
		outputs: [
			{
				action: "push_to_pull_request",
				summary: "Fix",
				status: "applied",
				files: ["migration/notes.md"],
			},
		],
	});
	expect(
		runStory(
			rework,
			[opened("acme/other", "planner"), opened("acme/app", "astro-builder")],
			workflowGraph(migration),
			migration,
		).followers[0]?.map((f) => f.automation),
	).toEqual(["review-parity"]);
});
