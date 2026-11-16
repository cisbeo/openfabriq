import { statSync } from "node:fs";
import { join } from "node:path";
import type { Factory } from "@openfabriq/core";
import { errorText } from "../files.js";
import {
	executeRun,
	type RunDeps,
	takeOffWorkingLabel,
} from "../run/execute.js";
import { baseRecord } from "../run/record.js";
import type { RunRecord } from "../state/journal.js";
import {
	listProjects,
	projectDir,
	readAppliedFactory,
} from "../state/projects.js";
import {
	enqueue,
	loadQueue,
	newId,
	type QueuedRun,
	recoverQueue,
	saveQueue,
	startable,
} from "./queue.js";

/** The factory of each project polled at least once, with its default branch. */
export type Factories = Map<
	string,
	{ factory: Factory; defaultBranch: string }
>;

/**
 * The waiting and the running runs. Every change is saved in queue.json; a run
 * starts once its project's factory is loaded and the concurrency lets it.
 */
export function scheduler(
	deps: RunDeps & {
		log: (line: string) => void;
		keepAwake?: (awake: boolean) => void;
	},
	maxRuns: number,
	factories: Factories,
) {
	const now = deps.now ?? (() => new Date());
	let queue: QueuedRun[] = [];
	const active = new Map<string, QueuedRun>();
	let restored = false;
	let stopped = false;

	function persist(repo: string) {
		const mine = (r: QueuedRun) => r.repository === repo;
		saveQueue(repo, {
			queued: queue.filter(mine),
			running: [...active.values()].filter(mine),
		});
	}

	/** At the first tick: what waited is queued again; what ran is failed, then queued once more. */
	function restore() {
		if (restored) return;
		restored = true;
		for (const { repository: repo } of listProjects())
			try {
				restoreProject(repo);
			} catch (error) {
				deps.log(`${repo}: queue not restored: ${errorText(error)}`);
			}
	}

	function restoreProject(repo: string) {
		const saved = loadQueue(repo);
		if (saved.queued.length + saved.running.length === 0) return;
		const previous = new Map(deps.journal.read(repo).map((r) => [r.id, r]));
		const factory = readAppliedFactory(repo);
		removeStaleWorktrees(deps.workspace, repo, saved.running);
		// Stopped while they worked, or before they took the working label off. The engine's writes go
		// out in order: a run queued again puts it back after this.
		for (const run of saved.running)
			if (run.number !== undefined)
				void takeOffWorkingLabel(deps.github, repo, run.number, deps.log);
		// A run the journal says ended stopped after its outputs: never again. One that wrote some
		// already is not queued again either, as if it had been once: it would write them twice.
		const published = (r: QueuedRun) =>
			previous.get(r.id)?.outputs.some((o) => o.status === "applied") ?? false;
		const recovered = recoverQueue(
			{
				queued: saved.queued,
				running: saved.running
					.filter((r) => !previous.get(r.id)?.endedAt)
					.map((r) => (published(r) ? { ...r, requeued: true } : r)),
			},
			newId,
		);
		for (const run of recovered.interrupted) {
			const ended = now().toISOString();
			deps.journal.append(
				interruptedRecord(
					run,
					factory,
					previous.get(run.id),
					ended,
					lastWritten(repo, run.id, ended),
				),
			);
			closeAbandonedSession(run, deps);
		}
		requeue(saved.queued, recovered.queued, factory);
		persist(repo);
		deps.log(
			`${repo}: restored ${saved.queued.length} waiting and ${recovered.interrupted.length} interrupted runs`,
		);
	}

	/** Waiting runs are already in the journal; interrupted ones come back under a new id. */
	function requeue(
		waited: QueuedRun[],
		recovered: QueuedRun[],
		factory: Factory | undefined,
	) {
		const waiting = new Set(waited.map((r) => r.id));
		for (const run of recovered)
			if (waiting.has(run.id))
				queue = enqueue(queue, run, [...active.values()]);
			else add(run, factory);
	}

	function add(run: QueuedRun, factory: Factory | undefined) {
		const queued = { ...run, queuedAt: run.queuedAt ?? now().toISOString() };
		const before = queue;
		queue = enqueue(queue, queued, [...active.values()]);
		if (queue === before) return;
		try {
			persist(run.repository);
		} catch (error) {
			// Not queued at all: the next poll reads the event again and queues it then.
			queue = before;
			throw error;
		}
		deps.journal.append(baseRecord(queued, factory, queued.queuedAt));
		// A manual run borrows its automation's event: the log says who asked instead.
		const why = run.event.key.startsWith("manual:")
			? `manual run by ${run.event.actor}`
			: run.event.event;
		deps.log(
			`queued ${run.repository}${run.number ? ` #${run.number}` : ""}: ${run.automation} (${why})`,
		);
	}

	// Awake while a run works, on the local machine; told only when it changes.
	let awake = false;
	const stayAwake = () => {
		if (awake === active.size > 0) return;
		awake = active.size > 0;
		deps.keepAwake?.(awake);
	};

	function pump() {
		if (stopped) return;
		// A run waits until its project's factory is loaded (after a restart, or a failed poll).
		const ready = queue.filter((q) => factories.has(q.repository));
		for (const run of startable(ready, [...active.values()], maxRuns)) {
			const known = factories.get(run.repository);
			if (!known) continue;
			const before = queue;
			queue = queue.filter((q) => q.id !== run.id);
			active.set(run.id, run);
			try {
				persist(run.repository);
			} catch (error) {
				// Not started at all: it waits in the queue, and a later tick starts it.
				queue = before;
				active.delete(run.id);
				throw error;
			}
			stayAwake();
			const name = `${run.repository}${run.number ? ` #${run.number}` : ""}: ${run.automation}`;
			deps.log(`started ${name}`);
			// executeRun never throws, but its journal can (a full disk): the slot is freed all the same.
			void executeRun(run, known.factory, deps, known.defaultBranch)
				.then(
					(record) =>
						deps.log(
							`${record.status} ${name}` +
								`${record.reason ? ` (${record.reason})` : ""}${record.costUsd ? `, ${record.costUsd.toFixed(2)} USD` : ""}`,
						),
					(error: unknown) => deps.log(`failed ${name} (${errorText(error)})`),
				)
				.finally(() => {
					active.delete(run.id);
					stayAwake();
					persist(run.repository);
					pump();
				})
				.catch((error: unknown) => deps.log(`${name}: ${errorText(error)}`));
		}
	}

	return {
		add,
		pump,
		restore,
		/** The running runs end; no other starts. */
		stop() {
			stopped = true;
		},
		status: () => ({ queued: [...queue], active: [...active.values()] }),
	};
}

/** The worktrees of the runs the engine's stop interrupted stayed on disk. */
function removeStaleWorktrees(
	workspace: RunDeps["workspace"],
	repo: string,
	running: QueuedRun[],
) {
	for (const run of running)
		for (const dir of [run.id, `${run.id}-merge`])
			void workspace
				.remove(
					join(projectDir(repo), "repo"),
					join(projectDir(repo), "worktrees", dir),
				)
				.catch(() => undefined);
}

/**
 * The journal's last line for a run the engine's stop interrupted: what it knew of the run, failed,
 * and timed until `lastWrittenMs` when the run had started.
 */
function interruptedRecord(
	run: QueuedRun,
	factory: Factory | undefined,
	previous: RunRecord | undefined,
	ended: string,
	lastWrittenMs: number,
): RunRecord {
	const started = previous?.startedAt;
	// A run stopped before Claude Code said its cost counts its whole budget, as a timeout does.
	const budget = started ? factory?.limits.usd_per_run : undefined;
	return {
		...baseRecord(run, factory, ended),
		...previous,
		...(previous?.costUsd === undefined && budget !== undefined
			? { costUsd: budget }
			: {}),
		status: "failed",
		reason: "interrupted: the engine stopped",
		endedAt: ended,
		...(started ? { durationMs: lastWrittenMs - Date.parse(started) } : {}),
	};
}

/** Not queued a third time: its Linear session would wait forever without a last word. */
function closeAbandonedSession(
	run: QueuedRun,
	deps: Pick<RunDeps, "linearApp"> & { log: (line: string) => void },
) {
	const session =
		run.event.source?.kind === "linear" && run.event.source.session;
	if (run.requeued && session && deps.linearApp)
		void deps
			.linearApp(session.organizationId)
			.activity(session.id, {
				type: "error",
				body: "openfabriq stopped: the run was interrupted twice.",
			})
			.catch((error: unknown) =>
				deps.log(`linear: the error activity failed: ${errorText(error)}`),
			);
}

/** When an interrupted run last wrote its transcript: about when the engine stopped, not when it restarted. */
function lastWritten(repo: string, id: string, restarted: string): number {
	const transcript = join(projectDir(repo), "runs", id, "transcript.jsonl");
	try {
		return Math.min(statSync(transcript).mtimeMs, Date.parse(restarted));
	} catch {
		return Date.parse(restarted);
	}
}
