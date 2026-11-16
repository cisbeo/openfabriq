import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type LocalGit,
	projectDir,
	readFactoryFolder,
	writeApplied,
} from "@openfabriq/runner";
import { beforeEach, expect, it } from "vitest";
import {
	type ApplyDeps,
	applyBeforeStart,
	applyCommand,
	planCommand,
} from "../../src/commands/apply/index.js";
import { isYes } from "../../src/prompts.js";

const ROOT = join(import.meta.dirname, "../../../..");
const REPO = "acme/task-app";

let repoDir: string;
let calls: string[];
let deps: ApplyDeps;

function fakeGitHub(existing: string[]): ApplyDeps["github"] {
	return {
		defaultBranch: async () => "main",
		labels: async () => existing,
		createLabel: async (repo, name) => {
			calls.push(`label ${repo} ${name}`);
		},
		clone: async (repo, dir) => {
			calls.push(`clone ${repo}`);
			cpSync(join(ROOT, "README.md"), join(dir, "README.md"), {
				recursive: true,
			});
		},
	};
}

const cleanGit: LocalGit = {
	branch: async () => "main",
	dirty: async () => false,
	origin: async () => REPO,
};

beforeEach(() => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	repoDir = mkdtempSync(join(tmpdir(), "openfabriq-repo-"));
	cpSync(
		join(ROOT, "fixtures/valid/sdlc/openfabriq"),
		join(repoDir, "openfabriq"),
		{ recursive: true },
	);
	calls = [];
	deps = {
		github: fakeGitHub(["bug", "needs-info"]),
		git: cleanGit,
		confirm: async () => true,
		print: () => {},
	};
});

it("plans a first apply, then applies it: labels, clone and the factory copy", async () => {
	const first = await planCommand(repoDir, deps);
	expect(first.code).toBe(0);
	expect(first.output).toContain(
		"+ automation implement-ready-issues can now create_pull_request",
	);
	expect(first.output).toMatch(
		/Plan: 10 to add, 0 to change, 0 to remove, 4 labels to create\.$/,
	);

	const result = await applyCommand(repoDir, deps);
	expect(result.code).toBe(0);
	expect(calls).toEqual([
		`label ${REPO} needs-human`,
		`label ${REPO} needs-investigation`,
		`label ${REPO} openfabriq:working`,
		`label ${REPO} ready-for-agent`,
		`clone ${REPO}`,
	]);
	const home = process.env.OPENFABRIQ_HOME ?? "";
	const project = join(home, "projects/acme/task-app");
	expect(
		JSON.parse(readFileSync(join(project, "state.json"), "utf8")),
	).toMatchObject({ repository: REPO });
	expect(existsSync(join(project, "factory/agents/reviewer/agent.md"))).toBe(
		true,
	);
	expect(result.output).toContain(`Applied. ${REPO} runs this factory`);

	deps.github = fakeGitHub([
		"needs-info",
		"needs-investigation",
		"ready-for-agent",
		"needs-human",
		"openfabriq:working",
	]);
	expect((await planCommand(repoDir, deps)).output).toBe(
		"No changes. The factory matches what is applied.",
	);
	expect((await applyCommand(repoDir, deps)).output).toBe(
		"No changes. The factory matches what is applied.\n\nNothing to apply.",
	);
});

it("shows only the change on the next plan", async () => {
	await applyCommand(repoDir, deps);
	const automation = join(
		repoDir,
		"openfabriq/automations/rework-pull-requests/automation.md",
	);
	writeFileSync(
		automation,
		readFileSync(automation, "utf8").replace(
			"agent: rework",
			"agent: rework\nfrom: anyone",
		),
	);
	const next = await planCommand(repoDir, deps);
	expect(next.output).toContain(
		"+ automation rework-pull-requests now starts for anyone, not only maintainers",
	);
	expect(next.output).toContain(
		"~ rework-pull-requests: from maintainers → anyone",
	);
});

it("plans and applies a skill edit, and a file the plan does not describe", async () => {
	await applyCommand(repoDir, deps);
	const skill = join(
		repoDir,
		"openfabriq/skills/repository-conventions/SKILL.md",
	);
	writeFileSync(
		skill,
		`${readFileSync(skill, "utf8")}\nAlways run setup.sh.\n`,
	);
	writeFileSync(
		join(repoDir, "openfabriq/skills/repository-conventions/setup.sh"),
		"echo hi\n",
	);
	const next = await planCommand(repoDir, deps);
	expect(next.output).toContain(
		"~ skill file skills/repository-conventions/SKILL.md changed",
	);
	expect(next.output).toContain(
		"+ skill file skills/repository-conventions/setup.sh",
	);
	await applyCommand(repoDir, deps);
	expect((await planCommand(repoDir, deps)).output).not.toContain("skill file");

	deps.github = fakeGitHub([
		"needs-info",
		"needs-investigation",
		"ready-for-agent",
		"needs-human",
		"openfabriq:working",
	]);
	writeFileSync(join(repoDir, "openfabriq/README.md"), "notes\n");
	expect((await planCommand(repoDir, deps)).output).toContain(
		"+ file README.md",
	);
	expect((await applyCommand(repoDir, deps)).output).toContain("Applied.");
	expect((await applyCommand(repoDir, deps)).output).toContain(
		"Nothing to apply.",
	);
});

it("says why everything shows as new when the applied factory no longer loads", async () => {
	await applyCommand(repoDir, deps);
	const applied = join(
		process.env.OPENFABRIQ_HOME ?? "",
		"projects",
		REPO,
		"factory/automations/rework-pull-requests/automation.md",
	);
	writeFileSync(applied, readFileSync(applied, "utf8").replace("when:", "on:"));
	expect((await planCommand(repoDir, deps)).output).toContain(
		"! The factory applied now does not load with this version of openfabriq",
	);
});

it("writes nothing when the user declines", async () => {
	deps.confirm = async () => false;
	const result = await applyCommand(repoDir, deps);
	expect(result).toEqual({
		code: 1,
		output: expect.stringMatching(/Cancelled\. Nothing was applied\.$/),
	});
	expect(calls).toEqual([]);
});

it("prints the plan before it asks to apply it", async () => {
	const said: string[] = [];
	deps.print = (text) => said.push(`print ${text}`);
	deps.confirm = async (question) => {
		said.push(`ask ${question}`);
		return false;
	};
	await applyCommand(repoDir, deps);
	expect(said).toEqual([
		`print ${(await planCommand(repoDir, deps)).output}\n`,
		`ask Apply this plan to ${REPO}?`,
	]);
});

it("start applies what changed first, once the person says yes, and says nothing when it is applied", async () => {
	const elsewhere = mkdtempSync(join(tmpdir(), "openfabriq-elsewhere-"));
	expect(await applyBeforeStart(elsewhere, deps)).toBeUndefined();

	deps.confirm = async () => false;
	expect(await applyBeforeStart(repoDir, deps)).toBe(
		'Not applied: "start" runs the factory applied before, if any.',
	);
	expect(calls).toEqual([]);

	deps.confirm = async () => true;
	expect(await applyBeforeStart(repoDir, deps)).toBe(`Applied to ${REPO}.`);
	expect(calls).toContain(`clone ${REPO}`);

	deps.github = fakeGitHub([
		"needs-info",
		"needs-investigation",
		"ready-for-agent",
		"needs-human",
		"openfabriq:working",
	]);
	let asked = false;
	deps.confirm = async () => {
		asked = true;
		return true;
	};
	expect(await applyBeforeStart(repoDir, deps)).toBeUndefined();
	expect(asked).toBe(false);

	writeFileSync(join(repoDir, "openfabriq/factory.yaml"), "name: x\n");
	expect(await applyBeforeStart(repoDir, deps)).toMatch(
		/repository is required[\s\S]*Not applied: "start" runs the factory applied before, if any\.$/,
	);
});

it("refuses an invalid factory, and warns about an unmerged one", async () => {
	writeFileSync(join(repoDir, "openfabriq/factory.yaml"), "name: x\n");
	const invalid = await applyCommand(repoDir, deps);
	expect(invalid.code).toBe(1);
	expect(invalid.output).toContain("✗ factory.yaml: repository is required");

	cpSync(
		join(ROOT, "fixtures/valid/sdlc/openfabriq/factory.yaml"),
		join(repoDir, "openfabriq/factory.yaml"),
	);
	deps.git = {
		...cleanGit,
		branch: async () => "feature",
		dirty: async () => true,
	};
	const warned = await planCommand(repoDir, deps);
	expect(warned.output).toContain('! You are on branch "feature", not main');
	expect(warned.output).toContain("! openfabriq/ has uncommitted changes");
});

// The relay, the Linear app and the Slack bot are one per machine: what comes through them goes to
// every factory that declares it.
function anotherProject(extra: string) {
	const files = readFactoryFolder(join(ROOT, "fixtures/valid/sdlc/openfabriq"));
	writeApplied("acme/other", {
		...files,
		"factory.yaml": `name: Other\nrepository: acme/other\nmaintainers: [bob]\n${extra}`,
	});
}
const addToFactory = (extra: string) => {
	const path = join(repoDir, "openfabriq/factory.yaml");
	writeFileSync(path, `${readFileSync(path, "utf8")}\n${extra}`);
};

it("refuses a webhook name another project of this machine declares", async () => {
	const webhook = "webhooks:\n  deploy-failed:\n    signature: standard\n";
	anotherProject(webhook);
	addToFactory(webhook);
	const refused = await applyCommand(repoDir, deps);
	expect(refused.code).toBe(1);
	expect(refused.output).toContain(
		"✗ The webhook deploy-failed is also declared by acme/other",
	);
	expect(calls).toEqual([]);
	expect((await planCommand(repoDir, deps)).code).toBe(1);
});

it("warns when another project has the same Linear team or Slack channel", async () => {
	anotherProject(
		"integrations:\n  linear:\n    team: eng\n  slack:\n    channel: Factory\n",
	);
	addToFactory(
		"integrations:\n  linear:\n    team: ENG\n  slack:\n    channel: factory\n",
	);
	const planned = await planCommand(repoDir, deps);
	expect(planned.code).toBe(0);
	expect(planned.output).toContain(
		"! The Linear team ENG is also the team of acme/other: its issues start runs in both factories.",
	);
	expect(planned.output).toContain(
		"! The Slack channel #factory is also the channel of acme/other: a mention starts a run in both factories.",
	);
});

it("warns in a fixed order: shared integrations, origin, branch, uncommitted changes, then the format", async () => {
	await applyCommand(repoDir, deps);
	const applied = join(
		process.env.OPENFABRIQ_HOME ?? "",
		"projects",
		REPO,
		"factory/automations/rework-pull-requests/automation.md",
	);
	writeFileSync(applied, readFileSync(applied, "utf8").replace("when:", "on:"));
	anotherProject(
		"integrations:\n  linear:\n    team: eng\n  slack:\n    channel: factory\n",
	);
	addToFactory(
		"integrations:\n  linear:\n    team: ENG\n  slack:\n    channel: factory\n",
	);
	deps.git = {
		branch: async () => "feature",
		dirty: async () => true,
		origin: async () => "acme/web-app",
	};
	const planned = await planCommand(repoDir, deps);
	expect(planned.code).toBe(0);
	expect(planned.output.split("\n\n")[0]).toBe(
		[
			"! The Linear team ENG is also the team of acme/other: its issues start runs in both factories.",
			"! The Slack channel #factory is also the channel of acme/other: a mention starts a run in both factories.",
			"! factory.yaml names acme/task-app, but this checkout's origin is acme/web-app.",
			'! You are on branch "feature", not main: apply what is merged.',
			"! openfabriq/ has uncommitted changes.",
			"! The factory applied now does not load with this version of openfabriq (its format changed): everything shows as new.",
		].join("\n"),
	);
});

it("takes y or yes, whatever the case, as a yes, and anything else, Enter alone too, as a no", () => {
	for (const yes of ["y", "Y", "yes", " YES "]) expect(isYes(yes)).toBe(true);
	for (const no of ["", "n", "no", "yep", "oui"]) expect(isYes(no)).toBe(false);
});

it("says to restart start when the integrations changed, and only then", async () => {
	const first = await applyCommand(repoDir, deps);
	expect(first.output).not.toContain("integrations changed");
	const factoryFile = join(repoDir, "openfabriq/factory.yaml");
	writeFileSync(
		factoryFile,
		`${readFileSync(factoryFile, "utf8")}\nintegrations:\n  slack:\n    channel: factory\n`,
	);
	const second = await applyCommand(repoDir, deps);
	expect(second.output).toContain("Its integrations changed");
});

it("refuses a factory.yaml that names another repository than the one given: a server applies what each repository says", async () => {
	const result = await applyCommand(repoDir, deps, true, "acme/web-app");
	expect(result).toEqual({
		code: 1,
		output:
			"✗ factory.yaml names acme/task-app, not acme/web-app, the repository it was taken from. Nothing was applied.",
	});
	expect(calls).toEqual([]);
	expect(existsSync(join(projectDir(REPO), "factory"))).toBe(false);
	expect((await applyCommand(repoDir, deps, true, "Acme/Task-App")).code).toBe(
		0,
	);
});

it("with --yes, refuses a factory.yaml that names another repository than the checkout's origin, and warns without it", async () => {
	deps.git = { ...cleanGit, origin: async () => "acme/web-app" };
	expect(await applyCommand(repoDir, deps, true)).toEqual({
		code: 1,
		output:
			"✗ factory.yaml names acme/task-app, but this checkout's origin is acme/web-app. Nothing was applied: give the repository with --project to apply it anyway.",
	});
	expect(calls).toEqual([]);
	// Asked first: the plan says it, and a person decides (a fork's checkout, for example).
	expect((await planCommand(repoDir, deps)).output).toContain(
		"! factory.yaml names acme/task-app, but this checkout's origin is acme/web-app.",
	);
	expect((await applyCommand(repoDir, deps, true, REPO)).code).toBe(0);
	// No origin to compare with (not a git checkout): as before.
	deps.git = { ...cleanGit, origin: async () => undefined };
	expect((await applyCommand(repoDir, deps, true)).code).toBe(0);
});

it("says to set repository when gh finds no such repository, as with the examples' acme/web-app", async () => {
	const notFound = async () => {
		throw new Error(`gh api repos/${REPO}: gh: Not Found (HTTP 404)`);
	};
	deps.github = { ...deps.github, labels: notFound, defaultBranch: notFound };
	const result = await planCommand(repoDir, deps);
	expect(result).toEqual({
		code: 1,
		output: `✗ gh finds no repository ${REPO}: set repository in factory.yaml to yours (owner/name), one the account of "gh auth status" can read.`,
	});
});
