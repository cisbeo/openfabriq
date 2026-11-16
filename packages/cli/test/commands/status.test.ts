import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRun, type RunRecord, writeApplied } from "@openfabriq/runner";
import { beforeEach, expect, it } from "vitest";
import { formatStatus, statusCommand } from "../../src/commands/status.js";

// Local times: status speaks in the machine's day.
const NOW = new Date(2026, 10, 8, 15, 0);
const at = (hour: number, minute = 0, day = 8) =>
	new Date(2026, 10, day, hour, minute).toISOString();

let count = 0;
const run = (over: Partial<RunRecord>): RunRecord => ({
	id: `run-${++count}`,
	repository: "acme/app",
	automation: "triage",
	agent: "triager",
	event: "issues.opened",
	isPullRequest: false,
	status: "succeeded",
	queuedAt: at(9),
	outputs: [],
	...over,
});

beforeEach(() => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
});

it("says there is no project yet", () => {
	expect(statusCommand(NOW)).toEqual({
		code: 0,
		output: 'No project yet. Run "openfabriq apply" in a repository.',
	});
});

it("lists each project's runs: running, waiting, then the ten most recent", () => {
	const applied = new Date(2026, 10, 7, 18, 42);
	writeApplied("acme/app", { "factory.yaml": "name: app\n" }, applied);
	writeApplied("acme/web", { "factory.yaml": "name: web\n" }, applied);
	appendRun(
		run({
			number: 12,
			status: "running",
			automation: "review",
			queuedAt: at(14),
		}),
	);
	appendRun(run({ status: "queued", queuedAt: at(13) }));
	appendRun(
		run({
			number: 3,
			status: "failed",
			reason: "timeout",
			costUsd: 0.5,
			queuedAt: at(12),
			endedAt: at(12),
		}),
	);
	appendRun(
		run({
			status: "succeeded",
			automation: "nightly",
			costUsd: 1.25,
			queuedAt: at(11),
			endedAt: at(11),
		}),
	);
	appendRun(
		run({
			source: { kind: "slack", label: "#dev" },
			status: "skipped",
			automation: "answer",
			queuedAt: at(10, 0, 7),
			endedAt: at(10, 0, 7),
			costUsd: 9,
		}),
	);
	for (let i = 0; i < 9; i++)
		appendRun(
			run({
				repository: "acme/web",
				number: 100 + i,
				queuedAt: at(9, 50 - i),
			}),
		);
	expect(statusCommand(NOW)).toEqual({
		code: 0,
		output: [
			"acme/app (applied 2026-11-07 18:42, 2 runs today, 1.75 USD)",
			"  Running",
			"    running   #12      review",
			"  Waiting",
			"    queued    schedule triage",
			"  Recent",
			"    failed    #3       triage 0.50 USD: timeout",
			"    succeeded schedule nightly 1.25 USD",
			"    skipped   #dev     answer 9.00 USD",
			"acme/web (applied 2026-11-07 18:42, 0 runs today, 0.00 USD)",
			"  Recent",
			...Array.from(
				{ length: 9 },
				(_, i) => `    succeeded #${100 + i}     triage`,
			),
		].join("\n"),
	});
});

it("shows ten recent runs at most", () => {
	writeApplied("acme/app", { "factory.yaml": "name: app\n" }, NOW);
	for (let i = 0; i < 12; i++)
		appendRun(run({ number: i, queuedAt: at(14, 50 - i) }));
	const lines = statusCommand(NOW).output.split("\n");
	expect(lines).toHaveLength(12);
	expect(lines[2]).toBe("    succeeded #0       triage");
	expect(lines[11]).toBe("    succeeded #9       triage");
});

it("formats the runs it is given, without reading the disk", () => {
	expect(formatStatus([], NOW)).toBe(
		'No project yet. Run "openfabriq apply" in a repository.',
	);
	expect(
		formatStatus(
			[
				{
					repository: "acme/app",
					appliedAt: new Date(2026, 10, 7, 18, 42).toISOString(),
					runs: [
						run({ status: "running", number: 7, isPullRequest: true }),
						run({
							source: { kind: "linear", label: "ENG-123" },
							status: "succeeded",
							automation: "implement",
							costUsd: 0.333,
							endedAt: at(10),
						}),
						run({
							source: { kind: "github", label: "#4" },
							number: 4,
							status: "failed",
							reason: "no output",
							endedAt: at(8, 0, 6),
						}),
					],
				},
			],
			NOW,
		),
	).toBe(
		[
			"acme/app (applied 2026-11-07 18:42, 1 run today, 0.33 USD)",
			"  Running",
			"    running   #7       triage",
			"  Recent",
			"    succeeded ENG-123  implement 0.33 USD",
			"    failed    #4       triage: no output",
		].join("\n"),
	);
});
