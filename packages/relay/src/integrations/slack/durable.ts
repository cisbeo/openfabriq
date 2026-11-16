// Slack in the relay's Durable Object: the mentions Slack sends over HTTP.

import { isRecentTimestamp } from "../../shared/crypto";
import { parseJsonBody } from "../../shared/http";
import type { RelayStore } from "../../shared/store";
import { verifySignature } from "./signature";

interface SlackEvent {
	type?: unknown;
	thread_ts?: unknown;
	ts?: unknown;
	subtype?: unknown;
	bot_id?: unknown;
}

/** A mention of the bot, or a person's reply in a thread: the engine decides if it answers the bot. */
export const isMentionOrThreadReply = (event: SlackEvent | undefined) =>
	event?.type === "app_mention" ||
	(event?.type === "message" &&
		typeof event.thread_ts === "string" &&
		event.thread_ts !== event.ts &&
		event.subtype === undefined &&
		event.bot_id === undefined);

interface SlackPayload {
	type?: unknown;
	challenge?: unknown;
	event_id?: unknown;
	event?: SlackEvent;
}

/** What a signed, fresh request from Slack asks for. */
export type SlackRequest =
	| { kind: "challenge"; challenge: string }
	| { kind: "keep"; eventId: string; payload: SlackPayload }
	| { kind: "ignore" }
	| { kind: "bad" };

export function triage(body: ArrayBuffer): SlackRequest {
	const payload = parseJsonBody(body) as SlackPayload | null | undefined;
	if (payload === undefined) return { kind: "bad" };
	// Sent, signed, when the Request URL is verified in the Slack app's settings.
	if (payload?.type === "url_verification")
		return typeof payload.challenge === "string"
			? { kind: "challenge", challenge: payload.challenge }
			: { kind: "bad" };
	// Anything else (app_rate_limited…) gets its 200 and is not kept.
	if (
		payload?.type !== "event_callback" ||
		typeof payload.event_id !== "string"
	)
		return { kind: "ignore" };
	// Only mentions, and replies in a thread written by a person: the rest of the channel is not kept.
	if (!isMentionOrThreadReply(payload.event)) return { kind: "ignore" };
	return { kind: "keep", eventId: payload.event_id, payload };
}

/** The answer to Slack: the challenge as the body, or a status without one. */
export type SlackAnswer =
	| { kind: "challenge"; challenge: string }
	| { kind: "status"; status: 200 | 400 | 401 };

export class SlackHandler {
	constructor(private readonly store: RelayStore) {}

	configure(signingSecret: string): void {
		this.store.kv.put("slack:config", { signingSecret });
	}

	/** Slack waits 3 seconds at most: answered at once, the engine handles the event later. */
	async receiveHook(
		body: ArrayBuffer,
		signature: string | null,
		timestamp: string | null,
	): Promise<SlackAnswer> {
		const secret = this.store.kv.get<{ signingSecret: string }>(
			"slack:config",
		)?.signingSecret;
		if (!secret || !(await verifySignature(body, signature, timestamp, secret)))
			return { kind: "status", status: 401 };
		if (!isRecentTimestamp(timestamp)) return { kind: "status", status: 400 };
		const request = triage(body);
		if (request.kind === "challenge") return request;
		if (request.kind === "bad") return { kind: "status", status: 400 };
		// Slack retries an event it thinks was lost, with the same event_id.
		if (request.kind === "keep")
			await this.store.enqueue(
				{ service: "slack", kind: "webhook", payload: request.payload },
				`slack:${request.eventId}`,
			);
		return { kind: "status", status: 200 };
	}
}
