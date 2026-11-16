import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./paths.js";

/** The built CLI (`pnpm build`), as a person runs it, with this test's engine home. */
export function cli(args: string[], input = "") {
	const result = spawnSync(
		process.execPath,
		[join(ROOT, "packages/cli/dist/index.js"), ...args],
		{ env: process.env, input, encoding: "utf8", timeout: 60_000 },
	);
	return {
		code: result.status,
		output: `${result.stdout}${result.stderr}`.trim(),
	};
}
