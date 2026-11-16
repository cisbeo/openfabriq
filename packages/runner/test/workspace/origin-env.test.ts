import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { exec } from "../../src/exec.js";

// In app mode, git's calls to origin carry the token of the clone's own repository.
vi.mock("../../src/github/app.js", () => ({
	githubApp: () => ({}),
	githubEnv: async (repository: string) => ({
		GH_TOKEN: `token-of-${repository}`,
	}),
}));

it("gives git the token of the repository the clone's origin names", async () => {
	const { originEnv } = await import("../../src/workspace/hardened-git.js");
	const clone = mkdtempSync(join(tmpdir(), "openfabriq-origin-"));
	await exec("git", ["init", "--quiet", clone]);
	await exec("git", [
		"-C",
		clone,
		"remote",
		"add",
		"origin",
		"https://github.com/acme/web.git",
	]);
	expect((await originEnv(clone))?.GH_TOKEN).toBe("token-of-acme/web");
});
