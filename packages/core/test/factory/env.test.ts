import { describe, expect, it } from "vitest";
import {
	changesLoading,
	isEngineVariable,
	looksSecret,
} from "../../src/factory/env.js";

describe("variables", () => {
	it("knows the engine's own variables", () => {
		for (const name of [
			"GH_TOKEN",
			"GITHUB_TOKEN",
			"ANTHROPIC_API_KEY",
			"CLAUDE_CODE_X",
			"SSH_AUTH_SOCK",
			"GIT_DIR",
			"OPENFABRIQ_SLACK_BOT_TOKEN",
			"OPENFABRIQ_STUDIO_PASSWORD",
			"SLACK_X",
			"LINEAR_X",
			"SENTRY_X",
		])
			expect(isEngineVariable(name), name).toBe(true);
		// The prefix is the start of the name: LEGIT_MODE is not git's.
		for (const name of [
			"PATH",
			"HOME",
			"DATABASE_URL",
			"NODE_ENV",
			"LEGIT_MODE",
		])
			expect(isEngineVariable(name), name).toBe(false);
	});

	it("spots what looks like a secret, by its name or by a URL with a password", () => {
		for (const [name, value] of [
			["NPM_TOKEN", "x"],
			["npm_config__authToken", "x"],
			["STRIPE_SECRET_KEY", "x"],
			["OPENAI_API_KEY", "x"],
			["PGPASSWORD", "x"],
			["AWS_REGION", "eu-west-3"],
			["AZURE_TENANT", "x"],
			["GOOGLE_APPLICATION_CREDENTIALS", "/k.json"],
			["DATABASE_URL", "postgres://localhost/app"],
			["TEST_DATABASE_URL", "x"],
			["GPG_KEY", "x"],
			["KEY", "x"],
			["STRIPE_APIKEY", "x"],
			["REDIS", "redis://default:hunter2@cache:6379"],
		] as const)
			expect(looksSecret(name, value), name).toBe(true);
		for (const [name, value] of [
			["PATH", "/usr/bin"],
			["NVM_DIR", "/Users/a/.nvm"],
			["KEYCHAIN_PATH", "x"],
			["MONKEY", "x"],
			["API_URL", "https://api.example.com"],
			["PROXY", "http://user@proxy:8080"],
		] as const)
			expect(looksSecret(name, value), name).toBe(false);
	});

	it("knows the variables that change how a process loads code, by their start", () => {
		for (const name of ["NODE_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES"])
			expect(changesLoading(name), name).toBe(true);
		for (const name of [
			"NODE_OPTIONS_DOC",
			"WORLD_NAME",
			"MY_DYLD_X",
			"NODE_ENV",
		])
			expect(changesLoading(name), name).toBe(false);
	});
});
