import type { EngineRoute, IntegrationRoutes } from "../../routes";
import { readBody } from "../../shared/http";
import type { LinearConfig } from "./durable";

export const linearRoutes: IntegrationRoutes = {
	hookRoutes: async (request, url, relay) => {
		switch (`${request.method} ${url.pathname}`) {
			case "POST /hooks/linear": {
				const body = await readBody(request);
				if (!body) return new Response(null, { status: 413 });
				const status = await relay.receiveLinearHook(
					body,
					request.headers.get("Linear-Signature"),
					request.headers.get("Linear-Delivery"),
				);
				return new Response(null, { status });
			}

			case "GET /oauth/linear/callback": {
				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state");
				const install =
					code && state
						? await relay.installLinear(code, state, url.origin)
						: ({ kind: "unknown-state" } as const);
				if (install.kind === "unknown-state")
					return new Response("Unknown or already used state.", {
						status: 400,
					});
				if (install.kind === "code-refused")
					return new Response(
						"Linear refused the code, run openfabriq connect linear again.",
						{ status: 502 },
					);
				return new Response(
					`<!doctype html><meta charset="utf-8"><title>openfabriq</title><p>openfabriq is installed in ${escapeHtml(install.organizationName)}. You can close this tab.</p>`,
					{ headers: { "Content-Type": "text/html; charset=utf-8" } },
				);
			}
		}
		return undefined;
	},

	engineRoutes: (request, url) => {
		switch (`${request.method} ${url.pathname}`) {
			case "POST /config/linear":
				return configure;
			case "GET /tokens/linear":
				return tokens;
		}
		return undefined;
	},
};

const configure: EngineRoute = async (request, url, relay) => {
	const config = await request.json().catch(() => null);
	if (!isLinearConfig(config))
		return new Response("Expected { webhookSecret, clientId, clientSecret }.", {
			status: 400,
		});
	return Response.json({
		authorizeUrl: await relay.configureLinear(
			{
				webhookSecret: config.webhookSecret,
				clientId: config.clientId,
				clientSecret: config.clientSecret,
			},
			url.origin,
		),
	});
};

const tokens: EngineRoute = async (_request, _url, relay) =>
	Response.json({ organizations: await relay.linearTokens() });

function isLinearConfig(value: unknown): value is LinearConfig {
	const config = value as Partial<Record<keyof LinearConfig, unknown>> | null;
	return (["webhookSecret", "clientId", "clientSecret"] as const).every(
		(key) => typeof config?.[key] === "string" && config[key] !== "",
	);
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
