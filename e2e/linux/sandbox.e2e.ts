import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ROOT } from "../support/paths.js";

// The shell sandbox on Linux, in a Docker container with
// bubblewrap, as a non-root user, with the options the engine's image runs with. A real agent (haiku) needs Claude's login in the
// volume openfabriq-e2e-home: `pnpm e2e:linux:login` once; without it, those tests are skipped.

const IMAGE = "openfabriq-e2e-linux";
// What bubblewrap needs, and no more: --privileged is not needed (docker-compose.yml).
const SANDBOX = [
	"--security-opt",
	"seccomp=unconfined",
	"--security-opt",
	"apparmor=unconfined",
	"--security-opt",
	"systempaths=unconfined",
];
const docker = (args: string[], timeout = 600_000) =>
	spawnSync("docker", args, { encoding: "utf8", timeout });
const hasDocker = docker(["info"], 20_000).status === 0;

interface Result {
	loggedIn: boolean;
	status: string;
	reason: string;
	costUsd: number;
	bash: string[];
	/** Whether a file the agent tried to write outside the worktree is really there afterwards. */
	outsideWritten: boolean;
	committed: string;
	/** The credential of each request to the fake API (token, api-key): "token", "key", "other" or "none". */
	api?: string[];
	/** evidence: the pull requests the engine opened, the image's first bytes on the origin, the branches holding it. */
	pulls?: { title: string; body: string; head: string }[];
	png?: string;
	onOrigin?: string;
}

function run(
	scenario:
		| "shell"
		| "read"
		| "commands"
		| "token"
		| "api-key"
		| "refs"
		| "network"
		| "evidence"
		| "sockets"
		| "settings"
		| "astro"
		| "command-sockets",
	withoutBubblewrap = false,
): Result {
	const node = `node /repo/e2e/linux/run-in-linux.mjs ${scenario}`;
	const result = docker([
		"run",
		"--rm",
		...SANDBOX,
		"-v",
		"openfabriq-e2e-home:/home/dev",
		"-v",
		`${ROOT}:/repo:ro`,
		...(withoutBubblewrap
			? [
					"--user",
					"root",
					IMAGE,
					"sh",
					"-c",
					`rm -f /usr/bin/bwrap && su dev -c "${node}"`,
				]
			: [IMAGE, "sh", "-c", node]),
	]);
	const line = `${result.stdout}`
		.split("\n")
		.find((l) => l.startsWith("RESULT "));
	if (!line) throw new Error(`no result:\n${result.stdout}\n${result.stderr}`);
	return JSON.parse(line.slice("RESULT ".length));
}

const loggedIn = () =>
	hasDocker &&
	docker(
		[
			"run",
			"--rm",
			"-v",
			"openfabriq-e2e-home:/home/dev",
			IMAGE,
			"test",
			"-f",
			"/home/dev/.claude/.credentials.json",
		],
		60_000,
	).status === 0;

describe.skipIf(!hasDocker)("Linux", () => {
	beforeAll(() => {
		const built = docker(["build", "-q", "-t", IMAGE, join(ROOT, "e2e/linux")]);
		if (built.status !== 0) throw new Error(built.stderr);
	});

	it("without bubblewrap, an agent with shell fails with the reason, and never runs unsandboxed", () => {
		const result = run("shell", true);
		expect(result.status).toBe("failed");
		expect(result.reason).toContain("bubblewrap (bwrap) not installed");
		expect(result.bash).toEqual([]);
	});

	it("without bubblewrap, the engine's commands fail with the reason, and never run unsandboxed", () => {
		const result = run("commands", true);
		expect(result.status).toBe("failed");
		expect(result.reason).toMatch(/bwrap|bubblewrap/);
		expect(result.outsideWritten).toBe(false);
	});

	it("the engine's commands (setup, checks, run_command) read no secret and write only where they must", () => {
		const result = run("commands");
		const probe = result.bash[0] ?? "";
		expect(result.status, probe).toBe("succeeded");
		for (const secret of [
			"secrets.json",
			"viewer-token",
			"ssh key",
			"gh config",
			"claude login",
		])
			expect(probe).toContain(`read ${secret}: no`);
		expect(probe).toContain("read toolchain: yes");
		expect(probe).toContain("write worktree: ok");
		expect(result.outsideWritten).toBe(false);
		// Tools keep their settings in the command's own folder, never the home's ~/.config.
		expect(probe).toContain("write ~/.config: no");
		expect(probe).toContain("write settings: ok");
		// On Linux a command's temp folder is one no other command can list (runTemp).
		expect(probe).toMatch(
			/XDG_CONFIG_HOME: \/tmp\/of-[0-9a-z]+\/[\w-]{11}\/config\n/,
		);
		// The proxy refuses a site off the network (403), offline or not.
		expect(probe).toContain("off the list: 403");
		expect(probe).toContain(
			"openfabriq: the network refused off-the-list.invalid: it is not in network.",
		);
		// Offline, both fail: what matters is that Node's fetch goes where curl goes.
		expect(probe.match(/fetch: (\w+)/)?.[1]).toBe(
			probe.match(/curl: (\w+)/)?.[1],
		);
		// Measured, not required.
		console.log(
			probe.match(/unix socket: [^\n]*/)?.[0],
			probe.match(/git commit: [^\n]*/)?.[0],
			probe.match(/read another run: [^\n]*/)?.[0],
		);
	});

	it("a fresh Astro site builds as a check, its telemetry's setting kept out of the home folder", () => {
		const result = run("astro");
		expect(result.status, result.reason).toBe("succeeded");
		expect(result.outsideWritten).toBe(false);
	});

	it("the agent's shell keeps its tools' settings in the run's temp folder, never the home's ~/.config", () => {
		const result = run("settings");
		expect(result.status, result.reason).toBe("succeeded");
		const probe = result.bash.join("\n");
		expect(probe).toContain("write ~/.config: no");
		expect(probe).toContain("write settings: ok");
		expect(probe).toMatch(/XDG_CONFIG_HOME: \/tmp\/\S+\/config\n/);
	});

	it("with the tokens in the environment, as in Docker, Claude Code sends its own and the agent's shell sees neither", () => {
		const result = run("token");
		expect(result.status, result.reason).toBe("succeeded");
		expect(result.api).toContain("token");
		expect(result.api).not.toContain("other");
		const probe = result.bash.join("\n");
		expect(probe).toContain("gh token in env: no");
		expect(probe).toContain("\ntoken in env: no");
		expect(probe).toContain("token in /proc: no");
		expect(probe).not.toContain("environments read: 0");
	});

	it("in the sandbox, the agent's shell commits but cannot move origin's branches nor change the config of the shared clone", () => {
		const result = run("refs");
		expect(result.status, result.reason).toBe("succeeded");
		const probe = result.bash.join("\n");
		expect(probe).toContain("commit: ok");
		expect(probe).toContain("move origin ref: no");
		expect(probe).toContain("local branch: ok");
		expect(probe).toContain("change config: no");
		expect(result.committed).toBe("refs");
	});

	it("the agent.s shell reaches the sites of its network, and is refused the others without a prompt", () => {
		const result = run("network");
		expect(result.status, result.reason).toBe("succeeded");
		const probe = result.bash.join("\n");
		expect(probe).toContain("off the list: 403");
		expect(probe).toContain("listed: 502");
	});

	it("the agent's shell opens Unix sockets of its own, and reaches none of the machine's nor another run's folder", () => {
		const result = run("sockets");
		expect(result.status, result.reason).toBe("succeeded");
		const probe = result.bash.join("\n");
		expect(probe).toContain("own socket: ok");
		expect(probe).not.toContain("REACHED");
		expect(probe.match(/: no \(/g)).toHaveLength(4);
		expect(probe).toContain("list the runs' folders: no");
		expect(probe).toContain("user namespace: no");
	});

	it("the engine's commands open Unix sockets of their own: agent-browser screenshots a page, and none of the machine's sockets is reached", () => {
		const result = run("command-sockets");
		const probe = result.bash.join("\n");
		expect(result.status, result.reason).toBe("succeeded");
		expect(probe).toContain("own socket: ok");
		expect(probe).not.toContain("REACHED");
		expect(probe.match(/: no \(/g)).toHaveLength(4);
		expect(probe).toContain("list the commands' folders: no");
		expect(result.png).toBe("89504e470d0a1a0a");
	});

	it("an agent screenshots its page with agent-browser in its sandbox, and the pull request the engine opens shows the image", () => {
		const result = run("evidence");
		expect(result.status, result.reason).toBe("succeeded");
		const body = result.pulls?.[0]?.body ?? "";
		const link = body.match(
			/!\[built\]\(https:\/\/github\.com\/acme\/site\/blob\/([0-9a-f]{40})\/evidence\/1\/home-built-390\.png\?raw=true\)/,
		);
		expect(link, body).not.toBeNull();
		// The image is on the origin, at the commit the link names, on the pull request's branch.
		expect(result.png).toBe("89504e470d0a1a0a");
		expect(result.onOrigin).toBe(result.pulls?.[0]?.head);
	});

	it("with an API key next to the token, Claude Code sends the key alone and the agent's shell does not see it", () => {
		const result = run("api-key");
		expect(result.status, result.reason).toBe("succeeded");
		expect(result.api).toContain("key");
		expect(result.api).not.toContain("token");
		expect(result.api).not.toContain("other");
		const probe = result.bash.join("\n");
		expect(probe).toContain("key in env: no");
		expect(probe).toContain("key in /proc: no");
		expect(probe).toContain("key file: no");
		expect(probe).toContain("\ntoken in env: no");
		expect(probe).not.toContain("environments read: 0");
	});

	describe.skipIf(!loggedIn())(
		"with Claude's login (pnpm e2e:linux:login)",
		() => {
			it("without bubblewrap, an agent without shell still runs", () => {
				expect(run("read", true)).toMatchObject({ status: "succeeded" });
			});

			it("in the sandbox, the agent's shell reads no secret, writes only the worktree, and sees no MCP token", () => {
				const result = run("shell");
				expect(result.status).toBe("succeeded");
				const probe =
					result.bash.find((b) => b.includes("read secrets.json")) ?? "";
				if (!probe)
					throw new Error(`no probe output: ${JSON.stringify(result)}`);
				for (const secret of [
					"secrets.json",
					"viewer-token",
					"ssh key",
					"gh config",
					"claude login",
					"another run",
				])
					expect(probe).toContain(`read ${secret}: no`);
				expect(probe).toContain("read toolchain: yes");
				expect(probe).toContain("write worktree: ok");
				expect(probe).toContain("token in ps: no");
				expect(probe).toContain("git commit: ok");
				// strictAllowlist: Claude Code's proxy refuses a site off the agent's network, without asking.
				expect(probe).toContain("off the list: 403");
				expect(result.committed).toBe("probe");
				expect(result.outsideWritten).toBe(false);
				// Measured, not required: the sandbox's design expects Unix sockets to be refused on Linux.
				console.log(
					probe.match(/unix socket: [^\\\n]*/)?.[0],
					probe.match(/processes seen: \d+/)?.[0],
				);
			});
		},
	);
});
