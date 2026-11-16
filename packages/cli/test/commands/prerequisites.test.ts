import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, it } from "vitest";
import {
	checkPrerequisites,
	GH_LOGIN,
	missingPrerequisites,
} from "../../src/commands/prerequisites.js";

beforeEach(() => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(
		join(tmpdir(), "openfabriq-prerequisites-"),
	);
});

/** A machine where the commands named fail, as exec rejects: ENOENT when not installed. */
const machine =
	(failing: Record<string, "ENOENT" | "exit 1">) =>
	async (command: string, args: string[]) => {
		const key = `${command} ${args.join(" ")}`;
		const why = failing[key] ?? failing[command];
		if (why === "ENOENT") throw new Error(`${key}: spawn ${command} ENOENT`);
		if (why) throw new Error(`${key}: not logged in`);
		return "";
	};

it("finds nothing missing when claude and gh are logged in and git knows the user", async () => {
	expect(await missingPrerequisites(machine({}))).toEqual([]);
});

it("says exactly what is missing, with the command that fixes it", async () => {
	expect(
		await missingPrerequisites(
			machine({
				claude: "exit 1",
				gh: "ENOENT",
				"git config --get user.email": "exit 1",
			}),
		),
	).toEqual([
		"Claude Code is not logged in: run claude auth login (or set ANTHROPIC_API_KEY on a server)",
		"The GitHub CLI is not installed: brew install gh (or see https://cli.github.com), then run gh auth login",
		"git has no email for your commits: run git config --global user.email you@example.com",
	]);
	expect(
		await missingPrerequisites(
			machine({ claude: "ENOENT", gh: "exit 1", git: "ENOENT" }),
		),
	).toEqual([
		"Claude Code is not installed: see https://claude.com/claude-code, then run claude auth login",
		GH_LOGIN,
		"git is not installed: see https://git-scm.com",
	]);
});

it("as a GitHub App, wants gh installed but neither its login nor git's user", async () => {
	expect(
		await missingPrerequisites(
			machine({
				"gh auth status --hostname github.com": "exit 1",
				"git config --get user.name": "exit 1",
				"git config --get user.email": "exit 1",
			}),
			true,
		),
	).toEqual([]);
	expect(await missingPrerequisites(machine({ gh: "ENOENT" }), true)).toEqual([
		"The GitHub CLI is not installed: brew install gh (or see https://cli.github.com), then run gh auth login",
	]);
});

const quiet = {
	interactive: false,
	confirm: async () => false,
	ghLogin: async () => {},
};

it("stops the command until all is there, then does not check again", async () => {
	const refused = await checkPrerequisites({
		...quiet,
		run: machine({ claude: "exit 1" }),
	});
	expect(refused?.code).toBe(1);
	expect(refused?.output).toContain(
		"- Claude Code is not logged in: run claude auth login",
	);

	expect(await checkPrerequisites({ ...quiet, run: machine({}) })).toBe(
		undefined,
	);
	expect(
		existsSync(
			join(process.env.OPENFABRIQ_HOME ?? "", "prerequisites-checked"),
		),
	).toBe(true);
	expect(
		await checkPrerequisites({ ...quiet, run: machine({ claude: "exit 1" }) }),
	).toBe(undefined);
});

it("offers gh auth login in a terminal, then checks again", async () => {
	let loggedIn = false;
	const asked: string[] = [];
	const result = await checkPrerequisites({
		interactive: true,
		confirm: async (question) => {
			asked.push(question);
			return true;
		},
		ghLogin: async () => {
			loggedIn = true;
		},
		run: (command, args) =>
			machine(loggedIn ? {} : { gh: "exit 1" })(command, args),
	});
	expect(asked).toEqual([`${GH_LOGIN}. Run it now?`]);
	expect(result).toBe(undefined);
});

it("does not offer gh auth login outside a terminal", async () => {
	const result = await checkPrerequisites({
		...quiet,
		confirm: async () => {
			throw new Error("asked");
		},
		run: machine({ gh: "exit 1" }),
	});
	expect(result?.output).toContain(GH_LOGIN);
});
