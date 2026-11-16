import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentLauncher } from "@openfabriq/runner";
import { beforeAll, expect, it } from "vitest";
import { settled, testEngine } from "../support/engine.js";
import { fakeGitHub } from "../support/github.js";
import { freshHome } from "../support/home.js";
import { ROOT } from "../support/paths.js";
import { fakeCommands, session } from "../support/terminal.js";

// A factory ordered by area, from the built CLI to a run: validate, a duplicate name refused,
// apply, a move shown on one line, a manual run asked, then the engine runs an automation of a
// area with that area's skills and signs with a link to the file where it really is.

const REPO = "acme/app";
const commands = fakeCommands();
let home: string;
let repo: string;
let origin: string;

const git = (cwd: string, ...args: string[]) =>
	execFileSync(
		"git",
		["-c", "user.name=e2e", "-c", "user.email=e2e@example.com", ...args],
		{ cwd, stdio: "pipe" },
	);

beforeAll(() => {
	home = freshHome();
	writeFileSync(join(home, "prerequisites-checked"), "e2e\n");
	repo = mkdtempSync(join(tmpdir(), "openfabriq-e2e-repo-"));
	cpSync(
		join(ROOT, "fixtures/valid/areas/openfabriq"),
		join(repo, "openfabriq"),
		{ recursive: true },
	);
	const factory = join(repo, "openfabriq/factory.yaml");
	writeFileSync(
		factory,
		readFileSync(factory, "utf8").replace(
			/^repository: .*$/m,
			`repository: ${REPO}`,
		),
	);
	git(repo, "init", "--quiet", "--initial-branch=main");
	git(repo, "add", ".");
	git(repo, "commit", "--quiet", "-m", "factory");
	origin = mkdtempSync(join(tmpdir(), "openfabriq-e2e-origin-"));
	git(origin, "init", "--quiet", "--bare", "--initial-branch=main");
	git(repo, "push", "--quiet", origin, "main");
});

const run = (args: string[]) =>
	session(args, {
		path: commands.dir,
		env: { E2E_REPOSITORY: REPO, E2E_ORIGIN: origin },
	});

it("validate: counts the agents and automations of every area", async () => {
	const { code, output } = await run(["validate", repo]).done();
	expect(code).toBe(0);
	expect(output).toContain("is valid: 3 agents, 4 automations");
});

it("validate: refuses an agent named like one of another area, naming both folders", async () => {
	const copy = join(repo, "openfabriq/qa/agents/auditor");
	cpSync(join(repo, "openfabriq/security/agents/auditor"), copy, {
		recursive: true,
	});
	try {
		const { code, output } = await run(["validate", repo]).done();
		expect(code).toBe(1);
		expect(output).toContain(
			"security/agents/auditor: an agent named auditor is already in qa/agents/auditor",
		);
	} finally {
		rmSync(copy, { recursive: true });
	}
});

it("apply: copies the areas' folders into the applied factory", async () => {
	const { code, output } = await run(["apply", "--yes", repo]).done();
	expect(code).toBe(0);
	expect(output).toContain("Applied.");
	const applied = join(home, "projects", REPO, "factory");
	expect(existsSync(join(applied, "qa/agents/tester/agent.md"))).toBe(true);
	expect(existsSync(join(applied, "security/skills/owasp/SKILL.md"))).toBe(
		true,
	);
});

it("plan: an agent moved out of its area on one line, and nothing else", async () => {
	const factory = join(repo, "openfabriq");
	renameSync(join(factory, "qa/agents/tester"), join(factory, "agents/tester"));
	git(repo, "add", "-A");
	git(repo, "commit", "--quiet", "-m", "move tester");
	try {
		const { code, output } = await run(["plan", repo]).done();
		expect(code).toBe(0);
		expect(output).toContain("~ tester: moved to agents/tester");
		expect(output).not.toContain("Security changes");
		expect(output).toMatch(/Plan: 0 to add, 1 to change, 0 to remove/);
	} finally {
		renameSync(
			join(factory, "agents/tester"),
			join(factory, "qa/agents/tester"),
		);
		git(repo, "add", "-A");
		git(repo, "commit", "--quiet", "-m", "move tester back");
	}
	expect((await run(["plan", repo]).done()).output).toBe(
		"No changes. The factory matches what is applied.",
	);
});

it("run: asks for a manual run of an automation in an area", async () => {
	const { code, output } = await run(["run", "nightly-audit"]).done();
	expect(code).toBe(0);
	expect(output).toContain("Asked: a manual run of nightly-audit on acme/app");
});

it("the engine runs it with its area's skills, and its issue links to the file in its area", async () => {
	const { github } = fakeGitHub();
	const bodies: string[] = [];
	github.createIssue = async (_repo, created) => {
		bodies.push(created.body);
		return "https://github.com/acme/app/issues/1";
	};
	let skills: string[] = [];
	const launch: AgentLauncher = async (agentRun) => {
		skills = agentRun.plugin
			? readdirSync(join(agentRun.plugin, "skills")).sort()
			: [];
		agentRun.outputs.propose({
			action: "create_issue",
			title: "Audit",
			body: "Nothing found.",
		});
		return {
			status: "succeeded",
			costUsd: 0,
			turns: 1,
			tokens: { input: 0, output: 0 },
		};
	};
	const engine = testEngine(github, launch);
	engine.start();
	const runs = await settled(engine, REPO, 1);
	engine.stop();
	expect(runs[0]).toMatchObject({
		automation: "nightly-audit",
		agent: "auditor",
		status: "succeeded",
	});
	expect(skills).toEqual(["conventions", "owasp", "report"]);
	expect(bodies[0]).toContain(
		"(https://github.com/acme/app/blob/main/openfabriq/security/automations/nightly-audit/automation.md)",
	);
});
