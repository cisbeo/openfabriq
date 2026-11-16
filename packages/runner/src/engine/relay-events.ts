import type { Factory, FactoryEvent } from "@openfabriq/core";
import { errorText } from "../files.js";
import { delegation } from "../sources/linear/delegation.js";
import { labelEvents } from "../sources/linear/labels.js";
import type { RelayEvent } from "../sources/relay.js";
import { sentryEvents } from "../sources/sentry/events.js";
import { slackEvents } from "../sources/slack/mentions.js";
import { webhookEvents } from "../sources/webhook/events.js";
import {
	readHandledRelayEvents,
	saveHandledRelayEvents,
} from "../state/relayed.js";
import type { EngineDeps } from "./engine.js";

/**
 * The engine's answer to a batch of events the relay brings: each service's events become runs.
 * It resolves with the events whose runs are saved in the queue: the relay may then forget them.
 */
export function relayEvents({
	deps,
	appliedFactory,
	queue: queueFor,
	warn: warnOnce,
	now,
	pump,
}: {
	deps: Pick<EngineDeps, "slack" | "linearApp" | "sentry" | "log">;
	appliedFactory: (repo: string) => Factory | undefined;
	queue: (repo: string, factory: Factory, event: FactoryEvent) => void;
	warn: (line: string) => void;
	now: () => Date;
	/** Starts what the queue allows, once the batch is queued. */
	pump: () => void;
}): (events: RelayEvent[]) => Promise<string[]> {
	const onSlackEvents =
		deps.slack &&
		slackEvents(deps.slack, {
			appliedFactory,
			warn: warnOnce,
			queue: queueFor,
		});
	const onLinearDelegations = delegation({
		appliedFactory,
		linearApp: deps.linearApp,
		queue: queueFor,
		log: deps.log,
	});
	const onLinearLabels = labelEvents({ appliedFactory, queue: queueFor });
	const onSentryIssues = sentryEvents({
		appliedFactory,
		origin: deps.sentry?.origin,
		queue: queueFor,
		log: deps.log,
	});
	const onWebhooks = webhookEvents({
		appliedFactory,
		queue: queueFor,
		warn: warnOnce,
	});
	/** A service whose events this engine has no client for: Slack or Sentry connected after it started. */
	const notConnected = (event: RelayEvent) =>
		event.service === "slack" && !deps.slack
			? "Slack"
			: event.service === "sentry" && !deps.sentry
				? "Sentry"
				: undefined;
	const handledRelay = readHandledRelayEvents();
	/**
	 * Resolves with the events whose runs are saved in the queue: the relay may then forget them.
	 * Each event on its own, so one that fails comes back alone; one handled before, even by an
	 * earlier process, is not handled again.
	 */
	async function handleRelayBatch(events: RelayEvent[]): Promise<string[]> {
		const done: string[] = [];
		for (const event of events) {
			const missing = notConnected(event);
			if (missing) {
				// Not acknowledged: the relay sends it again when the engine reconnects, connected.
				warnOnce(
					`relay: ${missing} events wait in the relay: ${missing} is not connected on this machine. Run "openfabriq connect ${missing.toLowerCase()}", then restart "openfabriq start".`,
				);
				continue;
			}
			if (!handledRelay.has(event.id))
				try {
					await onLinearDelegations([event]);
					onLinearLabels([event]);
					onSentryIssues([event]);
					onWebhooks([event]);
					if (onSlackEvents) await onSlackEvents([event]);
					handledRelay.set(event.id, now().getTime());
				} catch (error) {
					deps.log(
						`relay: ${event.service} event not handled, it comes back: ${errorText(error)}`,
					);
					continue;
				}
			done.push(event.id);
		}
		if (done.length) saveHandledRelayEvents(handledRelay, now().getTime());
		pump();
		return done;
	}
	return handleRelayBatch;
}
