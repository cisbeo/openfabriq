import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeAgent, readRuns, requestRun } from "@openfabriq/runner";
import { afterAll, beforeAll, expect, it } from "vitest";
import { settled, testEngine } from "../support/engine.js";
import { fakeGitHub } from "../support/github.js";
import { applyProject, freshHome } from "../support/home.js";
import { ROOT } from "../support/paths.js";
import { freePort } from "../support/relay.js";
import { toolCalls } from "../support/transcript.js";

// With a real agent (haiku): the factory's MCP servers, a remote
// one with a bearer token and a local one with a secret. The agent calls what it lists, nothing
// else, and its shell sees neither secret.

const REPO = "acme/app";
const TOKEN = `canary-token-${Math.random().toString(36).slice(2)}`;
const DB_URL = `canary-db-${Math.random().toString(36).slice(2)}`;
const SERVER = join(ROOT, "e2e/support/mcp-server.mjs");
const log = join(
	mkdtempSync(join(tmpdir(), "openfabriq-e2e-mcp-")),
	"calls.log",
);
let remote: ChildProcess;
let port: number;
// The local server runs in the commands' sandbox: it writes only in its own folder.
let localLog: string;

beforeAll(async () => {
	port = await freePort();
	remote = spawn(process.execPath, [SERVER, "http", String(port)], {
		env: { ...process.env, MCP_LOG: log, MCP_EXPECTED_TOKEN: TOKEN },
		stdio: "ignore",
	});
	const home = freshHome();
	localLog = join(home, "projects", REPO, "mcp", "calls.log");
	// The engine's environment, where secrets come from.
	process.env.E2E_MCP_TOKEN = TOKEN;
	process.env.E2E_DB_URL = DB_URL;
	process.env.MCP_LOG = log;
	applyProject(
		REPO,
		{
			"factory.yaml": `name: E2E
repository: ${REPO}
maintainers: [alice]
model: haiku
env:
  MCP_LOG: calls.log
secrets: [E2E_MCP_TOKEN, E2E_DB_URL]
mcp:
  remote:
    url: http://127.0.0.1:${port}/mcp
    secret: E2E_MCP_TOKEN
  local:
    command: node ${SERVER}
    secrets: [E2E_DB_URL]
`,
			"agents/prober/agent.md": `---
description: Calls tools and reports what it sees
tools: [read, shell]
mcp:
  remote: [echo, missing_tool]
  local: [echo]
---
You follow the task exactly and report each result.
`,
			"automations/probe/automation.md": `---
when:
  schedule: { cron: "0 3 * * *" }
agent: prober
---
Do these steps in order, then stop:
1. Call the echo tool of the remote server with the text "hello-remote".
2. Call the echo tool of the local server with the text "hello-local".
3. Call the print_env tool of the local server.
4. Run this shell command: sh probe.sh
Report each result.
`,
		},
		{
			"README.md": "# app\n",
			// Says only whether a secret is visible; it never prints one.
			"probe.sh": `A="${TOKEN.slice(0, 13)}"; B="${DB_URL.slice(0, 10)}"
env | grep -q "\${A}${TOKEN.slice(13)}" && echo "token in env: YES" || echo "token in env: no"
env | grep -q "\${B}${DB_URL.slice(10)}" && echo "db secret in env: YES" || echo "db secret in env: no"
ps -axwwE -o args 2>/dev/null | grep -v grep | grep -q "\${A}${TOKEN.slice(13)}" && echo "token in ps: YES" || echo "token in ps: no"
ps -axwwE -o args 2>/dev/null | grep -v grep | grep -q "\${B}${DB_URL.slice(10)}" && echo "db secret in ps: YES" || echo "db secret in ps: no"
`,
		},
	);
});
afterAll(() => {
	remote?.kill();
	delete process.env.E2E_MCP_TOKEN;
	delete process.env.E2E_DB_URL;
});

it("calls the listed tools of both servers, never another, and its shell sees no secret", async () => {
	requestRun(REPO, {
		id: "mcp-1",
		automation: "probe",
		isPullRequest: false,
		by: "e2e",
		at: new Date().toISOString(),
	});
	const { github, writes } = fakeGitHub();
	const engine = testEngine(github, claudeAgent);
	engine.start();
	const [run] = await settled(engine, REPO, 1);
	engine.stop();
	if (!run) throw new Error("no run");
	expect(run.status).toBe("succeeded");
	expect(run.mcpUnavailable).toEqual(["remote.missing_tool"]);
	expect(writes).toEqual([]);

	const calls = toolCalls(REPO, run.id);
	const result = (name: string) => calls.find((c) => c.name === name);
	expect(result("mcp__remote__echo")?.result).toContain(
		"remote echo: hello-remote",
	);
	expect(result("mcp__local__echo")?.result).toContain(
		"local echo: hello-local",
	);
	// print_env is not listed: refused if the agent tried, and never run by the server.
	const printEnv = result("mcp__local__print_env");
	if (printEnv) expect(printEnv.error).toBe(true);
	const probe = calls.find(
		(c) => c.name === "Bash" && c.input.includes("probe.sh"),
	);
	expect(probe?.result).toContain("token in env: no");
	expect(probe?.result).toContain("db secret in env: no");
	expect(probe?.result).toContain("token in ps: no");
	expect(probe?.result).toContain("db secret in ps: no");

	const served = readFileSync(log, "utf8") + readFileSync(localLog, "utf8");
	expect(served).toContain("local started, secret received");
	expect(served).toContain('remote call echo {"text":"hello-remote"}');
	expect(served).toContain('local call echo {"text":"hello-local"}');
	expect(served).not.toContain("call print_env");
	expect(served).not.toContain("remote refused");
	console.log(`MCP run: ${run.costUsd?.toFixed(4)} USD, ${run.turns} turns`);
	expect(readRuns(REPO)).toHaveLength(1);
});
