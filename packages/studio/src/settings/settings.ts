import { type Factory, secretNames } from "@openfabriq/core";
import {
	readSecrets,
	relayClient,
	secretValues,
	usesRelay,
} from "@openfabriq/runner";

/**
 * The settings of the applied factory, without its agents and automations (their own pages show
 * them), its factory.yaml as written, and whether each piece the engine needs is ready on this
 * machine. Names and yes/no only: never a secret's value or a token (factory.yaml holds names only).
 */
export async function settingsOf(
	repository: string,
	factory: Factory,
	yaml = "",
) {
	const { agents, automations, skills, ...settings } = factory;
	const names = secretNames(factory);
	const set = secretValues(repository, names);
	const tokens = readSecrets();
	// Linear's install lives on the relay, not here: ask it whether an organization installed openfabriq.
	const linear =
		factory.linear && tokens.relay
			? await relayClient(tokens.relay)
					.linearTokens()
					.then(
						(orgs) => orgs.length > 0,
						() => false,
					)
			: false;
	return {
		...settings,
		yaml,
		ready: {
			secrets: Object.fromEntries(names.map((n) => [n, n in set])),
			relayNeeded: usesRelay(factory),
			relay: Boolean(tokens.relay),
			slack: Boolean(tokens.slack?.bot_token),
			linear,
			sentry: Boolean(tokens.sentry?.token),
		},
	};
}

export type FactorySettings = Awaited<ReturnType<typeof settingsOf>>;
