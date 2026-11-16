import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";
import { freshHome } from "../support/home.js";
import { ROOT } from "../support/paths.js";
import { session } from "../support/terminal.js";

// the CLI shows its mark and colors in a terminal, and plain text in a pipe, in CI, in
// Docker's logs and with NO_COLOR.

const ESC = "\u001b[";
const MARK = "█▄ █▄ ███";
const valid = join(ROOT, "fixtures/valid/sdlc");
const invalid = join(ROOT, "fixtures/invalid/many-problems");

beforeAll(() => {
	freshHome();
});

it("shows the mark, the name and colored commands in a terminal", async () => {
	const usage = await session([], { terminal: true }).done();
	expect(usage.output).toContain(MARK);
	expect(usage.output).toContain("openfabriq");
	const result = session(["validate", valid], { terminal: true });
	const { code } = await result.done();
	expect(code).toBe(0);
	// The ✓ in green.
	expect(result.raw()).toContain(`${ESC}32m✓`);
});

it("leads a failure with a red ✗ in a terminal", async () => {
	const result = session(["validate", invalid], { terminal: true });
	const { code, output } = await result.done();
	expect(code).toBe(1);
	expect(output).toContain("errors in");
	expect(result.raw()).toContain(`${ESC}31m✗`);
});

it("prints plain text in a pipe: no mark, no color", async () => {
	for (const args of [[], ["validate", valid], ["validate", invalid]]) {
		const result = session(args);
		const { output } = await result.done();
		expect(result.raw()).not.toContain("\u001b");
		expect(output).not.toContain(MARK);
	}
});

it("prints plain text in a terminal with NO_COLOR", async () => {
	for (const args of [[], ["validate", valid]]) {
		const result = session(args, { terminal: true, env: { NO_COLOR: "1" } });
		const { output } = await result.done();
		expect(result.raw()).not.toContain(ESC);
		expect(output).not.toContain(MARK);
	}
});
