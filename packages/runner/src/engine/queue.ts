import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { Automation, FactoryEvent } from "@openfabriq/core";
import { readJsonIfExists, writeFileAtomic } from "../files.js";
import { projectDir } from "../state/projects.js";

/** A new run's id: its time, then a little randomness. */
export const newId = () =>
	`${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;

export interface QueuedRun {
	id: string;
	repository: string;
	automation: string;
	/** The issue or pull request; absent for schedule. */
	number?: number;
	repoWide: boolean;
	event: FactoryEvent;
	/** Queued again after the engine stopped during its first attempt: never queued a third time. */
	requeued?: boolean;
	/** When it was queued: kept by the journal once it starts. */
	queuedAt?: string;
	/** No maintainer started it: what it writes starts only low-risk or `from: factory` automations. */
	untrusted?: boolean;
}

/** A run of an automation for an event, ready to queue. */
export const queuedRun = (
	repository: string,
	automation: Automation,
	event: FactoryEvent,
	untrusted = false,
): QueuedRun => ({
	id: newId(),
	repository,
	automation: automation.name,
	...(event.number !== undefined ? { number: event.number } : {}),
	repoWide: automation.concurrency === "repository",
	event,
	...(untrusted ? { untrusted: true } : {}),
});

/** queue.json of a project: what waits and what runs, written at every change. */
export interface SavedQueue {
	queued: QueuedRun[];
	running: QueuedRun[];
}

const queueFile = (repository: string) =>
	join(projectDir(repository), "queue.json");

export function saveQueue(repository: string, saved: SavedQueue): void {
	writeFileAtomic(queueFile(repository), `${JSON.stringify(saved, null, 2)}\n`);
}

export function loadQueue(repository: string): SavedQueue {
	const saved = readJsonIfExists<Partial<SavedQueue>>(queueFile(repository));
	return { queued: saved?.queued ?? [], running: saved?.running ?? [] };
}

/**
 * After a stop: the runs that were running are interrupted, and each goes back in the queue
 * once, with a new id, so that the journal keeps the interrupted attempt.
 */
export function recoverQueue(
	saved: SavedQueue,
	newId: () => string,
): { interrupted: QueuedRun[]; queued: QueuedRun[] } {
	const again = saved.running
		.filter((run) => !run.requeued)
		.map((run) => ({ ...run, id: newId(), requeued: true }));
	return {
		interrupted: saved.running,
		queued: again.reduce((queue, run) => enqueue(queue, run), saved.queued),
	};
}

/** What concurrency `issue` means: one issue or PR, one Slack thread, one Linear or Sentry issue. */
function subject(run: QueuedRun): string {
	const source = run.event.source;
	const key =
		source?.kind === "slack"
			? `slack:${source.channel}:${source.thread}`
			: source?.kind === "linear"
				? `linear:${source.issueId}`
				: source?.kind === "sentry"
					? `sentry:${source.issueId}`
					: source?.kind === "webhook"
						? `webhook:${source.webhook}:${source.delivery}`
						: (run.number ?? run.automation);
	return `${run.repository}#${key}`;
}

/** A Linear agent session waits for its own answer, even on an issue that already has a run waiting. */
const session = (run: QueuedRun) =>
	run.event.source?.kind === "linear"
		? run.event.source.session?.id
		: undefined;

/**
 * Adds a run, unless the same automation is already waiting for the same issue or pull request
 * (and Linear session), or already running for the same event (a cursor written late read it twice).
 */
export function enqueue(
	queue: QueuedRun[],
	run: QueuedRun,
	active: QueuedRun[] = [],
): QueuedRun[] {
	const duplicate =
		queue.some(
			(q) =>
				q.automation === run.automation &&
				subject(q) === subject(run) &&
				session(q) === session(run),
		) ||
		active.some(
			(a) => a.automation === run.automation && a.event.key === run.event.key,
		);
	return duplicate ? queue : [...queue, run];
}

/**
 * The waiting runs that can start now, in order: one run at a time per issue or pull request,
 * a repoWide run alone in its repository, and at most `max` runs in all.
 */
export function startable(
	queue: QueuedRun[],
	active: QueuedRun[],
	max: number,
): QueuedRun[] {
	const running = [...active];
	const picked: QueuedRun[] = [];
	for (const run of queue) {
		if (running.length >= max) break;
		const sameRepo = running.filter((r) => r.repository === run.repository);
		const blocked =
			sameRepo.some((r) => r.repoWide || subject(r) === subject(run)) ||
			(run.repoWide && sameRepo.length > 0);
		if (blocked) continue;
		picked.push(run);
		running.push(run);
	}
	return picked;
}
