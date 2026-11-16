import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker from "../../src/index";
import { RECEIVED_THOUGHT } from "../../src/integrations/linear/api";
import { parseLinearHook } from "../../src/integrations/linear/durable";
import {
	call,
	configure,
	ENGINE,
	events,
	fakeLinear,
	type LinearCall,
	relay,
	sendWebhook,
	WEBHOOK_SECRET,
} from "../helpers";

let linear: LinearCall[];

beforeEach(() => {
	linear = fakeLinear();
});
afterEach(() => {
	vi.restoreAllMocks();
});

async function install(): Promise<Response> {
	const { authorizeUrl } = await (await configure()).json<{
		authorizeUrl: string;
	}>();
	const state = new URL(authorizeUrl).searchParams.get("state");
	return call(`/oauth/linear/callback?code=the-code&state=${state}`);
}

it("needs the engine token to configure Linear", async () => {
	const response = await call("/config/linear", {
		method: "POST",
		headers: { Authorization: "Bearer wrong" },
		body: "{}",
	});
	expect(response.status).toBe(401);
});

it("refuses an incomplete Linear configuration", async () => {
	const response = await call("/config/linear", {
		method: "POST",
		headers: ENGINE,
		body: JSON.stringify({ clientId: "client-id" }),
	});
	expect(response.status).toBe(400);
});

it("configures Linear and returns the authorize URL", async () => {
	const response = await configure();
	expect(response.status).toBe(200);
	const url = new URL(
		(await response.json<{ authorizeUrl: string }>()).authorizeUrl,
	);
	expect(url.origin + url.pathname).toBe("https://linear.app/oauth/authorize");
	expect(Object.fromEntries(url.searchParams)).toEqual({
		client_id: "client-id",
		redirect_uri: "https://relay.test/oauth/linear/callback",
		response_type: "code",
		scope: "read,write,app:assignable,app:mentionable",
		state: expect.stringMatching(/.{16,}/),
		actor: "app",
	});
});

it("refuses a callback with an unknown state", async () => {
	await configure();
	const response = await call(
		"/oauth/linear/callback?code=the-code&state=forged",
	);
	expect(response.status).toBe(400);
	expect(linear).toEqual([]);
});

it("installs Linear: exchanges the code, stores the organization, queues installed", async () => {
	const response = await install();
	expect(response.status).toBe(200);
	expect(await response.text()).toContain(
		"openfabriq is installed in Hexa &#60;Labs&#62;. You can close this tab.",
	);

	const [exchange, viewer] = linear;
	expect(exchange?.url).toBe("https://api.linear.app/oauth/token");
	expect(Object.fromEntries(new URLSearchParams(exchange?.body))).toEqual({
		grant_type: "authorization_code",
		code: "the-code",
		redirect_uri: "https://relay.test/oauth/linear/callback",
		client_id: "client-id",
		client_secret: "client-secret",
	});
	expect(viewer?.authorization).toBe("Bearer access-1");

	const org = await runInDurableObject(relay(), (_instance, state) =>
		state.storage.kv.get<Record<string, unknown>>("linear:org:org-1"),
	);
	expect(org).toMatchObject({
		organizationName: "Hexa <Labs>",
		appUserId: "app-user",
		accessToken: "access-1",
		refreshToken: "refresh-1",
	});
	expect(await events()).toContainEqual({
		id: expect.any(String),
		receivedAt: expect.any(Number),
		service: "linear",
		kind: "installed",
		organizationId: "org-1",
		organizationName: "Hexa <Labs>",
		appUserId: "app-user",
	});
});

it("refuses a state that was already used", async () => {
	const { authorizeUrl } = await (await configure()).json<{
		authorizeUrl: string;
	}>();
	const state = new URL(authorizeUrl).searchParams.get("state");
	const callback = `/oauth/linear/callback?code=the-code&state=${state}`;
	expect((await call(callback)).status).toBe(200);
	expect((await call(callback)).status).toBe(400);
});

it("says to connect again when Linear refuses the code, and the state stays used", async () => {
	vi.mocked(fetch).mockResolvedValue(
		new Response("invalid_grant", { status: 400 }),
	);
	const logged = vi.spyOn(console, "error").mockImplementation(() => {});
	const { authorizeUrl } = await (await configure()).json<{
		authorizeUrl: string;
	}>();
	const state = new URL(authorizeUrl).searchParams.get("state");
	const callback = `/oauth/linear/callback?code=the-code&state=${state}`;
	const queued = (await events()).length;

	const refused = await call(callback);
	expect(refused.status).toBe(502);
	expect(await refused.text()).toBe(
		"Linear refused the code, run openfabriq connect linear again.",
	);
	expect(logged).toHaveBeenCalledWith(
		"Could not install Linear:",
		"Linear refused the token request (400)",
	);
	expect((await call(callback)).status).toBe(400);
	expect(await events()).toHaveLength(queued);
});

it("refreshes a token about to expire and keeps the rotated refresh token", async () => {
	await install();
	await runInDurableObject(relay(), (_instance, state) => {
		const org =
			state.storage.kv.get<Record<string, unknown>>("linear:org:org-1");
		state.storage.kv.put("linear:org:org-1", {
			...org,
			expiresAt: Date.now() + 60_000,
		});
	});
	linear.length = 0;

	const response = await call("/tokens/linear", { headers: ENGINE });
	expect(await response.json()).toEqual({
		organizations: [
			{
				organizationId: "org-1",
				organizationName: "Hexa <Labs>",
				appUserId: "app-user",
				accessToken: "access-2",
				expiresAt: expect.any(Number),
			},
		],
	});
	expect(Object.fromEntries(new URLSearchParams(linear[0]?.body))).toEqual({
		grant_type: "refresh_token",
		refresh_token: "refresh-1",
		client_id: "client-id",
		client_secret: "client-secret",
	});
	const org = await runInDurableObject(relay(), (_instance, state) =>
		state.storage.kv.get<Record<string, unknown>>("linear:org:org-1"),
	);
	expect(org?.refreshToken).toBe("refresh-2");

	await call("/tokens/linear", { headers: ENGINE });
	expect(linear).toHaveLength(1);
});

it("refreshes an organization once when two callers need it at the same time", async () => {
	await install();
	await runInDurableObject(relay(), (_instance, state) => {
		const org =
			state.storage.kv.get<Record<string, unknown>>("linear:org:org-1");
		state.storage.kv.put("linear:org:org-1", {
			...org,
			expiresAt: Date.now() + 60_000,
		});
	});
	linear.length = 0;

	const answers = await Promise.all([
		call("/tokens/linear", { headers: ENGINE }),
		call("/tokens/linear", { headers: ENGINE }),
	]);
	expect(answers.map((a) => a.status)).toEqual([200, 200]);
	expect(
		linear.filter((c) => c.url === "https://api.linear.app/oauth/token"),
	).toHaveLength(1);
});

it("returns the organizations that refreshed, and logs the one Linear refused", async () => {
	await install();
	await runInDurableObject(relay(), (_instance, state) => {
		const org =
			state.storage.kv.get<Record<string, unknown>>("linear:org:org-1");
		state.storage.kv.put("linear:org:org-2", {
			...org,
			organizationId: "org-2",
			refreshToken: "revoked",
			expiresAt: Date.now() + 60_000,
		});
	});
	const answer = vi.mocked(fetch).getMockImplementation();
	vi.mocked(fetch).mockImplementation(async (input, init) =>
		new Request(input, init).url === "https://api.linear.app/oauth/token"
			? new Response("invalid_grant", { status: 400 })
			: (answer as typeof fetch)(input, init),
	);
	const logged = vi.spyOn(console, "error").mockImplementation(() => {});

	const response = await call("/tokens/linear", { headers: ENGINE });
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({
		organizations: [expect.objectContaining({ organizationId: "org-1" })],
	});
	expect(logged).toHaveBeenCalledWith(
		"Could not refresh the Linear token of org-2:",
		"Linear refused the token request (400)",
	);
});

it("forgets an organization once Linear says its grant is gone, and only then", async () => {
	await install();
	const expiring = (id: string, refreshToken: string) =>
		runInDurableObject(relay(), (_instance, state) => {
			const org =
				state.storage.kv.get<Record<string, unknown>>("linear:org:org-1");
			state.storage.kv.put(`linear:org:${id}`, {
				...org,
				organizationId: id,
				refreshToken,
				expiresAt: Date.now() + 60_000,
			});
		});
	await expiring("org-2", "revoked");
	await expiring("org-3", "unreachable");
	const answer = vi.mocked(fetch).getMockImplementation();
	vi.mocked(fetch).mockImplementation(async (input, init) => {
		const request = new Request(input, init);
		if (request.url !== "https://api.linear.app/oauth/token")
			return (answer as typeof fetch)(input, init);
		const form = await request.formData();
		if (form.get("refresh_token") === "revoked")
			return Response.json(
				{ error: "invalid_grant", error_description: "revoked" },
				{ status: 400 },
			);
		throw new TypeError("network down");
	});
	vi.spyOn(console, "error").mockImplementation(() => {});

	await call("/tokens/linear", { headers: ENGINE });
	const kept = await runInDurableObject(relay(), (_instance, state) =>
		[...state.storage.kv.list({ prefix: "linear:org:" })]
			.map(([key]) => key)
			.sort(),
	);
	// The revoked install is forgotten; a network failure says nothing about the grant.
	expect(kept).toEqual(["linear:org:org-1", "linear:org:org-3"]);
});

it("refuses every engine route when the engine token is not set", async () => {
	for (const ENGINE_TOKEN of ["", undefined]) {
		const response = await worker.fetch(
			new Request("https://relay.test/tokens/linear", {
				headers: { Authorization: `Bearer ${ENGINE_TOKEN}` },
			}),
			{ ...env, ENGINE_TOKEN } as Env,
		);
		expect(response.status).toBe(401);
	}
});

it("needs the engine token to read tokens", async () => {
	expect((await call("/tokens/linear")).status).toBe(401);
});

it("refuses a webhook with a bad signature", async () => {
	await configure();
	const response = await sendWebhook({ type: "Issue" }, undefined, "other");
	expect(response.status).toBe(401);
});

it("refuses a stale webhook", async () => {
	await configure();
	const response = await sendWebhook({
		type: "Issue",
		webhookTimestamp: Date.now() - 61_000,
	});
	expect(response.status).toBe(400);
});

it("queues a webhook once even when delivered twice", async () => {
	await configure();
	const delivery = crypto.randomUUID();
	expect((await sendWebhook({ type: "Issue" }, delivery)).status).toBe(200);
	expect((await sendWebhook({ type: "Issue" }, delivery)).status).toBe(200);
	const queued = (await events()).filter((e) => e.delivery === delivery);
	expect(queued).toEqual([
		{
			id: expect.any(String),
			receivedAt: expect.any(Number),
			service: "linear",
			kind: "webhook",
			delivery,
			payload: expect.objectContaining({ type: "Issue" }),
		},
	]);
	// Prefixed like Slack's and the webhooks' ids: a Linear id cannot shadow another source's.
	const kept = await runInDurableObject(relay(), (_instance, state) =>
		state.storage.sql
			.exec("SELECT 1 FROM deliveries WHERE id = ?", `linear:${delivery}`)
			.toArray(),
	);
	expect(kept).toHaveLength(1);
});

it("posts the fixed received thought once for a created agent session", async () => {
	await install();
	linear.length = 0;
	const response = await sendWebhook({
		type: "AgentSessionEvent",
		action: "created",
		organizationId: "org-1",
		agentSession: { id: "session-1" },
	});
	expect(response.status).toBe(200);
	await vi.waitFor(() => expect(linear).toHaveLength(1));
	await sendWebhook({
		type: "AgentSessionEvent",
		action: "prompted",
		organizationId: "org-1",
		agentSession: { id: "session-1" },
	});
	await new Promise((resolve) => setTimeout(resolve, 50));

	expect(linear).toHaveLength(1);
	expect(linear[0]?.url).toBe("https://api.linear.app/graphql");
	expect(linear[0]?.authorization).toBe("Bearer access-1");
	expect(JSON.parse(linear[0]?.body ?? "").variables).toEqual({
		input: {
			agentSessionId: "session-1",
			content: { type: "thought", body: RECEIVED_THOUGHT },
		},
	});
});

/** A raw body signed with the webhook secret, the delivery header only when given. */
async function sendRaw(body: string, delivery?: string): Promise<Response> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(WEBHOOK_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(body),
	);
	const hex = [...new Uint8Array(signature)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return call("/hooks/linear", {
		method: "POST",
		headers: {
			"Linear-Signature": hex,
			...(delivery === undefined ? {} : { "Linear-Delivery": delivery }),
		},
		body,
	});
}

it("refuses a webhook from the future as stale, and keeps one within a minute", async () => {
	await configure();
	expect(
		(
			await sendWebhook({
				type: "Issue",
				webhookTimestamp: Date.now() + 61_000,
			})
		).status,
	).toBe(400);
	const delivery = crypto.randomUUID();
	expect(
		(
			await sendWebhook(
				{ type: "Issue", webhookTimestamp: Date.now() + 50_000 },
				delivery,
			)
		).status,
	).toBe(200);
	expect((await events()).filter((e) => e.delivery === delivery)).toHaveLength(
		1,
	);
});

it("refuses a signed webhook that is not a fresh Linear delivery, without using its delivery", async () => {
	await configure();
	const delivery = crypto.randomUUID();
	const fresh = () =>
		JSON.stringify({ type: "Issue", webhookTimestamp: Date.now() });
	for (const [body, header] of [
		["not json", delivery],
		["null", delivery],
		["42", delivery],
		['"text"', delivery],
		[JSON.stringify({ type: "Issue" }), delivery],
		[
			JSON.stringify({ type: "Issue", webhookTimestamp: String(Date.now()) }),
			delivery,
		],
		[JSON.stringify({ type: "Issue", webhookTimestamp: null }), delivery],
		[fresh(), undefined],
		[fresh(), ""],
	] as const)
		expect((await sendRaw(body, header)).status, `${body} ${header}`).toBe(400);
	expect((await events()).filter((e) => e.delivery === delivery)).toEqual([]);
	// The refused requests did not take the delivery id.
	expect((await sendRaw(fresh(), delivery)).status).toBe(200);
	expect((await events()).filter((e) => e.delivery === delivery)).toHaveLength(
		1,
	);
});

it("refuses every Linear webhook before Linear is configured", async () => {
	await runInDurableObject(relay(), (_instance, state) => {
		state.storage.kv.delete("linear:config");
	});
	expect((await sendWebhook({ type: "Issue" })).status).toBe(401);
});

it("logs, and posts nothing, for a created session without an installation", async () => {
	await install();
	linear.length = 0;
	const logged = vi.spyOn(console, "error").mockImplementation(() => {});
	for (const payload of [
		{ organizationId: "org-unknown", agentSession: { id: "session-1" } },
		{ organizationId: "org-1", agentSession: { id: 42 } },
		{ organizationId: "org-1" },
	]) {
		logged.mockClear();
		const response = await sendWebhook({
			type: "AgentSessionEvent",
			action: "created",
			...payload,
		});
		expect(response.status).toBe(200);
		await vi.waitFor(() => expect(logged).toHaveBeenCalled());
		expect(logged.mock.calls).toEqual([
			[
				"Could not post the received thought:",
				"no Linear installation for this session",
			],
		]);
	}
	expect(linear).toEqual([]);
});

it("parses a Linear webhook within a minute of now, either way", () => {
	const at = 1_700_000_000_000;
	const encode = (text: string) =>
		new TextEncoder().encode(text).buffer as ArrayBuffer;
	const payload = { type: "Issue", webhookTimestamp: at };
	const body = encode(JSON.stringify(payload));
	for (const now of [at - 60_000, at, at + 60_000])
		expect(parseLinearHook(body, "d-1", now)).toEqual({
			delivery: "d-1",
			payload,
		});
	for (const now of [at - 60_001, at + 60_001])
		expect(parseLinearHook(body, "d-1", now)).toBeNull();
	expect(parseLinearHook(body, null, at)).toBeNull();
	expect(parseLinearHook(encode("null"), "d-1", at)).toBeNull();
	expect(parseLinearHook(encode("{"), "d-1", at)).toBeNull();
});
