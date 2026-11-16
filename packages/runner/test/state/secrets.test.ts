import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, expect, it } from "vitest";
import { credentialFreeEnv } from "../../src/agent/env.js";
import {
	readSecrets,
	secretsPath,
	writeSecrets,
} from "../../src/state/secrets.js";

beforeEach(() => {
	process.env.OPENFABRIQ_HOME = join(
		mkdtempSync(join(tmpdir(), "openfabriq-home-")),
		"not-yet",
	);
});

it("writes secrets readable by the user only, and lets variables win", () => {
	writeSecrets("slack", { bot_token: "xoxb-file" });
	writeSecrets("sentry", { token: "sntryu-file", url: "https://sentry.io" });
	expect(statSync(secretsPath()).mode & 0o777).toBe(0o600);
	expect(readSecrets({})).toEqual({
		slack: { bot_token: "xoxb-file" },
		sentry: { token: "sntryu-file", url: "https://sentry.io" },
	});
	expect(
		readSecrets({
			OPENFABRIQ_SLACK_BOT_TOKEN: "xoxb-env",
			OPENFABRIQ_SENTRY_TOKEN: "sntryu-env",
		}),
	).toEqual({
		slack: { bot_token: "xoxb-env" },
		sentry: { token: "sntryu-env", url: "https://sentry.io" },
	});
});

it("names the file when it is not valid JSON, and leaves no temporary file", () => {
	writeSecrets("sentry", { token: "sntryu-file" });
	expect(readdirSync(dirname(secretsPath()))).toEqual(["secrets.json"]);
	writeFileSync(secretsPath(), '{"sentry": {"token": "sntryu-');
	expect(() => readSecrets({})).toThrow(`${secretsPath()} is not valid JSON`);
});

it("never gives an agent the engine's, Slack's, Linear's or Sentry's variables", () => {
	const saved = { ...process.env };
	Object.assign(process.env, {
		OPENFABRIQ_SLACK_APP_TOKEN: "xapp-secret",
		OPENFABRIQ_LINEAR_API_KEY: "lin-secret",
		SLACK_BOT_TOKEN: "xoxb-secret",
		LINEAR_API_KEY: "lin-secret-2",
		OPENFABRIQ_SENTRY_TOKEN: "sntryu-secret",
		SENTRY_AUTH_TOKEN: "sntryu-secret-2",
		GH_TOKEN: "ghp-secret",
		STRIPE_SECRET_KEY: "sk-secret",
		DATABASE_URL: "postgres://localhost/secret",
		REDIS: "redis://default:secret@cache:6379",
	});
	try {
		const env = credentialFreeEnv({ name: "T", email: "t@example.com" });
		expect(Object.values(env).join("\n")).not.toMatch(/secret/);
		expect(env.PATH).toBe(process.env.PATH);
	} finally {
		for (const key of Object.keys(process.env))
			if (!(key in saved)) delete process.env[key];
	}
});
