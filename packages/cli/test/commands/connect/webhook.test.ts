import { writeApplied } from "@openfabriq/runner";
import { beforeEach, expect, it } from "vitest";
import { connectCommand } from "../../../src/commands/connect/index.js";
import type { ConnectDeps } from "../../../src/commands/connect/shared.js";
import { RELAY, withRelay } from "./helpers.js";

// openfabriq connect webhook <name>.

let calls: { url: string; method: string; body?: unknown }[];

const deps = (
	status = 204,
	answer = " sentry-client-secret ",
): ConnectDeps => ({
	ask: async () => answer,
	print: () => {},
	fetch: (async (url: string, init: RequestInit) => {
		calls.push({
			url,
			method: String(init.method),
			...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
		});
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer rt",
		);
		return { ok: status < 300, status } as Response;
	}) as typeof fetch,
});

beforeEach(() => {
	calls = [];
	writeApplied("acme/app", {
		"factory.yaml":
			"name: F\nrepository: acme/app\nmaintainers: [alice]\nwebhooks:\n  deploy-failed:\n    signature: standard\n  sentry-fatal:\n    signature: sentry\n  open:\n    signature: none\n",
		"agents/fixer/agent.md": "---\ndescription: Fixes\n---\nFix.\n",
		"automations/a/automation.md":
			"---\nwhen:\n  webhook.received: { webhook: deploy-failed }\nagent: fixer\n---\nGo.\n",
	});
});

it("needs a name and a relay", async () => {
	expect((await connectCommand("webhook", deps())).output).toBe(
		"Usage: openfabriq connect webhook <name> [--remove]",
	);
	expect(
		await connectCommand("webhook", deps(), { name: "deploy-failed" }),
	).toEqual({
		code: 1,
		output: 'No relay yet: run "openfabriq connect relay" first.',
	});
});

it("generates a Standard Webhooks secret, gives it to the relay, and shows it once with the URL", async () => {
	withRelay();
	const result = await connectCommand("webhook", deps(), {
		name: "deploy-failed",
	});
	const body = calls[0]?.body as { signature: string; secret: string };
	expect(calls[0]).toMatchObject({
		url: `${RELAY}/config/webhook/deploy-failed`,
		method: "POST",
	});
	expect(body.signature).toBe("standard");
	// whsec_ and base64 of 32 random bytes, as the spec asks (24 to 64 bytes).
	expect(Buffer.from(body.secret.replace("whsec_", ""), "base64")).toHaveLength(
		32,
	);
	expect(result.code).toBe(0);
	expect(result.output).toContain(
		`URL:    ${RELAY}/hooks/custom/deploy-failed`,
	);
	expect(result.output).toContain(`Secret: ${body.secret}`);
});

it("asks the secret a sender creates, and puts the secret in the address without signature", async () => {
	withRelay();
	const sentry = await connectCommand("webhook", deps(), {
		name: "sentry-fatal",
	});
	expect(calls[0]?.body).toEqual({
		signature: "sentry",
		secret: "sentry-client-secret",
	});
	expect(sentry.output).not.toContain("sentry-client-secret");
	const open = await connectCommand("webhook", deps(), { name: "open" });
	const secret = (calls[1]?.body as { secret?: string } | undefined)?.secret;
	expect(open.output).toContain(`${RELAY}/hooks/custom/open/${secret}`);
});

it("refuses a webhook no applied factory declares, says when the relay refuses, and removes one", async () => {
	withRelay();
	expect(
		(await connectCommand("webhook", deps(), { name: "other" })).output,
	).toBe(
		'No applied factory declares the webhook other: add it under webhooks in factory.yaml, then run "openfabriq apply".',
	);
	expect(
		(await connectCommand("webhook", deps(401), { name: "deploy-failed" }))
			.output,
	).toBe(
		"The relay did not take the webhook (POST /config/webhook answered 401). Nothing was saved.",
	);
	expect(
		await connectCommand("webhook", deps(), {
			name: "deploy-failed",
			remove: true,
		}),
	).toEqual({
		code: 0,
		output: "The relay no longer accepts the webhook deploy-failed.",
	});
	expect(calls.at(-1)).toEqual({
		url: `${RELAY}/config/webhook/deploy-failed`,
		method: "DELETE",
	});
});

it("removes a webhook by its name only, never by a path the name would make", async () => {
	withRelay();
	await connectCommand("webhook", deps(), { name: "../slack", remove: true });
	expect(calls.at(-1)).toEqual({
		url: `${RELAY}/config/webhook/..%2Fslack`,
		method: "DELETE",
	});
});
