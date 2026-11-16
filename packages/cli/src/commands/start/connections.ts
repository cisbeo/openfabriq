import { type Factory, RELAY_EVENTS } from "@openfabriq/core";
import {
	appToken,
	linearAgentClient,
	readSecrets,
	relayClient,
	SENTRY_URL,
	type Secrets,
	sameOrigin,
	sentryClient,
	slackClient,
	type startEngine,
	usesRelay,
} from "@openfabriq/runner";

// The clients of the services the engine hears through the relay, built once when "start" starts,
// and the notes that say what is missing.

/** The events of a factory that only the relay brings, in words. */
const relayEvents = (factory: Factory) =>
	[
		...new Set(
			Object.values(factory.automations).flatMap((a) =>
				a.when.map((t) => t.event).filter((e) => RELAY_EVENTS.includes(e)),
			),
		),
	].join(", ");

/**
 * Every service comes through the relay: it starts for the factories that listen to one,
 * with Slack's bot token and Sentry's token for reading and writing. When something is missing, a
 * note says so for each project.
 */
export function serviceClients(
	factories: Factory[],
	secrets: Secrets,
): {
	clients: Pick<
		Parameters<typeof startEngine>[0],
		"slack" | "sentry" | "relay" | "linearApp"
	>;
	notes: string[];
} {
	const clients: ReturnType<typeof serviceClients>["clients"] = {};
	const notes: string[] = [];
	const listening = factories.filter(usesRelay);
	if (!secrets.relay) {
		for (const factory of listening)
			notes.push(
				`${factory.repository}: listens to ${relayEvents(factory)}, but the relay is not connected; run "openfabriq connect relay"`,
			);
		return { clients, notes };
	}
	if (listening.length === 0) return { clients, notes };
	const relay = relayClient(secrets.relay, {
		currentToken: () => readSecrets().relay?.token,
	});
	clients.relay = relay;
	clients.linearApp = (organization) =>
		linearAgentClient(() => appToken(relay, organization));
	notes.push(
		`relay: listening for ${listening.map((f) => f.repository).join(", ")}`,
	);
	const users = (uses: (f: Factory) => unknown) =>
		listening.filter(uses).map((f) => f.repository);
	const slackUsers = users((f) => f.slack);
	const botToken = secrets.slack?.bot_token;
	if (slackUsers.length && botToken) clients.slack = slackClient({ botToken });
	else if (slackUsers.length)
		notes.push(
			`slack: ${slackUsers.join(", ")} listen to Slack, but Slack is not connected; run "openfabriq connect slack"`,
		);
	const sentryUsers = users((f) => f.sentry);
	const token = secrets.sentry?.token;
	if (sentryUsers.length && !token) {
		notes.push(
			`sentry: ${sentryUsers.join(", ")} listen to Sentry, but Sentry is not connected; run "openfabriq connect sentry"`,
		);
		return { clients, notes };
	}
	if (!token) return { clients, notes };
	// The token goes only to the Sentry it was tested against, never to one a repository names.
	const origin = secrets.sentry?.url ?? SENTRY_URL;
	const onOrigin = users((f) => {
		if (!f.sentry) return false;
		const url = f.sentry.url ?? SENTRY_URL;
		if (sameOrigin(url, origin)) return true;
		notes.push(
			`sentry: ${f.repository} points at ${url} but the token is for ${origin}; run "openfabriq connect sentry"`,
		);
		return false;
	});
	if (onOrigin.length)
		clients.sentry = sentryClient(() => readSecrets().sentry?.token ?? token, {
			origin,
		});
	return { clients, notes };
}

/**
 * Linear's tokens live in the relay: a factory that listens to Linear while openfabriq is
 * installed in no workspace is said at start, not when the first delegation never comes.
 */
export async function linearNotes(
	factories: Factory[],
	relay: Pick<ReturnType<typeof relayClient>, "linearTokens"> | undefined,
): Promise<string[]> {
	const users = factories
		.filter((f) => f.linear && usesRelay(f))
		.map((f) => f.repository);
	if (!relay || users.length === 0) return [];
	const installs = await relay.linearTokens().catch(() => undefined);
	return installs?.length === 0
		? [
				`linear: ${users.join(", ")} listen to Linear, but openfabriq is not installed in Linear; run "openfabriq connect linear"`,
			]
		: [];
}
