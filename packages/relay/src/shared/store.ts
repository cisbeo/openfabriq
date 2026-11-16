/** An event kept for the engine: `service` names the integration, `kind` what happened. */
export interface RelayEvent {
	service: string;
	kind: string;
	[field: string]: unknown;
}

/** What an integration does with the relay's Durable Object: its own keys, and the shared queue. */
export interface RelayStore {
	/** Keys start with the integration's name: `linear:`, `slack:`, `sentry:`, `webhook:`. */
	kv: SyncKvStorage;
	/**
	 * Keeps an event for the engine. With a delivery key, once in 7 days: a retried delivery is kept
	 * once, and the key counts as seen only with its event stored, so a failed write loses nothing.
	 * "too large": the event would not fit in a row of the queue, and is not kept.
	 */
	enqueue(
		event: RelayEvent,
		deliveryKey?: string,
	): Promise<"queued" | "seen" | "too large">;
	waitUntil(promise: Promise<unknown>): void;
	/** Sets the alarm to fire within `ms`, unless it already does. */
	wakeWithin(ms: number): Promise<void>;
}
