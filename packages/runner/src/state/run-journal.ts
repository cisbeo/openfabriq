import { engineMerges, rememberMerge } from "../engine/cursors.js";
import { appendRun, costToday, type RunRecord, readRuns } from "./journal.js";

/** What a run and the engine read and write of the runs' history: runs.jsonl, and the engine's merges. */
export interface RunJournal {
	append(record: RunRecord): void;
	/** The runs of one project, or of all, latest first. */
	read(repository?: string): RunRecord[];
	/** Cost of the runs that ended today, in the machine's local day. */
	costToday(repository: string, now?: Date): number;
	/** The pull requests the engine merged, or let GitHub merge. */
	engineMerges(repository: string): number[];
	rememberMerge(repository: string, number: number): void;
}

/** The journal in the project's folder, on this machine's disk. */
export const diskJournal: RunJournal = {
	append: appendRun,
	read: readRuns,
	costToday,
	engineMerges,
	rememberMerge,
};
