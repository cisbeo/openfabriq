import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { type GitHubApp, githubApp, home } from "@openfabriq/runner";
import { gitConfig } from "../../projects.js";
import { GIT_NO_EMAIL, GIT_NO_NAME } from "../prerequisites.js";

// What "start" checks before the engine runs: its options, the studio's port, the one engine per
// home folder, and git's user, whom the runs commit as.

/** The studio's port, unless --port names another. */
const STUDIO_PORT = 4310;

/** The port --port asks for, or the studio's own. */
export function studioPort(value: string | undefined): number {
	if (value === undefined) return STUDIO_PORT;
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65_535)
		throw new Error("--port takes a port number, from 1 to 65535.");
	return port;
}

/** How many runs go at once, all projects together: OPENFABRIQ_MAX_RUNS, or the engine's own (4). */
export function maxRuns(env: NodeJS.ProcessEnv): number | undefined {
	const value = env.OPENFABRIQ_MAX_RUNS;
	if (value === undefined || value === "") return undefined;
	const runs = Number(value);
	if (!Number.isInteger(runs) || runs < 1 || runs > 32)
		throw new Error(
			"OPENFABRIQ_MAX_RUNS takes a number of runs, from 1 to 32.",
		);
	return runs;
}

/** How often GitHub is read, in ms: --interval, else OPENFABRIQ_INTERVAL, else the engine's own (60 s). */
export function pollInterval(
	flag: string | undefined,
	env: NodeJS.ProcessEnv,
): number | undefined {
	const [name, value] =
		flag !== undefined
			? ["--interval", flag]
			: ["OPENFABRIQ_INTERVAL", env.OPENFABRIQ_INTERVAL];
	if (value === undefined || value === "") return undefined;
	const ms = Number(value) * 1000;
	if (!(Number.isFinite(ms) && ms >= 10_000))
		throw new Error(`${name} takes a number of seconds, 10 or more.`);
	return ms;
}

/**
 * --interval and --port, checked before anything is applied: a wrong option or a taken port
 * never leaves labels created and a factory applied for an engine that does not start.
 */
export async function readStartOptions(
	values: {
		interval?: string | undefined;
		port?: string | undefined;
	},
	env: NodeJS.ProcessEnv = process.env,
): Promise<{ intervalMs?: number; maxRuns?: number; port: number }> {
	const port = studioPort(values.port);
	const runs = maxRuns(env);
	const intervalMs = pollInterval(values.interval, env);
	await refusePortTaken(port);
	return {
		...(intervalMs !== undefined ? { intervalMs } : {}),
		...(runs !== undefined ? { maxRuns: runs } : {}),
		port,
	};
}

/** Whether a process with this id runs on the machine. */
function processRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// It runs, as another user.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * One engine per home folder: two on the same projects remove each other's worktrees and break
 * their runs. The file names the engine's process; a file left by an engine that died is taken over.
 * Returns what frees it.
 */
export function lockHome(
	file = join(home(), "engine.pid"),
	pid = process.pid,
	running = processRunning,
): () => void {
	let other: number | undefined;
	try {
		other = Number(readFileSync(file, "utf8").trim()) || undefined;
	} catch {
		other = undefined;
	}
	if (other && other !== pid && running(other))
		throw new Error(
			`another "openfabriq start" (process ${other}) runs the projects of ${dirname(file)}: stop it first (Ctrl-C in its terminal). Two engines on the same projects break each other's runs.`,
		);
	writeFileSync(file, String(pid));
	return () => rmSync(file, { force: true });
}

/** Whether something already listens on 127.0.0.1 at this port. */
export function portTaken(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = createServer();
		probe.once("error", () => resolve(true));
		probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(false)));
	});
}

/** The studio's port taken: say so before anything starts, with the way out. */
export async function refusePortTaken(port: number) {
	if (await portTaken(port))
		throw new Error(
			`127.0.0.1:${port} is taken, most likely by another "openfabriq start": stop it first (Ctrl-C in its terminal), or give the studio another port with --port.`,
		);
}

/**
 * The name and email of git's user, which the runs commit with. A key git does not have is said
 * with the command that sets it, as the first-use check says it. As a GitHub App, the app's bot,
 * so GitHub links the commits to it, unless GIT_USER_NAME and GIT_USER_EMAIL name another.
 */
export async function gitIdentity(
	config = gitConfig,
	app: Pick<GitHubApp, "identity"> | undefined = githubApp(),
	env: NodeJS.ProcessEnv = process.env,
): Promise<{ name: string; email: string }> {
	if (app)
		return env.GIT_USER_NAME && env.GIT_USER_EMAIL
			? { name: env.GIT_USER_NAME, email: env.GIT_USER_EMAIL }
			: app.identity();
	const read = (key: string) => config(key).catch(() => undefined);
	const [name, email] = await Promise.all([
		read("user.name"),
		read("user.email"),
	]);
	if (name === undefined || email === undefined)
		throw new Error(
			[name === undefined && GIT_NO_NAME, email === undefined && GIT_NO_EMAIL]
				.filter(Boolean)
				.join("\n"),
		);
	return { name, email };
}
