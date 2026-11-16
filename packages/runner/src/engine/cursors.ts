import { join } from "node:path";
import { readJsonIfExists, writeFileAtomic } from "../files.js";
import { projectDir } from "../state/projects.js";

const OVERLAP_MS = 2 * 60_000; // re-read a little, dedupe by key: GitHub's clock and ours differ
/** How many keys of events already seen a cursor keeps. */
export const SEEN_KEPT = 5000;
/** Adds a key to a set of keys already seen, forgetting the oldest past SEEN_KEPT. */
export function remember(seen: Set<string>, key: string): void {
	seen.add(key);
	if (seen.size > SEEN_KEPT) seen.delete(seen.values().next().value as string);
}

/** How far GitHub has been read, per project. */
export const cursorPath = (repo: string) =>
	join(projectDir(repo), "cursor.json");
/** The default branch's head as the last poll left it; an older cursor kept the engine's own merge apart. */
export const cursorHead = (cursor: { branch?: string; mergedHead?: string }) =>
	cursor.mergedHead ?? cursor.branch;
/** Until when the schedules were checked, per project. */
export const scheduleCursorPath = (repo: string) =>
	join(projectDir(repo), "schedule-cursor.json");
/** A cursor file: written then renamed, so that a stop never leaves half of one. */
export const writeCursor = (path: string, cursor: unknown) =>
	writeFileAtomic(path, JSON.stringify(cursor));
/** The pull requests the engine merged, or let GitHub merge, per project. */
const mergesPath = (repo: string) => join(projectDir(repo), "merges.json");
const MERGES_KEPT = 500;
export const engineMerges = (repo: string) =>
	readJsonIfExists<number[]>(mergesPath(repo)) ?? [];
export function rememberMerge(repo: string, number: number): void {
	const kept = engineMerges(repo).filter((n) => n !== number);
	writeFileAtomic(
		mergesPath(repo),
		JSON.stringify([...kept, number].slice(-MERGES_KEPT)),
	);
}
/** Where the next poll starts: a little before this one. */
export const overlap = (started: Date) =>
	new Date(started.getTime() - OVERLAP_MS).toISOString();
