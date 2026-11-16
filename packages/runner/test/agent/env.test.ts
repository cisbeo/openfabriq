import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
	claudeLogin,
	credentialFreeEnv,
	hideSecrets,
	prepareClaudeAuth,
} from "../../src/agent/env.js";

const engine = {
	PATH: "/usr/bin",
	CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-secret",
	GH_TOKEN: "ghp-secret",
};

it("gives Claude Code the engine's Claude login from the environment, and nothing else of the engine", () => {
	const agent = credentialFreeEnv({ name: "T", email: "t@example.com" });
	expect(agent.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
	const claude = prepareClaudeAuth(agent, engine);
	expect(claude).toEqual({
		env: { ...agent, CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-secret" },
	});
	expect(claude.env.GH_TOKEN).toBeUndefined();
});

it("leaves the agent's environment as it is without a token: Claude Code uses its own login", () => {
	const agent = { PATH: "/usr/bin" };
	expect(prepareClaudeAuth(agent, { PATH: "/usr/bin" }).env).toBe(agent);
});

it("keeps the API key out of every environment: a helper reads it from the engine's secrets folder, and it wins over a token", () => {
	vi.stubEnv("OPENFABRIQ_HOME", mkdtempSync(join(tmpdir(), "openfabriq-")));
	const agent = credentialFreeEnv({ name: "T", email: "t@example.com" });
	const claude = prepareClaudeAuth(agent, {
		...engine,
		ANTHROPIC_API_KEY: "sk-ant-api-secret",
	});
	const path = join(
		process.env.OPENFABRIQ_HOME ?? "",
		"secrets/anthropic_api_key",
	);
	vi.unstubAllEnvs();
	expect(claude).toEqual({ env: agent, apiKeyHelper: `cat '${path}'` });
	expect(readFileSync(path, "utf8")).toBe("sk-ant-api-secret");
	expect(statSync(path).mode & 0o777).toBe(0o600);
});

it("names the credential the runs use, and the token left unused", () => {
	expect(claudeLogin({})).toBe("Claude: this machine's Claude Code login");
	expect(claudeLogin({ CLAUDE_CODE_OAUTH_TOKEN: "t" })).toBe(
		"Claude: the subscription of CLAUDE_CODE_OAUTH_TOKEN",
	);
	expect(claudeLogin({ ANTHROPIC_API_KEY: "k" })).toBe(
		"Claude: the API key of ANTHROPIC_API_KEY, billed per token",
	);
	expect(
		claudeLogin({ ANTHROPIC_API_KEY: "k", CLAUDE_CODE_OAUTH_TOKEN: "t" }),
	).toContain("CLAUDE_CODE_OAUTH_TOKEN is not used");
});

it("hides each secret's value behind its name, the longer value first, and leaves short values", () => {
	const secrets = {
		DATABASE_URL: "postgres://u:hunter2@db/app",
		PASSWORD: "hunter2",
		PIN: "42",
	};
	expect(
		hideSecrets(
			"DATABASE_URL=postgres://u:hunter2@db/app\nPASSWORD=hunter2\n42 tests passed",
			secrets,
		),
	).toBe("DATABASE_URL=<DATABASE_URL>\nPASSWORD=<PASSWORD>\n42 tests passed");
});

it("keeps the studio's password from agents and commands", () => {
	vi.stubEnv("OPENFABRIQ_STUDIO_PASSWORD", "correct horse battery staple");
	vi.stubEnv("OPENFABRIQ_STUDIO_URL", "https://factory.example.com");
	const env = credentialFreeEnv({ name: "T", email: "t@example.com" });
	vi.unstubAllEnvs();
	expect(env.OPENFABRIQ_STUDIO_PASSWORD).toBeUndefined();
	expect(JSON.stringify(env)).not.toContain("correct horse");
});
