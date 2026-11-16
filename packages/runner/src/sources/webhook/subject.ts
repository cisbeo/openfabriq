import type { EventSource } from "@openfabriq/core";
import type { SourceWriter } from "../../run/outputs/apply.js";

type WebhookSource = Extract<EventSource, { kind: "webhook" }>;

export function webhookWriter(source: WebhookSource): SourceWriter {
	return {
		// No comment: a webhook has nowhere to answer.
		bodyFooter: `Started by the webhook \`${source.webhook}\`.`,
	};
}

/** The delivery's body; a webhook has no title of its own, nor a link. */
export function readWebhook(source: WebhookSource): {
	data: Record<string, unknown>;
	title: string;
} {
	return {
		data: {
			webhook: {
				name: source.webhook,
				delivery: source.delivery,
				// JSON when it is JSON; the sender's own format otherwise.
				body: parseOrText(source.payload),
			},
		},
		title: "Webhook received",
	};
}

function parseOrText(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}
