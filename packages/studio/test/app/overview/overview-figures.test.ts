import { describe, expect, it } from "vitest";
import {
	axisTicks,
	costRatios,
	gains,
	percent,
	productivity,
	returns,
	runsPerDay,
	spendingParts,
	unaided,
	waitingFor,
} from "../../../app/src/features/overview/overview-figures.js";
import { agentHues } from "../../../app/src/lib/agent-hue.js";
import type { Board, Metrics } from "../../../app/src/lib/types.js";

const metrics = (over: Partial<Metrics> = {}): Metrics => ({
	period: "7d",
	runs: {
		total: 0,
		succeeded: 0,
		failed: 0,
		skipped: 0,
		active: 0,
		unaided: 0,
	},
	agentTimeMs: 0,
	cost: { totalUsd: 0, chatUsd: 0, failedUsd: 0, byAgent: [], byDay: [] },
	pullRequests: { opened: 0, merged: 0, closed: 0, unknown: 0 },
	interventions: { total: 0, handoffs: 0, failedRuns: 0, refusedOutputs: 0 },
	outputs: [],
	gains: {
		merged: { asWritten: 0, changed: 0, unknown: 0 },
		issueToMerge: { factoryPulls: 0, teamPulls: 0 },
	},
	...over,
});

it("draws an axis in about four round steps, whole when asked", () => {
	expect(axisTicks(18)).toEqual([0, 5, 10, 15, 20]);
	expect(axisTicks(0.37)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
	expect(axisTicks(3, 1)).toEqual([0, 1, 2, 3]);
	expect(axisTicks(1, 1)).toEqual([0, 1]);
	expect(axisTicks(0.012, 0.01)).toEqual([0, 0.01, 0.02]);
	expect(axisTicks(0)).toEqual([0, 1]);
});

it("cuts a whole in parts, nothing of nothing", () => {
	expect(percent(1, 4)).toBe("25%");
	expect(percent(3, 0)).toBe("0%");
});

describe("the productivity cards", () => {
	it("say what each figure is made of, and scale the outputs to the most", () => {
		const p = productivity(
			metrics({
				runs: {
					total: 5,
					succeeded: 3,
					failed: 1,
					skipped: 0,
					active: 1,
					unaided: 2,
				},
				pullRequests: { opened: 5, merged: 1, closed: 1, unknown: 1 },
				interventions: {
					total: 3,
					handoffs: 2,
					failedRuns: 1,
					refusedOutputs: 0,
				},
				outputs: [
					{ action: "push_to_pull_request", count: 5 },
					{ action: "create_pull_request", count: 4 },
					{ action: "add_comment", count: 1 },
				],
			}),
		);
		expect(p.steppedInWords).toBe("2 handoffs · 1 failed run");
		expect(p.outputs.map((a) => a.action)).toEqual([
			"push_to_pull_request",
			"create_pull_request",
			"add_comment",
		]);
		expect(p.applied).toBe(10);
		expect(p.most).toBe(5);
	});

	it("name a figure made of one part without repeating its number", () => {
		const p = productivity(
			metrics({
				runs: {
					total: 21,
					succeeded: 21,
					failed: 0,
					skipped: 0,
					active: 0,
					unaided: 15,
				},
				interventions: {
					total: 6,
					handoffs: 6,
					failedRuns: 0,
					refusedOutputs: 0,
				},
			}),
		);
		expect(p.steppedInWords).toBe("handoffs");
		expect(
			productivity(
				metrics({
					interventions: {
						total: 1,
						handoffs: 0,
						failedRuns: 1,
						refusedOutputs: 0,
					},
				}),
			).steppedInWords,
		).toBe("failed run");
	});

	it("say nothing of what is zero", () => {
		const p = productivity(metrics());
		expect(p.steppedInWords).toBe("");
		expect(p.applied).toBe(0);
		expect(p.most).toBe(0);
	});
});

it("says how many finished runs needed nobody, only what is known", () => {
	expect(unaided(metrics())).toEqual({ share: undefined, words: "" });
	expect(
		unaided(
			metrics({
				agentTimeMs: 90_000,
				runs: {
					total: 4,
					succeeded: 2,
					failed: 1,
					skipped: 1,
					active: 0,
					unaided: 1,
				},
			}),
		),
	).toEqual({
		share: "33%",
		words: "1 of 3 finished runs · 1m 30s of agent work",
	});
});

it("says what the factory saved, as far as GitHub tells", () => {
	expect(gains(metrics())).toEqual({
		asWritten: undefined,
		asWrittenWords: "",
		issueToMerge: undefined,
		issueToMergeWords: "",
	});
	expect(
		gains(
			metrics({
				gains: {
					merged: { asWritten: 3, changed: 1, unknown: 2 },
					issueToMerge: {
						factoryMs: 5 * 3_600_000 + 20 * 60_000,
						factoryPulls: 1,
						teamMs: 3.2 * 86_400_000,
						teamPulls: 12,
					},
				},
			}),
		),
	).toEqual({
		asWritten: 3,
		asWrittenWords: "of 6 merged · 1 changed by a person · 2 not checked",
		issueToMerge: "5 h 20 min",
		issueToMergeWords:
			"median of 1 pull request · your team: 3.2 days, 12 pull requests in 90 days",
	});
});

it("gives the return: the cost of a pull request merged as written, and the wait against the team's", () => {
	expect(returns(metrics())).toEqual({
		perAsWritten: undefined,
		timeGained: undefined,
		timeGainedWords: "",
	});
	const hour = 3_600_000;
	const m = (factoryMs: number, teamMs: number) =>
		metrics({
			cost: { totalUsd: 6, chatUsd: 0, failedUsd: 0, byAgent: [], byDay: [] },
			gains: {
				merged: { asWritten: 3, changed: 1, unknown: 0 },
				issueToMerge: { factoryMs, factoryPulls: 3, teamMs, teamPulls: 9 },
			},
		});
	expect(returns(m(6 * hour, 102 * hour))).toEqual({
		perAsWritten: 2,
		timeGained: "4.0 days",
		timeGainedWords: "issue to merge: 6 h, your team: 4.3 days",
	});
	expect(returns(m(5 * hour, 2 * hour)).timeGained).toBe("3 h lost");
});

it("lists the agents that spent or ran, and the chat only when it spent", () => {
	const parts = spendingParts(
		metrics({
			cost: {
				totalUsd: 2,
				chatUsd: 0,
				failedUsd: 0,
				byDay: [],
				byAgent: [
					{ agent: "triage", usd: 0, runs: 2 },
					{ agent: "idle", usd: 0, runs: 0 },
					{ agent: "implementer", usd: 2, runs: 1 },
				],
			},
		}),
		agentHues([]),
	);
	expect(parts.map((p) => p.key)).toEqual(["triage", "implementer"]);
	const withChat = spendingParts(
		metrics({
			cost: { totalUsd: 1, chatUsd: 1, failedUsd: 0, byDay: [], byAgent: [] },
		}),
		agentHues([]),
	);
	expect(withChat).toEqual([
		{ key: "chat", value: 1, runs: undefined, color: "var(--fg-3)" },
	]);
});

it("divides the cost by units of work, none without any", () => {
	expect(costRatios(metrics())).toEqual({
		perRun: undefined,
		perMergedPr: undefined,
	});
	expect(
		costRatios(
			metrics({
				runs: {
					total: 4,
					succeeded: 4,
					failed: 0,
					skipped: 0,
					active: 0,
					unaided: 4,
				},
				cost: {
					totalUsd: 10,
					chatUsd: 2,
					failedUsd: 0,
					byAgent: [],
					byDay: [],
				},
				pullRequests: { opened: 3, merged: 2, closed: 0, unknown: 0 },
			}),
		),
	).toEqual({ perRun: 2, perMergedPr: 5 });
});

it("counts the project's cards that need a person, once the board is read", () => {
	const card = (repository: string) =>
		({
			run: { repository },
			trail: [],
		}) as unknown as Board["stages"][number]["cards"][number];
	const board = {
		agents: [],
		stages: [
			{ id: "needs-you", cards: [card("acme/shop"), card("acme/other")] },
		],
	} as unknown as Board;
	expect(waitingFor(board, "acme/shop")).toBe(1);
	expect(waitingFor(undefined, "acme/shop")).toBeUndefined();
});

describe("runsPerDay", () => {
	const byDay = [
		{ day: "2026-11-04", runs: 3, agents: { triage: 1, implementer: 2 } },
		{ day: "2026-11-05", runs: 0, agents: {} },
	];
	it("splits each day by agent, in the same order every day", () => {
		expect(runsPerDay(byDay)).toEqual([
			{
				day: "2026-11-04",
				value: 3,
				parts: [
					{ key: "implementer", value: 2 },
					{ key: "triage", value: 1 },
				],
			},
			{ day: "2026-11-05", value: 0, parts: [] },
		]);
	});
	it("shows one agent's runs when the filter names it", () => {
		expect(runsPerDay(byDay, "triage")).toEqual([
			{ day: "2026-11-04", value: 1 },
			{ day: "2026-11-05", value: 0 },
		]);
	});
});
