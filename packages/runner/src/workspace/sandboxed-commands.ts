import { spawn } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { type Network, scriptOf } from "@openfabriq/core";
import {
	commandSandbox,
	machineSockets,
	otherWorktrees,
	runTemp,
	settingsFolder,
} from "../agent/sandbox.js";
import { errorText } from "../files.js";
import { ensureFactorySecretsDir } from "../state/factory-secrets.js";
import { engineSecretPaths } from "../state/secrets.js";

/**
 * The output without the lines the macOS sandbox prints for each system certificate it cannot
 * copy: dozens of them would fill the end of the output, all the agent gets.
 */
export function withoutSandboxNoise(output: string): string {
	return output
		.split("\n")
		.filter(
			(line) =>
				!/^ERROR: failed to copy trust settings of system certificate/.test(
					line,
				),
		)
		.join("\n");
}

/** The last lines of a command's output: where the error usually is. */
export function tail(output: string, lines = 20): string {
	return output.trimEnd().split("\n").slice(-lines).join("\n").slice(-2000);
}

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/**
 * A command that starts with scripts/ runs that script of the applied factory, beside the clone,
 * which neither agents nor commands write: never the file of the run's branch.
 */
function withScript(clone: string, command: string): string {
	const script = scriptOf(command);
	return script
		? `${quote(join(clone, "..", "factory", script))}${command.slice(script.length)}`
		: command;
}

/**
 * Where the engine's commands get their temp folders. One fixed folder, real path: the sandbox
 * reads the folders where Unix sockets are allowed once, at its start (measured on macOS).
 */
function commandsTmp(): string {
	const dir = join(realpathSync(tmpdir()), "openfabriq-commands");
	mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * A command's temp folder, and on Linux the machine's sockets hidden from it. There its sandbox lets
 * it open any Unix socket (agent-browser's daemon, tsx): its folder is one that no other command nor
 * agent can list or guess (runTemp), and the machine's sockets are out of its sight.
 */
async function commandTemp(
	prefix: string,
	dir: string,
	hideOtherRuns = false,
): Promise<{ tmp: string; sockets?: string[] }> {
	if (process.platform !== "linux")
		return { tmp: await mkdtemp(join(commandsTmp(), prefix)) };
	const tmp = runTemp();
	return {
		tmp,
		sockets: [
			...machineSockets(dir, tmp),
			...(hideOtherRuns ? otherWorktrees(dir) : []),
		],
	};
}

// The machine is checked once per engine; a failure stays: the machine lacks what it needs.
let sandbox: Promise<string | undefined> | undefined;

/** Undefined once the machine can run the sandbox of the engine's commands, or why it cannot. */
function sandboxReady(): Promise<string | undefined> {
	sandbox ??= (async () => {
		if (!SandboxManager.isSupportedPlatform())
			return `not supported on ${process.platform}`;
		const { errors } = await SandboxManager.checkDependenciesAsync();
		if (errors.length > 0) return errors.join("; ");
		// On Linux, a sandbox denies nothing for a folder that does not exist yet.
		ensureFactorySecretsDir();
		return undefined;
	})().catch(errorText);
	return sandbox;
}

/**
 * Started by `node -e` with the library, a configuration, a command and a file: sets up a sandbox
 * with that configuration, runs the command in it, and exits with its code. Its proxy lives as long
 * as the command, and decides for that command alone. The sites its list refused go to the file,
 * which the command cannot write: only the engine says what was refused.
 */
const SANDBOX_PROCESS = `
const [lib, config, command, refusedFile] = process.argv.slice(1);
const { SandboxManager } = await import(lib);
const { execFileSync, spawn } = await import("node:child_process");
const { writeFileSync } = await import("node:fs");
await SandboxManager.initialize(JSON.parse(config));
const child = spawn("sh", ["-c", await SandboxManager.wrapWithSandbox(command, "sh")], { stdio: "inherit" });
// Stopped, it stops every process the command started: a signal to the command's shell alone leaves them running.
const stop = (signal) => {
	const children = new Map();
	for (const row of execFileSync("ps", ["-A", "-o", "pid=,ppid="]).toString().trim().split("\\n")) {
		const [pid, ppid] = row.trim().split(/\\s+/).map(Number);
		children.set(ppid, [...(children.get(ppid) ?? []), pid]);
	}
	const tree = [child.pid];
	for (let i = 0; i < tree.length; i++) tree.push(...(children.get(tree[i]) ?? []));
	for (const pid of tree.reverse())
		try {
			process.kill(pid, signal);
		} catch {}
};
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => stop(signal));
child.on("close", async (code) => {
	// The sites the proxy refused, said where the agent and the person who reads the output look: the end.
	const refused = new Set();
	const local = new Set();
	const other = new Set();
	for (const { line } of SandboxManager.getSandboxViolationStore().getViolations()) {
		const deny = /^deny network-outbound (.+):\\d+ \\((.*)\\)$/.exec(line);
		if (!deny) continue;
		if (deny[2] === "host is not on the allow list") refused.add(deny[1]);
		else if (/loopback/.test(deny[2])) local.add(deny[1]);
		else other.add(deny[1] + " (" + deny[2] + ")");
	}
	const list = (sites) => [...sites].join(", ").replace(/, ([^,]*)$/, " and $1");
	if (refused.size)
		process.stderr.write(
			"\\nopenfabriq: the network refused " + list(refused) +
				(refused.size > 1 ? ": they are not in network." : ": it is not in network.") +
				"\\nAdd the sites this command needs to network, in openfabriq/factory.yaml, or in the agent's agent.md for one agent.\\n",
		);
	if (local.size)
		process.stderr.write(
			"\\nopenfabriq: the network refused " + list(local) +
				", a name that points to this machine, even listed: reach it as localhost.\\n",
		);
	if (other.size)
		process.stderr.write("\\nopenfabriq: the network refused " + list(other) + ".\\n");
	if (refusedFile && refused.size) writeFileSync(refusedFile, JSON.stringify([...refused]));
	await SandboxManager.reset();
	process.exit(code ?? 1);
});
`;

const sandboxLibrary = pathToFileURL(
	createRequire(import.meta.url).resolve("@anthropic-ai/sandbox-runtime"),
).href;

/**
 * A shell line that runs `command` in a sandbox of its own, writing in `writable` only and reaching
 * the sites of `network`. One sandbox process per command: the library keeps one network list per
 * process, and any site can only be a whole process's list, never one command's beside others.
 */
function sandboxed(
	command: string,
	writable: string[],
	network: Network,
	sockets: string[] | undefined,
	refusedFile = "",
): string {
	// exec: the sandbox process takes the shell's place, so a signal to the line reaches it.
	return `exec ${[
		process.execPath,
		"--input-type=module",
		"-e",
		SANDBOX_PROCESS,
		sandboxLibrary,
		JSON.stringify(
			commandSandbox(
				writable,
				engineSecretPaths(),
				commandsTmp(),
				network,
				sockets,
			),
		),
		// The sandbox gives the network through HTTPS_PROXY only, which Node's fetch ignores without this.
		`export NODE_USE_ENV_PROXY=1\n${command}`,
		refusedFile,
	]
		.map(quote)
		.join(" ")}`;
}

function spawnShell(
	dir: string,
	command: string,
	env: Record<string, string>,
	timeoutMs: number,
): Promise<{ ok: boolean; output: string }> {
	return new Promise((resolve, reject) => {
		// Its own process group, so that a timeout also stops what the command started.
		const child = spawn("sh", ["-c", command], {
			cwd: dir,
			env,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		const keep = (chunk: Buffer) => {
			output = (output + chunk.toString()).slice(-64 * 1024);
		};
		child.stdout.on("data", keep);
		child.stderr.on("data", keep);
		const failed = (why: string) =>
			resolve({ ok: false, output: `${why}\n${tail(output)}`.trim() });
		// A process that left the group can keep the output open: the timeout does not wait for it.
		const timer = setTimeout(() => {
			try {
				if (child.pid) process.kill(-child.pid, "SIGKILL");
			} catch {
				child.kill("SIGKILL");
			}
			// A process that escaped the group must not be read forever.
			child.stdout.destroy();
			child.stderr.destroy();
			failed(`stopped after ${Math.round(timeoutMs / 60_000)} minutes`);
		}, timeoutMs);
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve({ ok: true, output });
			else failed(`exited with code ${code}`);
		});
	});
}

/**
 * Runs a command of the factory in the worktree `dir`, in the sandbox of the engine's commands.
 * Never rejects for a failed command: `ok` says how it ended, `output` is its output, or why and its end.
 */
export async function runSandboxed(
	clone: string,
	dir: string,
	command: string,
	env: Record<string, string>,
	timeoutMs: number,
	network: Network,
	/** Told the sites the network's list refused, read from the sandbox process, never from the output. */
	refused?: (sites: string[]) => void,
	/** A run no maintainer started: its code never writes what a later setup runs with the secrets. */
	ownCache = false,
): Promise<{ ok: boolean; output: string }> {
	const unavailable = await sandboxReady();
	if (unavailable)
		return {
			ok: false,
			output: `the sandbox of the engine's commands cannot start: ${unavailable}`,
		};
	const { tmp, sockets } = await commandTemp("command-", dir, true);
	mkdirSync(settingsFolder(tmp));
	const cache = ownCache ? join(tmp, "cache") : join(clone, "..", "cache");
	mkdirSync(cache, { recursive: true });
	// Beside the command's temp folder, never in it: the command cannot write it.
	const refusedFile = `${tmp}.refused.json`;
	try {
		// The sandbox hands its own TMPDIR to the command: this command's temp folder replaces it.
		const result = await spawnShell(
			dir,
			sandboxed(
				`export TMPDIR=${quote(tmp)}; ${withScript(clone, command)}`,
				[dir, tmp, cache],
				network,
				sockets,
				refusedFile,
			),
			{
				...env,
				// Package managers keep their store and cache in the project's folder, where the sandbox
				// writes: never the machine's, whose files are linked into other projects.
				npm_config_cache: join(cache, "npm"),
				npm_config_store_dir: join(cache, "pnpm-store"),
				XDG_CACHE_HOME: join(cache, "xdg"),
				XDG_CONFIG_HOME: settingsFolder(tmp),
			},
			timeoutMs,
		);
		const sites = await readFile(refusedFile, "utf8").then(
			(text) => JSON.parse(text) as string[],
			() => [],
		);
		if (sites.length) refused?.(sites);
		return { ...result, output: withoutSandboxNoise(result.output) };
	} finally {
		await rm(tmp, { recursive: true, force: true });
		await rm(refusedFile, { force: true });
	}
}

/**
 * The shell line Claude Code runs for a local MCP server of the factory, in the sandbox of the
 * engine's commands, from the project's own MCP folder. Rejects when the sandbox cannot start.
 */
export async function sandboxedMcpServer(
	clone: string,
	command: string,
	network: Network,
): Promise<string> {
	const unavailable = await sandboxReady();
	if (unavailable)
		throw new Error(
			`the sandbox of the factory's MCP servers cannot start: ${unavailable}`,
		);
	// Written by the servers only: neither an agent nor a command of a run writes here.
	const home = join(clone, "..", "mcp");
	mkdirSync(home, { recursive: true });
	// shortcut: one temp folder per server start, left to the system's temp cleanup; remove it at the run's end if they pile up.
	const { tmp, sockets } = await commandTemp("mcp-", home);
	return sandboxed(
		[
			`cd ${quote(home)}`,
			`export TMPDIR=${quote(tmp)} npm_config_cache=${quote(join(home, "npm"))} XDG_CACHE_HOME=${quote(join(home, "xdg"))}`,
			command,
		].join("\n"),
		[home, tmp],
		network,
		sockets,
	);
}
