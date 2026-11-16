import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectDir, recordRefusals } from "@openfabriq/runner";
import { expect, it } from "vitest";
import { doctorCommand } from "../../src/commands/doctor.js";

const examples = join(import.meta.dirname, "../../../../examples");

/** A machine where claude, gh and git are ready, and only the programs named exist. */
const machine =
	(programs: string[]) => async (command: string, args: string[]) => {
		if (command === "sh" && !programs.includes(args.at(-1) ?? ""))
			throw new Error("sh: exit 1");
		return "";
	};

it("says which program of the factory is missing, and which lines run it", async () => {
	const result = await doctorCommand(
		join(examples, "25-wordpress-maintenance"),
		machine(["find"]),
		"darwin",
	);
	expect(result.code).toBe(1);
	expect(result.output).toContain(
		"✗ composer is not installed: setup, command outdated and command update run it",
	);
	expect(result.output).toContain("✓ found find");
	expect(result.output).not.toContain("bubblewrap");
});

it("says a skill is ready when every program it installs is there, without repeating its needs", async () => {
	const result = await doctorCommand(
		join(examples, "02-sdlc"),
		machine(["npm", "agent-browser"]),
		"darwin",
	);
	expect(result.code).toBe(0);
	expect(result.output).toContain(
		"✓ skills/browser-evidence: agent-browser is installed",
	);
	expect(result.output).not.toContain("! skills/browser-evidence");
	expect(result.output).toContain("This machine has the programs");
});

it("looks up the program a skill installs, and fails without it", async () => {
	const result = await doctorCommand(
		join(examples, "09-ui-check"),
		machine(["pnpm"]),
		"darwin",
	);
	expect(result.code).toBe(1);
	expect(result.output).toContain(
		"✗ agent-browser is not installed: skills/browser-evidence runs it",
	);
	// Missing: the skill's own words say how to install it.
	expect(result.output).toContain(
		"! skills/browser-evidence: Needs agent-browser and Playwright's headless Chrome",
	);
});

it("checks the Linux sandbox's tools on Linux", async () => {
	const result = await doctorCommand(
		join(examples, "02-sdlc"),
		machine(["npm", "agent-browser", "bwrap"]),
		"linux",
	);
	expect(result.code).toBe(1);
	expect(result.output).toContain(
		"✗ The sandbox of the agents' shell and the commands needs socat and ripgrep: sudo apt install socat ripgrep",
	);
});

it("checks the machine alone outside a factory", async () => {
	const result = await doctorCommand(
		mkdtempSync(join(tmpdir(), "openfabriq-doctor-")),
		machine([]),
		"darwin",
	);
	expect(result.code).toBe(1);
	expect(result.output).toContain(
		"✓ Claude Code, the GitHub CLI and git are ready",
	);
	expect(result.output).toContain("No factory in");
});

it("names a secret the factory declares and this machine does not have, without failing", async () => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	const result = await doctorCommand(
		join(examples, "23-sentry-autofix"),
		machine(["pnpm", "agent-browser"]),
		"darwin",
	);
	expect(result.code).toBe(0);
	expect(result.output).toContain(
		'! acme/web-app: MCP_SENTRY_TOKEN not set on this machine; the commands or MCP servers that need it will fail. Set it with "openfabriq secret set MCP_SENTRY_TOKEN"',
	);
});

it("names the sites the factory calls and its network does not reach, and those its last runs were refused", async () => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	const repo = mkdtempSync(join(tmpdir(), "openfabriq-doctor-"));
	mkdirSync(join(repo, "openfabriq/agents/worker"), { recursive: true });
	mkdirSync(join(repo, "openfabriq/automations/go"), { recursive: true });
	writeFileSync(
		join(repo, "openfabriq/factory.yaml"),
		"name: F\nrepository: acme/app\nmaintainers: [alice]\ncommands:\n  pay: curl https://api.stripe.com/v1/x\n",
	);
	writeFileSync(
		join(repo, "openfabriq/agents/worker/agent.md"),
		"---\ndescription: Works\ntools: [read, commands]\n---\nWork.\n",
	);
	writeFileSync(
		join(repo, "openfabriq/automations/go/automation.md"),
		"---\nwhen: issue.opened\nagent: worker\n---\nGo.\n",
	);
	const run = join(projectDir("acme/app"), "runs", "run-1");
	mkdirSync(run, { recursive: true });
	recordRefusals(run, "command", ["hooks.slack.com"]);
	const result = await doctorCommand(repo, machine(["curl"]), "darwin");
	expect(result.code).toBe(0);
	expect(result.output).toContain(
		"! api.stripe.com is in command pay, but network does not reach it: add it to network if the factory calls it",
	);
	expect(result.output).toContain(
		"! hooks.slack.com was refused in 1 of the last runs (latest: run-1): add it to network if the factory needs it",
	);
});

it("says the network reaches every site a template calls", async () => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	const result = await doctorCommand(
		join(examples, "25-wordpress-maintenance"),
		machine(["composer", "find", "php", "curl", "xargs"]),
		"darwin",
	);
	expect(result.output).toContain(
		"✓ network reaches every site the factory names, and no site was refused in its last runs",
	);
});

it("as a GitHub App, says whether it is installed on the factory's repository", async () => {
	const app = (installed: boolean) => ({
		login: async () => "openfabriq-acme[bot]",
		installed: async () => installed,
		installUrl: async () =>
			"https://github.com/apps/openfabriq-acme/installations/new",
	});
	const dir = join(examples, "02-sdlc");
	const there = await doctorCommand(
		dir,
		machine(["npm", "agent-browser"]),
		"darwin",
		app(true),
	);
	expect(there.code).toBe(0);
	expect(there.output).toMatch(
		/✓ GitHub: the engine works as the app openfabriq-acme\[bot\], installed on \S+\/\S+/,
	);
	const missing = await doctorCommand(
		dir,
		machine(["npm", "agent-browser"]),
		"darwin",
		app(false),
	);
	expect(missing.code).toBe(1);
	expect(missing.output).toContain("is not installed on");
	expect(missing.output).toContain(
		"install it at https://github.com/apps/openfabriq-acme/installations/new",
	);
});
