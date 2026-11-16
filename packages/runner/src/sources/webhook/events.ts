import type { Factory, FactoryEvent } from "@openfabriq/core";
import {
	type AppliedProject,
	appliedProjects,
	type ProjectEvent,
} from "../projects.js";
import type { RelayEvent } from "../relay.js";

/** What an agent reads of a webhook's body, at most: the rest is cut, and the agent is told. */
export const PAYLOAD_KEPT = 50_000;

/** What the relay passes on: each webhook it received and checked is queued once. */
export function webhookEvents({
	appliedFactory,
	queue,
	warn = () => {},
}: {
	appliedFactory: (repo: string) => Factory | undefined;
	queue: (repo: string, factory: Factory, event: FactoryEvent) => void;
	warn?: (line: string) => void;
}): (events: RelayEvent[]) => void {
	// An event whose ack was lost comes back: the engine's journal of relay events skips it.
	return (events) => {
		for (const event of events) {
			if (event.service !== "webhook" || event.kind !== "received") continue;
			const found = webhookEventsFor(event, () =>
				appliedProjects(appliedFactory),
			);
			// A webhook a factory no longer declares: the relay still accepts it until it is removed there.
			if (!found.length && typeof event.webhook === "string")
				warn(
					`webhook ${event.webhook}: received, but no applied factory declares it: ignored. To stop the relay accepting it: "openfabriq connect webhook ${event.webhook} --remove".`,
				);
			for (const f of found) queue(f.repository, f.factory, f.event);
		}
	};
}

/** A webhook received, as webhook.received for each factory that declares a webhook of that name. */
export function webhookEventsFor(
	event: RelayEvent,
	/** Read only for an event that can start something. */
	projects: () => AppliedProject[],
): ProjectEvent[] {
	const { webhook, delivery, payload } = event;
	if (typeof webhook !== "string" || typeof delivery !== "string") return [];
	const text = typeof payload === "string" ? payload : "";
	return projects()
		.filter(({ factory }) => factory.webhooks?.[webhook])
		.map(({ repository, factory }) => ({
			repository,
			factory,
			event: {
				key: `webhook:${webhook}:${delivery}`,
				event: "webhook.received",
				isPullRequest: false,
				actor: `webhook ${webhook}`,
				at: new Date(event.receivedAt).toISOString(),
				source: {
					kind: "webhook",
					webhook,
					delivery,
					payload:
						text.length > PAYLOAD_KEPT
							? `${text.slice(0, PAYLOAD_KEPT)}\n[cut by the engine: the body had ${text.length} characters]`
							: text,
				},
			},
		}));
}
