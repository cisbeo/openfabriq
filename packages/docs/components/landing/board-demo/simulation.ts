import { POOL, type Subject } from "./subjects";

export type Stage = "waiting" | "working" | "needs" | "done";

/** The board's columns, left to right. */
export const STAGES: Stage[] = ["waiting", "working", "needs", "done"];

export interface Card extends Subject {
	id: number;
	stage: Stage;
	/** The board's clock when the run started, or ended. */
	at: number;
}

const LIMIT: Record<Stage, number> = {
	waiting: 3,
	working: 2,
	needs: 2,
	done: 3,
};

/** "Issue #66" for an issue, the source's name otherwise. */
const subjectOf = (s: Subject, number: number) =>
	s.source === "issue" ? `Issue #${number}` : s.label;

/** The board when it appears: the first six subjects, a week under way. */
export function initialCards(): Card[] {
	const card = (i: number, stage: Stage, at: number): Card => {
		const s = POOL[i] as Subject;
		return { ...s, label: subjectOf(s, 58 + i), id: i, stage, at };
	};
	return [
		card(1, "done", -140),
		card(0, "done", -260),
		card(2, "needs", -90),
		card(3, "working", -8),
		card(4, "waiting", -3),
		card(5, "waiting", -1),
	];
}

/**
 * One tick of the factory: a subject arrives, a run starts, or a run ends. `nextSubject` counts
 * the subjects that arrived, so the next one is the following subject of the pool.
 */
export function advance(
	cards: Card[],
	tick: number,
	clock: number,
	nextSubject: number,
): { cards: Card[]; nextSubject: number } {
	const working = cards.filter((c) => c.stage === "working");
	const waiting = cards.filter((c) => c.stage === "waiting");
	let next = cards;
	let n = nextSubject;
	if (tick % 3 === 0) {
		// The next subject not already on the board: one subject, one card.
		let s = POOL[n % POOL.length] as Subject;
		for (
			let k = 0;
			k < POOL.length && cards.some((c) => c.title === s.title);
			k++
		)
			s = POOL[++n % POOL.length] as Subject;
		next = [
			...cards,
			{
				...s,
				label: subjectOf(s, 58 + n),
				id: 100 + n,
				stage: "waiting",
				at: clock,
			},
		];
		n += 1;
	} else if (tick % 3 === 1 && waiting[0] && working.length < LIMIT.working) {
		const id = waiting[0].id;
		next = cards.map((c) =>
			c.id === id ? { ...c, stage: "working", at: clock } : c,
		);
	} else if (working[0]) {
		const id = working[0].id;
		// The newest card of a column comes first: a finished run goes to the top.
		const ended = {
			...working[0],
			stage: working[0].outcome.stage,
			at: clock,
		} as Card;
		next = [ended, ...cards.filter((c) => c.id !== id)];
	}
	// Each column keeps its newest cards; the oldest leave from the bottom.
	return {
		cards: STAGES.flatMap((stage) => {
			const column = next.filter((c) => c.stage === stage);
			return stage === "waiting"
				? column.slice(-LIMIT[stage])
				: column.slice(0, LIMIT[stage]);
		}),
		nextSubject: n,
	};
}
