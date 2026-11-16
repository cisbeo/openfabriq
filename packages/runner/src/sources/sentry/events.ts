import type { Factory, FactoryEvent } from "@openfabriq/core";
import {
	type AppliedProject,
	appliedProjects,
	type ProjectEvent,
} from "../projects.js";
import type { RelayEvent } from "../relay.js";
import { SENTRY_URL, sameOrigin } from "./client.js";

/** One search the relay runs on Sentry every minute for the engine. */
export interface SentryWatch {
	organization: string;
	project: string;
	query?: string;
}

/** Whether a factory's Sentry is the one the token was tested against: the token goes nowhere else. */
const onOrigin = (factory: Factory, origin: string) =>
	!!factory.sentry && sameOrigin(factory.sentry.url ?? SENTRY_URL, origin);

const sameWatch = (a: SentryWatch, b: SentryWatch) =>
	a.organization === b.organization &&
	a.project === b.project &&
	(a.query ?? "") === (b.query ?? "");

/** The searches the factories need: one per project and `query` of their sentry.issue.created triggers. */
export function sentryWatches(
	factories: Factory[],
	origin: string,
): SentryWatch[] {
	const watches: SentryWatch[] = [];
	for (const factory of factories) {
		if (!factory.sentry || !onOrigin(factory, origin)) continue;
		const { organization, project } = factory.sentry;
		for (const automation of Object.values(factory.automations))
			for (const trigger of automation.when) {
				if (trigger.event !== "sentry.issue.created") continue;
				const watch = {
					organization,
					project,
					...(trigger.query ? { query: trigger.query } : {}),
				};
				if (!watches.some((w) => sameWatch(w, watch))) watches.push(watch);
			}
	}
	return watches;
}

interface SentryIssueFound {
	id?: string;
	shortId?: string;
	permalink?: string;
	firstSeen?: string;
}

/**
 * What the relay passes on: a new Sentry issue its search found is queued as sentry.issue.created
 * for each factory of that project, with the search's `query`; a failed search is said once.
 */
export function sentryEvents({
	appliedFactory,
	origin,
	queue,
	log,
}: {
	appliedFactory: (repo: string) => Factory | undefined;
	/** The Sentry the token is for; undefined when Sentry is not connected. */
	origin: string | undefined;
	queue: (repo: string, factory: Factory, event: FactoryEvent) => void;
	log: (line: string) => void;
}): (events: RelayEvent[]) => void {
	// An event whose ack was lost comes back: the engine's journal of relay events skips it.
	return (events) => {
		for (const event of events) {
			if (event.service !== "sentry") continue;
			const watch = searchOf(event);
			if (!watch) continue;
			if (event.kind === "error") {
				log(`sentry: ${searchName(watch)}: ${String(event.message)}`);
				continue;
			}
			for (const found of sentryIssueEventsFor(event, origin, () =>
				appliedProjects(appliedFactory),
			))
				queue(found.repository, found.factory, found.event);
		}
	};
}

/** The search a relay's Sentry event comes from; undefined when the event does not say. */
function searchOf(event: RelayEvent): SentryWatch | undefined {
	const { organization, project, query } = event;
	if (typeof organization !== "string" || typeof project !== "string")
		return undefined;
	return {
		organization,
		project,
		...(typeof query === "string" ? { query } : {}),
	};
}

const searchName = (watch: SentryWatch) =>
	`${watch.organization}/${watch.project}${watch.query ? ` "${watch.query}"` : ""}`;

/**
 * A new Sentry issue a search found, as sentry.issue.created for each factory of the Sentry the
 * token is for (`origin`) that runs that search.
 */
export function sentryIssueEventsFor(
	event: RelayEvent,
	origin: string | undefined,
	/** Read only for an event that can start something. */
	projects: () => AppliedProject[],
): ProjectEvent[] {
	const watch = searchOf(event);
	const issue = event.issue as SentryIssueFound | undefined;
	if (!watch || event.kind !== "issue" || !origin || !issue?.id) return [];
	const { id, shortId, permalink, firstSeen } = issue;
	if (!shortId || !permalink) return [];
	return projects()
		.filter(({ factory }) =>
			sentryWatches([factory], origin).some((w) => sameWatch(w, watch)),
		)
		.map(({ repository, factory }) => ({
			repository,
			factory,
			event: {
				key: `sentry:${id}:${watch.query ?? ""}`,
				event: "sentry.issue.created",
				isPullRequest: false,
				actor: "sentry",
				at: firstSeen ?? new Date(event.receivedAt).toISOString(),
				...(watch.query ? { query: watch.query } : {}),
				source: {
					kind: "sentry",
					issueId: id,
					shortId,
					url: permalink,
				},
			},
		}));
}
