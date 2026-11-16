import { runInDurableObject } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import {
	isMentionOrThreadReply,
	triage,
} from "../../src/integrations/slack/durable";
import { isRecentTimestamp } from "../../src/shared/crypto";
import {
	call,
	configureSlack,
	ENGINE,
	events,
	relay,
	SIGNING_SECRET,
	sendSlack,
} from "../helpers";

// Storage is shared by the tests of a file: each starts with an empty queue.
beforeEach(() =>
	runInDurableObject(relay(), (_instance, state) => {
		state.storage.sql.exec("DELETE FROM events");
		state.storage.sql.exec("DELETE FROM deliveries");
	}),
);

const mention = (eventId: string) => ({
	type: "event_callback",
	team_id: "T1",
	api_app_id: "A1",
	event_id: eventId,
	event_time: 1762000000,
	event: {
		type: "app_mention",
		user: "U1",
		text: "<@B1> hi",
		ts: "1.2",
		channel: "C1",
	},
});

it("needs the engine token to configure Slack", async () => {
	const response = await call("/config/slack", {
		method: "POST",
		headers: { Authorization: "Bearer wrong" },
		body: JSON.stringify({ signingSecret: "s" }),
	});
	expect(response.status).toBe(401);
});

it("refuses a Slack configuration without a signing secret", async () => {
	for (const body of ["{}", '{"signingSecret":""}', "not json"]) {
		const response = await call("/config/slack", {
			method: "POST",
			headers: ENGINE,
			body,
		});
		expect(response.status).toBe(400);
	}
});

it("refuses every Slack request while no signing secret is configured", async () => {
	const response = await sendSlack({
		type: "url_verification",
		challenge: "c",
	});
	expect(response.status).toBe(401);
});

it("answers the url_verification challenge once the signature is right", async () => {
	expect((await configureSlack()).status).toBe(204);
	const response = await sendSlack({
		type: "url_verification",
		token: "legacy",
		challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P",
	});
	expect(response.status).toBe(200);
	expect(response.headers.get("Content-Type")).toBe("text/plain");
	expect(await response.text()).toBe(
		"3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P",
	);
	expect(await events()).toEqual([]);
});

it("refuses a bad signature, a missing one and a stale timestamp", async () => {
	await configureSlack();
	expect((await sendSlack(mention("Ev1"), { secret: "other" })).status).toBe(
		401,
	);
	expect(
		(await call("/hooks/slack", { method: "POST", body: "{}" })).status,
	).toBe(401);
	const stale = Math.floor(Date.now() / 1000) - 301;
	expect((await sendSlack(mention("Ev2"), { timestamp: stale })).status).toBe(
		400,
	);
	expect(await events()).toEqual([]);
});

it("queues an event once even when Slack retries it", async () => {
	await configureSlack();
	expect((await sendSlack(mention("Ev3"))).status).toBe(200);
	expect((await sendSlack(mention("Ev3"))).status).toBe(200);
	expect(await events()).toEqual([
		{
			id: expect.any(String),
			receivedAt: expect.any(Number),
			service: "slack",
			kind: "webhook",
			payload: mention("Ev3"),
		},
	]);
});

it("answers 200 to what is not an event and keeps nothing", async () => {
	await configureSlack();
	const response = await sendSlack({
		type: "app_rate_limited",
		minute_rate_limited: 1,
	});
	expect(response.status).toBe(200);
	expect(await events()).toEqual([]);
});

/** A raw body signed like Slack, now. */
async function sendRawSlack(body: string): Promise<Response> {
	const timestamp = Math.floor(Date.now() / 1000);
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(SIGNING_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(`v0:${timestamp}:${body}`),
	);
	const hex = [...new Uint8Array(signature)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return call("/hooks/slack", {
		method: "POST",
		headers: {
			"X-Slack-Signature": `v0=${hex}`,
			"X-Slack-Request-Timestamp": String(timestamp),
		},
		body,
	});
}

it("refuses a url_verification without a string challenge, and a body that is not JSON", async () => {
	await configureSlack();
	for (const body of [
		'{"type":"url_verification"}',
		'{"type":"url_verification","challenge":42}',
		"not json",
	]) {
		const response = await sendRawSlack(body);
		expect(response.status, body).toBe(400);
		expect(response.headers.get("Content-Type"), body).toBeNull();
		expect(await response.text(), body).toBe("");
	}
	expect(await events()).toEqual([]);
});

it("answers an empty challenge as a challenge", async () => {
	await configureSlack();
	const response = await sendSlack({ type: "url_verification", challenge: "" });
	expect(response.status).toBe(200);
	expect(response.headers.get("Content-Type")).toBe("text/plain");
	expect(await response.text()).toBe("");
});

it("answers 200 with no body, and keeps nothing, to an event it does not keep", async () => {
	await configureSlack();
	const { event_id: _, ...withoutId } = mention("Ev4");
	for (const body of [
		"null",
		"42",
		JSON.stringify(withoutId),
		JSON.stringify({ ...mention("Ev5"), event_id: 5 }),
		JSON.stringify({ ...mention("Ev6"), type: "event" }),
		JSON.stringify({
			...mention("Ev7"),
			event: { type: "message", ts: "1.2", channel: "C1" },
		}),
		JSON.stringify({ ...mention("Ev8"), event: undefined }),
	]) {
		const response = await sendRawSlack(body);
		expect(response.status, body).toBe(200);
		expect(response.headers.get("Content-Type"), body).toBeNull();
		expect(await response.text(), body).toBe("");
	}
	expect(await events()).toEqual([]);
	// Not kept, so not taken as delivered either.
	expect((await sendSlack(mention("Ev7"))).status).toBe(200);
	expect(await events()).toHaveLength(1);
});

it("answers a kept event with 200 and no body", async () => {
	await configureSlack();
	const response = await sendSlack(mention("Ev9"));
	expect(response.status).toBe(200);
	expect(response.headers.get("Content-Type")).toBeNull();
	expect(await response.text()).toBe("");
});

it("judges freshness within five minutes, either way", () => {
	const now = 1_762_000_000_000;
	expect(isRecentTimestamp("1762000300", now)).toBe(true);
	expect(isRecentTimestamp("1761999700", now)).toBe(true);
	expect(isRecentTimestamp("1762000301", now)).toBe(false);
	expect(isRecentTimestamp("1761999699", now)).toBe(false);
	expect(isRecentTimestamp("17620e5", now)).toBe(false);
	expect(isRecentTimestamp(null, now)).toBe(false);
});

it("keeps mentions and people's replies in a thread, and nothing else of the channel", () => {
	const reply = {
		type: "message",
		user: "U1",
		text: "2",
		ts: "1.3",
		thread_ts: "1.2",
	};
	expect(isMentionOrThreadReply({ type: "app_mention", ts: "1.2" })).toBe(true);
	expect(isMentionOrThreadReply(reply)).toBe(true);
	expect(isMentionOrThreadReply({ ...reply, thread_ts: undefined })).toBe(
		false,
	);
	expect(isMentionOrThreadReply({ ...reply, thread_ts: "1.3" })).toBe(false);
	expect(isMentionOrThreadReply({ ...reply, bot_id: "B1" })).toBe(false);
	expect(isMentionOrThreadReply({ ...reply, subtype: "message_changed" })).toBe(
		false,
	);
	expect(isMentionOrThreadReply(undefined)).toBe(false);
});

it("triages what Slack sends", () => {
	const body = (text: string) =>
		new TextEncoder().encode(text).buffer as ArrayBuffer;
	const json = (value: unknown) => body(JSON.stringify(value));
	expect(triage(json({ type: "url_verification", challenge: "c" }))).toEqual({
		kind: "challenge",
		challenge: "c",
	});
	expect(triage(json({ type: "url_verification" }))).toEqual({ kind: "bad" });
	expect(triage(body("{"))).toEqual({ kind: "bad" });
	expect(triage(body("null"))).toEqual({ kind: "ignore" });
	expect(triage(json({ type: "app_rate_limited" }))).toEqual({
		kind: "ignore",
	});
	expect(
		triage(json({ ...mention("Ev1"), event: { type: "message", ts: "1" } })),
	).toEqual({ kind: "ignore" });
	expect(triage(json(mention("Ev1")))).toEqual({
		kind: "keep",
		eventId: "Ev1",
		payload: mention("Ev1"),
	});
});
