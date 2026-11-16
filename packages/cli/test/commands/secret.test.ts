import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	factorySecretsPath,
	readFactorySecrets,
	writeApplied,
} from "@openfabriq/runner";
import { beforeEach, expect, it } from "vitest";
import { secretCommand } from "../../src/commands/secret.js";

const factory = (repository: string, yaml: string) => ({
	"factory.yaml": `name: F\nrepository: ${repository}\nmaintainers: [alice]\n${yaml}`,
	"agents/worker/agent.md": "---\ndescription: Works\n---\nWork.\n",
	"automations/a/automation.md":
		"---\nwhen: issue.opened\nagent: worker\n---\nGo.\n",
});

beforeEach(() => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	writeApplied("acme/app", factory("acme/app", "secrets: [DATABASE_URL]\n"));
	writeApplied(
		"acme/web",
		factory(
			"acme/web",
			"secrets: [DATABASE_URL]\nmcp:\n  docs:\n    url: https://docs.dev/mcp\n    secret: DOCS_TOKEN\n",
		),
	);
});

const asked: string[] = [];
const answer =
	(value: string) =>
	async (question: string, options: { secret?: boolean }) => {
		asked.push(question);
		expect(options.secret).toBe(true);
		return value;
	};

it("keeps a declared secret for its project, readable by the user only", async () => {
	const result = await secretCommand(
		{ action: "set", name: "DOCS_TOKEN" },
		{ ask: answer(" tok=en== \n"), env: {} },
	);
	expect(result).toEqual({
		code: 0,
		output: `Saved DOCS_TOKEN for acme/web in ${factorySecretsPath("acme/web")}, readable by you only. The next run uses it.`,
	});
	expect(readFactorySecrets("acme/web")).toEqual({ DOCS_TOKEN: "tok=en==" });
	expect(statSync(factorySecretsPath("acme/web")).mode & 0o777).toBe(0o600);
	expect(asked.at(-1)).toContain("never a production one");

	const shadowed = await secretCommand(
		{ action: "set", name: "DATABASE_URL", project: "acme/app" },
		{ ask: answer("postgres://localhost/test"), env: { DATABASE_URL: "x" } },
	);
	expect(shadowed.output).toContain(
		"the engine's environment also has DATABASE_URL",
	);
});

it("refuses what it cannot place, never asking the value first", async () => {
	asked.length = 0;
	const set = (name: string | undefined, project?: string) =>
		secretCommand(
			{ action: "set", name, ...(project ? { project } : {}) },
			{ ask: answer("v"), env: {} },
		).then((r) => r.output);
	expect(await set(undefined)).toBe(
		"Usage: openfabriq secret set <NAME> [--project owner/repo]",
	);
	expect(await set("GH_TOKEN")).toBe(
		"GH_TOKEN belongs to the engine; a factory never receives it.",
	);
	expect(await set("UNDECLARED")).toContain(
		"No applied factory names UNDECLARED in secrets or in an MCP server",
	);
	expect(await set("DATABASE_URL")).toBe(
		"DATABASE_URL is a secret of acme/app and acme/web: pass --project owner/repo.",
	);
	expect(await set("DATABASE_URL", "../../etc")).toBe(
		'../../etc is not applied on this machine. Run "openfabriq apply" in its repository first.',
	);
	expect(await set("DOCS_TOKEN", "acme/app")).toContain(
		"No applied factory of acme/app names DOCS_TOKEN",
	);
	expect(
		(
			await secretCommand(
				{ action: "set", name: "DOCS_TOKEN", extra: ["tok"] },
				{ ask: answer("v"), env: {} },
			)
		).output,
	).toContain("Never give a value as an argument");
	expect(asked).toEqual([]);
	expect(
		(
			await secretCommand(
				{ action: "list", name: "X" },
				{ ask: answer("v"), env: {} },
			)
		).code,
	).toBe(1);
});

it("names the project when none or several declare the secret", async () => {
	const set = (name: string, project?: string) =>
		secretCommand(
			{ action: "set", name, ...(project ? { project } : {}) },
			{ ask: answer("v"), env: {} },
		);
	expect(await set("DATABASE_URL")).toEqual({
		code: 1,
		output:
			"DATABASE_URL is a secret of acme/app and acme/web: pass --project owner/repo.",
	});
	expect(await set("DOCS_TOKEN", "acme/app")).toEqual({
		code: 1,
		output:
			'No applied factory of acme/app names DOCS_TOKEN in secrets or in an MCP server. Declare it in factory.yaml, then run "openfabriq apply".',
	});
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	expect(await set("DOCS_TOKEN")).toEqual({
		code: 1,
		output:
			'No applied factory names DOCS_TOKEN in secrets or in an MCP server. Declare it in factory.yaml, then run "openfabriq apply".',
	});
	expect(await set("DOCS_TOKEN", "acme/web")).toEqual({
		code: 1,
		output:
			'acme/web is not applied on this machine. Run "openfabriq apply" in its repository first.',
	});
});

it("refuses an empty value, or one the file cannot hold", async () => {
	const set = (value: string) =>
		secretCommand(
			{ action: "set", name: "DOCS_TOKEN" },
			{ ask: answer(value), env: {} },
		).then((r) => r.output);
	expect(await set("   ")).toBe("No value given: nothing saved.");
	expect(await set(`it's "both"`)).toContain("cannot be written to the file");
	expect(readFactorySecrets("acme/web")).toEqual({});
});

it("finds the project --project names whatever its case, and writes the applied one's file", async () => {
	const result = await secretCommand(
		{ action: "set", name: "DATABASE_URL", project: "ACME/Web" },
		{ ask: answer("postgres://localhost/test"), env: {} },
	);
	expect(result.output).toBe(
		`Saved DATABASE_URL for acme/web in ${factorySecretsPath("acme/web")}, readable by you only. The next run uses it.`,
	);
	expect(readFactorySecrets("acme/web")).toEqual({
		DATABASE_URL: "postgres://localhost/test",
	});
});
