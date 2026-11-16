import { linearRoutes } from "./integrations/linear/routes";
import { sentryRoutes } from "./integrations/sentry/routes";
import { slackRoutes } from "./integrations/slack/routes";
import { webhookRoutes } from "./integrations/webhook/routes";
import type { EngineRoutes } from "./routes";
import { sameSecret } from "./shared/crypto";

export { Relay } from "./relay";

const INTEGRATIONS = [linearRoutes, slackRoutes, sentryRoutes, webhookRoutes];

/** The engine's WebSocket. */
const engineSocket: EngineRoutes = (request, url) =>
	request.method === "GET" && url.pathname === "/engine"
		? // Behind Traefik the URL is wss:// (its X-Forwarded-Proto), which fetch refuses.
			async (request, url, relay) =>
				relay.fetch(new Request(url.href.replace(/^ws/, "http"), request))
		: undefined;

const ENGINE_ROUTES = [
	engineSocket,
	...INTEGRATIONS.map((routes) => routes.engineRoutes),
];

function fromEngine(request: Request, env: Env): boolean {
	// No token set must not mean "Bearer undefined" opens the engine routes.
	return (
		!!env.ENGINE_TOKEN &&
		sameSecret(
			request.headers.get("Authorization") ?? "",
			`Bearer ${env.ENGINE_TOKEN}`,
		)
	);
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const relay = env.RELAY.getByName("relay");

		const route = `${request.method} ${url.pathname}`;
		if (route === "GET /health") return Response.json({ ok: true });
		// Said to anyone, with or without the token.
		if (
			route === "GET /engine" &&
			request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
		)
			return new Response(null, { status: 426 });

		// Checked before any hook takes the delivery as seen: the sender's retry is queued later.
		if (
			request.method === "POST" &&
			url.pathname.startsWith("/hooks/") &&
			(await relay.queueFull())
		)
			return new Response(
				"The relay keeps as many events as it can for an engine that has not taken them: try again later.",
				{ status: 503, headers: { "Retry-After": "60" } },
			);
		for (const { hookRoutes } of INTEGRATIONS) {
			const response = await hookRoutes?.(request, url, relay);
			if (response) return response;
		}
		for (const engineRoutes of ENGINE_ROUTES) {
			const engineRoute = engineRoutes(request, url);
			if (!engineRoute) continue;
			if (!fromEngine(request, env)) return new Response(null, { status: 401 });
			return engineRoute(request, url, relay);
		}
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
