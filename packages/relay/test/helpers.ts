import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { vi } from "vitest";

export const relay = () => env.RELAY.getByName("relay");

/** The events the relay keeps for the engine. */
export function events() {
	return runInDurableObject(relay(), (_instance, state) =>
		state.storage.sql
			.exec<{ body: string }>("SELECT body FROM events")
			.toArray()
			.map((row) => JSON.parse(row.body)),
	);
}

export const ENGINE = { Authorization: "Bearer test-token" };
export const WEBHOOK_SECRET = "webhook-secret";

export function call(path: string, init?: RequestInit): Promise<Response> {
	return exports.default.fetch(`https://relay.test${path}`, init);
}

export function configure(): Promise<Response> {
	return call("/config/linear", {
		method: "POST",
		headers: ENGINE,
		body: JSON.stringify({
			webhookSecret: WEBHOOK_SECRET,
			clientId: "client-id",
			clientSecret: "client-secret",
		}),
	});
}

export async function sendWebhook(
	payload: Record<string, unknown>,
	delivery: string = crypto.randomUUID(),
	secret = WEBHOOK_SECRET,
): Promise<Response> {
	const body = JSON.stringify({ webhookTimestamp: Date.now(), ...payload });
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
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
		headers: { "Linear-Signature": hex, "Linear-Delivery": delivery },
		body,
	});
}

export const SIGNING_SECRET = "slack-signing-secret";

export function configureSlack(): Promise<Response> {
	return call("/config/slack", {
		method: "POST",
		headers: ENGINE,
		body: JSON.stringify({ signingSecret: SIGNING_SECRET }),
	});
}

/** Signs like Slack: v0= and the hex HMAC-SHA256 of v0:<timestamp>:<body>. */
export async function sendSlack(
	payload: Record<string, unknown>,
	{
		secret = SIGNING_SECRET,
		timestamp = Math.floor(Date.now() / 1000),
	}: { secret?: string; timestamp?: number } = {},
): Promise<Response> {
	const body = JSON.stringify(payload);
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
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

export interface LinearCall {
	url: string;
	authorization: string | null;
	body: string;
}

/** Stands in for api.linear.app: each token request returns a new numbered pair. */
export function fakeLinear(): LinearCall[] {
	const calls: LinearCall[] = [];
	let issued = 0;
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const request = new Request(input, init);
		const body = new TextDecoder().decode(await request.arrayBuffer());
		calls.push({
			url: request.url,
			authorization: request.headers.get("Authorization"),
			body,
		});
		if (request.url === "https://api.linear.app/oauth/token") {
			issued++;
			// Slow enough for another request to come in meanwhile, as over the network.
			await new Promise((resolve) => setTimeout(resolve, 20));
			return Response.json({
				access_token: `access-${issued}`,
				token_type: "Bearer",
				expires_in: 86399,
				refresh_token: `refresh-${issued}`,
			});
		}
		if (request.url === "https://api.linear.app/graphql") {
			return Response.json(
				body.includes("viewer")
					? {
							data: {
								viewer: {
									id: "app-user",
									organization: { id: "org-1", name: "Hexa <Labs>" },
								},
							},
						}
					: { data: { agentActivityCreate: { success: true } } },
			);
		}
		return new Response("unexpected request", { status: 500 });
	});
	return calls;
}
