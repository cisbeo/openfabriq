import { expect, it } from "vitest";
import {
	DONE_SHOWN,
	filterStages,
	shownCards,
	stageCount,
	trailSteps,
	writtenCounts,
} from "../../../app/src/features/board/board-view.js";
import type { Board, BoardCard } from "../../../app/src/lib/types.js";

const card = (agent: string, outputs: BoardCard["run"]["outputs"] = []) =>
	({ run: { agent, outputs }, trail: [] }) as unknown as BoardCard;

const board = {
	agents: [],
	stages: [
		{ id: "waiting", cards: [card("triage")] },
		{ id: "working", cards: [card("triage"), card("reviewer")] },
		{ id: "needs-you", cards: [] },
		{ id: "done", cards: [] },
	],
} as unknown as Board;

it("keeps every stage, with only the agent's cards", () => {
	const stages = filterStages(board.stages, "triage");
	expect(stages.map((s) => [s.id, s.cards.length])).toEqual([
		["waiting", 1],
		["working", 1],
		["needs-you", 0],
		["done", 0],
	]);
	expect(filterStages(board.stages, undefined)[1]?.cards).toHaveLength(2);
});

it("counts a stage's cards", () => {
	expect(stageCount(board, "working")).toBe(2);
	expect(stageCount(board, "done")).toBe(0);
});

it("merges consecutive runs of an agent into one step of the trail", () => {
	const trail = [
		"triage",
		"implementer",
		"implementer",
		"reviewer",
		"implementer",
	].map((agent, i) => ({
		id: `r${i}`,
		agent,
		status: "succeeded",
	})) as unknown as BoardCard["trail"];
	expect(trailSteps(trail).map((t) => [t.id, t.agent])).toEqual([
		["r0", "triage"],
		["r1", "implementer"],
		["r3", "reviewer"],
		["r4", "implementer"],
	]);
	expect(trailSteps([])).toEqual([]);
});

it("counts what the latest run wrote, per action, leaving out what it did not write", () => {
	expect(
		writtenCounts(
			card("implementer", [
				{ action: "add_comment", summary: "a", status: "applied" },
				{ action: "create_pull_request", summary: "b", status: "applied" },
				{ action: "add_comment", summary: "c", status: "applied" },
				{ action: "add_labels", summary: "d", status: "refused" },
			]),
		),
	).toEqual([
		["add_comment", 2],
		["create_pull_request", 1],
	]);
});

it("keeps the latest cards in Done and leaves the older ones to Runs", () => {
	const many = Array.from({ length: DONE_SHOWN + 3 }, () => card("triage"));
	expect(shownCards("done", many)).toEqual({
		cards: many.slice(0, DONE_SHOWN),
		older: 3,
	});
	expect(shownCards("done", many.slice(0, 2)).older).toBe(0);
	expect(shownCards("needs-you", many)).toEqual({ cards: many, older: 0 });
});

it("keeps the cards whose latest run shows the words searched, with the agent's filter", () => {
	const titled = (agent: string, title: string) =>
		({
			run: {
				agent,
				title,
				automation: "a",
				outputs: [],
				event: "issue.opened",
				number: 3,
				isPullRequest: false,
			},
			trail: [],
		}) as unknown as BoardCard;
	const stages = [
		{
			id: "done" as const,
			cards: [
				titled("triage", "Bouton Add trop petit"),
				titled("implementer", "Menu responsive"),
			],
		},
	];
	const titles = (agent: string | undefined, text: string) =>
		filterStages(stages, agent, text)[0]?.cards.map((c) => c.run.title);
	expect(titles(undefined, "bouton")).toEqual(["Bouton Add trop petit"]);
	expect(titles(undefined, "  ")).toEqual([
		"Bouton Add trop petit",
		"Menu responsive",
	]);
	expect(titles("triage", "menu")).toEqual([]);
	expect(titles(undefined, "issue #3")).toHaveLength(2);
});
