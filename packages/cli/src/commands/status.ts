import {
	listProjects,
	type ProjectState,
	type RunRecord,
	readRuns,
} from "@openfabriq/runner";
import type { CommandResult } from "../result.js";

const subject = (r: RunRecord) =>
	r.source && r.source.kind !== "github"
		? r.source.label
		: r.number === undefined
			? "schedule"
			: `#${r.number}`;
const cost = (r: RunRecord) =>
	r.costUsd === undefined ? "" : ` ${r.costUsd.toFixed(2)} USD`;

export function statusCommand(now = new Date()): CommandResult {
	const projects = listProjects().map((p) => ({
		...p,
		runs: readRuns(p.repository),
	}));
	return { code: 0, output: formatStatus(projects, now) };
}

/** Each project with its runs today, then its runs running, waiting and the ten most recent. */
export function formatStatus(
	projects: (Pick<ProjectState, "repository" | "appliedAt"> & {
		runs: RunRecord[];
	})[],
	now: Date,
): string {
	if (projects.length === 0)
		return 'No project yet. Run "openfabriq apply" in a repository.';
	const lines: string[] = [];
	for (const { repository, appliedAt, runs } of projects) {
		const today = runs.filter(
			(r) =>
				r.endedAt && new Date(r.endedAt).toDateString() === now.toDateString(),
		);
		const spent = today.reduce((s, r) => s + (r.costUsd ?? 0), 0);
		const applied = new Date(appliedAt).toLocaleString("sv-SE").slice(0, 16);
		lines.push(
			`${repository} (applied ${applied}, ${today.length} run${today.length === 1 ? "" : "s"} today, ${spent.toFixed(2)} USD)`,
		);
		const show = (title: string, list: RunRecord[]) => {
			if (list.length === 0) return;
			lines.push(`  ${title}`);
			for (const r of list)
				lines.push(
					`    ${r.status.padEnd(9)} ${subject(r).padEnd(8)} ${r.automation}${cost(r)}${r.reason ? `: ${r.reason}` : ""}`,
				);
		};
		show(
			"Running",
			runs.filter((r) => r.status === "running"),
		);
		show(
			"Waiting",
			runs.filter((r) => r.status === "queued"),
		);
		show(
			"Recent",
			runs
				.filter((r) => !["running", "queued"].includes(r.status))
				.slice(0, 10),
		);
	}
	return lines.join("\n");
}
