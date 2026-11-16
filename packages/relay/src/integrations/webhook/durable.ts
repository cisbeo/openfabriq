// The factory's own webhooks in the relay's Durable Object.

import { MAX_BODY } from "../../shared/http";
import type { RelayStore } from "../../shared/store";
import { bodyHash, checkWebhook, type Signature } from "./signatures";

export interface WebhookConfig {
	signature: Signature;
	secret: string;
}

export class WebhookHandler {
	constructor(private readonly store: RelayStore) {}

	configure(name: string, config: WebhookConfig): void {
		this.store.kv.put(`webhook:${name}`, config);
	}

	remove(name: string): boolean {
		return this.store.kv.delete(`webhook:${name}`);
	}

	/** Answered at once; a webhook the relay does not know, or badly signed, is not kept. */
	async receive(
		name: string,
		body: ArrayBuffer,
		headers: Record<string, string>,
		pathSecret: string | undefined,
	): Promise<200 | 400 | 401 | 413> {
		const config = this.store.kv.get<WebhookConfig>(`webhook:${name}`);
		if (!config) return 401;
		// The Worker already stops a larger body; checked again before any HMAC is computed.
		if (body.byteLength > MAX_BODY) return 413;
		// The check reads only the headers its sender documents; names are lowercase here.
		const header = (h: string) => headers[h.toLowerCase()] ?? null;
		const check = await checkWebhook(
			config.signature,
			config.secret,
			body,
			header,
			pathSecret,
		);
		if (!check.ok) return check.status;
		const delivery = check.delivery ?? (await bodyHash(body));
		const kept = await this.store.enqueue(
			{
				service: "webhook",
				kind: "received",
				webhook: name,
				delivery,
				// As text: the sender's format is its own; the engine shows it to the agent as data.
				payload: new TextDecoder().decode(body),
			},
			`webhook:${name}:${delivery}`,
		);
		// Bytes that are not text, or many quotes, grow as JSON past what the queue keeps.
		return kept === "too large" ? 413 : 200;
	}
}
