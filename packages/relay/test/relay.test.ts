import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { ackedIds, MAX_QUEUED_EVENTS } from "../src/relay";
import { call, configure, ENGINE, events, relay, sendWebhook } from "./helpers";

const DAY = 86_400_000;

it("answers health", async () => {
	const response = await call("/health");
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ ok: true });
});

it("answers 404 elsewhere", async () => {
	expect((await call("/nope")).status).toBe(404);
	expect((await call("/health", { method: "POST" })).status).toBe(404);
});

/** Every route only the engine may call, with what makes it reach its token check. */
const ENGINE_ROUTES: [string, string, Record<string, string>?][] = [
	["POST", "/config/linear"],
	["POST", "/config/slack"],
	["POST", "/config/sentry"],
	["PUT", "/config/sentry/watches"],
	["POST", "/config/webhook/x"],
	["DELETE", "/config/webhook/x"],
	["GET", "/tokens/linear"],
	["GET", "/engine", { Upgrade: "websocket" }],
];

/** The Worker with its ENGINE_TOKEN replaced, as in a deployment that forgot to set it. */
function callWithToken(token: string, path: string, init: RequestInit) {
	return worker.fetch(
		new Request(`https://relay.test${path}`, init) as Parameters<
			typeof worker.fetch
		>[0],
		{ ...env, ENGINE_TOKEN: token },
	);
}

describe.each(ENGINE_ROUTES)("%s %s", (method, path, headers = {}) => {
	const init = (authorization?: string): RequestInit => ({
		method,
		headers: authorization
			? { ...headers, Authorization: authorization }
			: headers,
		...(method === "GET" ? {} : { body: "{}" }),
	});

	it("answers 401 without the engine's token", async () => {
		expect((await call(path, init())).status).toBe(401);
		expect((await call(path, init("Bearer wrong-token"))).status).toBe(401);
		expect((await call(path, init("test-token"))).status).toBe(401);
	});

	it("answers 401 to any token when ENGINE_TOKEN is empty", async () => {
		for (const authorization of [
			undefined,
			"Bearer ",
			"Bearer",
			"Bearer undefined",
		])
			expect((await callWithToken("", path, init(authorization))).status).toBe(
				401,
			);
	});
});

it("answers 405 to an engine's webhook route with another method, 401 without the token", async () => {
	for (const method of ["GET", "PUT", "PATCH"]) {
		expect(
			(await call("/config/webhook/x", { method, headers: ENGINE })).status,
		).toBe(405);
		expect((await call("/config/webhook/x", { method })).status).toBe(401);
	}
});

it("answers 404 to an unknown route, with or without the token", async () => {
	for (const [method, path] of [
		["GET", "/config/linear"],
		["GET", "/config/slack"],
		["DELETE", "/config/sentry"],
		["POST", "/config/sentry/watches"],
		["POST", "/tokens/linear"],
		["POST", "/engine"],
		["POST", "/config/nope"],
		["POST", "/config/webhook/Bad_Name"],
		["POST", "/config/webhook/x/y"],
		["GET", "/hooks/custom/x"],
		["GET", "/hooks/linear"],
		["GET", "/hooks/slack"],
		["POST", "/oauth/linear/callback"],
	] as const)
		for (const headers of [{}, ENGINE])
			expect((await call(path, { method, headers })).status).toBe(404);
});

it("answers 426 to a GET /engine that is not a WebSocket upgrade, before the token", async () => {
	expect((await call("/engine")).status).toBe(426);
	expect((await call("/engine", { headers: ENGINE })).status).toBe(426);
	expect(
		(await call("/engine", { headers: { Authorization: "Bearer wrong" } }))
			.status,
	).toBe(426);
});

it("purges events older than 7 days", async () => {
	await runInDurableObject(relay(), async (_instance, state) => {
		state.storage.sql.exec(
			"INSERT INTO events VALUES ('old', ?, '{}'), ('recent', ?, '{}')",
			Date.now() - 8 * DAY,
			Date.now(),
		);
		await state.storage.setAlarm(Date.now() + DAY);
	});
	expect(await runDurableObjectAlarm(relay())).toBe(true);
	const ids = await runInDurableObject(relay(), (_instance, state) =>
		state.storage.sql
			.exec<{ id: string }>("SELECT id FROM events")
			.toArray()
			.map((row) => row.id),
	);
	expect(ids).not.toContain("old");
	expect(ids).toContain("recent");
});

/** The rows left in a table, and when the alarm is set to fire next. */
function afterAlarm(table: "events" | "deliveries") {
	return runInDurableObject(relay(), async (_instance, state) => ({
		ids: state.storage.sql
			.exec<{ id: string }>(`SELECT id FROM ${table} ORDER BY id`)
			.toArray()
			.map((row) => row.id),
		alarm: await state.storage.getAlarm(),
	}));
}

it("forgets deliveries older than 7 days, and wakes again in a day while rows remain", async () => {
	await runInDurableObject(relay(), async (_instance, state) => {
		state.storage.sql.exec("DELETE FROM events");
		state.storage.sql.exec("DELETE FROM deliveries");
		state.storage.sql.exec(
			"INSERT INTO deliveries VALUES ('old', ?), ('recent', ?)",
			Date.now() - 8 * DAY,
			Date.now() - 6 * DAY,
		);
		await state.storage.setAlarm(Date.now() + DAY);
	});
	const before = Date.now();
	expect(await runDurableObjectAlarm(relay())).toBe(true);
	const { ids, alarm } = await afterAlarm("deliveries");
	expect(ids).toEqual(["recent"]);
	expect(alarm).toBeGreaterThanOrEqual(before + DAY);
	expect(alarm).toBeLessThanOrEqual(Date.now() + DAY);
});

it("leaves the alarm off once every event and delivery is purged", async () => {
	await runInDurableObject(relay(), async (_instance, state) => {
		state.storage.sql.exec("DELETE FROM events");
		state.storage.sql.exec("DELETE FROM deliveries");
		state.storage.sql.exec(
			"INSERT INTO deliveries VALUES ('old', ?)",
			Date.now() - 8 * DAY,
		);
		state.storage.sql.exec(
			"INSERT INTO events VALUES ('old', ?, '{}')",
			Date.now() - 8 * DAY,
		);
		await state.storage.setAlarm(Date.now() + DAY);
	});
	expect(await runDurableObjectAlarm(relay())).toBe(true);
	expect(await afterAlarm("deliveries")).toEqual({ ids: [], alarm: null });
	expect((await afterAlarm("events")).ids).toEqual([]);
});

it("wakes again in a day while only a recent event remains", async () => {
	await runInDurableObject(relay(), async (_instance, state) => {
		state.storage.sql.exec("DELETE FROM events");
		state.storage.sql.exec("DELETE FROM deliveries");
		state.storage.sql.exec(
			"INSERT INTO events VALUES ('recent', ?, '{}')",
			Date.now(),
		);
		await state.storage.setAlarm(Date.now() + DAY);
	});
	const before = Date.now();
	expect(await runDurableObjectAlarm(relay())).toBe(true);
	const { ids, alarm } = await afterAlarm("events");
	expect(ids).toEqual(["recent"]);
	expect(alarm).toBeGreaterThanOrEqual(before + DAY);
});

it("forgets only the string ids of an ack frame", async () => {
	const left = await runInDurableObject(relay(), (instance, state) => {
		state.storage.sql.exec("DELETE FROM events");
		state.storage.sql.exec(
			"INSERT INTO events VALUES ('a', 1, '{}'), ('b', 1, '{}'), ('c', 1, '{}'), ('d', 1, '{}'), ('e', 1, '{}')",
		);
		const socket = null as unknown as WebSocket;
		for (const message of [
			"not json",
			"null",
			"42",
			'"ack"',
			'{"type":"ack"}',
			'{"type":"ack","ids":"a"}',
			'{"type":"ack","ids":{"0":"a"}}',
			'{"type":"events","ids":["a"]}',
			'{"ids":["a"]}',
			'{"type":"ack","ids":[1,null,["b"],{"id":"c"}]}',
			new TextEncoder().encode('{"type":"ack","ids":["a"]}')
				.buffer as ArrayBuffer,
		])
			instance.webSocketMessage(socket, message);
		instance.webSocketMessage(socket, '{"type":"ack","ids":["b",2,"d","x"]}');
		return state.storage.sql
			.exec<{ id: string }>("SELECT id FROM events ORDER BY id")
			.toArray()
			.map((row) => row.id);
	});
	expect(left).toEqual(["a", "c", "e"]);
});

it("reads the acknowledged ids of an engine's frame", () => {
	expect(ackedIds('{"type":"ack","ids":["a",1,null,"b",["c"]]}')).toEqual([
		"a",
		"b",
	]);
	expect(ackedIds('{"type":"ack","ids":[]}')).toEqual([]);
	for (const message of [
		'{"type":"ack","ids":"a"}',
		'{"type":"ack"}',
		'{"type":"events","ids":["a"]}',
		"null",
		"ping",
		new TextEncoder().encode('{"type":"ack","ids":["a"]}')
			.buffer as ArrayBuffer,
	])
		expect(ackedIds(message)).toEqual([]);
});

it("keeps the queue's size, in events and bytes, as events come and go", async () => {
	const size = () =>
		runInDurableObject(relay(), (_instance, state) => {
			state.storage.sql.exec("DELETE FROM events");
			state.storage.sql.exec(
				"INSERT INTO events VALUES ('a', 1, '\"é\"'), ('b', 2, '{}')",
			);
			const after = state.storage.sql
				.exec("SELECT events, bytes FROM queue_size")
				.toArray();
			state.storage.sql.exec("DELETE FROM events WHERE id = 'a'");
			return [
				after,
				state.storage.sql
					.exec("SELECT events, bytes FROM queue_size")
					.toArray(),
			];
		});
	// "é" is two bytes in UTF-8: four with its quotes.
	expect(await size()).toEqual([
		[{ events: 2, bytes: 6 }],
		[{ events: 1, bytes: 2 }],
	]);
});

it("refuses webhooks with 503 while the engine leaves too many events, and takes the sender's retry once it catches up", async () => {
	await configure();
	await runInDurableObject(relay(), (_instance, state) => {
		for (let i = 0; i < MAX_QUEUED_EVENTS; i++)
			state.storage.sql.exec(
				"INSERT INTO events VALUES (?, ?, '{}')",
				`waiting-${i}`,
				Date.now(),
			);
	});
	const delivery = crypto.randomUUID();
	const refused = await sendWebhook({ type: "Issue" }, delivery);
	expect(refused.status).toBe(503);
	expect(refused.headers.get("Retry-After")).toBe("60");
	await runInDurableObject(relay(), (_instance, state) => {
		state.storage.sql.exec("DELETE FROM events WHERE id LIKE 'waiting-%'");
	});
	// The refused delivery was not taken as seen: its retry is queued.
	expect((await sendWebhook({ type: "Issue" }, delivery)).status).toBe(200);
	expect((await events()).filter((e) => e.delivery === delivery)).toHaveLength(
		1,
	);
});
