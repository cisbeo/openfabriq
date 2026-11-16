import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Factory,
	isEngineVariable,
	looksSecret,
	secretNames,
} from "@openfabriq/core";
import { writeFileAtomic } from "../files.js";
import {
	claudeKeyPath,
	ensureFactorySecretsDir,
	secretValues,
} from "../state/factory-secrets.js";

/**
 * PATH and HOME stay (Claude Code needs them for its own login); every GitHub, git, SSH and
 * Anthropic credential goes, and gh, git and ssh point at empty configurations.
 * So do the engine's own variables and Slack, Linear and Sentry tokens, and
 * whatever looks like a secret of the machine.
 */
let ghConfigDir: string | undefined; // one empty gh configuration per engine process

export function credentialFreeEnv(identity: {
	name: string;
	email: string;
}): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env))
		if (
			value !== undefined &&
			!isEngineVariable(key) &&
			!looksSecret(key, value)
		)
			env[key] = value;
	ghConfigDir ??= mkdtempSync(join(tmpdir(), "openfabriq-gh-"));
	return {
		...env,
		GH_CONFIG_DIR: ghConfigDir,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_TERMINAL_PROMPT: "0",
		GIT_SSH_COMMAND:
			"ssh -F /dev/null -o IdentitiesOnly=yes -o IdentityFile=/dev/null -o BatchMode=yes",
		GIT_AUTHOR_NAME: identity.name,
		GIT_AUTHOR_EMAIL: identity.email,
		GIT_COMMITTER_NAME: identity.name,
		GIT_COMMITTER_EMAIL: identity.email,
		DO_NOT_TRACK: "1",
		// Auto memory writes to ~/.claude/ and would carry notes from one run to the next.
		CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
	};
}

/**
 * Claude Code's credential, from the engine's environment. Claude Code keeps an OAuth token from the
 * commands, MCP servers and hooks it starts (measured), but not ANTHROPIC_API_KEY: the
 * agent's sandboxed shell read it (measured). So the key goes in the engine's secrets
 * folder, which no sandbox reads, and an apiKeyHelper of the engine's settings prints it. An API key wins over
 * a token, as in Claude Code; the engine passes one only. Without either, Claude Code's own login.
 * With a key, it writes the key's file first.
 */
export function prepareClaudeAuth(
	agent: Record<string, string>,
	engine: NodeJS.ProcessEnv = process.env,
): { env: Record<string, string>; apiKeyHelper?: string } {
	const key = engine.ANTHROPIC_API_KEY;
	if (key) {
		const path = claudeKeyPath();
		ensureFactorySecretsDir();
		writeFileAtomic(path, key, 0o600);
		return {
			env: agent,
			apiKeyHelper: `cat '${path.replaceAll("'", "'\\''")}'`,
		};
	}
	const token = engine.CLAUDE_CODE_OAUTH_TOKEN;
	return {
		env: token ? { ...agent, CLAUDE_CODE_OAUTH_TOKEN: token } : agent,
	};
}

/** Which Claude credential the runs use, in words, for `start`. */
export function claudeLogin(engine: NodeJS.ProcessEnv = process.env): string {
	if (engine.ANTHROPIC_API_KEY)
		return engine.CLAUDE_CODE_OAUTH_TOKEN
			? "Claude: the API key of ANTHROPIC_API_KEY, billed per token; CLAUDE_CODE_OAUTH_TOKEN is not used"
			: "Claude: the API key of ANTHROPIC_API_KEY, billed per token";
	return engine.CLAUDE_CODE_OAUTH_TOKEN
		? "Claude: the subscription of CLAUDE_CODE_OAUTH_TOKEN"
		: "Claude: this machine's Claude Code login";
}

/**
 * A run's two environments. Secrets come from the engine's environment, then the project's file
 *, and reach setup and commands, never the agent. `variables` names what
 * was passed, for the journal.
 */
export function runEnv(
	identity: { name: string; email: string },
	factory: Factory,
	env: NodeJS.ProcessEnv = process.env,
): {
	agent: Record<string, string>;
	command: Record<string, string>;
	variables?: { env: string[]; secrets: string[]; missing: string[] };
} {
	const agent = { ...credentialFreeEnv(identity), ...factory.env };
	// A secret whose name does not look like one would pass credentialFreeEnv's filter; the MCP
	// servers' secrets go to their server alone.
	for (const name of secretNames(factory)) delete agent[name];
	const command = { ...agent };
	const values = secretValues(factory.repository, factory.secrets ?? [], env);
	const missing: string[] = [];
	for (const name of factory.secrets ?? []) {
		const value = values[name];
		if (value === undefined) missing.push(name);
		else command[name] = value;
	}
	if (!factory.env && !factory.secrets) return { agent, command };
	return {
		agent,
		command,
		variables: {
			env: Object.keys(factory.env ?? {}),
			secrets: (factory.secrets ?? []).filter((n) => !missing.includes(n)),
			missing,
		},
	};
}

/**
 * A command's output with each secret's value replaced by its name: the run's detail shows it, and a
 * failing check's output goes back to the agent, which never gets the secrets. Values
 * under 4 characters are left: they would hide ordinary text, and no real secret is that short.
 */
export function hideSecrets(
	text: string,
	secrets: Record<string, string>,
): string {
	return Object.entries(secrets)
		.filter(([, value]) => value.length >= 4)
		.sort(([, a], [, b]) => b.length - a.length)
		.reduce((out, [name, value]) => out.replaceAll(value, `<${name}>`), text);
}
