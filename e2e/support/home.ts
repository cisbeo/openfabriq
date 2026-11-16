import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FactoryFiles } from "@openfabriq/core";
import { projectDir, writeApplied } from "@openfabriq/runner";

/** A fresh engine home: what `~/.openfabriq` holds, for this test only. */
export function freshHome(): string {
	const home = mkdtempSync(join(tmpdir(), "openfabriq-e2e-home-"));
	process.env.OPENFABRIQ_HOME = home;
	return home;
}

export function writeSecrets(home: string, secrets: unknown) {
	writeFileSync(join(home, "secrets.json"), JSON.stringify(secrets), {
		mode: 0o600,
	});
}

const git = (cwd: string, ...args: string[]) =>
	execFileSync(
		"git",
		["-c", "user.name=e2e", "-c", "user.email=e2e@example.com", ...args],
		{ cwd, stdio: "pipe" },
	);

/**
 * The project as `openfabriq apply` leaves it: the applied factory, and the engine's clone,
 * whose origin is a local bare repository instead of GitHub. The real workspace adapter runs on it.
 */
export function applyProject(
	repository: string,
	files: FactoryFiles,
	repoFiles: Record<string, string> = { "README.md": "# app\n" },
): { origin: string } {
	writeApplied(repository, files);
	const origin = mkdtempSync(join(tmpdir(), "openfabriq-e2e-origin-"));
	git(origin, "init", "--quiet", "--bare", "--initial-branch=main");
	const seed = mkdtempSync(join(tmpdir(), "openfabriq-e2e-seed-"));
	git(seed, "init", "--quiet", "--initial-branch=main");
	for (const [path, content] of Object.entries(repoFiles)) {
		mkdirSync(join(seed, path, ".."), { recursive: true });
		writeFileSync(join(seed, path), content);
	}
	git(seed, "add", ".");
	git(seed, "commit", "--quiet", "-m", "first commit");
	git(seed, "push", "--quiet", origin, "main");
	git(projectDir(repository), "clone", "--quiet", origin, "repo");
	return { origin };
}

/** The branches of the origin: what the engine pushed. */
export const originBranches = (origin: string) =>
	execFileSync("git", ["branch", "--format=%(refname:short)"], {
		cwd: origin,
		encoding: "utf8",
	})
		.split("\n")
		.filter(Boolean);
