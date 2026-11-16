import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadApplied,
	readFactoryFolder,
	writeApplied,
	writeFactorySecret,
	writeSecrets,
} from "@openfabriq/runner";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { settingsOf as settingsFor } from "../../src/settings/settings.js";

// The route gives the view the applied factory and its files; none applied, no settings.
const settingsOf = async (repository: string) => {
	const applied = loadApplied(repository);
	return (
		applied?.factory &&
		settingsFor(repository, applied.factory, applied.files["factory.yaml"])
	);
};

const REPO = "acme/task-app";

beforeAll(() => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	const files = readFactoryFolder(
		join(import.meta.dirname, "../../../../fixtures/valid/sdlc/openfabriq"),
	);
	files["factory.yaml"] += `
setup: npm ci
env:
  NODE_ENV: test
secrets: [DATABASE_URL, STRIPE_KEY]
integrations:
  slack:
    channel: "#factory"
mcp:
  docs:
    url: https://mcp.example.com/mcp
    secret: DOCS_TOKEN
`;
	writeApplied(REPO, files);
	writeFactorySecret(REPO, "DATABASE_URL", "postgres://u:hunter2@db/app");
	writeSecrets("slack", { bot_token: "xoxb-very-secret" });
});

it("gives the factory's settings, without its agents and automations", async () => {
	const settings = await settingsOf(REPO);
	expect(settings).toMatchObject({
		name: "Task app factory",
		repository: REPO,
		maintainers: ["ada"],
		limits: { usd_per_run: 5, usd_per_day: 30 },
		setup: ["npm ci"],
		env: { NODE_ENV: "test" },
		slack: { channel: "factory" },
		mcp: { docs: { url: "https://mcp.example.com/mcp", secret: "DOCS_TOKEN" } },
	});
	expect(settings?.yaml).toContain("secrets: [DATABASE_URL, STRIPE_KEY]");
	expect(settings).not.toHaveProperty("agents");
	expect(settings).not.toHaveProperty("automations");
});

it("says which secrets and tokens are set on this machine, never their values", async () => {
	const settings = await settingsOf(REPO);
	expect(settings?.ready).toEqual({
		secrets: { DATABASE_URL: true, STRIPE_KEY: false, DOCS_TOKEN: false },
		relayNeeded: false,
		relay: false,
		slack: true,
		linear: false,
		sentry: false,
	});
	const text = JSON.stringify(settings);
	expect(text).not.toContain("hunter2");
	expect(text).not.toContain("xoxb");
});

it("has nothing for a project without an applied factory", async () => {
	expect(await settingsOf("someone/else")).toBeUndefined();
});

afterEach(() => vi.unstubAllGlobals());

it("asks the relay whether Linear is installed, since its tokens live there", async () => {
	const LINEAR = "acme/linear-app";
	const files = readFactoryFolder(
		join(import.meta.dirname, "../../../../fixtures/valid/sdlc/openfabriq"),
	);
	files["factory.yaml"] += "\nintegrations:\n  linear:\n    team: ENG\n";
	writeApplied(LINEAR, files);
	writeSecrets("relay", { url: "https://relay.example.com", token: "t" });
	const install = {
		organizationId: "o",
		accessToken: "lin",
		expiresAt: Date.now() + 3_600_000,
	};
	vi.stubGlobal("fetch", async () =>
		Response.json({ organizations: [install] }),
	);
	expect((await settingsOf(LINEAR))?.ready.linear).toBe(true);
	vi.stubGlobal("fetch", async () => Response.json({ organizations: [] }));
	expect((await settingsOf(LINEAR))?.ready.linear).toBe(false);
	vi.stubGlobal("fetch", async () => new Response("", { status: 401 }));
	expect((await settingsOf(LINEAR))?.ready.linear).toBe(false);
	expect(JSON.stringify(await settingsOf(LINEAR))).not.toContain('lin"');
});
