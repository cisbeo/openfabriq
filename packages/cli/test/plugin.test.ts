import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTIONS, CONCURRENCY, EVENTS, FROM, TOOLS } from "@openfabriq/core";
import { expect, it } from "vitest";

const PLUGIN = join(import.meta.dirname, "../plugin");
const reference = readFileSync(
	join(PLUGIN, "skills/setup/reference.md"),
	"utf8",
);

// Format words, written out because core may not export them yet.
const LATER_WORDS = [
	"slack.mentioned",
	"linear.issue.labeled",
	"sentry.issue.created",
	"slack",
	"linear",
	"sentry",
	"query",
	"setup",
	"ignore_paths",
	"commands",
	"checks",
	"timezone",
	"env",
	"secrets",
	"openfabriq connect slack",
	"openfabriq connect linear",
	"openfabriq connect sentry",
];

it("the setup skill's reference cites every word of the format", () => {
	const words = [
		...EVENTS,
		...ACTIONS,
		...TOOLS,
		...CONCURRENCY,
		...FROM,
		...LATER_WORDS,
	];
	expect(words.filter((w) => !reference.includes(`\`${w}\``))).toEqual([]);
});

it("the plugin is named openfabriq, so the skill is /openfabriq:setup", () => {
	const manifest = JSON.parse(
		readFileSync(join(PLUGIN, ".claude-plugin/plugin.json"), "utf8"),
	);
	expect(manifest.name).toBe("openfabriq");
	const skill = readFileSync(join(PLUGIN, "skills/setup/SKILL.md"), "utf8");
	expect(skill).toMatch(/^---\nname: setup\n/);
});

// Installed from the marketplace, the plugin updates when its version changes: it follows the CLI's.
it("the marketplace lists the plugin at the CLI's version", () => {
	const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
	const marketplace = json(
		join(import.meta.dirname, "../../../.claude-plugin/marketplace.json"),
	);
	expect(marketplace.plugins).toEqual([
		expect.objectContaining({
			name: "openfabriq",
			source: "./packages/cli/plugin",
		}),
	]);
	expect(json(join(PLUGIN, ".claude-plugin/plugin.json")).version).toBe(
		json(join(import.meta.dirname, "../package.json")).version,
	);
});
