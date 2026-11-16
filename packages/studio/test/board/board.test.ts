import type { RunRecord } from "@openfabriq/runner";
import { expect, it } from "vitest";
import { boardColumns, subjectsToAsk } from "../../src/board/board.js";

const base: RunRecord = {
	id: "r1",
	repository: "acme/app",
	automation: "triage-issues",
	agent: "triage",
	event: "issue.opened",
	number: 4,
	isPullRequest: false,
	title: "Filter tasks",
	url: "https://github.com/acme/app/issues/4",
	status: "succeeded",
	queuedAt: "2026-11-01T22:00:00Z",
	costUsd: 0.31,
	durationMs: 42_000,
	outputs: [],
};

const subjects = (board: ReturnType<typeof boardColumns>) =>
	Object.fromEntries(
		board.stages.map((s) => [s.id, s.cards.map((c) => c.run.number ?? null)]),
	);

it("places each issue or pull request in the stage of its latest run", () => {
	const board = boardColumns(
		[
			{ ...base, id: "r5", number: 7, status: "running", agent: "reviewer" },
			{ ...base, id: "r4", number: 8, status: "failed", agent: "implementer" },
			{ ...base, id: "r3", number: 6, status: "queued", agent: "implementer" },
			{
				...base,
				id: "r2",
				number: 5,
				agent: "reviewer",
				outputs: [
					{
						action: "add_labels",
						summary: "needs-human",
						status: "applied",
					},
				],
			},
			{ ...base, agent: "implementer" },
			{ ...base, id: "r0", agent: "triage" },
		],
		{ "acme/app": ["triage", "implementer", "reviewer"] },
	);
	expect(subjects(board)).toEqual({
		waiting: [6],
		working: [7],
		"needs-you": [8, 5],
		done: [4],
	});
});

it("keeps a pull request in working while one of its runs works, though another waits behind it", () => {
	const board = boardColumns(
		[
			{
				...base,
				id: "r3",
				automation: "rework",
				agent: "builder",
				status: "queued",
			},
			{
				...base,
				id: "r2",
				automation: "resolve-conflicts",
				agent: "builder",
				status: "running",
			},
			{ ...base, id: "r1", agent: "reviewer" },
		],
		{ "acme/app": ["builder", "reviewer"] },
	);
	expect(subjects(board)).toEqual({
		waiting: [],
		working: [4],
		"needs-you": [],
		done: [],
	});
	const card = board.stages.find((s) => s.id === "working")?.cards[0];
	expect(card?.run.automation).toBe("resolve-conflicts");
	expect(card?.trail.map((t) => t.id)).toEqual(["r1", "r2", "r3"]);
});

it("keeps the trail of agents that worked on a subject, oldest first", () => {
	const board = boardColumns(
		[
			{ ...base, id: "r3", agent: "reviewer", status: "running" },
			{ ...base, id: "r2", agent: "implementer" },
			{ ...base, id: "r1", agent: "triage" },
		],
		{ "acme/app": ["triage", "implementer", "reviewer"] },
	);
	const card = board.stages.find((s) => s.id === "working")?.cards[0];
	expect(card?.trail.map((t) => t.agent)).toEqual([
		"triage",
		"implementer",
		"reviewer",
	]);
});

it("shows runs about the whole repository while they wait, work or need someone, not once done", () => {
	const { number: _, ...noSubject } = base;
	const board = boardColumns(
		[
			{
				...noSubject,
				id: "a",
				automation: "nightly",
				event: "schedule",
				status: "running",
			},
			{
				...noSubject,
				id: "b",
				automation: "docs",
				event: "default_branch.updated",
			},
		],
		{ "acme/app": ["triage"] },
	);
	expect(subjects(board)).toEqual({
		waiting: [],
		working: [null],
		"needs-you": [],
		done: [],
	});
});

it("gives each Slack thread or Linear issue its own card, though none has a number", () => {
	const { number: _, ...noSubject } = base;
	const from = (id: string, label: string, url?: string): RunRecord => ({
		...noSubject,
		id,
		automation: "answer-mentions",
		event: "slack.mentioned",
		status: "running",
		source: { kind: "slack", label, ...(url ? { url } : {}) },
	});
	const board = boardColumns(
		[
			from("s3", "#factory", "https://acme.slack.com/archives/C1/p3"),
			from("s2", "#factory", "https://acme.slack.com/archives/C1/p2"),
			from("s1", "#factory", "https://acme.slack.com/archives/C1/p2"),
			from("l1", "ENG-1"),
		],
		{ "acme/app": ["triage"] },
	);
	const working = board.stages.find((s) => s.id === "working")?.cards ?? [];
	expect(working.map((c) => [c.run.id, c.trail.length])).toEqual([
		["s3", 1],
		["s2", 2],
		["l1", 1],
	]);
});

it("puts a run the daily cost limit skipped in needs-you, not done", () => {
	const board = boardColumns(
		[
			{
				...base,
				status: "skipped",
				reason: "the daily cost limit of 10 USD is reached (usd_per_day)",
			},
		],
		{ "acme/app": ["triage"] },
	);
	expect(subjects(board)).toMatchObject({ "needs-you": [4], done: [] });
});

it("moves a card that needs someone to done once its pull request is merged or its issue closed", () => {
	const handedOver = {
		...base,
		agent: "reviewer",
		outputs: [
			{
				action: "add_labels" as const,
				summary: "needs-human",
				status: "applied" as const,
			},
		],
	};
	const url = (n: number) => `https://github.com/acme/app/pull/${n}`;
	const runs: RunRecord[] = [
		{ ...handedOver, id: "a", number: 5, isPullRequest: true, url: url(5) },
		{ ...handedOver, id: "b", number: 6, isPullRequest: true, url: url(6) },
		{ ...base, id: "c", number: 7, status: "failed" },
		{ ...base, id: "d", number: 8, status: "running", url: url(8) },
	];
	expect(subjectsToAsk(runs)).toEqual([url(5), url(6), base.url]);
	const board = boardColumns(
		runs,
		{ "acme/app": ["reviewer"] },
		{
			[url(5)]: { merged: true, open: false },
			[url(6)]: { merged: false, open: true },
			[base.url as string]: { merged: false, open: false },
		},
	);
	expect(subjects(board)).toMatchObject({
		working: [8],
		"needs-you": [6],
		done: [5, 7],
	});
});

it("moves a handed-over card to done once nobody's label is on it any more, but never a failed run", () => {
	const handedOver = {
		...base,
		agent: "planner",
		outputs: [
			{
				action: "add_labels" as const,
				summary: "needs-human",
				status: "applied" as const,
			},
		],
	};
	const url = (n: number) => `https://github.com/acme/app/issues/${n}`;
	const runs: RunRecord[] = [
		{ ...handedOver, id: "a", number: 1, url: url(1) },
		{ ...handedOver, id: "b", number: 2, url: url(2) },
		{ ...base, id: "c", number: 3, url: url(3), status: "failed" },
	];
	const board = boardColumns(
		runs,
		{ "acme/app": ["planner"] },
		{
			[url(1)]: { merged: false, open: true, needsHuman: false },
			[url(2)]: { merged: false, open: true, needsHuman: true },
			[url(3)]: { merged: false, open: true, needsHuman: false },
		},
	);
	expect(subjects(board)).toMatchObject({
		"needs-you": [2, 3],
		done: [1],
	});
});

it("asks Linear and Sentry about their issues, and moves a card that needs someone once its issue is over", () => {
	const { number: _n, url: _u, ...rest } = base;
	const outside: RunRecord = { ...rest, status: "failed" };
	const linear = (id: string) => `https://linear.app/acme/issue/${id}/filter`;
	const sentry = (id: number) => `https://acme.sentry.io/issues/${id}/`;
	const runs: RunRecord[] = [
		{
			...outside,
			id: "a",
			url: linear("ENG-1"),
			source: { kind: "linear", label: "ENG-1", url: linear("ENG-1") },
		},
		// A run that failed before reading its issue has no url but its source's.
		{
			...outside,
			id: "b",
			source: { kind: "linear", label: "ENG-2", url: linear("ENG-2") },
		},
		{
			...outside,
			id: "c",
			url: sentry(12),
			source: { kind: "sentry", label: "WEB-12", url: sentry(12) },
		},
		{
			...outside,
			id: "d",
			url: sentry(13),
			source: { kind: "sentry", label: "WEB-13", url: sentry(13) },
		},
		// Slack has no state to ask: its card stays until a new run.
		{ ...outside, id: "e", source: { kind: "slack", label: "#support" } },
	];
	expect(subjectsToAsk(runs)).toEqual([
		linear("ENG-1"),
		linear("ENG-2"),
		sentry(12),
		sentry(13),
	]);
	const board = boardColumns(
		runs,
		{ "acme/app": ["triage"] },
		{
			[linear("ENG-1")]: { merged: false, open: false },
			[linear("ENG-2")]: { merged: false, open: true },
			[sentry(12)]: { merged: false, open: false },
			[sentry(13)]: undefined,
		},
	);
	const needsYou = board.stages.find((s) => s.id === "needs-you")?.cards;
	// Done without a number: nothing left to follow, the card leaves the board.
	expect(needsYou?.map((c) => c.run.id).sort()).toEqual(["b", "d", "e"]);
	expect(board.stages.find((s) => s.id === "done")?.cards).toEqual([]);
});

it("counts what each agent is doing, in the order of the factory's board", () => {
	const board = boardColumns(
		[
			{ ...base, id: "r3", number: 9, agent: "implementer", status: "queued" },
			{ ...base, id: "r2", number: 8, agent: "implementer", status: "running" },
			{ ...base, id: "r1", agent: "rework" },
		],
		{ "acme/app": ["triage", "implementer"] },
	);
	expect(board.agents).toEqual([
		{ name: "triage", working: 0, waiting: 0, runs: 0 },
		{ name: "implementer", working: 1, waiting: 1, runs: 2 },
		{ name: "rework", working: 0, waiting: 0, runs: 1 },
	]);
});
