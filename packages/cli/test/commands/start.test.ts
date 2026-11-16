import {
	appendFileSync,
	chmodSync,
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { Factory } from "@openfabriq/core";
import { factorySecretsPath, writeFactorySecret } from "@openfabriq/runner";
import { expect, it, vi } from "vitest";
import { readCommandLine } from "../../src/args.js";
import type { ApplyDeps } from "../../src/commands/apply/index.js";
import {
	announce,
	plainStartLines,
	signInAddress,
	startBlock,
	wikiHint,
} from "../../src/commands/start/banner.js";
import {
	linearNotes,
	serviceClients,
} from "../../src/commands/start/connections.js";
import { startCommand } from "../../src/commands/start/index.js";
import {
	gitIdentity,
	lockHome,
	maxRuns,
	pollInterval,
	portTaken,
	studioPort,
} from "../../src/commands/start/preflight.js";
import { secretWarnings } from "../../src/secret-warnings.js";

const ROOT = join(import.meta.dirname, "../../../..");

it("refuses a wrong --interval or a taken port before it applies anything", async () => {
	const repo = mkdtempSync(join(tmpdir(), "openfabriq-repo-"));
	cpSync(
		join(ROOT, "fixtures/valid/sdlc/openfabriq"),
		join(repo, "openfabriq"),
		{ recursive: true },
	);
	const asked: string[] = [];
	const record =
		<T>(name: string, value: T) =>
		async () => {
			asked.push(name);
			return value;
		};
	const deps: ApplyDeps = {
		github: {
			defaultBranch: record("defaultBranch", "main"),
			labels: record("labels", []),
			createLabel: record("createLabel", undefined),
			clone: record("clone", undefined),
		},
		git: {
			branch: record("branch", "main"),
			dirty: record("dirty", false),
			origin: record("origin", undefined),
		},
		confirm: record("confirm", false),
		print: () => {},
	};
	const startIn = (...options: string[]) =>
		startCommand(readCommandLine(["start", repo, ...options]), deps);
	for (const interval of ["abc", "0", "5", "Infinity"])
		await expect(startIn("--interval", interval)).rejects.toThrow(
			"--interval takes a number of seconds, 10 or more.",
		);
	await expect(startIn("--port", "0")).rejects.toThrow(
		"--port takes a port number, from 1 to 65535.",
	);
	const holder = createServer();
	await new Promise<void>((done) => holder.listen(0, "127.0.0.1", done));
	const address = holder.address();
	const port = typeof address === "object" && address ? address.port : 0;
	await expect(startIn("--port", String(port))).rejects.toThrow(
		`127.0.0.1:${port} is taken, most likely by another "openfabriq start"`,
	);
	await new Promise((done) => holder.close(done));
	expect(asked).toEqual([]);
});

const RELAY = { url: "https://relay.example", token: "t" };

const reads = (repository: string, url?: string) =>
	({
		repository,
		sentry: { organization: "acme", project: "web", ...(url ? { url } : {}) },
		automations: { triage: { when: [{ event: "sentry.issue.created" }] } },
	}) as unknown as Factory;

const chat = {
	repository: "acme/chat",
	slack: { channel: "dev" },
	automations: { answer: { when: [{ event: "slack.mentioned" }] } },
} as unknown as Factory;

it("keeps the Sentry token on the Sentry it is for, and says which factory points elsewhere", () => {
	const secrets = {
		relay: RELAY,
		sentry: { token: "sntryu_t", url: "https://sentry.io" },
	};
	const { clients: out, notes: lines } = serviceClients(
		[reads("acme/app"), reads("acme/web", "https://sentry.evil.example")],
		secrets,
	);
	expect(out.sentry?.origin).toBe("https://sentry.io");
	expect(lines).toEqual([
		"relay: listening for acme/app, acme/web",
		'sentry: acme/web points at https://sentry.evil.example but the token is for https://sentry.io; run "openfabriq connect sentry"',
	]);
});

it("starts no Sentry client when no factory is on the token's Sentry", () => {
	const { clients: out } = serviceClients(
		[reads("acme/web", "https://sentry.evil.example")],
		{ relay: RELAY, sentry: { token: "sntryu_t", url: "https://sentry.io" } },
	);
	expect(out.sentry).toBeUndefined();
	expect(out.relay).toBeDefined();
});

it("says which service of a factory is not connected, once the relay is", () => {
	const { clients: out, notes: lines } = serviceClients(
		[chat, reads("acme/app")],
		{ relay: RELAY },
	);
	expect(out.relay).toBeDefined();
	expect(out.slack).toBeUndefined();
	expect(out.sentry).toBeUndefined();
	expect(lines).toEqual([
		"relay: listening for acme/chat, acme/app",
		'slack: acme/chat listen to Slack, but Slack is not connected; run "openfabriq connect slack"',
		'sentry: acme/app listen to Sentry, but Sentry is not connected; run "openfabriq connect sentry"',
	]);
});

it("hears Slack and Sentry only through the relay", () => {
	const secrets = {
		slack: { bot_token: "xoxb-1" },
		sentry: { token: "sntryu_t" },
	};
	const { clients: missing, notes: lines } = serviceClients(
		[chat, reads("acme/app")],
		secrets,
	);
	expect(missing).toEqual({});
	expect(lines).toEqual([
		'acme/chat: listens to slack.mentioned, but the relay is not connected; run "openfabriq connect relay"',
		'acme/app: listens to sentry.issue.created, but the relay is not connected; run "openfabriq connect relay"',
	]);
	const { clients: out } = serviceClients([chat, reads("acme/app")], {
		...secrets,
		relay: RELAY,
	});
	expect(out.slack).toBeDefined();
	expect(out.sentry).toBeDefined();
	expect(out.relay).toBeDefined();
});

it("starts nothing for a factory that names a service but listens to none of its events", () => {
	const quiet = { ...chat, automations: {} } as unknown as Factory;
	const { clients, notes: lines } = serviceClients([quiet], {
		relay: RELAY,
		slack: { bot_token: "x" },
	});
	expect(clients).toEqual({});
	expect(lines).toEqual([]);
});

const delegates = (repository: string) =>
	({
		repository,
		linear: { team: "ENG" },
		automations: { implement: { when: [{ event: "linear.issue.delegated" }] } },
	}) as unknown as Factory;

it("connects the relay for the factories that listen to it, and says when it is missing", () => {
	const { clients: missing, notes: lines } = serviceClients(
		[delegates("acme/app")],
		{},
	);
	expect(missing.relay).toBeUndefined();
	expect(lines).toEqual([
		'acme/app: listens to linear.issue.delegated, but the relay is not connected; run "openfabriq connect relay"',
	]);
	const { clients: out } = serviceClients([delegates("acme/app")], {
		relay: RELAY,
	});
	expect(out.relay).toBeDefined();
	expect(out.linearApp).toBeDefined();
});

it("connects the relay for a factory that only listens to webhooks", () => {
	const hooks = {
		repository: "acme/ops",
		webhooks: { "deploy-failed": { signature: "standard" } },
		automations: {
			fix: { when: [{ event: "webhook.received", webhook: "deploy-failed" }] },
		},
	} as unknown as Factory;
	const lines = serviceClients([hooks], {}).notes;
	expect(lines).toEqual([
		'acme/ops: listens to webhook.received, but the relay is not connected; run "openfabriq connect relay"',
	]);
	const { clients: out } = serviceClients([hooks], { relay: RELAY });
	expect(out.relay).toBeDefined();
});

it("says when the environment hides the file, and which lines it cannot read, never a value", () => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	writeFactorySecret("acme/app", "DATABASE_URL", "file-value");
	appendFileSync(factorySecretsPath("acme/app"), "broken line\n");
	const lines = secretWarnings(
		[{ repository: "acme/app", secrets: ["DATABASE_URL"] }],
		{ DATABASE_URL: "env-value" },
	);
	expect(lines).toEqual([
		`acme/app: ${factorySecretsPath("acme/app")} has lines that do not read (line 2); write them NAME='value'`,
		`acme/app: DATABASE_URL set both in this engine's environment and in ${factorySecretsPath("acme/app")}; the environment's value is used`,
	]);
	expect(lines.join("\n")).not.toMatch(/value"|broken/);
});

it("names the secrets set nowhere on this machine, per project", () => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	writeFactorySecret("acme/web", "STRIPE_TEST_KEY", "sk_test");
	expect(
		secretWarnings(
			[
				{
					repository: "acme/app",
					secrets: ["DATABASE_URL", "STRIPE_TEST_KEY"],
				},
				{ repository: "acme/api", secrets: ["DATABASE_URL", "REDIS_URL"] },
				{
					repository: "acme/web",
					secrets: ["DATABASE_URL", "STRIPE_TEST_KEY"],
					mcp: { docs: { url: "https://docs.dev/mcp", secret: "DOCS_TOKEN" } },
				},
				{ repository: "acme/docs" },
			],
			{ DATABASE_URL: "postgres://localhost/test", REDIS_URL: "" },
		),
	).toEqual([
		'acme/app: STRIPE_TEST_KEY not set on this machine; the commands or MCP servers that need it will fail. Set it with "openfabriq secret set STRIPE_TEST_KEY"',
		'acme/web: DOCS_TOKEN not set on this machine; the commands or MCP servers that need it will fail. Set it with "openfabriq secret set DOCS_TOKEN"',
	]);
	chmodSync(factorySecretsPath("acme/web"), 0o644);
	expect(
		secretWarnings(
			[{ repository: "acme/web", secrets: ["A_TOKEN", "B_TOKEN"] }],
			{},
		),
	).toEqual([
		`acme/web: ${factorySecretsPath("acme/web")} can be read by other users of this machine; run chmod 600 on it`,
		'acme/web: A_TOKEN, B_TOKEN not set on this machine; the commands or MCP servers that need them will fail. Set each with "openfabriq secret set A_TOKEN"',
	]);
});

it("sees a taken port, so that a second start refuses before its engine runs", async () => {
	const server = createServer();
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	expect(await portTaken(port)).toBe(true);
	await new Promise((done) => server.close(done));
	expect(await portTaken(port)).toBe(false);
});

it("says how to give git a name and an email, as the first-use check does, when it has none", async () => {
	// git config --get exits 1, without a word, on a key that is not set.
	const unset = async (key: string) => {
		throw new Error(
			`git config --get ${key}: exited with code 1, without a message (often a passing network or GitHub error; the next round tries again)`,
		);
	};
	await expect(gitIdentity(unset)).rejects.toThrow(
		'git has no name for your commits: run git config --global user.name "Your Name"\ngit has no email for your commits: run git config --global user.email you@example.com',
	);
	await expect(
		gitIdentity(async (key) => (key === "user.name" ? "Ada" : unset(key))),
	).rejects.toThrow(
		/^git has no email for your commits: run git config --global user.email you@example.com$/,
	);
	expect(
		await gitIdentity(async (key) =>
			key === "user.name" ? "Ada" : "ada@example.com",
		),
	).toEqual({ name: "Ada", email: "ada@example.com" });
});

it("commits as the GitHub App's bot, unless GIT_USER_NAME and GIT_USER_EMAIL name another", async () => {
	const app = {
		identity: async () => ({
			name: "acme-factory[bot]",
			email: "99+acme-factory[bot]@users.noreply.github.com",
		}),
	};
	const never = async () => {
		throw new Error("git config is not read");
	};
	expect(await gitIdentity(never, app, {})).toEqual(await app.identity());
	expect(
		await gitIdentity(never, app, {
			GIT_USER_NAME: "Acme factory",
			GIT_USER_EMAIL: "factory@acme.dev",
		}),
	).toEqual({ name: "Acme factory", email: "factory@acme.dev" });
});

it("serves the studio on 4310, or on the port --port names", () => {
	expect(studioPort(undefined)).toBe(4310);
	expect(studioPort("4311")).toBe(4311);
	for (const wrong of ["", "abc", "0", "70000", "43.1"])
		expect(() => studioPort(wrong)).toThrow(
			"--port takes a port number, from 1 to 65535.",
		);
});

it("runs one engine per home folder, and takes over the file of an engine that died", () => {
	const file = join(
		mkdtempSync(join(tmpdir(), "openfabriq-lock-")),
		"engine.pid",
	);
	const unlock = lockHome(file, 100, () => true);
	expect(readFileSync(file, "utf8")).toBe("100");
	expect(() => lockHome(file, 200, () => true)).toThrow(
		'another "openfabriq start" (process 100) runs the projects of',
	);
	// The engine of the file died: the next one takes its place.
	lockHome(file, 200, () => false);
	expect(readFileSync(file, "utf8")).toBe("200");
	unlock();
	expect(existsSync(file)).toBe(false);
	writeFileSync(file, "not a number");
	lockHome(file, 300, () => true);
	expect(readFileSync(file, "utf8")).toBe("300");
});

it("puts the studio's address first, apart from the log, with what the engine watches and its Claude", () => {
	expect(
		startBlock({
			address: "http://127.0.0.1:4310/?token=abc",
			watching: ["acme/api", "acme/web"],
			everySeconds: 60,
			claude: "Claude: this machine's Claude Code login",
		}),
	).toEqual([
		"  Studio    http://127.0.0.1:4310/?token=abc",
		"            open it to follow the runs · Ctrl-C stops the engine",
		"  Watching  acme/api, acme/web, every 60 s",
		"  Claude    this machine's Claude Code login",
	]);
});

it("wraps the block to a narrow terminal under each value, and never cuts the address", () => {
	const address = `http://127.0.0.1:4310/?token=${"e".repeat(64)}`;
	expect(
		startBlock(
			{
				address,
				watching: ["acme/inventory-management-service", "acme/customer-portal"],
				everySeconds: 60,
				claude:
					"Claude: the API key of ANTHROPIC_API_KEY, billed per token; CLAUDE_CODE_OAUTH_TOKEN is not used",
			},
			60,
		),
	).toEqual([
		"  Studio    open it to follow the runs · Ctrl-C stops the",
		"            engine",
		`  ${address}`,
		"  Watching  acme/inventory-management-service",
		"            acme/customer-portal",
		"            every 60 s",
		"  Claude    the API key of ANTHROPIC_API_KEY, billed per",
		"            token; CLAUDE_CODE_OAUTH_TOKEN is not used",
	]);
});

it("says where to sign in when the studio has a password", () => {
	expect(signInAddress({}, 4310)).toBeUndefined();
	const password = "correct horse battery staple";
	expect(signInAddress({ password }, 4310)).toBe(
		"http://127.0.0.1:4310 with OPENFABRIQ_STUDIO_PASSWORD",
	);
	const url = new URL("https://factory.example.com");
	expect(signInAddress({ password, url }, 4310)).toBe(
		`${url.origin} with OPENFABRIQ_STUDIO_PASSWORD`,
	);
	expect(
		signInAddress(
			{ password, url, github: { clientId: "Iv1.x", clientSecret: "s" } },
			4310,
		),
	).toBe(`${url.origin} with GitHub or OPENFABRIQ_STUDIO_PASSWORD`);
	expect(
		startBlock({
			address: "http://127.0.0.1:4310/?token=abc",
			watching: ["acme/web"],
			everySeconds: 60,
			claude: "Claude: this machine's Claude Code login",
			signIn: `${url.origin} with OPENFABRIQ_STUDIO_PASSWORD`,
		}),
	).toEqual([
		"  Studio    http://127.0.0.1:4310/?token=abc",
		"            open it to follow the runs · Ctrl-C stops the engine",
		"  Sign in   https://factory.example.com with OPENFABRIQ_STUDIO_PASSWORD",
		"  Watching  acme/web, every 60 s",
		"  Claude    this machine's Claude Code login",
	]);
});

it("prints the block between empty lines, its address in the brand's blue and its hint dimmed, then the log's title", () => {
	const said: string[] = [];
	const spy = vi.spyOn(console, "log").mockImplementation((text) => {
		said.push(String(text));
	});
	const address = "http://127.0.0.1:4310/?token=abc";
	announce({
		address,
		watching: ["acme/web"],
		everySeconds: 60,
		claude: "Claude: this machine's Claude Code login",
	});
	spy.mockRestore();
	expect(said).toHaveLength(1);
	expect(stripVTControlCharacters(said[0] ?? "").split("\n")).toEqual([
		"",
		`  Studio    ${address}`,
		"            open it to follow the runs · Ctrl-C stops the engine",
		"  Watching  acme/web, every 60 s",
		"  Claude    this machine's Claude Code login",
		"",
		"  ── activity ──",
	]);
	expect(said[0]).toContain(`m${address}\u001b[39m`);
	expect(said[0]).toContain("\u001b[2mopen it to follow the runs");
	expect(said[0]).toContain("\u001b[2m  ── activity ──");
});

it("logs what the engine watches, its Claude and the studio's address when its output is no terminal", () => {
	const facts = {
		address: "http://127.0.0.1:4310/?token=abc",
		watching: ["acme/api", "acme/web"],
		everySeconds: 60,
		claude: "Claude: this machine's Claude Code login",
	};
	expect(plainStartLines(facts)).toEqual([
		"watching acme/api, acme/web every 60 s",
		"Claude: this machine's Claude Code login",
		"studio on http://127.0.0.1:4310/?token=abc",
	]);
	expect(
		plainStartLines({
			...facts,
			signIn: "https://factory.example.com with OPENFABRIQ_STUDIO_PASSWORD",
		}),
	).toEqual([
		"watching acme/api, acme/web every 60 s",
		"Claude: this machine's Claude Code login",
		"studio on http://127.0.0.1:4310/?token=abc",
		"studio: sign in at https://factory.example.com with OPENFABRIQ_STUDIO_PASSWORD",
	]);
});

it("says how to generate a wiki that is on but has no index.md yet, and only then", () => {
	const view = {
		folder: "wiki",
		refresh: "manual" as const,
		commit: "abc1234",
		pages: [],
		titles: {},
	};
	expect(wikiHint("acme/shop", view)).toBe(
		'acme/shop: no wiki yet. Generate it on the studio\'s Wiki page or with "openfabriq run wiki"; removing "wiki" from factory.yaml turns it off.',
	);
	expect(
		wikiHint("acme/shop", { ...view, pages: ["index.md"] }),
	).toBeUndefined();
	expect(wikiHint("acme/shop", undefined)).toBeUndefined();
	// Before the clone has the default branch, nothing says the wiki is missing.
	const { commit: _, ...unread } = view;
	expect(wikiHint("acme/shop", unread)).toBeUndefined();
});

it("says when a factory listens to Linear but openfabriq is installed in no Linear workspace", async () => {
	const linear = {
		repository: "acme/linear",
		linear: { team: "ENG" },
		automations: { work: { when: [{ event: "linear.issue.delegated" }] } },
	} as unknown as Factory;
	const relay = (installs: unknown[]) =>
		({ linearTokens: async () => installs }) as unknown as Parameters<
			typeof linearNotes
		>[1];
	expect(await linearNotes([linear, chat], relay([]))).toEqual([
		'linear: acme/linear listen to Linear, but openfabriq is not installed in Linear; run "openfabriq connect linear"',
	]);
	expect(await linearNotes([linear], relay([{ organizationId: "o" }]))).toEqual(
		[],
	);
	expect(await linearNotes([chat], relay([]))).toEqual([]);
	expect(await linearNotes([linear], undefined)).toEqual([]);
});

it("reads how often GitHub is read from --interval, else OPENFABRIQ_INTERVAL, and refuses less than 10 seconds", () => {
	expect(pollInterval(undefined, {})).toBeUndefined();
	expect(pollInterval(undefined, { OPENFABRIQ_INTERVAL: "" })).toBeUndefined();
	expect(pollInterval(undefined, { OPENFABRIQ_INTERVAL: "15" })).toBe(15_000);
	expect(pollInterval("30", { OPENFABRIQ_INTERVAL: "15" })).toBe(30_000);
	expect(() => pollInterval(undefined, { OPENFABRIQ_INTERVAL: "5" })).toThrow(
		"OPENFABRIQ_INTERVAL takes a number of seconds, 10 or more.",
	);
	expect(() => pollInterval("abc", {})).toThrow(
		"--interval takes a number of seconds, 10 or more.",
	);
});

it("reads how many runs go at once from OPENFABRIQ_MAX_RUNS, and refuses a wrong number", () => {
	expect(maxRuns({})).toBeUndefined();
	expect(maxRuns({ OPENFABRIQ_MAX_RUNS: "" })).toBeUndefined();
	expect(maxRuns({ OPENFABRIQ_MAX_RUNS: "6" })).toBe(6);
	for (const wrong of ["0", "33", "2.5", "four"])
		expect(() => maxRuns({ OPENFABRIQ_MAX_RUNS: wrong })).toThrow(
			"OPENFABRIQ_MAX_RUNS takes a number of runs, from 1 to 32.",
		);
});
