import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { type Network, PACKAGE_SITES } from "@openfabriq/core";
import { expect, it } from "vitest";
import { insideOnly, webInNetwork } from "../../src/agent/guard.js";
import { repoSettings } from "../../src/agent/repo-settings.js";
import {
	claudeTempFits,
	commandSandbox,
	homeSockets,
	machineSockets,
	otherSessions,
	otherWorktrees,
	readableHome,
	runTemp,
	shellSandbox,
} from "../../src/agent/sandbox.js";

const root = mkdtempSync(join(tmpdir(), "openfabriq-agent-"));
const worktree = join(root, "worktree");
const plugin = join(root, "plugin");
mkdirSync(worktree);
mkdirSync(plugin);
writeFileSync(join(root, "secrets.json"), "{}");
symlinkSync(join(root, "secrets.json"), join(worktree, "link.json"));

const decision = async (tool: string, input: Record<string, unknown>) => {
	const out = await insideOnly(worktree, [plugin])(
		{
			hook_event_name: "PreToolUse",
			tool_name: tool,
			tool_input: input,
			tool_use_id: "t",
			session_id: "s",
			transcript_path: "",
			cwd: worktree,
		} as HookInput,
		"t",
		{ signal: new AbortController().signal },
	);
	return "hookSpecificOutput" in out
		? (out.hookSpecificOutput as { permissionDecision?: string })
				.permissionDecision
		: undefined;
};

it("keeps web to the agent's sites, even the documentation sites Claude Code allows on its own, and says where to add one", async () => {
	const fetch = async (url: unknown, network: Network = ["packages"]) => {
		const out = await webInNetwork(network)(
			{
				hook_event_name: "PreToolUse",
				tool_name: "WebFetch",
				tool_input: { url, prompt: "p" },
				tool_use_id: "t",
				session_id: "s",
				transcript_path: "",
				cwd: worktree,
			} as HookInput,
			"t",
			{ signal: new AbortController().signal },
		);
		return "hookSpecificOutput" in out
			? (
					out.hookSpecificOutput as {
						permissionDecision?: string;
						permissionDecisionReason?: string;
					}
				).permissionDecisionReason
			: undefined;
	};
	expect(await fetch("https://github.com/acme/app/releases")).toBeUndefined();
	expect(await fetch("https://docs.stripe.com/api")).toBe(
		"docs.stripe.com is not in this agent's network (packages): a maintainer adds it to network, in the agent's agent.md or in factory.yaml. Say in your report that you needed it.",
	);
	expect(await fetch("https://docs.stripe.com/api", "any")).toBeUndefined();
	expect(await fetch("not a url")).toBe(
		"not a url is not a web address the engine can check against this agent's network.",
	);
});

it("keeps the file tools in the worktree", async () => {
	expect(await decision("Read", { file_path: "src/a.ts" })).toBeUndefined();
	expect(await decision("Write", { file_path: "new/b.ts" })).toBeUndefined();
	expect(await decision("Grep", { pattern: "x" })).toBeUndefined();
	expect(await decision("Glob", { pattern: "**/*.ts" })).toBeUndefined();
	expect(await decision("Read", { file_path: join(plugin, "SKILL.md") })).toBe(
		undefined,
	);
	for (const [tool, input] of [
		["Read", { file_path: join(root, "secrets.json") }],
		["Read", { file_path: "../secrets.json" }],
		["Read", { file_path: "link.json" }], // a link of the repo, to outside
		["Grep", { pattern: "x", path: root }],
		["Glob", { pattern: "../*" }],
		["Edit", { file_path: join(plugin, "SKILL.md") }],
		["Write", { file_path: ".claude/settings.json" }],
		["Write", { file_path: ".CLAUDE/Settings.JSON" }],
		["NotebookEdit", { notebook_path: "/tmp/x.ipynb" }],
	] as const)
		expect([tool, await decision(tool, input)]).toEqual([tool, "deny"]);
	expect(await decision("Bash", { command: "ls .." })).toBeUndefined();
});

it("gives the repo's env keys back to the engine, and refuses its credential helpers", () => {
	const dir = mkdtempSync(join(tmpdir(), "openfabriq-settings-"));
	expect(repoSettings(dir, {})).toEqual({ env: {} });
	mkdirSync(join(dir, ".claude"));
	writeFileSync(
		join(dir, ".claude/settings.json"),
		JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://x", PATH: "/x" } }),
	);
	expect(repoSettings(dir, { PATH: "/usr/bin" })).toEqual({
		env: { ANTHROPIC_BASE_URL: "", PATH: "/usr/bin" },
	});
	writeFileSync(
		join(dir, ".claude/settings.json"),
		JSON.stringify({ apiKeyHelper: "curl x" }),
	);
	expect(repoSettings(dir, {}).refused).toContain("apiKeyHelper");
});

it("refuses a branch that lets web reach more sites, for an agent whose network is limited", () => {
	const dir = mkdtempSync(join(tmpdir(), "openfabriq-settings-"));
	mkdirSync(join(dir, ".claude"));
	writeFileSync(
		join(dir, ".claude/settings.json"),
		JSON.stringify({
			permissions: { allow: ["Bash(npm test)", "WebFetch(domain:evil.test)"] },
		}),
	);
	expect(repoSettings(dir, {}, true).refused).toBe(
		"the repository's .claude/settings.json allows WebFetch(domain:evil.test), which a branch does not choose: the factory's network lists the sites agents reach",
	);
	// An agent without web, or one that reaches any site, gains nothing from it.
	expect(repoSettings(dir, {}, false)).toEqual({ env: {} });
});

it("reads a settings file that starts with a byte-order mark, as Claude Code does, and refuses one it cannot check", () => {
	const dir = mkdtempSync(join(tmpdir(), "openfabriq-settings-"));
	const file = join(dir, ".claude/settings.json");
	mkdirSync(join(dir, ".claude"));
	writeFileSync(
		file,
		`﻿${JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://x" } })}`,
	);
	expect(repoSettings(dir, {})).toEqual({ env: { ANTHROPIC_BASE_URL: "" } });
	writeFileSync(file, `﻿${JSON.stringify({ apiKeyHelper: "curl x" })}`);
	expect(repoSettings(dir, {}).refused).toContain("apiKeyHelper");
	for (const text of ["{", "null", "[]", '"x"']) {
		writeFileSync(file, text);
		expect([text, repoSettings(dir, {}).refused]).toEqual([
			text,
			expect.stringContaining("not a JSON object"),
		]);
	}
});

it("sandboxes shell commands: the secrets unread, any site for an agent whose network is any", () => {
	expect(
		shellSandbox(
			"/w",
			"/t",
			["/e/secrets.json"],
			"any",
			["~"],
			[],
			undefined,
			null,
		),
	).toEqual({
		enabled: true,
		failIfUnavailable: true,
		allowUnsandboxedCommands: false,
		filesystem: {
			allowRead: ["~"],
			// Where its tools keep their settings, in the run's temp folder: never the home's ~/.config.
			allowWrite: ["/t/config"],
			denyRead: [
				"/e/secrets.json",
				"~/.ssh",
				"~/.config/gh",
				"~/.aws",
				"~/.claude/.credentials.json",
				"~/Library/Keychains",
			],
		},
		network: {
			allowedDomains: ["*"],
			allowLocalBinding: true,
			// The run's own temp folder, and the shell's TMPDIR that Claude Code forces (VULN-013).
			allowUnixSockets: ["/w", "/t", `/tmp/claude-${process.getuid?.()}`],
		},
	});
});

it("limits a shell to the agent's sites, the registries spelled out, and never asks for more", () => {
	expect(
		shellSandbox(
			"/w",
			"/t",
			[],
			["packages", "x.io"],
			["~"],
			[],
			undefined,
			null,
		).network,
	).toEqual({
		allowedDomains: [...PACKAGE_SITES, "x.io"],
		// Unlisted hosts are refused, and the repository's own lists are left out.
		strictAllowlist: true,
		allowLocalBinding: true,
		allowUnixSockets: ["/w", "/t", `/tmp/claude-${process.getuid?.()}`],
	});
	expect(
		shellSandbox("/w", "/t", [], [], ["~"], [], undefined, null).network
			?.allowedDomains,
	).toEqual([]);
});

it("gives the engine's commands their own network: any site, or the sites spelled out", () => {
	expect(commandSandbox([], [], "/t", "any").network.allowedDomains).toEqual([
		"*",
	]);
	expect(
		commandSandbox([], [], "/t", ["packages", "x.io"]).network.allowedDomains,
	).toEqual([...PACKAGE_SITES, "x.io"]);
	expect(commandSandbox([], [], "/t", []).network.allowedDomains).toEqual([]);
});

it("sandboxes the engine's commands like an agent's shell, writing only where they must", () => {
	const sandbox = commandSandbox(
		["/w", "/t/1"],
		["/e/secrets.json"],
		"/t",
		"any",
	);
	expect(sandbox.filesystem).toEqual({
		denyRead: shellSandbox(
			"/w",
			"/t",
			["/e/secrets.json"],
			"any",
			["~"],
			[],
			undefined,
			null,
		).filesystem?.denyRead,
		allowWrite: ["/w", "/t/1"],
		denyWrite: [],
	});
	expect(sandbox.network).toEqual({
		allowedDomains: ["*"],
		deniedDomains: [],
		allowLocalBinding: true,
		allowUnixSockets: ["/t"],
	});
});

it("on Linux, lets the engine's commands open Unix sockets and hides the machine's, as from the agent's shell", () => {
	const sockets = ["/run", "/tmp/ssh-x", "/h/.gnupg/S.gpg-agent"];
	const sandbox = commandSandbox(["/w", "/t/1"], [], "/t", "any", sockets);
	expect(sandbox.network).toMatchObject({ allowAllUnixSockets: true });
	expect(sandbox.filesystem.denyRead).toEqual(expect.arrayContaining(sockets));
	expect(sandbox.filesystem.allowWrite).toEqual(["/w", "/t/1"]);
	// The same sockets the agent's shell does not see.
	expect(
		shellSandbox("/w", "/t", [], "any", ["~"], [], [], sockets).filesystem
			?.denyRead,
	).toEqual(sandbox.filesystem.denyRead);
	// macOS: Seatbelt filters sockets by path, nothing changes.
	expect(
		commandSandbox(["/w"], [], "/t", "any", undefined).network,
	).not.toHaveProperty("allowAllUnixSockets");
});

it("reopens the home folder but the engine's on Linux, where ~ would cover the worktrees", () => {
	const entries = () => [".openfabriq", ".nvm", ".config", "code"];
	expect(
		readableHome("darwin", "/home/u", "/home/u/.openfabriq", entries),
	).toEqual(["~"]);
	expect(
		readableHome("linux", "/home/u", "/home/u/.openfabriq", entries),
	).toEqual(["/home/u/.nvm", "/home/u/.config", "/home/u/code"]);
	// The engine elsewhere: its worktrees are not under ~.
	expect(readableHome("linux", "/home/u", "/srv/openfabriq", entries)).toEqual([
		"~",
	]);
	// The engine deeper in the home folder: its top folder stays closed.
	expect(
		readableHome("linux", "/home/u", "/home/u/code/of-home", entries),
	).toEqual(["/home/u/.openfabriq", "/home/u/.nvm", "/home/u/.config"]);
});

it("closes the other Claude Code sessions' folders of the shared temp folder, not the run's own nor the rest (VULN-013)", () => {
	const entries = () => [
		"-Users-ada-code-shop",
		"-Users-ada--openfabriq-projects-acme-app-worktrees-run-1",
		"cache-break-state-1234",
		"tsx-501",
	];
	expect(
		otherSessions(
			"/Users/ada/.openfabriq/projects/acme/app/worktrees/run-1",
			"/tmp/claude-501",
			entries,
		),
	).toEqual(["/tmp/claude-501/-Users-ada-code-shop"]);
	// The engine's home in a session's temp folder: the folder that holds the worktree stays open.
	expect(
		otherSessions(
			"/tmp/claude-501/-Users-ada-code-shop/scratch/home/projects/acme/app/worktrees/run-1",
			"/tmp/claude-501",
			entries,
		),
	).toEqual([
		"/tmp/claude-501/-Users-ada--openfabriq-projects-acme-app-worktrees-run-1",
	]);
	expect(
		otherSessions("/w", "/nowhere", () => {
			throw new Error("ENOENT");
		}),
	).toEqual([]);
	expect(
		shellSandbox(
			"/w",
			"/t",
			[],
			"any",
			["~"],
			["/tmp/claude-501/-Users-ada-code-shop"],
		).filesystem?.denyRead,
	).toContain("/tmp/claude-501/-Users-ada-code-shop");
});

it("on Linux, lets the shell open Unix sockets and hides the machine's: /run, /tmp but the run's, the home folder's", () => {
	const sandbox = shellSandbox(
		"/w",
		"/t",
		[],
		"any",
		["~"],
		[],
		[],
		["/run", "/tmp/ssh-x"],
	);
	expect(sandbox.network).toMatchObject({ allowAllUnixSockets: true });
	expect(sandbox.filesystem?.denyRead).toEqual(
		expect.arrayContaining(["/run", "/tmp/ssh-x"]),
	);
	// macOS: Seatbelt filters sockets by path, nothing changes.
	expect(
		shellSandbox("/w", "/t", [], "any", ["~"], [], [], null).network,
	).not.toHaveProperty("allowAllUnixSockets");

	// The sandbox's proxy bridges of the other runs come and go: one gone before bwrap starts made it fail.
	const tmp = () => [
		".X11-unix",
		"ssh-x",
		"home",
		"claude-1001",
		"claude-http-ce4765add22acc57.sock",
		"claude-socks-ce4765add22acc57.sock",
	];
	expect(
		machineSockets("/tmp/home/projects/a/b/worktrees/r", "/h/tmp/agent-1", {
			tmp,
			runAlias: "/run",
			home: () => ["/h/.gnupg/S.gpg-agent"],
			daemons: () => ["/var/snap/lxd/common/lxd"],
		}),
	).toEqual([
		"/run",
		"/tmp/.X11-unix",
		"/tmp/ssh-x",
		"/tmp/claude-1001",
		"/h/.gnupg/S.gpg-agent",
		// LXD's socket gives root to its group: outside /run, hidden too.
		"/var/snap/lxd/common/lxd",
	]);
	// /var/run not a link to /run: hidden too.
	expect(
		machineSockets("/w", "/t", {
			tmp: () => [],
			runAlias: "/var/run",
			home: () => [],
			daemons: () => [],
		}),
	).toEqual(["/run", "/var/run"]);
});

it("on Linux, puts a run's temp folder where no other run's shell can list it nor guess its name", () => {
	const uid = process.getuid?.() ?? 0;
	// Short, as the real /tmp/of-<uid> is: Claude Code keeps the shell's TMPDIR there only then.
	const parent = join(mkdtempSync("/tmp/oft-"), "of");
	const dir = runTemp("linux", uid, parent);
	expect(dir).toMatch(new RegExp(`^${parent}/[A-Za-z0-9_-]{11}$`));
	expect(statSync(parent).mode & 0o777).toBe(0o300);
	expect(statSync(dir).mode & 0o777).toBe(0o700);
	expect(() => readdirSync(parent)).toThrow(/EACCES/);
	expect(runTemp("linux", uid, parent)).not.toBe(dir);
	// A link planted in its place is refused.
	const planted = join(mkdtempSync(join(tmpdir(), "openfabriq-tmp-")), "of");
	symlinkSync(tmpdir(), planted);
	expect(() => runTemp("linux", uid, planted)).toThrow(/not a folder/);
	// A parent too long for Claude Code is refused, never a TMPDIR shared by every run.
	expect(() =>
		runTemp(
			"linux",
			uid,
			join(mkdtempSync(join(tmpdir(), "openfabriq-tmp-long-")), "of"),
		),
	).toThrow(/too long/);
	// macOS: as before.
	expect(runTemp("darwin")).toMatch(
		new RegExp(`^${realpathSync(tmpdir())}/openfabriq-agent-`),
	);
});

it("keeps the run's temp folder short enough for Claude Code with a 10-digit uid", () => {
	const uid = 1000680000;
	const dir = `/tmp/of-${uid.toString(36)}/${"a".repeat(11)}`;
	expect(claudeTempFits(dir, uid)).toBe(true);
	// The former name: decimal uid, 16 characters.
	expect(claudeTempFits(`/tmp/of-${uid}/${"a".repeat(16)}`, uid)).toBe(false);
});

it("finds the sockets daemons keep in the home folder's hidden folders, not in the engine's", () => {
	const dirent = (name: string, kind: "dir" | "socket" | "file" | "link") => ({
		name,
		isDirectory: () => kind === "dir",
		isSocket: () => kind === "socket",
		isSymbolicLink: () => kind === "link",
	});
	const tree: Record<string, ReturnType<typeof dirent>[]> = {
		"/h": [
			dirent(".cache", "dir"),
			dirent(".openfabriq", "dir"),
			dirent("code", "dir"),
			dirent(".agent.sock", "socket"),
			// ~/.gnupg linked to ~/dotfiles/gnupg (GNU stow): gpg-agent's socket is there.
			dirent(".gnupg", "link"),
		],
		"/h/.gnupg": [dirent("S.gpg-agent", "socket")],
		"/h/.cache": [dirent("git", "dir")],
		"/h/.cache/git": [dirent("credential", "dir")],
		"/h/.cache/git/credential": [
			dirent("socket", "socket"),
			dirent("deeper", "dir"),
		],
		"/h/.cache/git/credential/deeper": [dirent("too-deep", "socket")],
		"/h/.openfabriq": [dirent("engine.sock", "socket")],
		"/h/code": [dirent("app.sock", "socket")],
	};
	const list = (dir: string) => {
		const entries = tree[dir];
		if (!entries) throw new Error("ENOENT");
		return entries;
	};
	expect(
		homeSockets("/h", "/h/.openfabriq", list, (path) => path === "/h/.gnupg"),
	).toEqual([
		"/h/.cache/git/credential/socket",
		"/h/.agent.sock",
		"/h/.gnupg/S.gpg-agent",
	]);
});

it("keeps the agent's shell from moving the refs, or changing the config, of the clone every run shares", () => {
	const clone = mkdtempSync(join(tmpdir(), "openfabriq-clone-"));
	mkdirSync(join(clone, ".git/refs/remotes"), { recursive: true });
	writeFileSync(join(clone, ".git/packed-refs"), "");
	writeFileSync(join(clone, ".git/config"), "");
	const wt = mkdtempSync(join(tmpdir(), "openfabriq-wt-"));
	writeFileSync(
		join(wt, ".git"),
		`gitdir: ${join(clone, ".git/worktrees/run-1")}\n`,
	);
	expect(
		shellSandbox(wt, "/t", [], "any", ["~"], []).filesystem?.denyWrite,
	).toEqual([
		join(clone, ".git/refs/remotes"),
		join(clone, ".git/packed-refs"),
		join(clone, ".git/config"),
	]);
	// Not a worktree of the engine's: nothing more.
	expect(
		shellSandbox("/w", "/t", [], "any", ["~"], []).filesystem?.denyWrite,
	).toBe(undefined);
});

it("refuses what a branch's Claude Code configuration would add beyond the factory: plugins, marketplaces, directories", () => {
	const dir = mkdtempSync(join(tmpdir(), "openfabriq-settings-"));
	mkdirSync(join(dir, ".claude"));
	const set = (settings: object) => {
		writeFileSync(join(dir, ".claude/settings.json"), JSON.stringify(settings));
		return repoSettings(dir, {}).refused;
	};
	expect(set({ enabledPlugins: { "x@y": true } })).toContain("enabledPlugins");
	expect(set({ extraKnownMarketplaces: { y: {} } })).toContain(
		"extraKnownMarketplaces",
	);
	expect(
		set({ permissions: { additionalDirectories: ["/elsewhere"] } }),
	).toContain("permissions.additionalDirectories");
	// What the factory's runs already ignore or decide stays allowed.
	expect(
		set({ permissions: { allow: ["Bash(ls)"] }, env: {} }),
	).toBeUndefined();
});

it("refuses a project skill or command that grants itself tools: the factory lists an agent's tools", () => {
	const dir = mkdtempSync(join(tmpdir(), "openfabriq-skills-"));
	const skill = (path: string, frontmatter: string) => {
		mkdirSync(join(dir, path, ".."), { recursive: true });
		writeFileSync(join(dir, path), `---\n${frontmatter}\n---\nBody.\n`);
	};
	skill(".claude/skills/notes/SKILL.md", "name: notes\ndescription: Notes.");
	expect(repoSettings(dir, {}).refused).toBeUndefined();
	skill(
		".claude/commands/deploy/run.md",
		"description: Deploy.\nallowed-tools: Bash(curl:*)",
	);
	expect(repoSettings(dir, {}).refused).toContain(
		".claude/commands/deploy/run.md",
	);
	skill(
		".claude/skills/probe/SKILL.md",
		"name: probe\nallowed-tools: mcp__server__write",
	);
	expect(repoSettings(dir, {}).refused).toContain("allowed-tools");
});

it("hides from a run's commands the other runs' worktrees, of every project, where their sockets are", () => {
	const tree: Record<string, string[]> = {
		"/e/projects": ["acme"],
		"/e/projects/acme": ["app", "web"],
		"/e/projects/acme/app/worktrees": ["run-a", "run-b"],
		"/e/projects/acme/web/worktrees": ["run-c"],
	};
	const list = (dir: string) => {
		const entries = tree[dir];
		if (!entries) throw new Error(`ENOENT ${dir}`);
		return entries;
	};
	expect(
		otherWorktrees("/e/projects/acme/app/worktrees/run-a", "/e/projects", list),
	).toEqual([
		"/e/projects/acme/app/worktrees/run-b",
		"/e/projects/acme/web/worktrees/run-c",
	]);
});
