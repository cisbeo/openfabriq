import { mkdirSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
	closeHome,
	home,
	projectDir,
	writeApplied,
} from "../../src/state/projects.js";

it("closes the engine's folder to other users, even one created open (VULN-014)", () => {
	process.env.OPENFABRIQ_HOME = join(
		mkdtempSync(join(tmpdir(), "openfabriq-home-")),
		"home",
	);
	mkdirSync(home(), { mode: 0o755 });
	closeHome();
	expect(statSync(home()).mode & 0o777).toBe(0o700);
});

it("writes the factory's scripts executable, not their tests", () => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	writeApplied("acme/app", {
		"factory.yaml": "name: F\n",
		"scripts/report.sh": "#!/bin/sh\n",
		"scripts/test/report.test.mjs": "",
	});
	const mode = (path: string) =>
		statSync(join(projectDir("acme/app"), "factory", path)).mode & 0o111;
	expect(mode("scripts/report.sh")).toBe(0o111);
	expect(mode("scripts/test/report.test.mjs")).toBe(0);
	expect(mode("factory.yaml")).toBe(0);
});
