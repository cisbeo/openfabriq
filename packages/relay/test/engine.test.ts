// All WebSocket tests stay in this file: DO WebSockets do not survive per-file storage isolation.
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it, vi } from "vitest";
import worker from "../src/index";
import { backlogFrames } from "../src/relay";
import { call, configure, ENGINE, sendWebhook } from "./helpers";

interface Frame {
	type: string;
	events: { id: string; delivery?: string }[];
}

async function connect() {
	const response = await call("/engine", {
		headers: { ...ENGINE, Upgrade: "websocket" },
	});
	expect(response.status).toBe(101);
	const socket = response.webSocket;
	if (!socket) throw new Error("no WebSocket");
	const frames: Frame[] = [];
	socket.addEventListener("message", (event) => {
		if (event.data !== "pong") frames.push(JSON.parse(String(event.data)));
	});
	socket.accept();
	await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
	return { socket, frames };
}

beforeAll(async () => {
	await configure();
});

it("refuses an engine without the token", async () => {
	const response = await call("/engine", { headers: { Upgrade: "websocket" } });
	expect(response.status).toBe(401);
});

it("refuses a request that is not a WebSocket upgrade", async () => {
	const response = await call("/engine", { headers: ENGINE });
	expect(response.status).toBe(426);
});

it("answers ping with pong", async () => {
	const { socket } = await connect();
	const pong = new Promise((resolve) =>
		socket.addEventListener("message", (event) => resolve(event.data)),
	);
	socket.send("ping");
	expect(await pong).toBe("pong");
	socket.close();
});

it("delivers the backlog, pushes new events, and forgets acked ones", async () => {
	await sendWebhook({ type: "Issue" }, "first");
	const first = await connect();
	const backlog = first.frames[0];
	expect(backlog?.type).toBe("events");
	expect(backlog?.events.map((e) => e.delivery)).toEqual(["first"]);

	await sendWebhook({ type: "Issue" }, "second");
	await vi.waitFor(() => expect(first.frames).toHaveLength(2));
	expect(first.frames[1]?.events.map((e) => e.delivery)).toEqual(["second"]);

	first.socket.send("not json");
	first.socket.send(
		JSON.stringify({ type: "ack", ids: [backlog?.events[0]?.id] }),
	);
	await new Promise((resolve) => setTimeout(resolve, 50));
	first.socket.close();

	const again = await connect();
	expect(again.frames[0]?.events.map((e) => e.delivery)).toEqual(["second"]);
	again.socket.close();
});

it("splits the backlog into frames of 1 MiB at most, one event at least each", () => {
	const event = (id: string, size: number) =>
		JSON.stringify({ id, pad: "x".repeat(size) });
	const frames = [
		...backlogFrames([
			event("a", 600_000),
			event("b", 300_000),
			event("c", 200_000),
			event("d", 2_000_000),
		]),
	].map((f) => JSON.parse(f) as Frame);
	expect(frames.map((f) => f.type)).toEqual(["events", "events", "events"]);
	expect(frames.map((f) => f.events.map((e) => e.id))).toEqual([
		["a", "b"],
		["c"],
		["d"],
	]);
	expect([...backlogFrames([])]).toEqual(['{"type":"events","events":[]}']);
});

it("reads the backlog as its frames go, never all of it first", () => {
	const read: string[] = [];
	const bodies = function* () {
		for (const id of ["a", "b", "c"]) {
			read.push(id);
			yield JSON.stringify({ id, pad: "x".repeat(600_000) });
		}
	};
	const frames = backlogFrames(bodies());
	frames.next();
	// The first frame left when b did not fit: c is not read yet.
	expect(read).toEqual(["a", "b"]);
});

it("sends a large backlog in several frames, in order", async () => {
	const ids = ["big-1", "big-2", "big-3"];
	await runInDurableObject(env.RELAY.getByName("relay"), (_instance, state) => {
		for (const [at, id] of ids.entries())
			state.storage.sql.exec(
				"INSERT INTO events VALUES (?, ?, ?)",
				id,
				at,
				JSON.stringify({ id, pad: "x".repeat(600_000) }),
			);
	});
	const { socket, frames } = await connect();
	const received = () => frames.flatMap((f) => f.events.map((e) => e.id));
	await vi.waitFor(() =>
		expect(received()).toEqual(expect.arrayContaining(ids)),
	);
	// The oldest first, each 600 kB event in its own frame.
	expect(received().slice(0, 3)).toEqual(ids);
	expect(frames.slice(0, 3).map((f) => f.events[0]?.id)).toEqual(ids);
	socket.send(JSON.stringify({ type: "ack", ids }));
	await new Promise((resolve) => setTimeout(resolve, 50));
	socket.close();
});

it("accepts an engine behind a proxy that says wss, as Traefik does", async () => {
	// workerd builds request.url from X-Forwarded-Proto, which Traefik sets to wss for a WebSocket.
	const request = new Request("wss://relay.test/engine", {
		headers: { ...ENGINE, Upgrade: "websocket" },
	});
	const response = await worker.fetch(
		request as Parameters<typeof worker.fetch>[0],
		env,
	);
	expect(response.status).toBe(101);
	response.webSocket?.accept();
	response.webSocket?.close();
});
