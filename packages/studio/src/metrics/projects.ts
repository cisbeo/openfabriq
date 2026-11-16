import {
	type RunRecord,
	readAppliedFactory,
	readChats,
} from "@openfabriq/runner";
import type { SubjectStates } from "../subjects/subject-state.js";
import type { MergedPull } from "./merged-pulls.js";
import { computeMetrics, type Period } from "./metrics.js";

/** What GET /api/metrics sends: each project's numbers, with its name when its factory loads. */
export function projectsMetrics(
	repositories: string[],
	runs: RunRecord[],
	period: Period,
	subjectStates: SubjectStates,
	merged: Record<string, MergedPull[]> = {},
) {
	return repositories.map((repository) => {
		const name = readAppliedFactory(repository)?.name;
		return {
			repository,
			...(name ? { name } : {}),
			metrics: computeMetrics(
				runs.filter((r) => r.repository === repository),
				period,
				new Date(),
				subjectStates,
				readChats(repository),
				merged[repository] ?? [],
			),
		};
	});
}
