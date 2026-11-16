import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { readRuns, requestRun } from "@openfabriq/runner";
import { beforeAll, expect, it } from "vitest";
import { applyProject, freshHome } from "../support/home.js";
import { ROOT } from "../support/paths.js";

// The persistent queue: the engine's process dies in the middle of
// a run; started again, it ends that run as interrupted and runs it again, once.

const REPO = "acme/app";

beforeAll(() => {
	freshHome();
	applyProject(REPO, {
		"factory.yaml": `name: E2E\nrepository: ${REPO}\nmaintainers: [alice]\n`,
		"agents/nightly/agent.md": "---\ndescription: Nightly\n---\nWork.\n",
		"automations/nightly/automation.md":
			'---\nwhen:\n  schedule: { cron: "0 3 * * *" }\nagent: nightly\nconcurrency: repository\n---\nDo the nightly work.\n',
	});
});

function engineProcess(slow: boolean) {
	const child: ChildProcess = spawn(
		process.execPath,
		[join(ROOT, "e2e/support/engine-child.mjs")],
		{
			env: { ...process.env, ...(slow ? { SLOW: "1" } : {}) },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let output = "";
	child.stdout?.on("data", (c: Buffer) => {
		output += c.toString();
	});
	child.stderr?.on("data", (c: Buffer) => {
		output += c.toString();
	});
	const saw = async (text: string) => {
		for (let i = 0; i < 200 && !output.includes(text); i++)
			await new Promise((r) => setTimeout(r, 100));
		if (!output.includes(text))
			throw new Error(`never saw "${text}" in:\n${output}`);
	};
	return { child, saw, output: () => output };
}

it("ends a run cut by a dead engine as interrupted, and runs it again once", async () => {
	requestRun(REPO, {
		id: "req-1",
		automation: "nightly",
		isPullRequest: false,
		by: "e2e",
		at: new Date().toISOString(),
	});
	const first = engineProcess(true);
	await first.saw("started acme/app: nightly");
	first.child.kill("SIGKILL"); // a crash, or the machine turned off
	await new Promise((r) => first.child.once("exit", r));

	const second = engineProcess(false);
	await second.saw("succeeded acme/app: nightly");
	second.child.kill("SIGTERM");
	expect(second.output()).toContain(
		"restored 0 waiting and 1 interrupted runs",
	);

	const runs = readRuns(REPO);
	expect(runs.map((r) => [r.status, r.reason ?? ""]).sort()).toEqual([
		["failed", "interrupted: the engine stopped"],
		["succeeded", "the agent proposed no output"],
	]);
});
