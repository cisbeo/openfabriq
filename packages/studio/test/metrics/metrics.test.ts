import type { RunRecord } from "@openfabriq/runner";
import { expect, it } from "vitest";
import {
	computeMetrics,
	pullRequestUrls,
	runsInPeriod,
} from "../../src/metrics/metrics.js";

// Local times, so days do not depend on the machine's time zone.
const NOW = new Date(2026, 9, 10, 18, 0);
const at = (day: number, hour = 12) =>
	new Date(2026, 9, day, hour).toISOString();

const run = (over: Partial<RunRecord>): RunRecord => ({
	id: Math.random().toString(36).slice(2),
	repository: "acme/shop",
	automation: "implement",
	agent: "implementer",
	event: "issue.labeled",
	isPullRequest: false,
	status: "succeeded",
	queuedAt: at(10),
	outputs: [],
	...over,
});

const RUNS: RunRecord[] = [
	run({
		queuedAt: at(10),
		durationMs: 60_000,
		costUsd: 1.5,
		outputs: [
			{
				action: "create_pull_request",
				summary: "Add a counter",
				status: "applied",
				url: "https://github.com/acme/shop/pull/1",
			},
			{ action: "add_comment", summary: "Done", status: "applied" },
		],
	}),
	run({
		queuedAt: at(9),
		agent: "reviewer",
		durationMs: 30_000,
		costUsd: 0.5,
		outputs: [
			{ action: "add_labels", summary: "needs-human", status: "applied" },
			{
				action: "request_changes",
				summary: "Missing test",
				status: "refused",
				reason: "review_rounds reached (1)",
			},
		],
	}),
	run({
		queuedAt: at(8),
		status: "failed",
		durationMs: 90_000,
		costUsd: 1,
		outputs: [
			{
				action: "create_pull_request",
				summary: "Retry",
				status: "applied",
				url: "https://github.com/acme/shop/pull/2",
			},
		],
	}),
	run({ queuedAt: at(10, 17), status: "running" }),
	run({ queuedAt: at(10, 17), status: "skipped", reason: "daily limit" }),
	// Outside 7 days.
	run({ queuedAt: at(1), costUsd: 9, durationMs: 1_000 }),
];

it("counts runs, durations and costs over the last 7 days", () => {
	const m = computeMetrics(RUNS, "7d", NOW);
	expect(m.since).toBe("2026-10-04");
	expect(m.runs).toEqual({
		total: 5,
		succeeded: 2,
		failed: 1,
		skipped: 1,
		active: 1,
		unaided: 1,
	});
	expect(m.averageDurationMs).toBe(60_000);
	expect(m.agentTimeMs).toBe(180_000);
	expect(m.cost.totalUsd).toBe(3);
	expect(m.cost.failedUsd).toBe(1);
	expect(m.cost.byAgent).toEqual([
		{ agent: "implementer", usd: 2.5, runs: 4 },
		{ agent: "reviewer", usd: 0.5, runs: 1 },
	]);
	expect(m.cost.byDay).toHaveLength(7);
	expect(m.cost.byDay.at(-1)).toEqual({
		day: "2026-10-10",
		usd: 1.5,
		runs: 3,
		agents: { implementer: 3 },
	});
	expect(m.cost.byDay[0]).toEqual({
		day: "2026-10-04",
		usd: 0,
		runs: 0,
		agents: {},
	});
});

it("asks GitHub only about the pull requests of the period's runs", () => {
	const old = run({ queuedAt: at(1), endedAt: at(1) });
	expect(runsInPeriod([old, ...RUNS], "7d", NOW)).toEqual(
		RUNS.filter(
			(r) => new Date(r.endedAt ?? r.queuedAt) >= new Date(2026, 9, 4),
		),
	);
	expect(runsInPeriod([old], "30d", NOW)).toEqual([old]);
	expect(runsInPeriod([old], "all", NOW)).toEqual([old]);
});

it("counts the factory's pull requests and the merged ones, as far as gh could tell", () => {
	expect(pullRequestUrls(RUNS)).toEqual([
		"https://github.com/acme/shop/pull/1",
		"https://github.com/acme/shop/pull/2",
	]);
	const m = computeMetrics(RUNS, "7d", NOW, {
		"https://github.com/acme/shop/pull/1": { merged: true, open: false },
	});
	expect(m.pullRequests).toEqual({
		opened: 2,
		merged: 1,
		closed: 0,
		unknown: 1,
	});
	// Closed without a merge: counted apart.
	const closed = computeMetrics(RUNS, "7d", NOW, {
		"https://github.com/acme/shop/pull/1": { merged: false, open: false },
	});
	expect(closed.pullRequests).toEqual({
		opened: 2,
		merged: 0,
		closed: 1,
		unknown: 1,
	});
});

it("counts human interventions: handoffs, failed runs, refused outputs", () => {
	expect(computeMetrics(RUNS, "7d", NOW).interventions).toEqual({
		total: 3,
		handoffs: 1,
		failedRuns: 1,
		refusedOutputs: 1,
	});
});

it("counts the applied outputs by kind, most first", () => {
	expect(computeMetrics(RUNS, "7d", NOW).outputs).toEqual([
		{ action: "create_pull_request", count: 2 },
		{ action: "add_comment", count: 1 },
		{ action: "add_labels", count: 1 },
	]);
});

it("counts as hands-off only a succeeded run nobody had to step in on", () => {
	const refused = run({
		outputs: [
			{ action: "add_comment", summary: "Done", status: "applied" },
			{
				action: "close_issue",
				summary: "Close",
				status: "refused",
				reason: "not allowed",
			},
		],
	});
	const alone = run({
		outputs: [{ action: "add_comment", summary: "Done", status: "applied" }],
	});
	const failed = run({ status: "failed" });
	const { runs } = computeMetrics([refused, alone, failed], "7d", NOW);
	expect(runs.unaided).toBe(1);
});

const pr = (n: number) => `https://github.com/acme/shop/pull/${n}`;

it("tells the factory's pull requests merged as written from those a person changed, and the old ones it cannot tell", () => {
	const opened = (n: number, commits?: string[]) =>
		run({
			outputs: [
				{
					action: "create_pull_request",
					summary: "Fix",
					status: "applied",
					url: pr(n),
					...(commits ? { commits } : {}),
				},
			],
		});
	const runs = [
		opened(1, ["a1"]),
		opened(2, ["b1"]),
		// The engine pushed again on #2 after a review.
		run({
			url: pr(2),
			outputs: [
				{
					action: "push_to_pull_request",
					summary: "Address the review",
					status: "applied",
					commits: ["b2"],
				},
			],
		}),
		opened(3, ["c1"]),
		// Opened before the engine noted its commits.
		opened(4),
		// Not merged yet: not in GitHub's list.
		opened(5, ["e1"]),
		// Merged before the repository's 100 latest: GitHub's state says merged.
		opened(6, ["f1"]),
	];
	const merged = [
		{ url: pr(1), mergedAt: at(10), commits: ["a1"] },
		{ url: pr(2), mergedAt: at(10), commits: ["b1", "b2"] },
		{ url: pr(3), mergedAt: at(10), commits: ["c1", "person"] },
		{ url: pr(4), mergedAt: at(10), commits: ["d1"] },
	];
	const states = { [pr(6)]: { merged: true, open: false } };
	expect(
		computeMetrics(runs, "7d", NOW, states, [], merged).gains.merged,
	).toEqual({
		asWritten: 2,
		changed: 1,
		unknown: 2,
	});
});

it("compares how long an issue waits for its merge, the factory's against the team's over 90 days", () => {
	const hours = (h: number) =>
		new Date(NOW.getTime() - h * 3_600_000).toISOString();
	const runs = [1, 2, 3].map((n) =>
		run({
			outputs: [
				{
					action: "create_pull_request",
					summary: "Fix",
					status: "applied",
					url: pr(n),
					commits: [`f${n}`],
				},
			],
		}),
	);
	const pull = (
		n: number,
		issueHours: number | undefined,
		mergedHours = 0,
	) => ({
		url: pr(n),
		mergedAt: hours(mergedHours),
		commits: [`f${n}`],
		...(issueHours !== undefined ? { issueOpenedAt: hours(issueHours) } : {}),
	});
	const merged = [
		// The factory's: 2 h and 4 h; #3 closes no issue.
		pull(1, 2),
		pull(2, 4),
		pull(3, undefined),
		// The team's: 24 h, 48 h and 72 h; the last merged 100 days ago is left out.
		pull(10, 24),
		pull(11, 48),
		pull(12, 72),
		pull(13, 2410, 2400),
	];
	expect(
		computeMetrics(runs, "7d", NOW, {}, [], merged).gains.issueToMerge,
	).toEqual({
		factoryMs: 3 * 3_600_000,
		factoryPulls: 2,
		teamMs: 48 * 3_600_000,
		teamPulls: 3,
	});
	expect(computeMetrics([], "7d", NOW).gains).toEqual({
		merged: { asWritten: 0, changed: 0, unknown: 0 },
		issueToMerge: { factoryPulls: 0, teamPulls: 0 },
	});
});

it("covers every run for 'all', and adds the chat's cost", () => {
	const m = computeMetrics(RUNS, "all", NOW, {}, [
		{ at: at(10, 9), costUsd: 0.25 },
	]);
	expect(m.runs.total).toBe(6);
	expect(m.since).toBe("2026-10-01");
	expect(m.cost.byDay).toHaveLength(10);
	expect(m.cost.chatUsd).toBe(0.25);
	expect(m.cost.totalUsd).toBe(12.25);
	expect(computeMetrics([], "all", NOW).cost.byDay).toEqual([]);
});

it("counts a failed run the engine handed over once, and not the engine's handoff as an output", () => {
	const failed = run({
		queuedAt: at(10),
		status: "failed",
		outputs: [
			{ action: "add_labels", summary: "needs-human", status: "applied" },
			{ action: "add_comment", summary: "handoff", status: "applied" },
		],
	});
	const skipped = run({
		queuedAt: at(10),
		status: "skipped",
		outputs: [
			{ action: "add_comment", summary: "Done", status: "applied" },
			{ action: "add_labels", summary: "needs-human", status: "applied" },
			{ action: "add_comment", summary: "handoff", status: "applied" },
		],
	});
	const m = computeMetrics([failed, skipped], "7d", NOW);
	expect(m.interventions).toEqual({
		total: 2,
		handoffs: 1,
		failedRuns: 1,
		refusedOutputs: 0,
	});
	expect(m.outputs).toEqual([{ action: "add_comment", count: 1 }]);
});

it("counts a run's cost on the day it ended, like the daily limit", () => {
	const late = run({ queuedAt: at(9, 23), endedAt: at(10, 1), costUsd: 2 });
	const { byDay } = computeMetrics([late], "7d", NOW).cost;
	expect(byDay.at(-1)).toEqual({
		day: "2026-10-10",
		usd: 2,
		runs: 1,
		agents: { implementer: 1 },
	});
	expect(byDay.at(-2)).toEqual({
		day: "2026-10-09",
		usd: 0,
		runs: 0,
		agents: {},
	});
});

it("starts 'all' at midnight of the first run or chat, whichever came first", () => {
	const chats = [
		{ at: at(1, 9), costUsd: 0.5 },
		{ at: new Date(2026, 8, 30, 8).toISOString(), costUsd: 0.25 },
	];
	const m = computeMetrics(RUNS, "all", NOW, {}, chats);
	expect(m.since).toBe("2026-09-30");
	expect(m.cost.chatUsd).toBe(0.75);
	expect(m.cost.byDay[0]).toEqual({
		day: "2026-09-30",
		usd: 0.25,
		runs: 0,
		agents: {},
	});
	expect(computeMetrics([], "all", NOW, {}, chats.slice(0, 1)).since).toBe(
		"2026-10-01",
	);
});

it("leaves out the engine's link to what the run opened, old Linear records included", () => {
	const pr = {
		action: "create_pull_request",
		summary: "Add a counter",
		status: "applied",
		url: "https://github.com/acme/shop/pull/1",
	} as const;
	const slack = run({
		outputs: [
			pr,
			{
				action: "add_comment",
				summary: "link to the pull request",
				status: "applied",
				url: "https://acme.slack.com/archives/C1/p2",
			},
		],
	});
	// Before the fix, the link in a Linear session was recorded as a second pull request.
	const linear = run({
		outputs: [
			pr,
			{
				action: "create_pull_request",
				summary: "link to the pull request in the session",
				status: "applied",
			},
		],
	});
	const m = computeMetrics([slack, linear], "7d", NOW);
	expect(m.outputs).toEqual([{ action: "create_pull_request", count: 2 }]);
});

it("adds a chat's cost to its day, and leaves out the chats before the period", () => {
	const m = computeMetrics(RUNS, "7d", NOW, {}, [
		{ at: at(10, 9), costUsd: 0.25 },
		{ at: at(5, 9), costUsd: 0.5 },
		{ at: at(1, 9), costUsd: 4 },
	]);
	expect(m.cost.chatUsd).toBe(0.75);
	expect(m.cost.totalUsd).toBe(3.75);
	expect(m.cost.byDay.at(-1)).toEqual({
		day: "2026-10-10",
		usd: 1.75,
		runs: 3,
		agents: { implementer: 3 },
	});
	expect(m.cost.byDay[1]).toEqual({
		day: "2026-10-05",
		usd: 0.5,
		runs: 0,
		agents: {},
	});
	expect(m.cost.byDay.reduce((sum, d) => sum + d.usd, 0)).toBe(3.75);
	expect(Object.keys(m)).toEqual([
		"period",
		"since",
		"runs",
		"averageDurationMs",
		"agentTimeMs",
		"cost",
		"pullRequests",
		"interventions",
		"outputs",
		"gains",
	]);
	expect(Object.keys(computeMetrics([], "all", NOW))).toEqual([
		"period",
		"runs",
		"agentTimeMs",
		"cost",
		"pullRequests",
		"interventions",
		"outputs",
		"gains",
	]);
});
