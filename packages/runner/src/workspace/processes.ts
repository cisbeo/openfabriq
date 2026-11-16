import { readdirSync, readlinkSync, realpathSync } from "node:fs";
import { sep } from "node:path";
import { exec } from "../exec.js";

const inside = (path: string, root: string) =>
	path === root || path.startsWith(root + sep);

/** The pids of `lsof -Fpn -d cwd` whose working directory is `root` or under it. */
export function pidsUnder(lsofOutput: string, root: string): number[] {
	const pids: number[] = [];
	let pid: number | undefined;
	for (const line of lsofOutput.split("\n")) {
		if (line.startsWith("p")) pid = Number(line.slice(1));
		else if (line.startsWith("n") && pid && inside(line.slice(1), root))
			pids.push(pid);
	}
	return pids;
}

async function workingIn(root: string): Promise<number[]> {
	if (process.platform === "linux") {
		const pids: number[] = [];
		for (const entry of readdirSync("/proc")) {
			const pid = Number(entry);
			if (!pid) continue;
			try {
				if (inside(readlinkSync(`/proc/${pid}/cwd`), root)) pids.push(pid);
			} catch {
				// Gone already, or another user's process.
			}
		}
		return pids;
	}
	const out = await exec("lsof", [
		"-a",
		"-d",
		"cwd",
		"-u",
		String(process.getuid?.()),
		"-Fpn",
	]).catch((error: Error & { stdout?: string }) => error.stdout ?? "");
	return pidsUnder(out, root);
}

/**
 * Stops what an agent left running in its worktree (a dev server, a browser): they would outlive the
 * run, keep its port and its files. Returns the pids it stopped.
 */
export async function stopProcessesIn(dir: string): Promise<number[]> {
	let root: string;
	try {
		root = realpathSync(dir);
	} catch {
		return [];
	}
	const pids = (await workingIn(root)).filter((pid) => pid !== process.pid);
	for (const pid of pids) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Ended in between.
		}
	}
	return pids;
}
