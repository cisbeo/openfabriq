import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { pidsUnder, stopProcessesIn } from "../../src/workspace/processes.js";

let dir: string | undefined;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

it("reads the pids working in a folder or under it, not in a folder that only shares its prefix", () => {
	const out = [
		"p10",
		"fcwd",
		"n/runs/a",
		"p11",
		"fcwd",
		"n/runs/a/node_modules/.bin",
		"p12",
		"fcwd",
		"n/runs/ab",
		"p13",
		"fcwd",
		"n/",
	].join("\n");
	expect(pidsUnder(out, "/runs/a")).toEqual([10, 11]);
});

it("stops a process an agent left running in its worktree, and only that one", async () => {
	dir = realpathSync(mkdtempSync(join(tmpdir(), "of-processes-")));
	mkdirSync(join(dir, "worktree"));
	mkdirSync(join(dir, "other"));
	const left = spawn("sleep", ["30"], { cwd: join(dir, "worktree") });
	const other = spawn("sleep", ["30"], { cwd: join(dir, "other") });
	const exited = new Promise((resolve) => left.on("exit", resolve));
	try {
		const stopped = await stopProcessesIn(join(dir, "worktree"));
		expect(stopped).toContain(left.pid);
		expect(stopped).not.toContain(other.pid);
		await exited;
		expect(other.exitCode).toBeNull();
	} finally {
		left.kill();
		other.kill();
	}
});

it("stops nothing for a folder that is gone", async () => {
	dir = mkdtempSync(join(tmpdir(), "of-processes-"));
	expect(await stopProcessesIn(join(dir, "missing"))).toEqual([]);
});
