// M1 spike: proves the local execution model before any engine code is written.
// Run: OPENFABRIQ_SPIKE_REPO=owner/name OPENFABRIQ_SPIKE_CHECKOUT=/path/to/its/clone \
//   node --experimental-strip-types packages/runner/spike/m1-agent-sdk.ts
// The repository is a private one of yours, cloned locally with an `npm test`.
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	Options,
	SDKMessage,
	SDKResultMessage,
	SDKSystemMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
	createSdkMcpServer,
	query,
	tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const CLAUDE = spawnSync("which", ["claude"], {
	encoding: "utf8",
}).stdout.trim();
const { OPENFABRIQ_SPIKE_REPO: TEST_REPO, OPENFABRIQ_SPIKE_CHECKOUT } =
	process.env;
if (!TEST_REPO || !OPENFABRIQ_SPIKE_CHECKOUT)
	throw new Error(
		"Set OPENFABRIQ_SPIKE_REPO (owner/name) and OPENFABRIQ_SPIKE_CHECKOUT (its local clone).",
	);
const TEST_REPO_HTTPS = `https://github.com/${TEST_REPO}.git`;
const TEST_REPO_SSH = `git@github.com:${TEST_REPO}.git`;
const TEST_REPO_CHECKOUT = OPENFABRIQ_SPIKE_CHECKOUT;

// Inherit PATH and HOME (Claude Code needs them for its own login), drop every GitHub, git, SSH
// and Anthropic credential, and point gh, git and ssh at empty configurations.
function credentialFreeEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined) continue;
		if (
			/^(GH_|GITHUB_|ANTHROPIC_|CLAUDE|SSH_AUTH_SOCK$|SSH_ASKPASS$|GIT_ASKPASS$)/.test(
				key,
			)
		)
			continue;
		env[key] = value;
	}
	return {
		...env,
		GH_CONFIG_DIR: mkdtempSync(join(tmpdir(), "openfabriq-gh-")),
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_TERMINAL_PROMPT: "0",
		GIT_SSH_COMMAND:
			"ssh -F /dev/null -o IdentitiesOnly=yes -o IdentityFile=/dev/null -o BatchMode=yes",
	};
}

async function run(prompt: string, options: Options) {
	const messages: SDKMessage[] = [];
	const stream = query({
		prompt,
		options: {
			pathToClaudeCodeExecutable: CLAUDE,
			cwd: mkdtempSync(join(tmpdir(), "openfabriq-run-")),
			env: credentialFreeEnv(),
			settingSources: ["project"],
			permissionMode: "dontAsk",
			maxTurns: 8,
			...options,
		},
	});
	for await (const message of stream) messages.push(message);
	const init = messages.find(
		(m): m is SDKSystemMessage => m.type === "system" && m.subtype === "init",
	);
	const result = messages.find(
		(m): m is SDKResultMessage => m.type === "result",
	);
	return { init, result };
}

function summary(result: SDKResultMessage | undefined) {
	if (!result) return { result: "missing" };
	return {
		subtype: result.subtype,
		costUsd: Number(result.total_cost_usd.toFixed(4)),
		durationS: Math.round(result.duration_ms / 1000),
		turns: result.num_turns,
		models: Object.keys(result.modelUsage),
		text:
			result.subtype === "success" ? result.result.slice(0, 300) : undefined,
	};
}

function exitCode(
	cmd: string,
	args: string[],
	env: NodeJS.ProcessEnv,
	cwd?: string,
) {
	return spawnSync(cmd, args, { env, cwd, encoding: "utf8", timeout: 120_000 })
		.status;
}

const report: Record<string, unknown> = { claudeBinary: CLAUDE };

// 1. The Agent SDK runs the installed Claude Code on its own login, with no API key in the environment.
const auth = await run("Reply with the single word OK.", { tools: [] });
report.auth = {
	apiKeySource: auth.init?.apiKeySource,
	claudeCodeVersion: auth.init?.claude_code_version,
	model: auth.init?.model,
	...summary(auth.result),
};

// 2. A custom tool records a proposal and writes nothing.
const proposals: { kind: string; body: string }[] = [];
const outputs = createSdkMcpServer({
	name: "openfabriq",
	tools: [
		tool(
			"comment",
			"Propose a comment on the issue. The engine decides whether to post it.",
			{ body: z.string() },
			async ({ body }) => {
				proposals.push({ kind: "comment", body });
				return {
					content: [
						{
							type: "text",
							text: "Recorded. The engine will post it if allowed.",
						},
					],
				};
			},
		),
	],
});
const custom = await run(
	'Use the comment tool to propose this comment: "hello from openfabriq". Then stop.',
	{
		tools: [],
		mcpServers: { openfabriq: outputs },
		allowedTools: ["mcp__openfabriq__comment"],
	},
);
report.customTool = { proposals, ...summary(custom.result) };

// 3. settingSources ["project"] leaves the machine's ~/.claude out (compare with ["user", "project"]).
const withUser = await run("Reply with the single word OK.", {
	tools: [],
	settingSources: ["user", "project"],
});
const loaded = (init: SDKSystemMessage | undefined) => ({
	plugins: init?.plugins.length,
	skills: init?.skills.length,
	agents: init?.agents?.length,
	slashCommands: init?.slash_commands.length,
});
report.settingSources = {
	project: loaded(auth.init),
	userAndProject: loaded(withUser.init),
};

// 4. Without credentials, gh and git cannot reach the private test repo, but the project's tests still run.
const clean = credentialFreeEnv();
report.credentials = {
	machineEnv: {
		ghAuth: exitCode("gh", ["auth", "status"], process.env),
		gitHttps: exitCode(
			"git",
			["ls-remote", TEST_REPO_HTTPS, "HEAD"],
			process.env,
		),
	},
	agentEnv: {
		ghAuth: exitCode("gh", ["auth", "status"], clean),
		gitHttps: exitCode("git", ["ls-remote", TEST_REPO_HTTPS, "HEAD"], clean),
		gitSsh: exitCode("git", ["ls-remote", TEST_REPO_SSH, "HEAD"], clean),
		projectTests: exitCode("npm", ["test"], clean, TEST_REPO_CHECKOUT),
	},
};
const shell = await run(
	`Run each command with the Bash tool and report its exit code, one per line: ` +
		`"gh auth status", "git ls-remote ${TEST_REPO_HTTPS} HEAD", "node --version".`,
	{ tools: ["Bash"], allowedTools: ["Bash"] },
);
report.credentialsInsideAgent = summary(shell.result);

// 5. Cost and tokens are available at the end of every run (see the summaries above).
console.log(JSON.stringify(report, null, 2));
