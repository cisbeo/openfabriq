import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	bodyHash,
	checkWebhook,
} from "../../src/integrations/webhook/signatures";
import { call, ENGINE, events, relay } from "../helpers";

// The factory's own webhooks.

beforeEach(() =>
	runInDurableObject(relay(), (_instance, state) => {
		state.storage.sql.exec("DELETE FROM events");
		state.storage.sql.exec("DELETE FROM deliveries");
	}),
);

const encoder = new TextEncoder();
async function hmac(key: Uint8Array, text: string): Promise<Uint8Array> {
	const imported = await crypto.subtle.importKey(
		"raw",
		key,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return new Uint8Array(
		await crypto.subtle.sign("HMAC", imported, encoder.encode(text)),
	);
}
const hex = (b: Uint8Array) =>
	[...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const base64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

const configure = (name: string, signature: string, secret: string) =>
	call(`/config/webhook/${name}`, {
		method: "POST",
		headers: ENGINE,
		body: JSON.stringify({ signature, secret }),
	});

const STANDARD_KEY = crypto.getRandomValues(new Uint8Array(32));
const STANDARD_SECRET = `whsec_${base64(STANDARD_KEY)}`;
const now = () => Math.floor(Date.now() / 1000);

/** A request signed the way each sender documents it. */
const signed: Record<
	string,
	(
		body: string,
		secret: string,
		at?: number,
		id?: string,
	) => Promise<Record<string, string>>
> = {
	github: async (body, secret, _at, id = "gh-1") => ({
		"X-Hub-Signature-256": `sha256=${hex(await hmac(encoder.encode(secret), body))}`,
		"X-GitHub-Delivery": id,
	}),
	sentry: async (body, secret, _at, id = "se-1") => ({
		"Sentry-Hook-Signature": hex(await hmac(encoder.encode(secret), body)),
		"Request-ID": id,
	}),
	stripe: async (body, secret, at = now()) => ({
		"Stripe-Signature": `t=${at},v1=${"0".repeat(64)},v1=${hex(await hmac(encoder.encode(secret), `${at}.${body}`))}`,
	}),
	standard: async (body, secret, at = now(), id = "msg_1") => ({
		"webhook-id": id,
		"webhook-timestamp": String(at),
		"webhook-signature": `v1,${base64(await hmac(secret === STANDARD_SECRET ? STANDARD_KEY : encoder.encode(secret), `${id}.${at}.${body}`))}`,
	}),
};
const SECRETS: Record<string, string> = {
	github: "gh-secret",
	sentry: "sentry-client-secret",
	stripe: "whsec_stripe",
	standard: STANDARD_SECRET,
};

describe("configuration", () => {
	it("needs the engine token, a known signature and a secret", async () => {
		const wrong = await call("/config/webhook/deploy", {
			method: "POST",
			headers: { Authorization: "Bearer wrong" },
			body: JSON.stringify({ signature: "github", secret: "s" }),
		});
		expect(wrong.status).toBe(401);
		for (const body of [
			'{"signature":"hmac","secret":"s"}',
			'{"signature":"github","secret":""}',
			"not json",
		]) {
			const response = await call("/config/webhook/deploy", {
				method: "POST",
				headers: ENGINE,
				body,
			});
			expect(response.status, body).toBe(400);
		}
	});

	it("refuses a standard secret without a base64 key after whsec_", async () => {
		for (const secret of ["whsec_%%%", "whsec_", "whsec_a"]) {
			const response = await configure("deploy", "standard", secret);
			expect(response.status, secret).toBe(400);
			expect(await response.text()).toBe(
				"Expected a standard secret: whsec_ and a base64 key.",
			);
		}
		expect(
			(await configure("deploy", "standard", STANDARD_SECRET)).status,
		).toBe(204);
	});
});

describe.each(["github", "sentry", "stripe", "standard"])(
	"signed by %s",
	(scheme) => {
		const name = `hook-${scheme}`;
		const secret = SECRETS[scheme] as string;
		const sign = signed[scheme] as (typeof signed)[string];
		const send = async (body: string, headers: Record<string, string>) =>
			(await call(`/hooks/custom/${name}`, { method: "POST", headers, body }))
				.status;

		it("keeps a well signed delivery once, and refuses a wrong signature", async () => {
			expect((await configure(name, scheme, secret)).status).toBe(204);
			const body = JSON.stringify({ id: "evt_1", level: "fatal" });
			expect(await send(body, await sign(body, secret))).toBe(200);
			// The sender retries the same delivery: kept once.
			expect(await send(body, await sign(body, secret))).toBe(200);
			expect(await send(body, await sign(body, "wrong-secret"))).toBe(401);
			expect(await send(`${body} `, await sign(body, secret))).toBe(401);
			expect(await send(body, {})).toBe(401);
			const kept = await events();
			expect(kept).toHaveLength(1);
			expect(kept[0]).toMatchObject({
				service: "webhook",
				kind: "received",
				webhook: name,
				payload: body,
			});
			expect(typeof kept[0].delivery).toBe("string");
		});

		if (scheme === "stripe" || scheme === "standard")
			it("refuses a stale timestamp", async () => {
				await configure(name, scheme, secret);
				const body = JSON.stringify({ id: "evt_2" });
				expect(await send(body, await sign(body, secret, now() - 600))).toBe(
					400,
				);
				expect(await events()).toEqual([]);
			});

		if (scheme === "github" || scheme === "sentry")
			it("keeps a signed body once, even sent again with a new unsigned id", async () => {
				await configure(name, scheme, secret);
				const body = JSON.stringify({ action: "created" });
				expect(await send(body, await sign(body, secret, 0, "id-1"))).toBe(200);
				expect(await send(body, await sign(body, secret, 0, "id-2"))).toBe(200);
				expect((await events()).map((e) => e.delivery)).toEqual([
					await bodyHash(encoder.encode(body).buffer as ArrayBuffer),
				]);
			});
	},
);

describe("without signature", () => {
	it("takes the secret in the address", async () => {
		await configure("open", "none", "a1b2c3");
		const send = async (path: string, body: string) =>
			(await call(path, { method: "POST", body })).status;
		expect(await send("/hooks/custom/open/a1b2c3", '{"n":1}')).toBe(200);
		expect(await send("/hooks/custom/open/wrong", '{"n":2}')).toBe(401);
		expect(await send("/hooks/custom/open", '{"n":3}')).toBe(401);
		// Without a delivery id, the same body twice is one delivery.
		expect(await send("/hooks/custom/open/a1b2c3", '{"n":1}')).toBe(200);
		expect((await events()).map((e) => e.payload)).toEqual(['{"n":1}']);
	});

	it("refuses a body that grows past a row of the queue as text, and keeps none of it as seen", async () => {
		await configure("raw", "none", "a1b2c3");
		// 900 KB that are not UTF-8: each byte reads as U+FFFD, three bytes, well past 2 MB of JSON.
		const binary = new Uint8Array(900_000).fill(0xff);
		const send = async (body: BodyInit) =>
			(await call("/hooks/custom/raw/a1b2c3", { method: "POST", body })).status;
		expect(await send(binary)).toBe(413);
		expect(await events()).toEqual([]);
		const seen = await runInDurableObject(relay(), (_instance, state) =>
			state.storage.sql.exec("SELECT id FROM deliveries").toArray(),
		);
		expect(seen).toEqual([]);
		expect(await send('{"n":1}')).toBe(200);
	});
});

describe("limits", () => {
	it("refuses a webhook it does not know, one removed, and a body too large", async () => {
		const body = "{}";
		const headers = await (signed.github as (typeof signed)[string])(body, "s");
		expect(
			(await call("/hooks/custom/unknown", { method: "POST", headers, body }))
				.status,
		).toBe(401);
		await configure("big", "github", "s");
		const large = "x".repeat(1024 * 1024 + 1);
		expect(
			(
				await call("/hooks/custom/big", {
					method: "POST",
					headers: await (signed.github as (typeof signed)[string])(large, "s"),
					body: large,
				})
			).status,
		).toBe(413);
		expect(
			(await call("/config/webhook/big", { method: "DELETE", headers: ENGINE }))
				.status,
		).toBe(204);
		expect(
			await runInDurableObject(relay(), (_instance, state) =>
				state.storage.kv.get("webhook:big"),
			),
		).toBeUndefined();
		expect(
			(await call("/hooks/custom/big", { method: "POST", headers, body }))
				.status,
		).toBe(401);
		expect(await events()).toEqual([]);
	});

	it("stops reading a hook's body past the limit, with or without Content-Length", async () => {
		await configure("big", "none", "s");
		// 64 KiB chunks, no Content-Length: only the byte count can stop it.
		const chunked = () => {
			let sent = 0;
			return new ReadableStream<Uint8Array>({
				pull(controller) {
					if (sent > 1024 * 1024) return controller.close();
					sent += 65_536;
					controller.enqueue(new Uint8Array(65_536));
				},
			});
		};
		for (const path of [
			"/hooks/custom/big/s",
			"/hooks/linear",
			"/hooks/slack",
		]) {
			const streamed = await call(path, { method: "POST", body: chunked() });
			expect(streamed.status, path).toBe(413);
			for (const length of ["abc", String(1024 * 1024 + 1)]) {
				const announced = await call(path, {
					method: "POST",
					headers: { "Content-Length": length },
					body: "{}",
				});
				expect(announced.status, `${path} ${length}`).toBe(413);
			}
		}
		expect(await events()).toEqual([]);
	});
});

describe("signature candidates", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	// Each scheme's header, with these signatures in this order.
	const headers = {
		stripe: (at: number, signatures: Uint8Array[]) => ({
			"Stripe-Signature": `t=${at},${signatures.map((s) => `v1=${hex(s)}`).join(",")}`,
		}),
		standard: (at: number, signatures: Uint8Array[]) => ({
			"webhook-id": "msg_c",
			"webhook-timestamp": String(at),
			"webhook-signature": signatures.map((s) => `v1,${base64(s)}`).join(" "),
		}),
	};

	it.each(["stripe", "standard"] as const)(
		"%s: stops at the first match, and refuses more than five",
		async (scheme) => {
			const body = '{"id":"evt_c"}';
			const at = now();
			const good =
				scheme === "stripe"
					? await hmac(
							encoder.encode(SECRETS.stripe as string),
							`${at}.${body}`,
						)
					: await hmac(STANDARD_KEY, `msg_c.${at}.${body}`);
			const bad = new Uint8Array(32);
			const check = (signatures: Uint8Array[]) => {
				const sent: Record<string, string> = headers[scheme](at, signatures);
				return checkWebhook(
					scheme,
					SECRETS[scheme] as string,
					encoder.encode(body).buffer as ArrayBuffer,
					(name) => sent[name] ?? null,
					undefined,
				);
			};
			const verify = vi.spyOn(crypto.subtle, "verify");
			expect(await check([good, bad, bad, bad, bad])).toMatchObject({
				ok: true,
			});
			expect(verify).toHaveBeenCalledTimes(1);
			verify.mockClear();
			expect(await check([bad, bad, bad, bad, bad, good])).toEqual({
				ok: false,
				status: 401,
			});
			expect(verify).not.toHaveBeenCalled();
		},
	);
});

it("matches GitHub's published test vector", async () => {
	await configure("vector", "github", "It's a Secret to Everybody");
	const response = await call("/hooks/custom/vector", {
		method: "POST",
		headers: {
			"X-Hub-Signature-256":
				"sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
			"X-GitHub-Delivery": "vector-1",
		},
		body: "Hello, World!",
	});
	expect(response.status).toBe(200);
	expect((await events())[0]).toMatchObject({
		// The SHA-256 of the body: X-GitHub-Delivery is not signed.
		delivery:
			"dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f",
		payload: "Hello, World!",
	});
});

describe("checkWebhook, header by header", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	const check = (
		scheme: "stripe" | "standard",
		sent: Record<string, string>,
		body: string,
		secret = SECRETS[scheme] as string,
	) =>
		checkWebhook(
			scheme,
			secret,
			encoder.encode(body).buffer as ArrayBuffer,
			(name) => sent[name] ?? null,
			undefined,
		);
	const stripeSignature = async (at: number, body: string) =>
		hex(await hmac(encoder.encode(SECRETS.stripe as string), `${at}.${body}`));

	it("stripe: refuses a header without t=, or without a well formed v1=", async () => {
		const body = '{"id":"evt_s"}';
		const at = now();
		const good = await stripeSignature(at, body);
		const verify = vi.spyOn(crypto.subtle, "verify");
		for (const header of [
			`v1=${good}`,
			`t=,v1=${good}`,
			`t,t=${at},v1=${good}`,
			`t=${at}`,
			`t=${at},v1=`,
			`t=${at},v1=${good.slice(0, 62)}`,
			`t=${at},v1=${"z".repeat(64)}`,
			`t=${at},v0=${good}`,
			"",
		])
			expect(
				await check("stripe", { "Stripe-Signature": header }, body),
				header,
			).toEqual({ ok: false, status: 401 });
		expect(verify).not.toHaveBeenCalled();
		expect(await check("stripe", {}, body)).toEqual({
			ok: false,
			status: 401,
		});
	});

	it("stripe: skips malformed v1= values, which do not count toward the limit", async () => {
		const body = '{"id":"evt_s"}';
		const at = now();
		const good = await stripeSignature(at, body);
		const malformed = Array.from({ length: 6 }, () => "v1=abcd").join(",");
		expect(
			await check(
				"stripe",
				{ "Stripe-Signature": `t=${at},${malformed},v1=${good.toUpperCase()}` },
				body,
			),
		).toEqual({ ok: true, delivery: "evt_s" });
	});

	it("stripe: refuses a bad signature before a stale timestamp", async () => {
		const body = '{"id":"evt_s"}';
		const at = now() - 600;
		expect(
			await check(
				"stripe",
				{ "Stripe-Signature": `t=${at},v1=${"0".repeat(64)}` },
				body,
			),
		).toEqual({ ok: false, status: 401 });
		expect(
			await check(
				"stripe",
				{ "Stripe-Signature": `t=${at},v1=${await stripeSignature(at, body)}` },
				body,
			),
		).toEqual({ ok: false, status: 400 });
	});

	it("stripe: a body without a string id gives no delivery", async () => {
		const at = now();
		for (const body of ['{"type":"charge"}', '{"id":42}', "not json", "null"])
			expect(
				await check(
					"stripe",
					{
						"Stripe-Signature": `t=${at},v1=${await stripeSignature(at, body)}`,
					},
					body,
				),
				body,
			).toEqual({ ok: true });
	});

	it("stripe: a body without an id is kept once, by its hash", async () => {
		await configure("stripe-no-id", "stripe", SECRETS.stripe as string);
		const body = '{"type":"charge.succeeded"}';
		const at = now();
		for (let i = 0; i < 2; i++)
			expect(
				(
					await call("/hooks/custom/stripe-no-id", {
						method: "POST",
						headers: {
							"Stripe-Signature": `t=${at},v1=${await stripeSignature(at, body)}`,
						},
						body,
					})
				).status,
			).toBe(200);
		expect((await events()).map((e) => e.delivery)).toEqual([
			await bodyHash(encoder.encode(body).buffer as ArrayBuffer),
		]);
	});

	it("standard: refuses a request without webhook-id or webhook-timestamp", async () => {
		const body = '{"id":"evt_w"}';
		const at = now();
		const signature = `v1,${base64(await hmac(STANDARD_KEY, `msg_w.${at}.${body}`))}`;
		const verify = vi.spyOn(crypto.subtle, "verify");
		for (const sent of [
			{ "webhook-timestamp": String(at), "webhook-signature": signature },
			{ "webhook-id": "msg_w", "webhook-signature": signature },
			{
				"webhook-id": "",
				"webhook-timestamp": String(at),
				"webhook-signature": signature,
			},
		] as Record<string, string>[])
			expect(await check("standard", sent, body)).toEqual({
				ok: false,
				status: 401,
			});
		expect(verify).not.toHaveBeenCalled();
		expect(
			await check(
				"standard",
				{
					"webhook-id": "msg_w",
					"webhook-timestamp": String(at),
					"webhook-signature": `v2,${signature.slice(3)} v1,%%% v1 ${signature}`,
				},
				body,
			),
		).toEqual({ ok: true, delivery: "msg_w" });
	});

	it("standard: refuses everything with a whsec_ secret that is not base64", async () => {
		const body = '{"id":"evt_w"}';
		const at = now();
		const verify = vi.spyOn(crypto.subtle, "verify");
		expect(
			await check(
				"standard",
				{
					"webhook-id": "msg_w",
					"webhook-timestamp": String(at),
					"webhook-signature": `v1,${base64(await hmac(encoder.encode("whsec_%%%"), `msg_w.${at}.${body}`))}`,
				},
				body,
				"whsec_%%%",
			),
		).toEqual({ ok: false, status: 401 });
		expect(verify).not.toHaveBeenCalled();
	});

	it("standard: refuses, without throwing, a stored secret with an empty key", async () => {
		const body = '{"id":"evt_w"}';
		const at = now();
		expect(
			await check(
				"standard",
				{
					"webhook-id": "msg_w",
					"webhook-timestamp": String(at),
					"webhook-signature": `v1,${base64(new Uint8Array(32))}`,
				},
				body,
				"whsec_",
			),
		).toEqual({ ok: false, status: 401 });
	});

	it("standard: refuses a bad signature before a stale timestamp", async () => {
		const body = '{"id":"evt_w"}';
		const at = now() - 600;
		const sent = (signature: string) => ({
			"webhook-id": "msg_w",
			"webhook-timestamp": String(at),
			"webhook-signature": signature,
		});
		expect(
			await check("standard", sent(`v1,${base64(new Uint8Array(32))}`), body),
		).toEqual({ ok: false, status: 401 });
		expect(
			await check(
				"standard",
				sent(`v1,${base64(await hmac(STANDARD_KEY, `msg_w.${at}.${body}`))}`),
				body,
			),
		).toEqual({ ok: false, status: 400 });
	});

	it("github and sentry: a malformed header is refused without an HMAC", async () => {
		const body = "{}";
		const good = hex(await hmac(encoder.encode("s"), body));
		const verify = vi.spyOn(crypto.subtle, "verify");
		const run = (scheme: "github" | "sentry", sent: Record<string, string>) =>
			checkWebhook(
				scheme,
				"s",
				encoder.encode(body).buffer as ArrayBuffer,
				(name) => sent[name] ?? null,
				undefined,
			);
		for (const value of [good, `sha256=${good.slice(1)}`, `sha1=${good}`, ""])
			expect(await run("github", { "X-Hub-Signature-256": value })).toEqual({
				ok: false,
				status: 401,
			});
		for (const value of [`sha256=${good}`, good.slice(1), ""])
			expect(await run("sentry", { "Sentry-Hook-Signature": value })).toEqual({
				ok: false,
				status: 401,
			});
		expect(await run("github", {})).toEqual({ ok: false, status: 401 });
		expect(verify).not.toHaveBeenCalled();
		// Hex and the prefix in any case.
		expect(
			await run("github", {
				"X-Hub-Signature-256": `SHA256=${good.toUpperCase()}`,
			}),
		).toEqual({ ok: true });
		expect(
			await run("sentry", { "Sentry-Hook-Signature": good.toUpperCase() }),
		).toEqual({ ok: true });
		expect(
			await run("sentry", { "Sentry-Hook-Signature": "0".repeat(64) }),
		).toEqual({ ok: false, status: 401 });
	});

	it("none: needs the secret in the address", async () => {
		const run = (pathSecret: string | undefined) =>
			checkWebhook(
				"none",
				"a1b2c3",
				new ArrayBuffer(0),
				() => null,
				pathSecret,
			);
		expect(await run("a1b2c3")).toEqual({ ok: true });
		for (const pathSecret of [undefined, "", "a1b2c", "a1b2c3d"])
			expect(await run(pathSecret), String(pathSecret)).toEqual({
				ok: false,
				status: 401,
			});
	});
});
