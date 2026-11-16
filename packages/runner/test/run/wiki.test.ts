import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Factory, loadFactory, withWiki } from "@openfabriq/core";
import { expect, it } from "vitest";
import { withWikiPointer } from "../../src/run/launch.js";
import { workspace } from "../../src/workspace/workspace.js";

const factory = withWiki(
	loadFactory({
		"factory.yaml":
			"name: F\nrepository: acme/app\nmaintainers: [alice]\nwiki:\n  folder: docs/wiki\n",
		"agents/worker/agent.md": "---\ndescription: Works\n---\nWork.\n",
		"automations/go/automation.md":
			"---\nwhen: issue.opened\nagent: worker\n---\nGo.\n",
	}).factory as Factory,
);
const worker = factory.agents.worker;
const wiki = factory.agents.wiki;
if (!worker || !wiki) throw new Error("both agents should exist");

it("points the factory's agents at the wiki once it exists, never the wiki's own agent", () => {
	const worktree = mkdtempSync(join(tmpdir(), "openfabriq-wiki-"));
	expect(withWikiPointer(worker, factory, worktree)).toBe("Work.");
	mkdirSync(join(worktree, "docs/wiki"), { recursive: true });
	writeFileSync(join(worktree, "docs/wiki/index.md"), "# Index\n");
	expect(withWikiPointer(worker, factory, worktree)).toContain(
		"start with `docs/wiki/index.md`",
	);
	expect(withWikiPointer(wiki, factory, worktree)).toBe(wiki.instructions);
	const { wiki: _, ...off } = factory;
	expect(withWikiPointer(worker, off, worktree)).toBe("Work.");
});

it("gives the wiki's agent the engine's wiki skill, and no factory agent its folder", () => {
	const factoryDir = mkdtempSync(join(tmpdir(), "openfabriq-factory-"));
	const own = join(factoryDir, "agents/wiki/skills/wiki");
	mkdirSync(own, { recursive: true });
	writeFileSync(join(own, "SKILL.md"), "---\nname: wiki\n---\nNot ours.\n");
	const dir = workspace.plugin(
		factoryDir,
		{ name: "wiki", builtIn: true },
		mkdtempSync(join(tmpdir(), "openfabriq-plugin-")),
	);
	const skill = join(dir ?? "", "skills/wiki/SKILL.md");
	expect(existsSync(skill) && readFileSync(skill, "utf8")).toContain(
		"a **map** of the code",
	);
	expect(
		workspace.plugin(
			factoryDir,
			{ name: "worker" },
			mkdtempSync(join(tmpdir(), "openfabriq-plugin-")),
		),
	).toBeUndefined();
});
