import { expect, it } from "vitest";
import { readCommandLine, reportsHowItWent } from "../src/args.js";

it("finds the command after a flag, so apply keeps its ✓ lead", () => {
	const line = readCommandLine(["--yes", "apply", "repo"]);
	expect(line).toMatchObject({ command: "apply", dir: "repo" });
	expect(line.values.yes).toBe(true);
	expect(reportsHowItWent(line.command)).toBe(true);
});

it("leads only the commands that say how they went", () => {
	expect(reportsHowItWent(readCommandLine(["plan"]).command)).toBe(false);
	expect(reportsHowItWent(readCommandLine(["--help", "apply"]).command)).toBe(
		false,
	);
	expect(readCommandLine([])).toMatchObject({ command: undefined, dir: "." });
});
