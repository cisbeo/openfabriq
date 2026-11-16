import type { EngineRoute, IntegrationRoutes } from "../../routes";
import { readBody } from "../../shared/http";
import { SIGNATURES, type Signature, standardWebhookKey } from "./signatures";

const WEBHOOK = /^\/hooks\/custom\/([a-z][a-z0-9-]*)(?:\/([^/]+))?$/;
const WEBHOOK_CONFIG = /^\/config\/webhook\/([a-z][a-z0-9-]*)$/;

/** /hooks/custom/<name>, and /<secret> for "none"; /config/webhook/<name> for the engine. */
export const webhookRoutes: IntegrationRoutes = {
	hookRoutes: async (request, url, relay) => {
		const hook = WEBHOOK.exec(url.pathname);
		if (!hook?.[1] || request.method !== "POST") return undefined;
		const body = await readBody(request);
		if (!body) return new Response(null, { status: 413 });
		const status = await relay.receiveWebhook(
			hook[1],
			body,
			Object.fromEntries(request.headers),
			hook[2],
		);
		return new Response(null, { status });
	},

	// Any method: one other than POST and DELETE is told 405, once the token is checked.
	engineRoutes: (_request, url) => {
		const name = WEBHOOK_CONFIG.exec(url.pathname)?.[1];
		return name ? configRoute(name) : undefined;
	},
};

const configRoute =
	(name: string): EngineRoute =>
	async (request, _url, relay) => {
		if (request.method === "DELETE") {
			await relay.removeWebhook(name);
			return new Response(null, { status: 204 });
		}
		if (request.method !== "POST") return new Response(null, { status: 405 });
		const config = await request
			.json<{ signature?: unknown; secret?: unknown }>()
			.catch(() => null);
		if (
			!SIGNATURES.includes(config?.signature as Signature) ||
			typeof config?.secret !== "string" ||
			!config.secret
		)
			return new Response(
				`Expected { signature: ${SIGNATURES.join(" | ")}, secret }.`,
				{ status: 400 },
			);
		if (config.signature === "standard" && !standardWebhookKey(config.secret))
			return new Response(
				"Expected a standard secret: whsec_ and a base64 key.",
				{ status: 400 },
			);
		await relay.configureWebhook(name, {
			signature: config.signature as Signature,
			secret: config.secret,
		});
		return new Response(null, { status: 204 });
	};
