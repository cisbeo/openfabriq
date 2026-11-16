import type { EngineRoute, IntegrationRoutes } from "../../routes";
import { originOf, type SentryWatch, watchFields } from "./api";

/** No hook: the relay polls Sentry. */
export const sentryRoutes: IntegrationRoutes = {
	engineRoutes: (request, url) => {
		switch (`${request.method} ${url.pathname}`) {
			case "POST /config/sentry":
				return configure;
			case "PUT /config/sentry/watches":
				return watch;
		}
		return undefined;
	},
};

const configure: EngineRoute = async (request, _url, relay) => {
	const config = await request
		.json<{ token?: unknown; url?: unknown }>()
		.catch(() => null);
	const origin =
		typeof config?.url === "string" ? originOf(config.url) : undefined;
	if (typeof config?.token !== "string" || !config.token || !origin)
		return new Response("Expected { token, url }.", { status: 400 });
	await relay.configureSentry({ token: config.token, origin });
	return new Response(null, { status: 204 });
};

const watch: EngineRoute = async (request, _url, relay) => {
	const body = await request.json<{ watches?: unknown }>().catch(() => null);
	const watches = body?.watches;
	if (!Array.isArray(watches) || !watches.every(isWatch))
		return new Response(
			"Expected { watches: [{ organization, project, query? }] }.",
			{ status: 400 },
		);
	await relay.watchSentry(watches.map(watchFields));
	return new Response(null, { status: 204 });
};

function isWatch(value: unknown): value is SentryWatch {
	const watch = value as Partial<Record<keyof SentryWatch, unknown>> | null;
	return (
		typeof watch?.organization === "string" &&
		watch.organization !== "" &&
		typeof watch.project === "string" &&
		watch.project !== "" &&
		(watch.query === undefined || typeof watch.query === "string")
	);
}
