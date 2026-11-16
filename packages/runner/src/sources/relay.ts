// The relay: a Worker the user deploys, which keeps what comes from the Internet for the
// engine. The engine connects out to it; nothing listens on this machine. Its contract:
// packages/relay/README.md.

import { type Factory, RELAY_EVENTS } from "@openfabriq/core";
import { errorText } from "../files.js";
import type { SentryWatch } from "./sentry/events.js";

/** Whether a factory listens to a service, whose events only the relay brings. */
export const usesRelay = (factory: Factory) =>
	Object.values(factory.automations).some((a) =>
		a.when.some((t) => RELAY_EVENTS.includes(t.event)),
	);

/** Wait before reconnecting: 1 s, 2 s, 4 s… up to a minute. */
export const reconnectDelay = (attempt: number) =>
	Math.min(60_000, 1000 * 2 ** attempt);

/** Timers stand still while the laptop sleeps: a longer gap between two checks means it woke up. */
const WATCHDOG_MS = 30_000;
const SLEPT_MS = 120_000;

/** Calls `check` every 30 s, telling it whether the machine slept since the last call. */
function wakeWatchdog(check: (slept: boolean) => void): NodeJS.Timeout {
	let checkedAt = Date.now();
	return setInterval(() => {
		const slept = Date.now() - checkedAt > SLEPT_MS;
		checkedAt = Date.now();
		check(slept);
	}, WATCHDOG_MS);
}

/** One event the relay kept: `{ service, kind }` say what the other fields are. */
export interface RelayEvent {
	id: string;
	receivedAt: number;
	service: string;
	kind: string;
	[field: string]: unknown;
}

/** A Linear organization openfabriq is installed in, with the app's current access token. */
export interface LinearInstall {
	organizationId: string;
	organizationName: string;
	appUserId: string;
	accessToken: string;
	/** Epoch milliseconds. */
	expiresAt: number;
}

export interface Relay {
	/**
	 * Connects and calls onEvents for each batch; an event is acknowledged only once onEvents
	 * resolved with its id, so one that was not handled comes back. Reconnects by itself until stop().
	 */
	listen(
		onEvents: (events: RelayEvent[]) => Promise<string[]>,
		log: (line: string) => void,
	): void;
	linearTokens(): Promise<LinearInstall[]>;
	/** Tells the relay which Sentry searches to run every minute. */
	watchSentry(watches: SentryWatch[]): Promise<void>;
	stop(): void;
}

interface WebSocketLike {
	onopen: ((event: unknown) => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: ((event: unknown) => void) | null;
	onerror: ((event: unknown) => void) | null;
	send(data: string): void;
	close(): void;
}

type Socket = new (
	url: string,
	options: { headers: Record<string, string> },
) => WebSocketLike;

/** Closes a socket for good: under Node 22, close() can fire onerror again, and its handler loop. */
function drop(socket: WebSocketLike) {
	socket.onopen = null;
	socket.onmessage = null;
	socket.onerror = null;
	socket.onclose = null;
	socket.close();
}

/** A token is asked again this long before it expires. */
const EARLY_MS = 5 * 60_000;

export function relayClient(
	{ url, token }: { url: string; token: string },
	options: {
		WebSocket?: Socket;
		fetch?: typeof fetch;
		/** The token saved now: "connect relay" may deploy the relay again with a new one while the engine runs. */
		currentToken?: () => string | undefined;
	} = {},
): Relay {
	// Read at each connection and request: a socket opened before a redeploy stays open, the next one needs the new token.
	const authorization = () => `Bearer ${options.currentToken?.() ?? token}`;
	let cache: { installs: LinearInstall[]; until: number } | undefined;
	let stopped = false;
	let socket: WebSocketLike | undefined;
	let timer: NodeJS.Timeout | undefined;
	let watchdog: NodeJS.Timeout | undefined;

	return {
		listen(onEvents, log) {
			// Node 22's WebSocket (undici) takes headers; the browser's would not.
			const Socket =
				options.WebSocket ?? (globalThis.WebSocket as unknown as Socket);
			const address = new URL("/engine", url).href.replace(/^http/, "ws");
			let attempt = 0;
			// Batches are handled one after the other, in the relay's order.
			let handled = Promise.resolve();
			const again = () => {
				if (stopped) return;
				timer = setTimeout(connect, reconnectDelay(attempt++));
			};
			function receive(current: WebSocketLike, data: string) {
				let frame: { type?: string; events?: unknown[] } | null;
				try {
					frame = JSON.parse(data);
				} catch {
					return; // "pong", or a frame the relay does not send
				}
				if (frame?.type !== "events" || !Array.isArray(frame.events)) return;
				const events = frame.events.filter(
					(e): e is RelayEvent =>
						typeof e === "object" &&
						e !== null &&
						typeof (e as RelayEvent).id === "string",
				);
				// A new installation has a token the cache does not know yet.
				if (events.some((e) => e.kind === "installed")) cache = undefined;
				handled = handled
					.then(() => onEvents(events))
					.then((ids) => {
						if (ids.length) current.send(JSON.stringify({ type: "ack", ids }));
					})
					.catch((error: unknown) =>
						log(`relay: not acknowledged, it comes back: ${errorText(error)}`),
					);
			}
			function connect() {
				if (stopped) return;
				const current = new Socket(address, {
					headers: { Authorization: authorization() },
				});
				socket = current;
				current.onopen = () => {
					attempt = 0;
					log("relay: connected");
				};
				// A handler that throws would crash the engine: a bad frame is logged and dropped.
				current.onmessage = (message) => {
					try {
						receive(current, String(message.data));
					} catch (error) {
						log(`relay: frame ignored: ${errorText(error)}`);
					}
				};
				// Under Node 22 a handshake that fails fires error but never close: drop it and retry here.
				current.onerror = () => {
					log("relay: connection error");
					if (socket === current) socket = undefined;
					drop(current);
					again();
				};
				current.onclose = () => {
					if (socket === current) socket = undefined;
					again();
				};
			}
			connect();
			// After a sleep the socket can look open while the relay dropped it: start a new one.
			watchdog = wakeWatchdog((slept) => {
				const open = socket;
				if (!open) return;
				if (!slept) {
					try {
						open.send("ping");
					} catch {} // closing: onclose reconnects
					return;
				}
				log("relay: woke up from sleep; reconnecting");
				socket = undefined;
				drop(open);
				again();
			});
		},
		async linearTokens() {
			if (cache && Date.now() < cache.until) return cache.installs;
			const response = await (options.fetch ?? fetch)(
				new URL("/tokens/linear", url),
				{ headers: { Authorization: authorization() } },
			);
			if (!response.ok)
				throw new Error(`relay: /tokens/linear answered ${response.status}`);
			const { organizations } = (await response.json()) as {
				organizations: LinearInstall[];
			};
			const until =
				Math.min(...organizations.map((o) => o.expiresAt)) - EARLY_MS;
			cache = organizations.length
				? { installs: organizations, until }
				: undefined;
			return organizations;
		},
		async watchSentry(watches) {
			const response = await (options.fetch ?? fetch)(
				new URL("/config/sentry/watches", url),
				{
					method: "PUT",
					headers: {
						Authorization: authorization(),
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ watches }),
				},
			);
			if (!response.ok)
				throw new Error(
					`relay: /config/sentry/watches answered ${response.status}`,
				);
		},
		stop() {
			stopped = true;
			if (timer) clearTimeout(timer);
			if (watchdog) clearInterval(watchdog);
			if (socket) drop(socket);
		},
	};
}
