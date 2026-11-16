import { EVENT_SHORT, subject } from "../../lib/format.js";
import type { RunRecord } from "../../lib/types.js";

/**
 * What started the run, in plain words: "Push to main", "Issue labeled · ready-for-agent",
 * "Slack mention · #factory", "Manual run · Ada". A GitHub source adds nothing: the subject already says it.
 */
export function trigger(r: RunRecord) {
	if (r.manual) return `Manual run · ${r.manual}`;
	const what = EVENT_SHORT[r.event] ?? r.event;
	const detail =
		r.label ??
		(r.source && r.source.kind !== "github" ? r.source.label : undefined);
	return detail ? `${what} · ${detail}` : what;
}

/** The words a run shows in the list, to search: "Issue #9", its title, agent, trigger, reason. */
export const runWords = (r: RunRecord) =>
	[subject(r), r.title, r.automation, r.agent, trigger(r), r.reason, r.id]
		.join(" ")
		.toLowerCase();

/**
 * The runs of an agent that contain `text`, then of a status; the agents to choose from, and the
 * count per status.
 */
export function filterRuns(
	runs: RunRecord[],
	agent: string | undefined,
	status: string | undefined,
	text = "",
) {
	const wanted = text.trim().toLowerCase();
	const byAgent =
		agent || wanted
			? runs.filter(
					(r) =>
						(!agent || r.agent === agent) &&
						(!wanted || runWords(r).includes(wanted)),
				)
			: runs;
	return {
		agents: [...new Set(runs.map((r) => r.agent))].sort(),
		shown: status ? byAgent.filter((r) => r.status === status) : byAgent,
		/** The agent's runs with that status, or all of them. */
		count: (s: string | undefined) =>
			s ? byAgent.filter((r) => r.status === s).length : byAgent.length,
	};
}
