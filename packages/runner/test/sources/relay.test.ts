import { expect, it, vi } from "vitest";
import {
	type RelayEvent,
	reconnectDelay,
	relayClient,
} from "../../src/sources/relay.js";

function fakeRelay(currentToken?: () => string) {
	const sockets: FakeSocket[] = [];
	class FakeSocket {
		onopen: ((e: unknown) => void) | null = null;
		onmessage: ((e: { data: unknown }) => void) | null = null;
		onclose: ((e: unknown) => void) | null = null;
		onerror: ((e: unknown) => void) | null = null;
		sent: string[] = [];
		closed = false;
		constructor(
			public url: string,
			public options: { headers: Record<string, string> },
		) {
			sockets.push(this);
		}
		send(data: string) {
			this.sent.push(data);
		}
		// Like Node 22: closing fires the error and close handlers again.
		close() {
			this.closed = true;
			this.onerror?.({});
			this.onclose?.({});
		}
	}
	const fetches: string[] = [];
	let expiresAt = Date.now() + 24 * 3600_000;
	const fakeFetch = (async (url: URL, init: RequestInit) => {
		fetches.push(
			`${url.href} ${(init.headers as Record<string, string>).Authorization}`,
		);
		return {
			ok: true,
			json: async () => ({
				organizations: [
					{
						organizationId: "org-1",
						organizationName: "Acme",
						appUserId: "app-1",
						accessToken: `lin_oauth_${fetches.length}`,
						expiresAt,
					},
				],
			}),
		} as Response;
	}) as unknown as typeof fetch;
	const relay = relayClient(
		{ url: "https://relay.example", token: "engine-token" },
		{
			WebSocket: FakeSocket,
			fetch: fakeFetch,
			...(currentToken ? { currentToken } : {}),
		},
	);
	return {
		sockets,
		fetches,
		relay,
		expireSoon: () => {
			expiresAt = Date.now() + 60_000;
		},
	};
}

const event = (id: string): RelayEvent => ({
	id,
	receivedAt: 1,
	service: "linear",
	kind: "webhook",
	payload: {},
});
const frame = (...events: RelayEvent[]) => ({
	data: JSON.stringify({ type: "events", events }),
});

it("acknowledges the events of a batch it handled, once handled, and never one that failed", async () => {
	const { sockets, relay } = fakeRelay();
	const lines: string[] = [];
	let done: () => void = () => {};
	const handled: string[][] = [];
	relay.listen(
		(events) => {
			handled.push(events.map((e) => e.id));
			if (events[0]?.id === "bad") return Promise.reject(new Error("disk"));
			// e2 is not handled: it comes back.
			return new Promise<string[]>((ok) => {
				done = () => ok(["e1"]);
			});
		},
		(line) => lines.push(line),
	);
	const socket = sockets[0] as (typeof sockets)[number];
	expect(socket.url).toBe("wss://relay.example/engine");
	expect(socket.options.headers).toEqual({
		Authorization: "Bearer engine-token",
	});
	socket.onopen?.({});
	socket.onmessage?.(frame(event("e1"), event("e2")));
	socket.onmessage?.({ data: "pong" });
	await new Promise((r) => setTimeout(r, 0));
	expect(handled).toEqual([["e1", "e2"]]);
	expect(socket.sent).toEqual([]); // not yet persisted
	done();
	await new Promise((r) => setTimeout(r, 0));
	expect(socket.sent).toEqual(['{"type":"ack","ids":["e1"]}']);
	socket.onmessage?.(frame(event("bad")));
	await new Promise((r) => setTimeout(r, 0));
	expect(socket.sent).toHaveLength(1);
	expect(lines).toEqual([
		"relay: connected",
		"relay: not acknowledged, it comes back: disk",
	]);
	relay.stop();
});

it("ignores what is not an event in a frame, and never throws on a bad frame", async () => {
	const { sockets, relay } = fakeRelay();
	const handled: string[][] = [];
	relay.listen(
		async (events) => {
			handled.push(events.map((e) => e.id));
			return [];
		},
		() => {},
	);
	const socket = sockets[0] as (typeof sockets)[number];
	expect(() => {
		socket.onmessage?.({ data: "null" });
		socket.onmessage?.({
			data: JSON.stringify({
				type: "events",
				events: [null, 5, { kind: "x" }, event("e1")],
			}),
		});
	}).not.toThrow();
	await new Promise((r) => setTimeout(r, 0));
	expect(handled).toEqual([["e1"]]);
	relay.stop();
});

it("reconnects after a close, and stops for good", async () => {
	vi.useFakeTimers();
	try {
		const { sockets, relay } = fakeRelay();
		const lines: string[] = [];
		relay.listen(
			async () => [],
			(line) => lines.push(line),
		);
		sockets[0]?.onclose?.({});
		await vi.advanceTimersByTimeAsync(1000); // first retry waits 1 s
		expect(sockets).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(30_000); // the keepalive
		expect(sockets[1]?.sent).toEqual(["ping"]);
		vi.setSystemTime(Date.now() + 10 * 60_000); // the laptop slept
		await vi.advanceTimersByTimeAsync(30_000 + 1000);
		expect(sockets[1]?.closed).toBe(true);
		expect(lines).toContain("relay: woke up from sleep; reconnecting");
		await vi.advanceTimersByTimeAsync(2000);
		expect(sockets).toHaveLength(3);
		relay.stop();
		expect(sockets[2]?.closed).toBe(true);
		await vi.advanceTimersByTimeAsync(120_000);
		expect(sockets).toHaveLength(3);
		expect(vi.getTimerCount()).toBe(0);
	} finally {
		vi.useRealTimers();
	}
});

it("reconnects after a handshake that failed: Node 22 fires error, never close", async () => {
	vi.useFakeTimers();
	try {
		const { sockets, relay } = fakeRelay();
		const lines: string[] = [];
		relay.listen(
			async () => [],
			(line) => lines.push(line),
		);
		sockets[0]?.onerror?.({}); // network unreachable: the socket stays CONNECTING
		await vi.advanceTimersByTimeAsync(1000);
		expect(sockets).toHaveLength(2);
		expect(lines).toEqual(["relay: connection error"]);
		sockets[1]?.onerror?.({}); // again, and again after a backoff
		await vi.advanceTimersByTimeAsync(2000);
		expect(sockets).toHaveLength(3);
		relay.stop();
	} finally {
		vi.useRealTimers();
	}
});

it("keeps Linear tokens until 5 minutes before they expire, and asks again after an install", async () => {
	const { sockets, fetches, relay, expireSoon } = fakeRelay();
	expect((await relay.linearTokens())[0]?.accessToken).toBe("lin_oauth_1");
	await relay.linearTokens();
	expect(fetches).toEqual([
		"https://relay.example/tokens/linear Bearer engine-token",
	]);
	relay.listen(
		async () => [],
		() => {},
	);
	sockets[0]?.onmessage?.(
		frame({ id: "i", receivedAt: 1, service: "linear", kind: "installed" }),
	);
	expireSoon();
	await relay.linearTokens(); // the install emptied the cache
	await relay.linearTokens(); // expires within 5 minutes: asked again
	expect(fetches).toHaveLength(3);
	relay.stop();
});

it("reconnects with the token saved now, after the relay was deployed again with a new one", async () => {
	vi.useFakeTimers();
	try {
		let saved = "engine-token";
		const { sockets, relay } = fakeRelay(() => saved);
		relay.listen(
			async () => [],
			() => {},
		);
		expect(sockets[0]?.options.headers.Authorization).toBe(
			"Bearer engine-token",
		);
		saved = "new-token";
		sockets[0]?.onclose?.({});
		await vi.advanceTimersByTimeAsync(1000);
		expect(sockets[1]?.options.headers.Authorization).toBe("Bearer new-token");
		relay.stop();
	} finally {
		vi.useRealTimers();
	}
});

it("backs off from 1 s up to a minute before reconnecting", () => {
	expect([0, 1, 2, 10].map(reconnectDelay)).toEqual([1000, 2000, 4000, 60_000]);
});

it("tells the relay which Sentry searches to run, with the engine's token", async () => {
	const calls: { url: string; init: RequestInit }[] = [];
	let status = 204;
	const relay = relayClient(
		{ url: "https://relay.example", token: "engine-token" },
		{
			fetch: (async (url: URL, init: RequestInit) => {
				calls.push({ url: url.href, init });
				return { ok: status < 300, status } as Response;
			}) as unknown as typeof fetch,
		},
	);
	const watches = [
		{ organization: "acme", project: "web", query: "level:error" },
	];
	await relay.watchSentry(watches);
	const [call] = calls;
	expect(call?.url).toBe("https://relay.example/config/sentry/watches");
	expect(call?.init.method).toBe("PUT");
	expect(call?.init.headers).toMatchObject({
		Authorization: "Bearer engine-token",
	});
	expect(JSON.parse(String(call?.init.body))).toEqual({ watches });
	status = 401;
	await expect(relay.watchSentry([])).rejects.toThrow("answered 401");
});
