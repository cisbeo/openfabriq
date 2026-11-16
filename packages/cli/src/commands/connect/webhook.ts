import { randomBytes } from "node:crypto";
import {
	errorText,
	listProjects,
	readAppliedFactory,
} from "@openfabriq/runner";
import type { CommandResult } from "../../result.js";
import {
	type ConnectDeps,
	connectedRelay,
	NO_RELAY,
	relayCall,
} from "./shared.js";

// openfabriq connect webhook <name>: gives the relay the webhook's secret, and says
// where the sender must post. The name and the signature come from the applied factory.

/** Senders that create the secret themselves: the person copies it here. */
const ASKED = { sentry: "Client Secret", stripe: "Signing secret (whsec_...)" };

export async function connectWebhook(
	name: string | undefined,
	deps: ConnectDeps,
	options: { remove?: boolean } = {},
): Promise<CommandResult> {
	if (!name)
		return {
			code: 1,
			output: "Usage: openfabriq connect webhook <name> [--remove]",
		};
	const relay = connectedRelay();
	if (!relay) return NO_RELAY;
	const call = (method: string, body?: unknown) =>
		relayCall(
			relay,
			deps,
			method,
			`/config/webhook/${encodeURIComponent(name)}`,
			body,
		);

	if (options.remove) {
		try {
			const response = await call("DELETE");
			if (!response.ok)
				throw new Error(`DELETE /config/webhook answered ${response.status}`);
		} catch (error) {
			return {
				code: 1,
				output: `The relay did not remove it (${errorText(error)}).`,
			};
		}
		return {
			code: 0,
			output: `The relay no longer accepts the webhook ${name}.`,
		};
	}

	const signature = listProjects()
		.map((p) => readAppliedFactory(p.repository)?.webhooks?.[name]?.signature)
		.find(Boolean);
	if (!signature)
		return {
			code: 1,
			output: `No applied factory declares the webhook ${name}: add it under webhooks in factory.yaml, then run "openfabriq apply".`,
		};

	let secret: string;
	if (signature === "sentry" || signature === "stripe") {
		secret = (
			await deps.ask(`${ASKED[signature]} of the ${signature} webhook: `, {
				secret: true,
			})
		).trim();
		if (!secret)
			return { code: 1, output: "No secret given. Nothing was saved." };
	} else
		secret =
			signature === "standard"
				? `whsec_${randomBytes(32).toString("base64")}`
				: randomBytes(24).toString("hex");

	try {
		const response = await call("POST", { signature, secret });
		if (!response.ok)
			throw new Error(`POST /config/webhook answered ${response.status}`);
	} catch (error) {
		return {
			code: 1,
			output: `The relay did not take the webhook (${errorText(error)}). Nothing was saved.`,
		};
	}
	const address = `${relay.url}/hooks/custom/${name}`;
	const lines =
		signature === "none"
			? [
					`Webhook ${name} ready. Give the sender this address, and keep it private: anyone who has it can start the factory.`,
					"",
					`  ${address}/${secret}`,
				]
			: signature === "sentry" || signature === "stripe"
				? [
						`Webhook ${name} ready. In ${signature === "sentry" ? "Sentry" : "Stripe"}, set the webhook URL to:`,
						"",
						`  ${address}`,
					]
				: [
						`Webhook ${name} ready. Give the sender this URL and this secret${signature === "github" ? ' (GitHub: "Content type" application/json)' : ""}:`,
						"",
						`  URL:    ${address}`,
						`  Secret: ${secret}`,
						"",
						"The secret is shown once and kept only by your relay. Run this command again to get a new one.",
					];
	return { code: 0, output: lines.join("\n") };
}
