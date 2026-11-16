import type { RunRecord, RunStatus } from "@openfabriq/runner";
import { costLimited, handedOver, subjectKey } from "../runs/story.js";
import type { SubjectStates } from "../subjects/subject-state.js";

/** The four steps of the work, in reading order. */
export const STAGES = ["waiting", "working", "needs-you", "done"] as const;
export type Stage = (typeof STAGES)[number];

export interface BoardCard {
	/** The latest run about this issue, pull request or repository-wide automation. */
	run: RunRecord;
	/** The runs about the same subject, oldest first: who touched it, in order. */
	trail: { id: string; agent: string; status: RunStatus }[];
}

export interface Board {
	stages: { id: Stage; cards: BoardCard[] }[];
	/** Every agent of the board, with what it is doing now. */
	agents: { name: string; working: number; waiting: number; runs: number }[];
}

const TRAIL = 8;

/** The URL to ask about: a GitHub issue or pull request, a Linear or a Sentry issue. A Slack thread has no state to ask. */
export const subjectUrl = (run: RunRecord) =>
	run.number !== undefined ||
	run.source?.kind === "linear" ||
	run.source?.kind === "sentry"
		? (run.url ?? run.source?.url)
		: undefined;

function stage(run: RunRecord, states: SubjectStates = {}): Stage {
	if (run.status === "queued") return "waiting";
	if (run.status === "running") return "working";
	// Merged, closed, done or resolved since: nobody is waiting on it any more.
	const url = subjectUrl(run);
	if (url && states[url]?.open === false) return "done";
	if (run.status === "failed" || costLimited(run)) return "needs-you";
	// Handed over, until someone takes `needs-human` off it.
	if (handedOver(run))
		return url && states[url]?.needsHuman === false ? "done" : "needs-you";
	return "done";
}

/** The latest run of each subject, latest first. */
function latestRuns(runs: RunRecord[]): RunRecord[] {
	const seen = new Set<string>();
	return runs.filter((run) => {
		const key = subjectKey(run);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** The subjects to ask GitHub, Linear or Sentry about: those whose card needs someone. */
export function subjectsToAsk(runs: RunRecord[]): string[] {
	return latestRuns(runs)
		.filter((r) => stage(r) === "needs-you")
		.flatMap((r) => subjectUrl(r) ?? []);
}

const activity = (run: RunRecord) =>
	new Date(run.endedAt ?? run.startedAt ?? run.queuedAt).getTime();

/**
 * One card per issue or pull request, in the stage of its latest run, or of its run at work. A run about the whole
 * repository (schedule, default branch) is a card while it waits, works or needs someone:
 * once done, it has nothing left to follow. A card that needs someone goes to done once its
 * issue or pull request is closed or merged on GitHub, or its Linear or Sentry issue is over (`states`). `runs` come latest first.
 */
export function boardColumns(
	runs: RunRecord[],
	agentOrders: Record<string, string[]>,
	states: SubjectStates = {},
): Board {
	const bySubject = new Map<string, RunRecord[]>();
	for (const run of runs) {
		const key = subjectKey(run);
		const subjectRuns = bySubject.get(key);
		// Pushed, not copied: a scheduled automation's thousands of runs share one key.
		if (subjectRuns) subjectRuns.push(run);
		else bySubject.set(key, [run]);
	}

	const cards = new Map<Stage, BoardCard[]>(STAGES.map((s) => [s, []]));
	for (const subjectRuns of bySubject.values()) {
		// A run at work shows the card, not the one waiting behind it (a rework after a conflict's resolution).
		const latest =
			subjectRuns.find((r) => r.status === "running") ?? subjectRuns[0];
		if (!latest) continue;
		const where = stage(latest, states);
		if (where === "done" && latest.number === undefined) continue;
		const trail = subjectRuns
			.slice(0, TRAIL)
			.reverse()
			.map((r) => ({ id: r.id, agent: r.agent, status: r.status }));
		cards.get(where)?.push({ run: latest, trail });
	}
	// First in line first while waiting; latest news first everywhere else.
	cards
		.get("waiting")
		?.sort((a, b) => a.run.queuedAt.localeCompare(b.run.queuedAt));
	for (const s of ["working", "needs-you", "done"] as const)
		cards.get(s)?.sort((a, b) => activity(b.run) - activity(a.run));

	const names = [...new Set(Object.values(agentOrders).flat())];
	for (const run of runs) if (!names.includes(run.agent)) names.push(run.agent);
	const agents = names.map((name) => {
		const own = runs.filter((r) => r.agent === name);
		return {
			name,
			working: own.filter((r) => r.status === "running").length,
			waiting: own.filter((r) => r.status === "queued").length,
			runs: own.length,
		};
	});

	return {
		stages: STAGES.map((id) => ({ id, cards: cards.get(id) ?? [] })),
		agents,
	};
}
