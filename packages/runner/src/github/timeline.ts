import { type FactoryEvent, sameName, WORKING_LABEL } from "@openfabriq/core";
import {
	isChangesRequested,
	isFromEngine,
	isFromUntrustedRun,
} from "./markers.js";

export interface IssueItem {
	number: number;
	created_at: string;
	user: { login: string } | null;
	body?: string | null;
	pull_request?: unknown;
	/** The labels it carries now, as the issues API gives them for issues and pull requests alike. */
	labels?: { name: string }[];
}

export interface TimelineItem {
	event?: string;
	id?: number | null;
	created_at?: string | null;
	submitted_at?: string | null;
	actor?: { login: string } | null;
	user?: { login: string } | null;
	label?: { name: string } | null;
	body?: string | null;
	state?: string | null;
}

/** The events of one issue or pull request that happened at or after `since`. */
export function itemEvents(
	item: IssueItem,
	timeline: TimelineItem[],
	since: string,
): FactoryEvent[] {
	const isPullRequest =
		item.pull_request !== undefined && item.pull_request !== null;
	const kind = isPullRequest ? "pull_request" : "issue";
	const base = { number: item.number, isPullRequest };
	// A comment carries its subject's labels, for a trigger that filters on them.
	const labels = item.labels ? { labels: item.labels.map((l) => l.name) } : {};
	const events: FactoryEvent[] = [];
	if (item.created_at >= since)
		events.push({
			...base,
			key: `${item.number}:opened`,
			event: `${kind}.opened`,
			actor: item.user?.login ?? "",
			at: item.created_at,
			...untrusted(item.body),
		});
	for (const entry of timeline) {
		const at = entry.created_at ?? entry.submitted_at ?? "";
		const actor = entry.actor?.login ?? entry.user?.login ?? "";
		if (!at || at < since || entry.id == null) continue;
		// The label the engine puts while a run works starts nothing, or every run would start a labeled trigger.
		if (
			entry.event === "labeled" &&
			entry.label &&
			!sameName(entry.label.name, WORKING_LABEL)
		)
			events.push({
				...base,
				key: `labeled:${entry.id}`,
				event: `${kind}.labeled`,
				actor,
				at,
				label: entry.label.name,
			});
		// The engine's own comments never start anything, or a commenting agent would start itself again.
		else if (entry.event === "commented" && !isFromEngine(entry.body))
			events.push({
				...base,
				key: `comment:${entry.id}`,
				event: `${kind}.commented`,
				actor,
				at,
				...(entry.body ? { text: entry.body } : {}),
				...labels,
			});
		else if (
			entry.event === "reviewed" &&
			(entry.state === "changes_requested" || isChangesRequested(entry.body))
		)
			events.push({
				...base,
				key: `review:${entry.id}`,
				event: "pull_request.changes_requested",
				actor,
				at,
				...untrusted(entry.body),
			});
		else if (
			entry.event === "reviewed" &&
			entry.state === "commented" &&
			!isFromEngine(entry.body)
		)
			events.push({
				...base,
				key: `review:${entry.id}`,
				event: "pull_request.commented",
				actor,
				at,
				...(entry.body ? { text: entry.body } : {}),
				...labels,
			});
	}
	return events;
}

/** What the engine wrote for a run no maintainer started. */
export const untrusted = (body?: string | null) =>
	isFromUntrustedRun(body) ? { fromUntrustedRun: true } : {};
