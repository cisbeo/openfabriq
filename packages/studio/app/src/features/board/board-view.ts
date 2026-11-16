import type { BoardCard, Board as BoardData, Stage } from "../../lib/types.js";
import { runWords } from "../runs/run-filters.js";

// What the board shows of the server's columns: one agent's cards, a card's trail and outputs.

/** Every stage with only the agent's cards that contain `text`, or all of them without either. */
export const filterStages = (
	stages: BoardData["stages"],
	agent: string | undefined,
	text = "",
) => {
	const wanted = text.trim().toLowerCase();
	return stages.map((s) => ({
		...s,
		cards:
			agent || wanted
				? s.cards.filter(
						(c) =>
							(!agent || c.run.agent === agent) &&
							(!wanted || runWords(c.run).includes(wanted)),
					)
				: s.cards,
	}));
};

/** Done keeps its latest cards: the rest is history, which Runs lists. */
export const DONE_SHOWN = 20;

/** The cards a column shows, latest first, and how many older ones it leaves to Runs. */
export const shownCards = (stage: Stage, cards: BoardCard[]) =>
	stage === "done"
		? {
				cards: cards.slice(0, DONE_SHOWN),
				older: Math.max(0, cards.length - DONE_SHOWN),
			}
		: { cards, older: 0 };

/** How many cards a stage holds. */
export const stageCount = (data: BoardData, stage: Stage) =>
	data.stages.find((x) => x.id === stage)?.cards.length ?? 0;

/** One step per hand-over: runs of the same agent in a row are one step of the work. */
export const trailSteps = (trail: BoardCard["trail"]) =>
	trail.filter((t, i) => i === 0 || trail[i - 1]?.agent !== t.agent);

/** What the latest run wrote, per action in the order first written: [action, count]. */
export function writtenCounts(card: BoardCard): [string, number][] {
	const counts = new Map<string, number>();
	for (const o of card.run.outputs)
		if (o.status === "applied")
			counts.set(o.action, (counts.get(o.action) ?? 0) + 1);
	return [...counts];
}
