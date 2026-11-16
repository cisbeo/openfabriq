import type { Factory } from "./types.js";

/** Variables the engine owns or strips: a factory cannot give them to its commands. */
const ENGINE =
	/^(GH_|GITHUB_|ANTHROPIC_|CLAUDE|SSH_|GIT_|OPENFABRIQ_|SLACK_|LINEAR_|SENTRY_)/;

const SECRET_NAME =
	/TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|ACCESS_KEY|PRIVATE_KEY|(^|_)KEY($|_)|^AWS_|^AZURE_|(^|_)DATABASE_URL$/i;
const URL_WITH_PASSWORD = /^[a-z][a-z0-9+.-]*:\/\/[^/@\s:]*:[^/@\s]+@/i;

export const isEngineVariable = (name: string) => ENGINE.test(name);

/** Variables that change how a process loads code: env would reach the agent with them. */
export const changesLoading = (name: string) =>
	/^(NODE_OPTIONS$|LD_|DYLD_)/.test(name);

/** Whether a variable of the machine looks like a secret, by its name or a URL with a password. */
export const looksSecret = (name: string, value: string) =>
	SECRET_NAME.test(name) || URL_WITH_PASSWORD.test(value);

/** Every secret the factory names: for its commands, and for its MCP servers. */
export function secretNames(factory: Factory): string[] {
	const servers = Object.values(factory.mcp ?? {}).flatMap((server) =>
		"url" in server
			? server.secret
				? [server.secret]
				: []
			: (server.secrets ?? []),
	);
	return [...new Set([...(factory.secrets ?? []), ...servers])];
}
