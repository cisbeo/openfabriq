import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadFactory } from "@openfabriq/core";
import { beforeEach, describe, expect, it } from "vitest";
import { runEnv } from "../../src/agent/env.js";
import { agentMcp } from "../../src/agent/mcp.js";
import {
	envLine,
	factorySecretsDir,
	factorySecretsPath,
	looseFactorySecrets,
	parseSecrets,
	readFactorySecrets,
	secretValues,
	withSecretLine,
	writeFactorySecret,
} from "../../src/state/factory-secrets.js";

beforeEach(() => {
	process.env.OPENFABRIQ_HOME = join(
		mkdtempSync(join(tmpdir(), "openfabriq-home-")),
		"not-yet",
	);
});

describe("the project's secrets file", () => {
	it("lives in one folder for all projects, never outside it", () => {
		expect(factorySecretsPath("acme/app")).toBe(
			join(factorySecretsDir(), "acme", "app.env"),
		);
		for (const bad of [
			"acme",
			"acme/app/x",
			"../app",
			"acme/..",
			"/app",
			"acme/",
		])
			expect(() => factorySecretsPath(bad)).toThrow("is not owner/repo");
	});

	it("is written readable by the user only, in a folder closed to others", () => {
		writeFactorySecret("acme/app", "DATABASE_URL", "postgres://u:p@db/test");
		writeFactorySecret("acme/app", "STRIPE_KEY", "sk_test_1");
		const path = factorySecretsPath("acme/app");
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
		expect(statSync(factorySecretsDir()).mode & 0o777).toBe(0o700);
		expect(readFactorySecrets("acme/app")).toEqual({
			DATABASE_URL: "postgres://u:p@db/test",
			STRIPE_KEY: "sk_test_1",
		});
		expect(looseFactorySecrets("acme/app")).toBe(false);
		expect(readFactorySecrets("acme/other")).toEqual({});
	});

	it("reads back every value exactly, and never writes one that would add a line", () => {
		for (const value of [
			"plain",
			"with space",
			"a#b",
			"$HOME x",
			"it's",
			'say "hi"',
			"\\n stays",
			"it's \\n",
			"=x=",
			"abc==",
			"x?y=1&z=2",
			"  padded  ",
		]) {
			const line = envLine("K", value);
			if (line) {
				writeFactorySecret("acme/app", "K", value);
				expect(readFactorySecrets("acme/app").K).toBe(value);
			} else expect(value).toBe("never");
		}
		expect(envLine("K", "a\nGH_TOKEN=x")).toBeUndefined();
		expect(envLine("K", "a\rb")).toBeUndefined();
		expect(envLine("K", `'"`)).toBeUndefined();
		expect(envLine("1K", "x")).toBeUndefined();
		expect(() => writeFactorySecret("acme/app", "K", "a\nb")).toThrow(
			"cannot be written",
		);
	});

	it("takes the engine's environment first, then the file", () => {
		writeFactorySecret("acme/app", "A", "file-a");
		writeFactorySecret("acme/app", "B", "file-b");
		expect(
			secretValues("acme/app", ["A", "B", "C"], { A: "env-a", OTHER: "x" }),
		).toEqual({ A: "env-a", B: "file-b" });
	});

	it("notices a file others can read", () => {
		const path = factorySecretsPath("acme/app");
		writeFactorySecret("acme/app", "A", "x");
		chmodSync(path, 0o644);
		expect(looseFactorySecrets("acme/app")).toBe(true);
	});
});

it("reads a file written by hand, and names the lines it cannot read", () => {
	expect(
		parseSecrets(
			"\uFEFF# test values only\n\nA=plain\nexport B='it has = and #'\nC=\"double\" # a note\n  D = spaced\nnot a line\nE=\nF='a=b'\nG='never closed\nH=raw # comment\nconstructor=x\n",
		),
	).toEqual({
		values: Object.assign(Object.create(null), {
			A: "plain",
			B: "it has = and #",
			C: "double",
			D: "spaced",
			E: "",
			F: "a=b",
			H: "raw",
			constructor: "x",
		}),
		bad: [7, 10],
	});
});

it("keeps comments and other lines when it sets a value, and never rewrites a file it cannot read", () => {
	const path = factorySecretsPath("acme/app");
	writeFactorySecret("acme/app", "A", "1");
	writeFileSync(path, "# keep me\nA='1'\nB=2 # note\nA='dup'\n");
	writeFactorySecret("acme/app", "A", "new");
	expect(readFileSync(path, "utf8")).toBe("# keep me\nA='new'\nB=2 # note\n");
	writeFileSync(path, "A='1'\nnot a line\n");
	expect(() => writeFactorySecret("acme/app", "B", "2")).toThrow(
		"has lines that do not read (line 2)",
	);
	expect(readFileSync(path, "utf8")).toBe("A='1'\nnot a line\n");
});

it("sets a value's line in the file's text: the first of its name, the others gone, or at the end", () => {
	expect(withSecretLine("", "A", "A='1'")).toBe("A='1'\n");
	expect(withSecretLine("# notes\r\nB=2\r\n", "A", "A='1'")).toBe(
		"# notes\nB=2\nA='1'\n",
	);
	expect(
		withSecretLine("export A=0\nB=2\n A = 'x' # old\nC=3", "A", "A='1'"),
	).toBe("A='1'\nB=2\nC=3\n");
	// A comment or another name that starts the same is not this name.
	expect(withSecretLine("# A=0\nAB=1\n\n", "A", "A='1'")).toBe(
		"# A=0\nAB=1\n\nA='1'\n",
	);
});

it("finds nothing it was not given, even for a name of Object", () => {
	expect(secretValues("acme/app", ["constructor", "toString"], {})).toEqual(
		Object.create(null),
	);
});

describe("who gets the values", () => {
	const { factory, problems } = loadFactory({
		"factory.yaml":
			"name: F\nrepository: acme/app\nmaintainers: [alice]\nenv:\n  NODE_ENV: test\nsecrets: [DB, ABSENT]\nmcp:\n  sentry:\n    url: https://mcp.sentry.dev/mcp\n    secret: PLAIN_NAME\n",
		"agents/worker/agent.md":
			"---\ndescription: Works\nmcp:\n  sentry: [get_issue]\n---\nWork.\n",
		"automations/a/automation.md":
			"---\nwhen: issue.opened\nagent: worker\n---\nGo.\n",
	});
	if (!factory) throw new Error(JSON.stringify(problems));
	const identity = { name: "F", email: "f@x" };

	it("gives the commands their secrets from the file, the agent none, the server its own", async () => {
		writeFactorySecret("acme/app", "DB", "db-value");
		writeFactorySecret("acme/app", "PLAIN_NAME", "mcp-value");
		// In the engine's environment, a server's secret with a plain name would pass the filter.
		process.env.PLAIN_NAME = "mcp-env";
		const env = runEnv(identity, factory, { PLAIN_NAME: "mcp-env" });
		delete process.env.PLAIN_NAME;
		expect(env.command.DB).toBe("db-value");
		expect(env.command.PLAIN_NAME).toBeUndefined();
		expect(env.agent.DB).toBeUndefined();
		expect(env.agent.PLAIN_NAME).toBeUndefined();
		expect(env.agent.NODE_ENV).toBe("test");
		expect(env.variables).toEqual({
			env: ["NODE_ENV"],
			secrets: ["DB"],
			missing: ["ABSENT"],
		});
		const mcp = await agentMcp(
			factory.agents.worker as never,
			factory,
			env.agent,
			async (command) => command,
			{},
		);
		expect(mcp?.servers.sentry).toEqual({
			type: "http",
			url: "https://mcp.sentry.dev/mcp",
			headers: { Authorization: "Bearer mcp-value" },
		});
	});
});
