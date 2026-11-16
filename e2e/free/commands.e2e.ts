import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	onTestFinished,
} from "vitest";
import { freshHome } from "../support/home.js";
import { ROOT } from "../support/paths.js";
import { fakeCommands, session } from "../support/terminal.js";

// The commands of the CLI around a factory, as a person runs them: init, plan, apply, status, run,
// secret set and start, on a real git repository, with gh and Claude Code replaced by stand-ins.

const REPO = "acme/app";
const MARK = "█▄ █▄ ███";
const ENTER = "\r";
const commands = fakeCommands();
let home: string;
let repo: string;
let origin: string;

const git = (cwd: string, ...args: string[]) =>
	execFileSync(
		"git",
		["-c", "user.name=e2e", "-c", "user.email=e2e@example.com", ...args],
		{ cwd, stdio: "pipe" },
	);

beforeAll(() => {
	home = freshHome();
	// gh, claude and git are checked on first use: here they are stand-ins.
	writeFileSync(join(home, "prerequisites-checked"), "e2e\n");
	repo = mkdtempSync(join(tmpdir(), "openfabriq-e2e-repo-"));
	cpSync(
		join(ROOT, "examples/01-quickstart/openfabriq"),
		join(repo, "openfabriq"),
		{
			recursive: true,
		},
	);
	const factory = join(repo, "openfabriq/factory.yaml");
	writeFileSync(
		factory,
		`${readFileSync(factory, "utf8").replace(/^repository: .*$/m, `repository: ${REPO}`)}secrets: [API_KEY]\n`,
	);
	git(repo, "init", "--quiet", "--initial-branch=main");
	git(repo, "add", ".");
	git(repo, "commit", "--quiet", "-m", "factory");
	origin = mkdtempSync(join(tmpdir(), "openfabriq-e2e-origin-"));
	git(origin, "init", "--quiet", "--bare", "--initial-branch=main");
	git(repo, "push", "--quiet", origin, "main");
});

const run = (
	args: string[],
	options: { terminal?: boolean; cwd?: string } = {},
) =>
	session(args, {
		...options,
		path: commands.dir,
		env: {
			E2E_REPOSITORY: REPO,
			E2E_ORIGIN: origin,
			// The person running `openfabriq run`, from git's own configuration.
			GIT_CONFIG_COUNT: "2",
			GIT_CONFIG_KEY_0: "user.name",
			GIT_CONFIG_VALUE_0: "Alice",
			GIT_CONFIG_KEY_1: "user.email",
			GIT_CONFIG_VALUE_1: "alice@example.com",
		},
	});
const ghCalls = () =>
	commands
		.calls()
		.split("\n")
		.filter((l) => l.startsWith("gh "));

it("status: no project before the first apply", async () => {
	expect(await run(["status"]).done()).toEqual({
		code: 0,
		output: 'No project yet. Run "openfabriq apply" in a repository.',
	});
});

it("plan: the security changes first, then the labels to create on GitHub", async () => {
	const { code, output } = await run(["plan", repo]).done();
	expect(code).toBe(0);
	expect(output.startsWith("Security changes (read these first)")).toBe(true);
	expect(output).toContain("+ maintainer alice can now start automations");
	expect(output).toContain(
		"Labels to create on GitHub\n  + needs-human\n  + openfabriq:working\n  + ready-for-agent",
	);
	expect(output).toMatch(
		/Plan: \d+ to add, 0 to change, 0 to remove, 3 labels to create\./,
	);
	expect(ghCalls()).toContain(`gh api repos/${REPO}`);
});

it("plan: warns on another branch than the default one, and on uncommitted changes", async () => {
	git(repo, "checkout", "--quiet", "-b", "feature");
	writeFileSync(join(repo, "openfabriq/notes.md"), "draft\n");
	try {
		const { output } = await run(["plan", repo]).done();
		expect(output).toContain(
			'! You are on branch "feature", not main: apply what is merged.',
		);
		expect(output).toContain("! openfabriq/ has uncommitted changes.");
	} finally {
		rmSync(join(repo, "openfabriq/notes.md"));
		git(repo, "checkout", "--quiet", "main");
	}
});

it("apply, in a terminal: no is the default answer, and nothing is applied", async () => {
	const cli = run(["apply", repo], { terminal: true });
	await cli.waitFor(`Apply this plan to ${REPO}?`);
	cli.type(ENTER);
	const { code, output } = await cli.done();
	expect(code).toBe(1);
	expect(output).toContain("Cancelled. Nothing was applied.");
	expect(ghCalls().some((c) => c.startsWith("gh label create"))).toBe(false);
	expect(existsSync(join(home, "projects", REPO))).toBe(false);
});

it("apply, in a terminal: yes creates the labels, clones the repository, and applies the factory", async () => {
	const cli = run(["apply", repo], { terminal: true });
	await cli.waitFor(`Apply this plan to ${REPO}?`);
	cli.type("y");
	await cli.waitFor("Applied.");
	cli.type(ENTER);
	const { code, output } = await cli.done();
	expect(code).toBe(0);
	expect(output).toContain(
		`Applied. ${REPO} runs this factory as soon as "openfabriq start" is running.`,
	);
	expect(ghCalls()).toContainEqual(
		expect.stringMatching(/^gh label create ready-for-agent -R acme\/app /),
	);
	expect(existsSync(join(home, "projects", REPO, "repo/.git"))).toBe(true);
});

it("plan and apply after apply: no changes, nothing to apply", async () => {
	expect((await run(["plan", repo]).done()).output).toBe(
		"No changes. The factory matches what is applied.",
	);
	const { code, output } = await run(["apply", repo]).done();
	expect(code).toBe(0);
	expect(output).toContain("Nothing to apply.");
});

it("status: the applied project, with today's runs and spend", async () => {
	const { code, output } = await run(["status"]).done();
	expect(code).toBe(0);
	expect(output).toMatch(/^acme\/app \(applied .+, 0 runs today, 0\.00 USD\)$/);
});

it("run: asks the engine for a manual run, signed with git's name; refuses an unknown automation", async () => {
	const asked = await run([
		"run",
		"implement-ready-issues",
		"--issue",
		"3",
	]).done();
	expect(asked.code).toBe(0);
	expect(asked.output).toContain(
		"Asked: a manual run of implement-ready-issues on acme/app",
	);
	const requests = join(home, "projects", REPO, "requests");
	const [file = ""] = readdirSync(requests);
	expect(readFileSync(join(requests, file), "utf8")).toContain("Alice");

	const unknown = await run(["run", "deploy", "--issue", "3"]).done();
	expect(unknown.code).toBe(1);
	expect(unknown.output).toContain(
		'No automation "deploy" in the applied factories',
	);
	expect(
		(await run(["run", "implement-ready-issues", "--issue", "three"]).done())
			.output,
	).toBe('"three" is not an issue or pull request number.');
});

it("secret set, in a terminal: the value hidden, kept for this project only, readable by its owner only", async () => {
	const cli = run(["secret", "set", "API_KEY"], { terminal: true });
	await cli.waitFor(`Value of API_KEY for ${REPO}`);
	cli.type(`s3cret-e2e${ENTER}`);
	const { code, output } = await cli.done();
	expect(code).toBe(0);
	expect(output).toContain(`Saved API_KEY for ${REPO}`);
	expect(output).not.toContain("s3cret-e2e");
	const file = join(home, "secrets", `${REPO}.env`);
	expect(readFileSync(file, "utf8")).toContain("API_KEY=");
	expect(readFileSync(file, "utf8")).toContain("s3cret-e2e");
	expect(statSync(file).mode & 0o777).toBe(0o600);
});

it("secret set: refuses a value given as an argument, and a name no factory declares", async () => {
	const inHistory = await run(["secret", "set", "API_KEY", "s3cret"]).done();
	expect(inHistory.code).toBe(1);
	expect(inHistory.output).toContain("Never give a value as an argument");
	const undeclared = await run(["secret", "set", "OTHER_KEY"]).done();
	expect(undeclared.code).toBe(1);
	expect(undeclared.output).toContain(
		"No applied factory names OTHER_KEY in secrets or in an MCP server.",
	);
});

describe("start", () => {
	let holder: Server | undefined;
	beforeAll(
		() =>
			new Promise<void>((resolve) => {
				// The studio's port held, by this test or by an "openfabriq start" already running here.
				holder = createServer();
				holder.once("error", () => {
					holder = undefined;
					resolve();
				});
				holder.listen(4310, "127.0.0.1", () => resolve());
			}),
	);
	afterAll(() => holder?.close());

	it("start, in a repository: refuses a taken studio port before it shows or applies anything", async () => {
		const factory = join(repo, "openfabriq/factory.yaml");
		writeFileSync(
			factory,
			readFileSync(factory, "utf8").replace("usd_per_run: 5", "usd_per_run: 8"),
		);
		git(repo, "commit", "--quiet", "-am", "raise the limit");
		const { code, output } = await run(["start"], {
			terminal: true,
			cwd: repo,
		}).done();
		expect(output).toContain(MARK);
		expect(output).toContain(
			'127.0.0.1:4310 is taken, most likely by another "openfabriq start"',
		);
		expect(output).not.toContain("Apply this plan");
		expect(code).toBe(1);
		expect((await run(["plan", repo]).done()).output).toContain(
			"~ limit usd_per_run raised: 5 → 8",
		);
	});

	it("start, in a repository: shows what changed, applies it after a yes, and stops when another engine runs here", async () => {
		const free = createServer();
		await new Promise<void>((done) => free.listen(0, "127.0.0.1", done));
		const address = free.address();
		const port = typeof address === "object" && address ? address.port : 0;
		await new Promise((done) => free.close(done));
		// This test's own process stands for an engine that runs the projects of this home.
		const pid = join(home, "engine.pid");
		writeFileSync(pid, String(process.pid));
		// Removed even when a wait times out: a later start in this home would stop on it.
		onTestFinished(() => rmSync(pid, { force: true }));
		const cli = run(["start", "--port", String(port)], {
			terminal: true,
			cwd: repo,
		});
		await cli.waitFor("~ limit usd_per_run raised: 5 → 8");
		await cli.waitFor(`Apply this plan to ${REPO}?`);
		cli.type("y");
		const { code, output } = await cli.done();
		expect(output).toContain(`Applied to ${REPO}.`);
		expect(output).toContain(
			`another "openfabriq start" (process ${process.pid}) runs the projects of`,
		);
		expect(code).toBe(1);
		expect((await run(["plan", repo]).done()).output).toBe(
			"No changes. The factory matches what is applied.",
		);
	});
});

it("init --example: copies the example, with the repository and the maintainer gh knows", async () => {
	const dir = mkdtempSync(join(tmpdir(), "openfabriq-e2e-init-"));
	const created = await run(["init", "--example", "01-quickstart"], {
		cwd: dir,
	}).done();
	expect(created.code).toBe(0);
	expect(created.output).toContain("Created openfabriq/ from 01-quickstart.");
	const factory = readFileSync(join(dir, "openfabriq/factory.yaml"), "utf8");
	expect(factory).toMatch(/^repository: acme\/app$/m);
	expect(factory).toMatch(
		/^maintainers: \[alice\] # only their actions start the factory$/m,
	);
	const again = await run(["init", "--example", "01-quickstart"], {
		cwd: dir,
	}).done();
	expect(again.code).toBe(1);
	expect(again.output).toContain("already exists. Nothing was copied.");
});

it("init without an example: in a pipe it says what it needs; in a terminal it opens Claude Code on the setup skill", async () => {
	const dir = mkdtempSync(join(tmpdir(), "openfabriq-e2e-init-"));
	const piped = await run(["init"], { cwd: dir }).done();
	expect(piped.code).toBe(1);
	expect(piped.output).toContain("It needs an interactive terminal");
	const cli = run(["init"], { terminal: true, cwd: dir });
	const { code, output } = await cli.done();
	expect(code).toBe(0);
	expect(output).toContain(MARK);
	expect(commands.calls()).toMatch(
		/^claude --plugin-dir \S+\/plugin \/openfabriq:setup /m,
	);
});
