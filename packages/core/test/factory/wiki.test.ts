import { describe, expect, it } from "vitest";
import { loadFactory } from "../../src/factory/load.js";
import type { FactoryFiles } from "../../src/factory/types.js";
import { withWiki } from "../../src/factory/wiki.js";
import {
	type FactoryEvent,
	matchingAutomations,
	needsChangedFiles,
} from "../../src/match.js";
import { planChanges } from "../../src/plan/plan.js";
import { load, NO_FILES } from "../helpers.js";

const FACTORY = "name: F\nrepository: acme/app\nmaintainers: [alice]\n";
const files = (yaml = "", extra: FactoryFiles = {}): FactoryFiles => ({
	"factory.yaml": FACTORY + yaml,
	"agents/worker/agent.md": "---\ndescription: Does things\n---\nDo things.\n",
	"automations/run/automation.md":
		"---\nwhen: issue.opened\nagent: worker\n---\nGo.\n",
	...extra,
});
// The wiki is off unless factory.yaml turns it on.
const ON = "wiki: true\n";
const messages = (f: FactoryFiles) =>
	loadFactory(f).problems.map((p) => `${p.file}: ${p.message}`);

describe("the wiki", () => {
	it("is off by default; true turns it on, in wiki/, on demand", () => {
		expect(load(files()).wiki).toBeUndefined();
		expect(load(files(ON)).wiki).toEqual({ folder: "wiki", refresh: "manual" });
	});

	it("is set or turned off in factory.yaml", () => {
		expect(
			load(files("wiki:\n  folder: docs/wiki/\n  refresh: after_merge\n")).wiki,
		).toEqual({ folder: "docs/wiki", refresh: "after_merge" });
		expect(load(files("wiki: false\n")).wiki).toBeUndefined();
	});

	it("reads openfabriq/wiki.md as the pages to add, and warns when the wiki is off", () => {
		const pages = { "wiki.md": "- Billing rules: how invoices work\n" };
		expect(load(files(ON, pages)).wiki?.pages).toBe(
			"- Billing rules: how invoices work",
		);
		expect(messages(files("wiki: false\n", pages))).toEqual([
			"wiki.md: the wiki is off, so this file is not read: add wiki: true to factory.yaml to turn it on",
		]);
	});

	it.each([
		["/", "not its root"],
		["/srv/wiki", "relative to its root"],
		["docs/../../etc", "without . or .. parts"],
		["openfabriq/wiki", "cannot be under openfabriq/"],
		[".github/wiki", "cannot be under .github/"],
	])("refuses the folder %s", (folder, why) => {
		expect(messages(files(`wiki:\n  folder: ${folder}\n`)).join()).toContain(
			why,
		);
	});

	it("refuses an unknown refresh", () => {
		expect(messages(files("wiki:\n  refresh: daily\n"))).toEqual([
			"factory.yaml: wiki: is true, false, or a folder and a refresh (manual or after_merge), like wiki: { folder: docs/wiki, refresh: after_merge }",
		]);
	});

	it("reserves the name wiki, even when the wiki is off", () => {
		expect(
			messages(
				files("wiki: false\n", {
					"agents/wiki/agent.md": "---\ndescription: Mine\n---\nMine.\n",
				}),
			),
		).toContain(
			"agents/wiki/agent.md: an agent cannot be called wiki: the engine's wiki uses that name. Rename it",
		);
	});

	it("gives the engine an agent and an automation that only open a pull request", () => {
		const factory = withWiki(
			load(files(ON, { "wiki.md": "- Billing rules\n" })),
		);
		expect(factory.agents.wiki).toMatchObject({
			builtIn: true,
			tools: ["read", "edit", "shell"],
			skills: ["wiki"],
		});
		expect(factory.automations.wiki).toMatchObject({
			when: [],
			agent: "wiki",
			can: [{ action: "create_pull_request" }],
			concurrency: "repository",
		});
		expect(factory.automations.wiki?.instructions).toContain("- Billing rules");
		expect(withWiki(load(files("wiki: false\n"))).agents.wiki).toBeUndefined();
	});

	it("after_merge: runs on new commits, except those that only touch the wiki", () => {
		const factory = withWiki(
			load(files("wiki:\n  folder: docs/wiki\n  refresh: after_merge\n")),
		);
		const pushed: FactoryEvent = {
			key: "k",
			event: "default_branch.updated",
			isPullRequest: false,
			actor: "bob",
			commits: "a..b",
			at: "2026-11-06T10:00:00Z",
		};
		expect(needsChangedFiles(factory, pushed)).toBe(true);
		expect(needsChangedFiles(withWiki(load(files(ON))), pushed)).toBe(false);
		const started = (changed: string[]) =>
			matchingAutomations(factory, { ...pushed, files: changed }).map(
				(a) => a.name,
			);
		expect(started(["src/app.ts", "docs/wiki/index.md"])).toEqual(["wiki"]);
		expect(started(["docs/wiki/index.md"])).toEqual([]);
	});

	it("plan says what the wiki does, in one line", () => {
		const plan = (before: string | undefined, after: string) =>
			planChanges(
				before === undefined ? undefined : load(files(before)),
				load(files(after)),
				[],
				NO_FILES,
			).settings.filter((l) => l.includes("wiki"));
		expect(plan(undefined, ON)).toEqual([
			"+ wiki: the engine writes wiki/ when asked (the studio's Wiki page or openfabriq run wiki), by pull request only, touching wiki/ only",
		]);
		expect(plan(ON, ON)).toEqual([]);
		expect(plan(undefined, "")).toEqual([]);
		expect(plan(ON, "")).toEqual(["- wiki: off"]);
		expect(plan(ON, "wiki:\n  refresh: after_merge\n")).toEqual([
			"~ wiki: the engine keeps wiki/ up to date after each merge, by pull request only, touching wiki/ only",
		]);
		expect(plan(ON, "wiki: false\n")).toEqual(["- wiki: off"]);
	});

	it("plan says when only the wiki's pages changed, after the factory's other settings", () => {
		const settings = (before: FactoryFiles, after: FactoryFiles) =>
			planChanges(load(before), load(after), [], NO_FILES).settings;
		const pages = { "wiki.md": "- Billing rules: how invoices work\n" };
		expect(settings(files(ON), files(ON, pages))).toEqual([
			"~ wiki: the engine writes wiki/ when asked (the studio's Wiki page or openfabriq run wiki), by pull request only, touching wiki/ only (its pages changed)",
		]);
		expect(settings(files(ON, pages), files(ON))).toEqual([
			"~ wiki: the engine writes wiki/ when asked (the studio's Wiki page or openfabriq run wiki), by pull request only, touching wiki/ only (its pages changed)",
		]);
		const renamed = {
			"factory.yaml":
				"name: G\nrepository: acme/app\nmaintainers: [alice]\nmodel: opus\ntimezone: UTC\nwiki:\n  refresh: after_merge\n",
		};
		expect(settings(files(ON), files(ON, renamed))).toEqual([
			"~ name: F → G",
			"~ model: sonnet → opus",
			"+ timezone UTC: schedules read in this time zone",
			"~ wiki: the engine keeps wiki/ up to date after each merge, by pull request only, touching wiki/ only",
		]);
	});
});

it("plan ignores the wiki's agent the engine adds, so a loaded factory compares with its files", () => {
	const factory = load(files(ON));
	expect(planChanges(withWiki(factory), factory, [], NO_FILES)).toMatchObject({
		security: [],
		agents: [],
		automations: [],
		settings: [],
	});
});
