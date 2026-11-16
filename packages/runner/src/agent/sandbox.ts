import { randomBytes } from "node:crypto";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SandboxSettings } from "@anthropic-ai/claude-agent-sdk";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { type Network, networkSites } from "@openfabriq/core";
import { home } from "../state/projects.js";
import { realPath, within } from "./guard.js";

/**
 * What sandboxed commands read again of the home folder that blockReadsOutsideWorkingDirectories
 * closes: all of it on macOS. On Linux, `~` reopened read-only also covers the worktrees under
 * ~/.openfabriq, and bubblewrap then cannot write there, nor create the files Claude Code protects
 * (measured): each entry of the home folder but the engine's is reopened instead.
 */
export function readableHome(
	platform: NodeJS.Platform = process.platform,
	userHome = homedir(),
	engineHome = home(),
	entries = () => readdirSync(userHome),
): string[] {
	if (platform !== "linux") return ["~"];
	const inside = relative(userHome, engineHome);
	if (inside.startsWith("..") || isAbsolute(inside)) return ["~"];
	const engine = inside.split(sep)[0];
	// shortcut: an entry created in the home folder during a run stays closed until the next run.
	return entries()
		.filter((entry) => entry !== engine)
		.map((entry) => join(userHome, entry));
}

/**
 * Where a sandboxed command's tools keep their settings (XDG_CONFIG_HOME): a folder of its own temp
 * folder, gone with it. No sandbox writes the home's ~/.config, and tools such as Astro fail without
 * it. Settings only: ~/.local and ~/.cache hold tools the sandboxes read (mise, pnpm, Playwright's browsers).
 */
export const settingsFolder = (temp: string) => join(temp, "config");

/** What no command of a run reads: the engine's secrets, and the machine's. */
function secretPaths(engineSecrets: string[]): string[] {
	return [
		...engineSecrets,
		"~/.ssh",
		"~/.config/gh",
		"~/.aws",
		"~/.claude/.credentials.json",
		// The login keychain: gh and Claude Code keep their tokens there on macOS.
		"~/Library/Keychains",
	];
}

/** The sites a sandbox lets through: `*` for any site, else the list with the registries spelled out. */
const allowedDomains = (network: Network) => {
	const sites = networkSites(network);
	return sites === "any" ? ["*"] : sites;
};

/**
 * The sandbox of the engine's own commands: setup, checks and run_command. They run code
 * the agent or the branch wrote, so they read what an agent's shell reads, write only where they
 * must, and reach the sites of `network`. `temp` holds their temp folders, where a test may open a
 * Unix socket (tsx does). On Linux they open any Unix socket, agent-browser's daemon included, and
 * `sockets`, the machine's (machineSockets), are hidden from them, as from an agent's shell.
 */
export function commandSandbox(
	writable: string[],
	engineSecrets: string[],
	temp: string,
	network: Network,
	sockets?: string[],
): SandboxRuntimeConfig {
	return {
		network: {
			allowedDomains: allowedDomains(network),
			deniedDomains: [],
			allowLocalBinding: true,
			allowUnixSockets: [temp],
			...(sockets ? { allowAllUnixSockets: true } : {}),
		},
		filesystem: {
			denyRead: [...secretPaths(engineSecrets), ...(sockets ?? [])],
			allowWrite: writable,
			denyWrite: [],
		},
	};
}

/** The temp folder Claude Code forces on the shell, shared by all its sessions on the machine. */
const sharedTemp = () => `/tmp/claude-${process.getuid?.()}`;

/**
 * The other Claude Code sessions' folders in the shared temp folder (VULN-013): named after their
 * project, they hold those sessions' tool outputs. The run's own folder stays open, and so does the
 * folder itself, where Claude Code writes the shell's state. So does a folder that holds the run's
 * worktree, when the engine's home lives in a session's temp folder: closed, the shell could not
 * even read its working directory.
 */
export function otherSessions(
	cwd: string,
	dir = sharedTemp(),
	entries = () => readdirSync(dir),
): string[] {
	const paths = [cwd, realPath(cwd)];
	const own = new Set(paths.map((p) => p.replace(/[^a-zA-Z0-9]/g, "-")));
	const roots = [dir, realPath(dir)];
	const holdsWorktree = (entry: string) =>
		roots.some((root) => paths.some((p) => within(p, join(root, entry))));
	try {
		// shortcut: a session that starts during the run stays readable to it; close the whole folder once Claude Code lets the shell have its own TMPDIR.
		return entries()
			.filter(
				(entry) =>
					entry.startsWith("-") && !own.has(entry) && !holdsWorktree(entry),
			)
			.map((entry) => join(dir, entry));
	} catch {
		return [];
	}
}

/**
 * A run's own temp folder, for Claude Code's files and sockets and the shell's TMPDIR under it: its
 * real path, which the sandbox compares. Claude Code puts that TMPDIR there only while the path is
 * short enough for a Unix socket (claudeTempFits), else in the shared /tmp/claude-<uid>. On Linux
 * the shell may open Unix sockets (shellSandbox): the runs' folders sit in /tmp/of-<uid in base 36>,
 * which a shell can neither list nor change (mode 0300, read-only in its sandbox), under names it
 * cannot guess (64 random bits), so no run reaches another's sockets, its browser's daemon.
 */
export function runTemp(
	platform = process.platform,
	uid = process.getuid?.() ?? 0,
	parent = `/tmp/of-${uid.toString(36)}`,
): string {
	if (platform !== "linux")
		return mkdtempSync(join(realpathSync(tmpdir()), "openfabriq-agent-"));
	mkdirSync(parent, { recursive: true, mode: 0o300 });
	// /tmp is everyone's: a link or another user's folder planted there is refused.
	const planted = lstatSync(parent);
	if (!planted.isDirectory() || planted.uid !== uid)
		throw new Error(`${parent} is not a folder of this user's`);
	chmodSync(parent, 0o300);
	const dir = join(parent, randomBytes(8).toString("base64url"));
	// Too long, every run's shell would share /tmp/claude-<uid>, where it may open sockets.
	if (!claudeTempFits(dir, uid))
		throw new Error(
			`${dir} is too long for Claude Code to keep the shell's temp folder in it: set a shorter TMPDIR for the engine`,
		);
	mkdirSync(dir, { mode: 0o700 });
	return dir;
}

/**
 * Whether Claude Code keeps the shell's TMPDIR in this folder: only while <dir>/claude-<uid> is 44
 * bytes at most (read in the Claude Code the SDK bundles; 41 bytes measured working with uid 1001).
 */
export const claudeTempFits = (dir: string, uid: number) =>
	Buffer.byteLength(join(dir, `claude-${uid}`)) <= 44;

/** A folder's entries as readdir gives them with their types: enough to find sockets. */
type Entry = {
	name: string;
	isDirectory(): boolean;
	isSocket(): boolean;
	isSymbolicLink(): boolean;
};

/**
 * The sockets daemons keep in the home folder's hidden folders, three folders deep at most: git's
 * credential cache, gpg-agent, an SSH agent, Docker Desktop. Not the engine's folder, which the
 * shell does not see.
 */
export function homeSockets(
	userHome = homedir(),
	engineHome = home(),
	list = (dir: string): Entry[] => readdirSync(dir, { withFileTypes: true }),
	// A link to a folder is walked too: dotfiles managers link ~/.gnupg and the like.
	linksToFolder = (path: string) => {
		try {
			return statSync(path).isDirectory();
		} catch {
			return false;
		}
	},
): string[] {
	const found: string[] = [];
	const walk = (dir: string, depth: number) => {
		let entries: Entry[];
		try {
			entries = list(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isSocket()) found.push(path);
			else if (
				(entry.isDirectory() ||
					(entry.isSymbolicLink() && linksToFolder(path))) &&
				depth < 3 &&
				(depth > 0 || entry.name.startsWith(".")) &&
				!within(path, engineHome)
			)
				walk(path, depth + 1);
		}
	};
	walk(userHome, 0);
	return found;
}

/**
 * The worktrees of the other runs, of every project of the engine: a run's commands read the
 * engine's folder, and on Linux open any Unix socket, so another run's sockets would be in reach.
 */
export function otherWorktrees(
	cwd: string,
	projects = join(home(), "projects"),
	list = (dir: string): string[] => readdirSync(dir),
): string[] {
	const entries = (dir: string) => {
		try {
			return list(dir).map((name) => join(dir, name));
		} catch {
			return [];
		}
	};
	return entries(projects)
		.flatMap(entries)
		.flatMap((repo) => entries(join(repo, "worktrees")))
		.filter((worktree) => !within(cwd, worktree));
}

/**
 * Where the machine's Unix sockets are, hidden from an agent's shell on Linux, where it may open
 * sockets (agent-browser's daemon, tsx) but seccomp cannot tell one path from another: /run (the
 * session and system buses, Docker, the user's agents and keyring), each entry of /tmp there
 * when the run starts (an SSH agent, X11, tmux) but one that holds the worktree or the run's
 * folder, and the sockets of the home folder's hidden folders. Claude Code's own proxies, made
 * later in /tmp, stay: each wants its session's password (measured).
 */
export function machineSockets(
	cwd: string,
	temp: string,
	sources = {
		// Not a link: refusing it could refuse what it points to, a folder the shell needs.
		tmp: () =>
			readdirSync("/tmp", { withFileTypes: true })
				.filter((entry) => !entry.isSymbolicLink())
				.map((entry) => entry.name),
		runAlias: realPath("/var/run"),
		home: () => homeSockets(),
		// LXD and Incus keep their socket outside /run: its group is root on the machine.
		daemons: () =>
			["/var/snap/lxd/common/lxd", "/var/lib/lxd", "/var/lib/incus"].filter(
				(path) => existsSync(path),
			),
	},
): string[] {
	const ours = [cwd, realPath(cwd), temp];
	let tmp: string[] = [];
	try {
		// shortcut: an entry of /tmp made during the run stays visible to it; a container has none.
		tmp = sources
			.tmp()
			// The sandboxes' own proxy bridges, as Claude Code's proxies below: made and removed with each
			// command, one gone before bwrap starts would stop it ("Can't create file", measured).
			.filter((entry) => !/^claude-(http|socks)-[0-9a-f]+\.sock$/.test(entry))
			.map((entry) => join("/tmp", entry))
			.filter((path) => !ours.some((p) => within(p, path)));
	} catch {}
	return [
		"/run",
		...(sources.runAlias === "/run" ? [] : ["/var/run"]),
		...tmp,
		...sources.home(),
		...sources.daemons(),
	];
}

/**
 * What of the clone a run's worktree shares with the other runs, read from the worktree's .git
 * file the engine just wrote: Claude Code lets the shell write that .git. Another run's agent would
 * move origin's branches in its refs, and its config runs commands in the engine's own git
 * (`remote.origin.uploadpack` on a fetch, a filter on a status), while that agent still works.
 */
export function sharedRefs(cwd: string): string[] {
	let gitdir: string | undefined;
	try {
		gitdir = readFileSync(join(cwd, ".git"), "utf8").match(
			/^gitdir: (.+)$/m,
		)?.[1];
	} catch {
		return [];
	}
	if (!gitdir) return [];
	const common = resolve(gitdir.trim(), "..", "..");
	// Only what exists: on Linux the sandbox mounts something on each denied path.
	return [
		join(common, "refs/remotes"),
		join(common, "packed-refs"),
		join(common, "config"),
	].filter((p) => existsSync(p));
}

/**
 * Claude Code's sandbox for an agent with `shell`: its commands read the machine but not
 * its secrets nor the other Claude Code sessions, write in the worktree and the temp folder only,
 * and reach the sites of the agent's `network`.
 */
export function shellSandbox(
	cwd: string,
	temp: string,
	secrets: string[],
	network: Network,
	readable = readableHome(),
	others = otherSessions(cwd),
	refs = sharedRefs(cwd),
	// null: none, whatever the platform (the tests of the other platforms' rules).
	sockets: string[] | null = process.platform === "linux"
		? machineSockets(cwd, temp)
		: null,
): SandboxSettings {
	const denyRead = [...secretPaths(secrets), ...others, ...(sockets ?? [])];
	const denied = new Set(
		denyRead.map((p) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p)),
	);
	return {
		enabled: true,
		// A run whose sandbox cannot start fails: it never runs unsandboxed.
		failIfUnavailable: true,
		// dangerouslyDisableSandbox is ignored, and the repo's settings can no longer loosen the sandbox.
		allowUnsandboxedCommands: false,
		filesystem: {
			// blockReadsOutsideWorkingDirectories also closes the home folder to commands, and with it the
			// toolchains installed there (nvm, pnpm): it opens again, minus the secrets. The engine's files
			// are named one by one: under a denied folder, the worktree could not be opened again.
			// For the same path, allowRead wins over denyRead (measured on Linux): a denied one is never reopened.
			allowRead: readable.filter((p) => !denied.has(p)),
			allowWrite: [settingsFolder(temp)],
			denyRead,
			...(refs.length ? { denyWrite: refs } : {}),
		},
		network: {
			allowedDomains: allowedDomains(network),
			// A host off the list is refused rather than asked about, and the repository's settings
			// cannot add sites: under it, Claude Code leaves their lists out.
			...(network === "any" ? {} : { strictAllowlist: true }),
			// A test or an app that listens on localhost, or on a socket in the worktree, the run's own
			// temp folder (CLAUDE_CODE_TMPDIR: Claude Code's own sockets), or the shell's TMPDIR, where
			// tsx and agent-browser put theirs. Claude Code 2.1.310 forces that TMPDIR to the shared
			// /tmp/claude-<uid> and writes its cwd file there: denying it breaks the shell (measured,
			// VULN-013). Not all of /tmp: other programs' sockets are there.
			allowLocalBinding: true,
			allowUnixSockets: [cwd, temp, sharedTemp()],
			// Linux: seccomp refuses every socket, agent-browser's included, or none. None, and the
			// machine's sockets are hidden instead (machineSockets).
			...(sockets ? { allowAllUnixSockets: true } : {}),
		},
	};
}
