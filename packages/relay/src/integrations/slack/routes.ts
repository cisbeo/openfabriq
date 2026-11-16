import type { EngineRoute, IntegrationRoutes } from "../../routes";
import { readBody } from "../../shared/http";

export const slackRoutes: IntegrationRoutes = {
	hookRoutes: async (request, url, relay) => {
		if (`${request.method} ${url.pathname}` !== "POST /hooks/slack")
			return undefined;
		const body = await readBody(request);
		if (!body) return new Response(null, { status: 413 });
		const answer = await relay.receiveSlackHook(
			body,
			request.headers.get("X-Slack-Signature"),
			request.headers.get("X-Slack-Request-Timestamp"),
		);
		return answer.kind === "challenge"
			? new Response(answer.challenge, {
					headers: { "Content-Type": "text/plain" },
				})
			: new Response(null, { status: answer.status });
	},

	engineRoutes: (request, url) =>
		`${request.method} ${url.pathname}` === "POST /config/slack"
			? configure
			: undefined,
};

const configure: EngineRoute = async (request, _url, relay) => {
	const config = await request
		.json<{ signingSecret?: unknown }>()
		.catch(() => null);
	if (typeof config?.signingSecret !== "string" || !config.signingSecret)
		return new Response("Expected { signingSecret }.", { status: 400 });
	await relay.configureSlack(config.signingSecret);
	return new Response(null, { status: 204 });
};
