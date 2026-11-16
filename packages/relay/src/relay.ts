import { DurableObject } from "cloudflare:workers";
import {
	type LinearConfig,
	LinearHandler,
} from "./integrations/linear/durable";
import type { SentryConfig, SentryWatch } from "./integrations/sentry/api";
import { POLL_EVERY, SentryHandler } from "./integrations/sentry/durable";
import { SlackHandler } from "./integrations/slack/durable";
import {
	type WebhookConfig,
	WebhookHandler,
} from "./integrations/webhook/durable";
import type { RelayEvent, RelayStore } from "./shared/store";

// The relay's Durable Object: the queue of events kept for the engine, sent over its WebSocket and
// forgotten once acknowledged or after 7 days. Each integration's logic is in integrations/<name>/;
// the methods below are the ones the Worker calls, one line each.

const DAY = 86_400_000;
const RETENTION_MS = 7 * DAY;

/**
 * The most events, and bytes of events, kept for an engine that has not taken them: past either,
 * webhooks are refused with 503 and their senders try again later. The engine takes events as
 * they come, so only an engine away for long, or a flood through a leaked hook address, reaches it.
 */
export const MAX_QUEUED_EVENTS = 10_000;
export const MAX_QUEUED_BYTES = 100 * 1024 * 1024;

/** The most bytes of one stored event: a row of the Durable Object's SQLite holds 2 MB. */
const MAX_EVENT_BYTES = 1_900_000;

/** The most bytes of events in one backlog frame, unless a single event is larger. */
const FRAME_BYTES = 1024 * 1024;

/**
 * The backlog as `{ type: "events", events }` frames of FRAME_BYTES at most, one event at least
 * each, in order: 7 days of events are not one message. `bodies` are the stored events' JSON, read
 * as the frames go: a full queue held whole, twice, would not fit in the object's memory.
 */
export function* backlogFrames(bodies: Iterable<string>): Generator<string> {
	const encoder = new TextEncoder();
	const frame = (batch: string[]) =>
		`{"type":"events","events":[${batch.join(",")}]}`;
	let batch: string[] = [];
	let size = 0;
	for (const body of bodies) {
		const bytes = encoder.encode(body).byteLength;
		if (batch.length && size + bytes > FRAME_BYTES) {
			yield frame(batch);
			batch = [];
			size = 0;
		}
		batch.push(body);
		size += bytes;
	}
	yield frame(batch);
}

/** The event ids an engine's `{ type: "ack", ids }` frame acknowledges: none for any other frame. */
export function ackedIds(message: string | ArrayBuffer): string[] {
	let ids: unknown;
	try {
		const frame = JSON.parse(String(message));
		if (frame.type === "ack") ids = frame.ids;
	} catch {
		return [];
	}
	return Array.isArray(ids)
		? ids.filter((id): id is string => typeof id === "string")
		: [];
}

export class Relay extends DurableObject<Env> {
	private readonly store: RelayStore = {
		kv: this.ctx.storage.kv,
		enqueue: (event, deliveryKey) => this.enqueue(event, deliveryKey),
		waitUntil: (promise) => this.ctx.waitUntil(promise),
		wakeWithin: async (ms) => {
			const at = await this.ctx.storage.getAlarm();
			if (at === null || at > Date.now() + ms)
				await this.ctx.storage.setAlarm(Date.now() + ms);
		},
	};
	private readonly linear = new LinearHandler(this.store);
	private readonly slack = new SlackHandler(this.store);
	private readonly sentry = new SentryHandler(this.store);
	private readonly webhooks = new WebhookHandler(this.store);

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		const sql = ctx.storage.sql;
		// The queue's size is kept as it changes: a webhook from anyone never counts the whole queue,
		// and the purge reads only what it removes.
		sql.exec(
			`CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL, body TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
			CREATE INDEX IF NOT EXISTS events_received_at ON events (received_at);
			CREATE INDEX IF NOT EXISTS deliveries_received_at ON deliveries (received_at);
			CREATE TABLE IF NOT EXISTS queue_size (events INTEGER NOT NULL, bytes INTEGER NOT NULL);
			CREATE TRIGGER IF NOT EXISTS queue_size_in AFTER INSERT ON events BEGIN
				UPDATE queue_size SET events = events + 1, bytes = bytes + LENGTH(CAST(NEW.body AS BLOB));
			END;
			CREATE TRIGGER IF NOT EXISTS queue_size_out AFTER DELETE ON events BEGIN
				UPDATE queue_size SET events = events - 1, bytes = bytes - LENGTH(CAST(OLD.body AS BLOB));
			END`,
		);
		// Counted once, for a queue kept from before its size was.
		if (!sql.exec("SELECT 1 FROM queue_size").toArray().length)
			sql.exec(
				"INSERT INTO queue_size SELECT COUNT(*), COALESCE(SUM(LENGTH(CAST(body AS BLOB))), 0) FROM events",
			);
		ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair("ping", "pong"),
		);
	}

	configureLinear(config: LinearConfig, origin: string): string {
		return this.linear.configure(config, origin);
	}

	installLinear(code: string, state: string, origin: string) {
		return this.linear.install(code, state, origin);
	}

	linearTokens() {
		return this.linear.tokens();
	}

	receiveLinearHook(
		body: ArrayBuffer,
		signature: string | null,
		delivery: string | null,
	) {
		return this.linear.receiveHook(body, signature, delivery);
	}

	configureSlack(signingSecret: string): void {
		this.slack.configure(signingSecret);
	}

	receiveSlackHook(
		body: ArrayBuffer,
		signature: string | null,
		timestamp: string | null,
	) {
		return this.slack.receiveHook(body, signature, timestamp);
	}

	configureSentry(config: SentryConfig): Promise<void> {
		return this.sentry.configure(config);
	}

	watchSentry(watches: SentryWatch[]): Promise<void> {
		return this.sentry.watch(watches);
	}

	configureWebhook(name: string, config: WebhookConfig): void {
		this.webhooks.configure(name, config);
	}

	removeWebhook(name: string): boolean {
		return this.webhooks.remove(name);
	}

	receiveWebhook(
		name: string,
		body: ArrayBuffer,
		headers: Record<string, string>,
		pathSecret: string | undefined,
	) {
		return this.webhooks.receive(name, body, headers, pathSecret);
	}

	async fetch(): Promise<Response> {
		const { 0: client, 1: server } = new WebSocketPair();
		this.ctx.acceptWebSocket(server, ["engine"]);
		const rows = this.ctx.storage.sql.exec<{ body: string }>(
			"SELECT body FROM events ORDER BY received_at",
		);
		const bodies = (function* () {
			for (const row of rows) yield row.body;
		})();
		for (const frame of backlogFrames(bodies)) server.send(frame);
		return new Response(null, { status: 101, webSocket: client });
	}

	webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): void {
		for (const id of ackedIds(message))
			this.ctx.storage.sql.exec("DELETE FROM events WHERE id = ?", id);
	}

	async alarm(): Promise<void> {
		const sql = this.ctx.storage.sql;
		const cutoff = Date.now() - RETENTION_MS;
		sql.exec("DELETE FROM events WHERE received_at < ?", cutoff);
		sql.exec("DELETE FROM deliveries WHERE received_at < ?", cutoff);
		// Sentry has no webhook for new issues: the relay searches every minute.
		if (this.sentry.polling()) {
			// Set first: a poll that throws must not stop the polling for good.
			await this.ctx.storage.setAlarm(Date.now() + POLL_EVERY);
			await this.sentry.poll();
			return;
		}
		const left = sql
			.exec("SELECT 1 FROM events UNION ALL SELECT 1 FROM deliveries LIMIT 1")
			.toArray().length;
		if (left) await this.ctx.storage.setAlarm(Date.now() + DAY);
	}

	/** Whether the queue holds as much as the relay keeps: then no webhook is taken. */
	queueFull(): boolean {
		const [queued] = this.ctx.storage.sql
			.exec<{ events: number; bytes: number }>(
				"SELECT events, bytes FROM queue_size",
			)
			.toArray();
		return (
			(queued?.events ?? 0) >= MAX_QUEUED_EVENTS ||
			(queued?.bytes ?? 0) >= MAX_QUEUED_BYTES
		);
	}

	private async enqueue(
		event: RelayEvent,
		deliveryKey?: string,
	): Promise<"queued" | "seen" | "too large"> {
		const stored = {
			id: crypto.randomUUID(),
			receivedAt: Date.now(),
			...event,
		};
		const body = JSON.stringify(stored);
		if (new TextEncoder().encode(body).byteLength > MAX_EVENT_BYTES)
			return "too large";
		const sql = this.ctx.storage.sql;
		// One transaction: the delivery is seen only with its event kept.
		const kept = this.ctx.storage.transactionSync(() => {
			if (
				deliveryKey !== undefined &&
				sql.exec(
					"INSERT OR IGNORE INTO deliveries VALUES (?, ?)",
					deliveryKey,
					stored.receivedAt,
				).rowsWritten === 0
			)
				return false;
			sql.exec(
				"INSERT INTO events VALUES (?, ?, ?)",
				stored.id,
				stored.receivedAt,
				body,
			);
			return true;
		});
		if (!kept) return "seen";
		if ((await this.ctx.storage.getAlarm()) === null)
			await this.ctx.storage.setAlarm(Date.now() + DAY);
		const frame = JSON.stringify({ type: "events", events: [stored] });
		for (const ws of this.ctx.getWebSockets("engine")) {
			try {
				ws.send(frame);
			} catch {
				// A closing socket: the engine gets the event from the backlog on reconnect.
			}
		}
		return "queued";
	}
}
