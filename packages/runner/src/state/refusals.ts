import {
	appendFileSync,
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { projectDir } from "./projects.js";

// The sites the network refused in a factory's runs, for doctor, which says what to add to network.
// Only the engine writes them, in the run's folder, which neither commands nor agents write: a
// command's output or an issue cannot add a site to the list doctor suggests.

const FILE = "refused.jsonl";

/** Records sites the network refused in a run: to setup, to a command or a check, to the web tool. */
export function recordRefusals(
	runDir: string,
	source: "setup" | "command" | "web",
	sites: string[],
): void {
	appendFileSync(join(runDir, FILE), `${JSON.stringify({ source, sites })}\n`);
}

/**
 * The sites the network refused in the latest `limit` runs of a repository, the most refused first:
 * in how many runs, and the latest of them.
 */
export function recentRefusals(
	repository: string,
	limit = 20,
): { site: string; runs: number; lastRun: string }[] {
	const dir = join(projectDir(repository), "runs");
	if (!existsSync(dir)) return [];
	const runs = readdirSync(dir)
		.map((id) => ({ id, at: statSync(join(dir, id)).mtimeMs }))
		.sort((a, b) => b.at - a.at)
		.slice(0, limit);
	const counts = new Map<string, { runs: number; lastRun: string }>();
	for (const { id } of runs) {
		const file = join(dir, id, FILE);
		if (!existsSync(file)) continue;
		const sites = new Set(
			readFileSync(file, "utf8")
				.split("\n")
				.filter(Boolean)
				.flatMap((line) => (JSON.parse(line) as { sites: string[] }).sites),
		);
		for (const site of sites) {
			const seen = counts.get(site);
			// Runs come newest first: the first one met is the latest.
			counts.set(site, {
				runs: (seen?.runs ?? 0) + 1,
				lastRun: seen?.lastRun ?? id,
			});
		}
	}
	return [...counts]
		.map(([site, c]) => ({ site, ...c }))
		.sort((a, b) => b.runs - a.runs);
}
