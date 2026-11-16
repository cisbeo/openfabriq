import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	readFactoryFolder,
	takeRequests,
	writeApplied,
} from "@openfabriq/runner";
import { beforeEach, expect, it } from "vitest";
import { runManually } from "../../src/commands/run.js";

const ROOT = join(import.meta.dirname, "../../../..");
const REPO = "acme/task-app";
const NOW = new Date("2026-11-03T10:00:00Z");

beforeEach(() => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	const files = readFactoryFolder(join(ROOT, "fixtures/valid/sdlc/openfabriq"));
	files["automations/nightly/automation.md"] =
		'---\nwhen:\n  schedule: { cron: "0 2 * * *" }\nagent: implementer\nconcurrency: repository\n---\nImprove.\n';
	writeApplied(REPO, files);
});

it("asks the engine for a manual run", () => {
	const result = runManually("nightly", {}, "Ada", NOW);
	expect(result.code).toBe(0);
	expect(result.output).toBe(
		`Asked: a manual run of nightly on ${REPO}. "openfabriq start" takes it within a minute; follow it in the studio, under Runs.`,
	);
	expect(takeRequests(REPO)).toMatchObject([
		{ automation: "nightly", isPullRequest: false, by: "Ada" },
	]);
	expect(
		runManually("implement-ready-issues", { issue: "12" }, "Ada", NOW).code,
	).toBe(0);
	expect(takeRequests(REPO)).toMatchObject([
		{ automation: "implement-ready-issues", number: 12, isPullRequest: false },
	]);
});

it("says what is missing, and asks nothing", () => {
	expect(runManually("nope", {}, "M", NOW)).toEqual({
		code: 1,
		output: expect.stringContaining(
			'No automation "nope" in the applied factories',
		),
	});
	expect(runManually("implement-ready-issues", {}, "M", NOW)).toEqual({
		code: 1,
		output: "implement-ready-issues starts on an issue: pass --issue <number>",
	});
	expect(runManually("nightly", { issue: "x" }, "M", NOW).code).toBe(1);
	expect(takeRequests(REPO)).toEqual([]);
});

it("names the project when none or several have the automation", () => {
	expect(runManually("nightly", { project: "acme/other" }, "M", NOW)).toEqual({
		code: 1,
		output:
			'No automation "nightly" in the applied factories of acme/other. Check its folder name in openfabriq/automations/, and that it is applied.',
	});
	writeApplied(
		"acme/other",
		readFactoryFolder(join(ROOT, "fixtures/valid/sdlc/openfabriq")),
	);
	expect(runManually("implement-ready-issues", {}, "M", NOW)).toEqual({
		code: 1,
		output: `"implement-ready-issues" is in ${["acme/other", REPO].sort().join(" and ")}: pass --project owner/repo.`,
	});
	expect(takeRequests(REPO)).toEqual([]);
});

it("says no automation when nothing is applied on this machine", () => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	expect(runManually("nightly", {}, "M", NOW)).toEqual({
		code: 1,
		output:
			'No automation "nightly" in the applied factories. Check its folder name in openfabriq/automations/, and that it is applied.',
	});
});

it("finds the project --project names whatever its case, as apply does", () => {
	expect(
		runManually("nightly", { project: "ACME/Task-App" }, "M", NOW).code,
	).toBe(0);
	expect(takeRequests(REPO)).toMatchObject([{ automation: "nightly" }]);
});
