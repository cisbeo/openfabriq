import { type Factory, type FactoryEvent, sameName } from "@openfabriq/core";
import {
	type AppliedProject,
	appliedProjects,
	type ProjectEvent,
} from "../projects.js";
import type { RelayEvent } from "../relay.js";

/**
 * The parts of Linear's Issue webhook the engine reads (IssueWebhookPayload in Linear's
 * schema); anything else in it is ignored.
 */
export interface IssueWebhook {
	type?: string;
	action?: string;
	organizationId?: string;
	createdAt?: string;
	actor?: { name?: string } | null;
	data?: {
		id?: string;
		identifier?: string;
		url?: string;
		labels?: { id?: string; name?: string }[];
		team?: { key?: string } | null;
	};
	/** For an update: the previous values of the properties that changed. */
	updatedFrom?: { labelIds?: unknown } | null;
}

/** The labels a webhook adds to an issue: all of them when it is created, the new ones on an update. */
export function labelsAdded(payload: IssueWebhook): string[] {
	const labels = payload.data?.labels ?? [];
	const before = payload.updatedFrom?.labelIds;
	const added =
		payload.action === "create"
			? labels
			: payload.action === "update" && Array.isArray(before)
				? labels.filter((l) => !before.includes(l.id))
				: [];
	return added.flatMap((l) => (l.name ? [l.name] : []));
}

/** What the relay passes on: each Linear Issue webhook is read once. */
export function labelEvents({
	appliedFactory,
	queue,
}: {
	appliedFactory: (repo: string) => Factory | undefined;
	queue: (repo: string, factory: Factory, event: FactoryEvent) => void;
}): (events: RelayEvent[]) => void {
	// An event whose ack was lost comes back: the engine's journal of relay events skips it.
	return (events) => {
		for (const event of events) {
			const payload = event.payload as IssueWebhook | undefined;
			if (event.service !== "linear" || payload?.type !== "Issue") continue;
			for (const found of labeledEventsFor(event, payload, () =>
				appliedProjects(appliedFactory),
			))
				queue(found.repository, found.factory, found.event);
		}
	};
}

/**
 * Each label an Issue webhook adds, as linear.issue.labeled for each factory of the issue's
 * team. The team is the gate, as with polling.
 */
export function labeledEventsFor(
	event: RelayEvent,
	payload: IssueWebhook,
	/** Read only for an event that can start something. */
	projects: () => AppliedProject[],
): ProjectEvent[] {
	const issue = payload.data;
	const team = issue?.team?.key;
	const organizationId = payload.organizationId;
	if (!issue?.id || !issue.identifier || !issue.url || !team) return [];
	if (!organizationId) return [];
	const { id, identifier, url } = issue;
	const delivery =
		typeof event.delivery === "string" ? event.delivery : event.id;
	const ofTeam = projects().filter(
		({ factory }) => factory.linear && sameName(factory.linear.team, team),
	);
	return labelsAdded(payload).flatMap((label) =>
		ofTeam.map(({ repository, factory }) => ({
			repository,
			factory,
			event: {
				key: `linear:${delivery}:${label}`,
				event: "linear.issue.labeled",
				isPullRequest: false,
				// Empty for an integration or a Linear automation, as before.
				actor: payload.actor?.name ?? "",
				label,
				at: payload.createdAt ?? new Date(event.receivedAt).toISOString(),
				source: {
					kind: "linear",
					issueId: id,
					identifier,
					url,
					organizationId,
				},
			},
		})),
	);
}
