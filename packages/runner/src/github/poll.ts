import {
	type Factory,
	type FactoryEvent,
	needsChangedFiles,
} from "@openfabriq/core";
import { cursorHead, overlap, SEEN_KEPT } from "../engine/cursors.js";
import { errorText } from "../files.js";
import { failedChecks } from "./checks.js";
import type { GitHub, OpenPull } from "./github.js";
import { itemEvents } from "./timeline.js";

/** How far GitHub has been read, per project. */
export interface Cursor {
	since: string;
	seen: string[];
	heads: Record<string, string>;
	/** Head commit of the default branch; absent in older cursors. */
	branch?: string;
}

/** What a poll found: the events to queue, and the cursor to write once they are queued. */
export interface Poll {
	events: FactoryEvent[];
	cursor: Cursor;
	/** The default branch has a new head, the engine's own merge included. */
	headMoved: boolean;
	/** The engine's auto-merges GitHub kept on a pushed pull request: tried again at the next poll. */
	autoMergeStillOn: { number: number; reason: string }[];
}

/** The open pull requests and the branches they stand on, read first. */
interface Snapshot {
	pulls: OpenPull[];
	defaultBranch: string;
	/** The default branch's head. */
	branch: string;
	/** The head of the default branch and of each base a pull request in conflict is on. */
	baseHeads: Map<string, string>;
}

/** A new head of the default branch, the engine's own merge included, and who made it. */
type BranchMove = { actor: string };

/**
 * What happened on GitHub since the last poll: issues and pull requests updated, pushes to pull
 * requests, failing checks, new commits on the default branch. Everything is read before
 * anything is returned: a failure leaves the cursor, and nothing runs twice.
 */
export async function pollGitHub(
	repo: string,
	factory: Factory,
	defaultBranch: string,
	{
		github,
		now,
		saved,
		engineMerges,
	}: {
		github: GitHub;
		now: () => Date;
		/** The cursor the last poll left; undefined at the first start. */
		saved: Cursor | undefined;
		/** The pull requests the engine merged, or let GitHub merge. */
		engineMerges: () => number[];
	},
): Promise<Poll> {
	const started = now();
	const snapshot = await readSnapshot(github, repo, defaultBranch);
	// First start: only what happens from now on counts.
	if (!saved)
		return {
			events: [],
			cursor: firstCursor(snapshot, started),
			headMoved: false,
			autoMergeStillOn: [],
		};
	const cursor = migrated(saved, snapshot);
	const updated = await readItemEvents(github, repo, cursor.since);
	const autoMergeStillOn = await disableStaleAutoMerges(
		github,
		repo,
		snapshot.pulls,
		cursor,
		engineMerges(),
	);
	const move = await readBranchMove(github, repo, cursor, snapshot.branch);
	const fresh = newEvents(snapshot, cursor, updated, move, started);
	const lastHead = cursorHead(cursor);
	return {
		events: await withChangedFiles(github, repo, factory, fresh),
		cursor: nextCursor(snapshot, cursor, fresh, started, autoMergeStillOn),
		headMoved: lastHead !== undefined && lastHead !== snapshot.branch,
		autoMergeStillOn,
	};
}

async function readSnapshot(
	github: GitHub,
	repo: string,
	defaultBranch: string,
): Promise<Snapshot> {
	const [pulls, branch] = await Promise.all([
		github.openPulls(repo),
		github.branchHead(repo, defaultBranch),
	]);
	// A conflict starts once per head and base commit: a new merge on the base starts it again.
	// The base's head is read here: gh's baseRefOid does not follow the base branch (seen on 6 November 2026).
	const baseHeads = new Map([[defaultBranch, branch]]);
	for (const base of new Set(
		conflicted(pulls).map((p) => p.base ?? defaultBranch),
	))
		if (!baseHeads.has(base))
			baseHeads.set(base, await github.branchHead(repo, base));
	return { pulls, defaultBranch, branch, baseHeads };
}

/** The events of the issues and pull requests updated since `since`. */
async function readItemEvents(
	github: GitHub,
	repo: string,
	since: string,
): Promise<FactoryEvent[]> {
	const events: FactoryEvent[] = [];
	for (const item of await github.issuesUpdatedSince(repo, since))
		events.push(
			...itemEvents(item, await github.timeline(repo, item.number), since),
		);
	return events;
}

/**
 * GitHub keeps an auto-merge when someone with write access pushes: the engine turns its own off,
 * so new commits wait for a new review (seen on 6 November 2026). The pull requests where it
 * fails keep their former head in the cursor: the next poll sees the push again and tries again.
 */
async function disableStaleAutoMerges(
	github: GitHub,
	repo: string,
	pulls: OpenPull[],
	cursor: Cursor,
	ownAutoMerges: number[],
): Promise<Poll["autoMergeStillOn"]> {
	const stillOn: Poll["autoMergeStillOn"] = [];
	for (const pull of pulls)
		if (
			pushed(cursor, pull) &&
			pull.autoMerge &&
			ownAutoMerges.includes(pull.number)
		)
			await github
				.disableAutoMerge(repo, pull.number)
				.catch((error: unknown) =>
					stillOn.push({ number: pull.number, reason: errorText(error) }),
				);
	return stillOn;
}

/** How the default branch moved since the last poll; undefined when it did not, or the cursor is too old to tell. */
async function readBranchMove(
	github: GitHub,
	repo: string,
	cursor: Cursor,
	branch: string,
): Promise<BranchMove | undefined> {
	if (cursor.branch === undefined || cursor.branch === branch) return undefined;
	return { actor: await github.commitAuthor(repo, branch) };
}

/** The events not seen yet, oldest first. Checks and conflicts already seen are dropped with them. */
function newEvents(
	snapshot: Snapshot,
	cursor: Cursor,
	updated: FactoryEvent[],
	move: BranchMove | undefined,
	started: Date,
): FactoryEvent[] {
	const at = started.toISOString();
	const pullEvent = (
		pull: OpenPull,
		key: string,
		event:
			| "pull_request.updated"
			| "pull_request.checks_failed"
			| "pull_request.conflicted",
	): FactoryEvent => ({
		key,
		event,
		number: pull.number,
		isPullRequest: true,
		// The pull request's author: a commit's author is only its e-mail, which anyone can write.
		actor: pull.author,
		at,
		...(pull.fromUntrustedRun ? { fromUntrustedRun: true } : {}),
	});
	const events: FactoryEvent[] = [
		...updated,
		...snapshot.pulls
			.filter((p) => pushed(cursor, p))
			.map((p) =>
				pullEvent(p, `push:${p.number}:${p.sha}`, "pull_request.updated"),
			),
		...conflicted(snapshot.pulls).map((p) =>
			pullEvent(p, conflictKey(snapshot, p), "pull_request.conflicted"),
		),
		...failing(snapshot.pulls).map((p) =>
			pullEvent(p, checksKey(p), "pull_request.checks_failed"),
		),
	];
	// The engine's own merge counts too: a factory can go on from what it merged, such as the next
	// tickets of a plan. An automation on this event starts again after its own merges: its brief stops it.
	if (move)
		events.push({
			key: `branch:${snapshot.branch}`,
			event: "default_branch.updated",
			isPullRequest: false,
			actor: move.actor,
			commits: `${cursor.branch}..${snapshot.branch}`,
			at,
		});
	const seen = new Set(cursor.seen);
	return events
		.filter((e) => !seen.has(e.key))
		.sort((a, b) => a.at.localeCompare(b.at));
}

/** The events, with the files they change when an automation's ignore_paths needs them. */
async function withChangedFiles(
	github: GitHub,
	repo: string,
	factory: Factory,
	events: FactoryEvent[],
): Promise<FactoryEvent[]> {
	const read: FactoryEvent[] = [];
	for (const event of events) {
		if (!needsChangedFiles(factory, event)) read.push(event);
		else if (event.number !== undefined)
			read.push({
				...event,
				files: await github.changedFiles(repo, event.number),
			});
		else if (event.commits) {
			// A compare GitHub cannot answer (a force push, a huge diff) must not stop every event of
			// the repository: without the list, the run happens, as when GitHub cuts it.
			const files = await github
				.commitFiles(repo, event.commits)
				.catch(() => undefined);
			read.push(files ? { ...event, files } : event);
		} else read.push(event);
	}
	return read;
}

const firstCursor = (snapshot: Snapshot, started: Date): Cursor => ({
	since: started.toISOString(),
	seen: [
		...failing(snapshot.pulls).map(checksKey),
		...conflicted(snapshot.pulls).map((p) => conflictKey(snapshot, p)),
	],
	heads: headsOf(snapshot.pulls),
	branch: snapshot.branch,
});

/** An older cursor, without the branch: the checks failing now are not news either. */
const migrated = (cursor: Cursor, snapshot: Snapshot): Cursor =>
	cursor.branch === undefined
		? {
				...cursor,
				seen: [...cursor.seen, ...failing(snapshot.pulls).map(checksKey)],
			}
		: cursor;

/** Where the next poll starts. */
const nextCursor = (
	snapshot: Snapshot,
	cursor: Cursor,
	fresh: FactoryEvent[],
	started: Date,
	stillOn: Poll["autoMergeStillOn"],
): Cursor => ({
	since: overlap(started),
	seen: [...cursor.seen, ...fresh.map((e) => e.key)].slice(-SEEN_KEPT),
	heads: {
		...headsOf(snapshot.pulls),
		...Object.fromEntries(
			stillOn.map(({ number }) => [
				String(number),
				cursor.heads[String(number)] ?? "",
			]),
		),
	},
	branch: snapshot.branch,
});

const headsOf = (pulls: OpenPull[]) =>
	Object.fromEntries(pulls.map((p) => [String(p.number), p.sha]));
/** A new head since the last poll; a pull request it did not know yet is not a push. */
function pushed(cursor: Cursor, pull: OpenPull): boolean {
	const before = cursor.heads[String(pull.number)];
	return !!before && before !== pull.sha;
}
const failing = (pulls: OpenPull[]) =>
	pulls.filter((p) => failedChecks(p.checks).length > 0);
const conflicted = (pulls: OpenPull[]) =>
	pulls.filter((p) => p.mergeable === "CONFLICTING");
const checksKey = (p: OpenPull) => `checks:${p.number}:${p.sha}`;
const conflictKey = (snapshot: Snapshot, p: OpenPull) =>
	`conflict:${p.number}:${p.sha}:${snapshot.baseHeads.get(p.base ?? snapshot.defaultBranch) ?? ""}`;
