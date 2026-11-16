import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// End-to-end tests (README.md): the real relay under wrangler dev, the built CLI, the engine.
// Not part of `pnpm test`: run with `pnpm e2e` (free) or `pnpm e2e:agent` (real agents, a few cents).
const root = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
	root,
	test: {
		include: ["e2e/**/*.e2e.ts"],
		testTimeout: 300_000,
		hookTimeout: 120_000,
		// One relay at a time, and runs that cost money stay readable in order.
		fileParallelism: false,
	},
	resolve: {
		alias: {
			"@openfabriq/runner": `${root}packages/runner/src/index.ts`,
			"@openfabriq/core": `${root}packages/core/src/index.ts`,
		},
	},
});
