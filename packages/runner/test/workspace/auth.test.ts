import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

// Every git call the workspace makes, still run for real.
const calls: string[][] = [];
vi.mock("../../src/exec.js", async (importOriginal) => {
	const real = await importOriginal<typeof import("../../src/exec.js")>();
	return {
		...real,
		exec: (command: string, args: string[], options?: object) => {
			if (command === "git") calls.push(args);
			return real.exec(command, args, options);
		},
	};
});
const { workspace } = await import("../../src/workspace/workspace.js");

const dir = () => mkdtempSync(join(tmpdir(), "openfabriq-auth-"));
const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
		cwd,
		stdio: "ignore",
	});

it("fetches with gh's credentials: a private repository on a server has no other git login", async () => {
	const origin = dir();
	git(origin, "-c", "init.defaultBranch=main", "init", "-q");
	writeFileSync(join(origin, "t.txt"), "hi");
	git(origin, "add", ".");
	git(origin, "commit", "-q", "-m", "start");
	const clone = join(dir(), "repo");
	execFileSync("git", ["clone", "-q", origin, clone]);
	await workspace.create(clone, join(dir(), "run-1"), "main");
	const fetch = calls.find((args) => args.includes("fetch"));
	expect(fetch).toEqual(
		expect.arrayContaining([
			"credential.helper=",
			"credential.helper=!gh auth git-credential",
		]),
	);
});

const SAFE = [
	"--no-replace-objects",
	"-c",
	"core.hooksPath=/dev/null",
	"-c",
	"core.fsmonitor=false",
];
const FETCH = [
	...SAFE,
	"-c",
	"credential.helper=",
	"-c",
	"credential.helper=!gh auth git-credential",
	"-c",
	"url.https://github.com/.insteadOf=git@github.com:",
	"-c",
	"url.https://github.com/.insteadOf=ssh://git@github.com/",
	"fetch",
	"--quiet",
	"--prune",
	"origin",
];

it("creates a worktree and fetches with these git calls, in this order, from the trusted config", async () => {
	const origin = dir();
	git(origin, "-c", "init.defaultBranch=main", "init", "-q");
	writeFileSync(join(origin, "t.txt"), "hi");
	git(origin, "add", ".");
	git(origin, "commit", "-q", "-m", "start");
	const clone = join(dir(), "repo");
	execFileSync("git", ["clone", "-q", origin, clone]);
	const config = readFileSync(join(clone, ".git/config"), "utf8");
	const first = join(dir(), "run-1");
	await workspace.create(clone, first, "main");
	expect(readFileSync(join(clone, "..", "git-config.trusted"), "utf8")).toBe(
		config,
	);
	const main = execFileSync("git", ["rev-parse", "origin/main"], {
		cwd: clone,
		encoding: "utf8",
	}).trim();
	const blob = (args: string[], input?: string) =>
		execFileSync("git", args, { cwd: first, input, encoding: "utf8" }).trim();
	git(
		first,
		"replace",
		blob(["rev-parse", "origin/main:t.txt"]),
		blob(["hash-object", "-w", "--stdin"], "evil"),
	);

	calls.length = 0;
	const next = join(dir(), "run-2");
	await workspace.create(clone, next, "main");
	expect(calls).toEqual([
		[...SAFE, "for-each-ref", "--format=delete %(refname)", "refs/replace"],
		[...SAFE, "update-ref", "--stdin"],
		[...FETCH.slice(0, -4), "ls-remote", "origin", "refs/heads/*"],
		FETCH,
		[...SAFE, "worktree", "add", "--quiet", "--detach", next, main],
	]);

	// The config an agent changed is put back before the fetch.
	appendFileSync(join(clone, ".git/config"), "[x]\n\ty = 1\n");
	calls.length = 0;
	await workspace.fetch(clone);
	expect(calls).toEqual([FETCH]);
	expect(readFileSync(join(clone, ".git/config"), "utf8")).toBe(config);

	// No clone yet: nothing to fetch.
	calls.length = 0;
	await workspace.fetch(join(dir(), "repo"));
	expect(calls).toEqual([]);
});

it("reaches github.com over HTTPS even when the clone's origin is SSH: only gh's login, the app's token in app mode, is used", async () => {
	const { GH_AUTH } = await import("../../src/workspace/hardened-git.js");
	const clone = dir();
	git(clone, "init", "-q");
	git(clone, "remote", "add", "origin", "git@github.com:acme/app.git");
	const url = (remote: string) =>
		execFileSync("git", [...GH_AUTH, "ls-remote", "--get-url", remote], {
			cwd: clone,
			encoding: "utf8",
		}).trim();
	expect(url("origin")).toBe("https://github.com/acme/app.git");
	expect(url("ssh://git@github.com/acme/app.git")).toBe(
		"https://github.com/acme/app.git",
	);
});
