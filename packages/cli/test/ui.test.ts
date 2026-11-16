import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { brand, header, outcome, paint, paintUsage } from "../src/ui.js";

const PLAN = `! openfabriq/ has uncommitted changes.

Security changes (read these first)
  + agent dev can now use Bash
  - env TOKEN

Agents
  ~ dev: model

Plan: 1 to add, 1 to change, 1 to remove, 0 labels to create.
If "openfabriq start" is running, restart it: see https://example.com/docs.`;

it("only adds colors: stripped, the text is the command's plain output", () => {
	expect(paint(PLAN)).not.toBe(PLAN);
	expect(stripVTControlCharacters(paint(PLAN))).toBe(PLAN);
});

it("gives each sign its role: + green, - red, ~ and ! yellow, the security title red", () => {
	const lines = paint(PLAN).split("\n");
	expect(lines[0]).toContain("\u001b[33m!");
	expect(lines[2]).toContain("\u001b[31m");
	expect(lines[3]).toContain("\u001b[32m+");
	expect(lines[4]).toContain("\u001b[31m-");
	expect(lines[7]).toContain("\u001b[33m~");
	expect(lines.at(-1)?.startsWith("\u001b[2m")).toBe(true);
});

it("colors the status of a run, in status and in start's log, and nothing else", () => {
	expect(paint("failed acme/app #3: triage (timeout)")).toContain(
		"\u001b[31mfailed",
	);
	expect(paint("    succeeded #12      review")).toContain(
		"\u001b[32msucceeded",
	);
	expect(paint("watching acme/app every 60 s")).toBe(
		"watching acme/app every 60 s",
	);
});

it("leads a report with ✓ or ✗, never a usage or a line that has its own sign", () => {
	const plain = (code: number, output: string, marked = true) =>
		stripVTControlCharacters(outcome({ code, output }, marked));
	expect(plain(0, "Sentry connected.")).toBe("✓ Sentry connected.");
	expect(plain(1, "The token does not work.")).toBe(
		"✗ The token does not work.",
	);
	expect(plain(0, "No changes.", false)).toBe("No changes.");
	expect(plain(1, "Usage: openfabriq secret set <NAME>")).toBe(
		"Usage: openfabriq secret set <NAME>",
	);
	expect(plain(0, "✓ openfabriq is valid")).toBe("✓ openfabriq is valid");
	expect(plain(0, "")).toBe("");
});

it("shows the mark beside the name and what the command does", () => {
	const lines = stripVTControlCharacters(header("connect sentry")).split("\n");
	expect(lines[2]).toContain("openfabriq");
	expect(lines[3]).toContain("connect sentry");
});

it("paints each command of the usage in the brand's blue, and only adds colors", () => {
	const usage = `Usage: openfabriq <command> [folder]

Commands:
  validate [folder]        check the openfabriq/ files
  status                   runs in progress, waiting and recent
                           and a line under it`;
	const painted = paintUsage(usage);
	expect(stripVTControlCharacters(painted)).toBe(usage);
	expect(painted).toContain(`  ${brand("validate [folder]")}`);
	expect(painted).toContain(`  ${brand("status")}`);
	expect(painted).not.toContain(brand("and a line under it"));
});
