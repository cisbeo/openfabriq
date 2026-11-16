import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, it } from "vitest";
import type { RunRecord } from "../../src/index.js";
import { appendRun, projectDir, readRuns } from "../../src/index.js";

const REPO = "acme/web-app";
const AT = "2026-11-04T11:31:02.856Z";

const record = (id: string, status: RunRecord["status"]): RunRecord => ({
	id,
	repository: REPO,
	automation: "nightly",
	agent: "quality",
	event: "schedule",
	isPullRequest: false,
	status,
	queuedAt: AT,
	outputs: [],
});

beforeEach(() => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
});

it("puts a run queued again after a stop before the interrupted one, though both keep the same queuedAt", () => {
	appendRun(record("interrupted", "running"));
	appendRun(record("interrupted", "failed"));
	appendRun(record("again", "queued"));
	appendRun(record("again", "running"));
	expect(readRuns(REPO).map((r) => [r.id, r.status])).toEqual([
		["again", "running"],
		["interrupted", "failed"],
	]);
});

const journal = () => join(projectDir(REPO), "runs.jsonl");
const statuses = () => readRuns(REPO).map((r) => [r.id, r.status]);

it("reads the lines written since its last read, by this process or another", () => {
	appendRun(record("a", "queued"));
	expect(statuses()).toEqual([["a", "queued"]]);
	appendRun(record("a", "running"));
	// Another process (the engine, for the studio) appends too.
	appendFileSync(journal(), `${JSON.stringify(record("b", "queued"))}\n`);
	expect(statuses()).toEqual([
		["b", "queued"],
		["a", "running"],
	]);
});

it("waits for half a line until it is whole, and keeps the line before it", () => {
	appendRun(record("a", "queued"));
	const line = JSON.stringify(record("a", "running"));
	appendFileSync(journal(), line.slice(0, 20));
	expect(statuses()).toEqual([["a", "queued"]]);
	appendFileSync(journal(), `${line.slice(20)}\n`);
	expect(statuses()).toEqual([["a", "running"]]);
});

it("reads a journal written again from its start", () => {
	appendRun(record("a", "succeeded"));
	expect(statuses()).toEqual([["a", "succeeded"]]);
	rmSync(journal());
	expect(readRuns(REPO)).toEqual([]);
	appendRun({ ...record("b", "queued"), automation: "other" });
	appendRun(record("c", "queued"));
	expect(statuses()).toEqual([
		["c", "queued"],
		["b", "queued"],
	]);
	writeFileSync(journal(), `${JSON.stringify(record("d", "queued"))}\n`);
	expect(statuses()).toEqual([["d", "queued"]]);
});
