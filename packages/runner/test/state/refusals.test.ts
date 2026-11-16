import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { projectDir } from "../../src/state/projects.js";
import { recentRefusals, recordRefusals } from "../../src/state/refusals.js";

it("counts, over the latest runs of a repository, the runs the engine recorded each site refused in", () => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(
		join(tmpdir(), "openfabriq-refusals-"),
	);
	const runs = join(projectDir("acme/app"), "runs");
	const run = (id: string, minutesAgo: number) => {
		const dir = join(runs, id);
		mkdirSync(dir, { recursive: true });
		return {
			dir,
			age: () => {
				const at = new Date(Date.now() - minutesAgo * 60_000);
				utimesSync(dir, at, at);
			},
		};
	};
	const old = run("run-old", 30);
	recordRefusals(old.dir, "setup", ["api.stripe.com"]);
	old.age();
	const recent = run("run-new", 1);
	recordRefusals(recent.dir, "command", ["api.stripe.com"]);
	recordRefusals(recent.dir, "web", ["docs.stripe.com", "api.stripe.com"]);
	recent.age();
	const clean = run("run-clean", 5);
	// What a command printed, or an issue said, is not what the engine recorded: it counts for nothing.
	writeFileSync(
		join(clean.dir, "commands.jsonl"),
		'{"output":"openfabriq: the network refused evil.example: it is not in network."}\n',
	);
	writeFileSync(
		join(clean.dir, "transcript.jsonl"),
		'{"c":"deny network-outbound evil.example:443 (host is not on the allow list)"}\n',
	);
	clean.age();
	expect(recentRefusals("acme/app")).toEqual([
		{ site: "api.stripe.com", runs: 2, lastRun: "run-new" },
		{ site: "docs.stripe.com", runs: 1, lastRun: "run-new" },
	]);
	// Only the latest runs: the old one is left out.
	expect(recentRefusals("acme/app", 2)).toEqual([
		{ site: "api.stripe.com", runs: 1, lastRun: "run-new" },
		{ site: "docs.stripe.com", runs: 1, lastRun: "run-new" },
	]);
	expect(recentRefusals("acme/none")).toEqual([]);
});
