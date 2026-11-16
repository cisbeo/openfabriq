import { dueRun, type Factory } from "@openfabriq/core";
import { readJsonIfExists } from "../files.js";
import { scheduleCursorPath, writeCursor } from "./cursors.js";
import { type QueuedRun, queuedRun } from "./queue.js";

/**
 * The runs the schedules owe between the last check (excluded) and this one (included): at most
 * one per trigger, so a night missed while the machine slept, or while the engine was stopped,
 * runs once.
 */
export function dueRuns(
	repo: string,
	factory: Factory,
	since: Date,
	checkedAt: Date,
): QueuedRun[] {
	return Object.values(factory.automations).flatMap((automation) =>
		automation.when.flatMap((trigger) => {
			const due =
				trigger.cron &&
				dueRun(trigger.cron, since, checkedAt, factory.timezone);
			if (!due) return [];
			return [
				queuedRun(repo, automation, {
					key: `schedule:${automation.name}:${due.toISOString().slice(0, 16)}`,
					event: "schedule",
					isPullRequest: false,
					actor: "schedule",
					at: due.toISOString(),
				}),
			];
		}),
	);
}

/** When the schedules were last checked, kept on disk. The first start counts from the minute before, never from history. */
export function lastScheduleCheck(repo: string, checkedAt: Date): Date {
	const saved = readJsonIfExists<{ checkedAt: string }>(
		scheduleCursorPath(repo),
	);
	return saved
		? new Date(saved.checkedAt)
		: new Date(checkedAt.getTime() - 60_000);
}

export const saveScheduleCheck = (repo: string, checkedAt: Date) =>
	writeCursor(scheduleCursorPath(repo), {
		checkedAt: checkedAt.toISOString(),
	});
