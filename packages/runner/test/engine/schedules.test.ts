import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Factory, loadFactory } from "@openfabriq/core";
import { beforeEach, expect, it } from "vitest";
import { scheduleCursorPath } from "../../src/engine/cursors.js";
import type { QueuedRun } from "../../src/engine/queue.js";
import {
	dueRuns,
	lastScheduleCheck,
	saveScheduleCheck,
} from "../../src/engine/schedules.js";
import { readJsonIfExists } from "../../src/files.js";

const REPO = "acme/app";
const automation = (when: string) =>
	`---\nwhen:\n  ${when}\nagent: worker\n---\nGo.\n`;
const factory = loadFactory({
	"factory.yaml":
		"name: F\nrepository: acme/app\nmaintainers: [alice]\ntimezone: UTC\n",
	"agents/worker/agent.md": "---\ndescription: Works\n---\nWork.\n",
	"automations/nightly/automation.md": automation(
		'schedule: { cron: "0 2 * * *" }',
	),
	"automations/hourly/automation.md": automation(
		'schedule: { cron: "0 * * * *" }',
	),
	"automations/triage/automation.md": automation("issue.opened: {}"),
}).factory as Factory;

beforeEach(() => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-cron-"));
});

/** One check at `at`, as the engine makes it each minute. */
function check(at: string): QueuedRun[] {
	const checkedAt = new Date(at);
	const runs = dueRuns(
		REPO,
		factory,
		lastScheduleCheck(REPO, checkedAt),
		checkedAt,
	);
	saveScheduleCheck(REPO, checkedAt);
	return runs;
}
const due = (runs: QueuedRun[]) => runs.map((r) => ({ ...r, id: typeof r.id }));
const scheduled = (name: string, at: string) => ({
	id: "string",
	repository: REPO,
	automation: name,
	repoWide: false,
	event: {
		key: `schedule:${name}:${at.slice(0, 16)}`,
		event: "schedule",
		isPullRequest: false,
		actor: "schedule",
		at,
	},
});

it("counts the first start from the minute before, never from history", () => {
	expect(due(check("2026-11-04T02:00:30Z"))).toEqual([
		scheduled("hourly", "2026-11-04T02:00:00.000Z"),
		scheduled("nightly", "2026-11-04T02:00:00.000Z"),
	]);
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-cron-"));
	expect(check("2026-11-04T02:01:30Z")).toEqual([]);
});

it("owes one run per trigger since the last check: the latest time it was due", () => {
	check("2026-11-01T12:30:00Z");
	expect(due(check("2026-11-04T08:12:00Z"))).toEqual([
		scheduled("hourly", "2026-11-04T08:00:00.000Z"),
		scheduled("nightly", "2026-11-04T02:00:00.000Z"),
	]);
	expect(check("2026-11-04T08:13:00Z")).toEqual([]);
});

it("finds the runs due between two times without reading or writing anything", () => {
	const since = new Date("2026-11-04T01:30:00Z");
	const checkedAt = new Date("2026-11-04T02:30:00Z");
	expect(due(dueRuns(REPO, factory, since, checkedAt))).toEqual([
		scheduled("hourly", "2026-11-04T02:00:00.000Z"),
		scheduled("nightly", "2026-11-04T02:00:00.000Z"),
	]);
	expect(readJsonIfExists(scheduleCursorPath(REPO))).toBeUndefined();
});

it("keeps the check on disk even when nothing is due", () => {
	expect(check("2026-11-04T10:30:00Z")).toEqual([]);
	expect(readJsonIfExists(scheduleCursorPath(REPO))).toEqual({
		checkedAt: "2026-11-04T10:30:00.000Z",
	});
	expect(due(check("2026-11-04T11:00:00Z"))).toEqual([
		scheduled("hourly", "2026-11-04T11:00:00.000Z"),
	]);
});
