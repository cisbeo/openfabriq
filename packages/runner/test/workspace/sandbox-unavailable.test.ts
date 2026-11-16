import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { workspace } from "../../src/workspace/workspace.js";

vi.mock("@anthropic-ai/sandbox-runtime", () => ({
	SandboxManager: {
		isSupportedPlatform: () => true,
		checkDependenciesAsync: async () => ({
			errors: ["bubblewrap (bwrap) not installed"],
			warnings: [],
		}),
	},
}));

const dir = () => mkdtempSync(join(tmpdir(), "openfabriq-nosandbox-"));

it("never runs an engine's command outside the sandbox: it fails with the reason", async () => {
	const ran = join(dir(), "ran");
	const result = await workspace.run(
		join(dir(), "repo"),
		dir(),
		`touch ${ran}`,
		{ PATH: process.env.PATH ?? "/usr/bin:/bin" },
		5000,
		[],
	);
	expect(result).toEqual({
		ok: false,
		output:
			"the sandbox of the engine's commands cannot start: bubblewrap (bwrap) not installed",
	});
	await expect(
		workspace.setup(join(dir(), "repo"), dir(), "true", {}, 5000, []),
	).rejects.toThrow("bubblewrap (bwrap) not installed");
});
