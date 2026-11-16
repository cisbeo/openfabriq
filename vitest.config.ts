import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// Tests import workspace packages from their sources, so they run without a build.
// The relay runs in the Workers runtime, with its own config: packages/relay/vitest.config.ts.
export default defineConfig({
	test: {
		// Never the machine's ~/.openfabriq: a GitHub App saved there by "openfabriq connect github"
		// would put every test of gh in app mode. A test that needs a home sets its own.
		env: {
			OPENFABRIQ_HOME: mkdtempSync(join(tmpdir(), "openfabriq-test-home-")),
			GITHUB_APP_ID: "",
			GITHUB_APP_PRIVATE_KEY: "",
		},
		exclude: [
			...configDefaults.exclude,
			".claude/**",
			".stryker-tmp/**",
			"packages/relay/**",
			// Tests of a factory's scripts use node:test; pnpm test runs them with node --test.
			"**/openfabriq/scripts/test/**",
		],
	},
	resolve: {
		alias: {
			"@openfabriq/runner": fileURLToPath(
				new URL("packages/runner/src/index.ts", import.meta.url),
			),
			"@openfabriq/core": fileURLToPath(
				new URL("packages/core/src/index.ts", import.meta.url),
			),
		},
	},
});
