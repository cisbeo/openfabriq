import { expect, it } from "vitest";
import {
	installedBy,
	machineNeeds,
	programStartedBy,
} from "../../src/factory/needs.js";
import { example, load } from "../helpers.js";

it("takes the first word of a line, after its variable assignments", () => {
	expect(programStartedBy("pnpm test")).toBe("pnpm");
	expect(programStartedBy("  CI=1 NODE_ENV=test vitest run")).toBe("vitest");
	expect(programStartedBy("make;echo done")).toBe("make");
	expect(programStartedBy("cd app && pnpm build")).toBe("cd");
});

it("leaves paths alone: a script of the factory or a file of the repository", () => {
	expect(programStartedBy("scripts/wpscan-report.sh")).toBeUndefined();
	expect(programStartedBy("./bin/check --fast")).toBeUndefined();
	expect(programStartedBy("vendor/bin/phpcs")).toBeUndefined();
	expect(programStartedBy("")).toBeUndefined();
});

it("lists the programs a factory runs, with the lines that run them", () => {
	const files = example("25-wordpress-maintenance");
	expect(machineNeeds(load(files), files).programs).toEqual({
		composer: ["setup", "command outdated", "command update"],
		find: ["command syntax"],
	});
});

it("reads the programs of MCP servers and the compatibility of skills", () => {
	const files = {
		...example("01-quickstart"),
		"skills/browser/SKILL.md":
			"---\nname: browser\ndescription: d\ncompatibility: Needs agent-browser\n---\nBody",
		"skills/plain/SKILL.md": "---\nname: plain\ndescription: d\n---\nBody",
		"agents/x/skills/broken/SKILL.md": "no header",
	};
	const factory = {
		...load(example("01-quickstart")),
		mcp: { docs: { command: "npx -y docs-mcp" }, web: { url: "https://x" } },
	};
	const needs = machineNeeds(factory, files);
	expect(needs.programs.npx).toEqual(["MCP server docs"]);
	expect(needs.skills).toEqual({ "skills/browser": "Needs agent-browser" });
});

it("reads the programs a skill's compatibility installs, so doctor looks them up", () => {
	expect(
		installedBy(
			"Needs agent-browser: npm install -g agent-browser && npx playwright install chromium.",
		),
	).toEqual(["agent-browser"]);
	expect(installedBy("brew install jq ripgrep; pipx install ruff")).toEqual([
		"jq",
		"ripgrep",
		"ruff",
	]);
	expect(installedBy("npm i -g typescript@5 @scope/tool")).toEqual([
		"typescript",
	]);
	expect(installedBy("Needs a browser")).toEqual([]);
	const files = example("09-ui-check");
	expect(machineNeeds(load(files), files).programs["agent-browser"]).toEqual([
		"skills/browser-evidence",
	]);
});
