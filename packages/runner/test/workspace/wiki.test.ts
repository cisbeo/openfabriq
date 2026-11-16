import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, expect, it } from "vitest";
import { projectDir } from "../../src/state/projects.js";
import {
	diagramLines,
	parseGrep,
	readWiki,
	searchWiki,
	titlesFromIndex,
	wikiPage,
} from "../../src/workspace/wiki.js";

const REPO = "acme/app";
const write = (path: string, text: string) => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
};
const git = (dir: string, ...args: string[]) =>
	execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

let clone: string;
let head: string;

beforeEach(() => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-wiki-"));
	const project = projectDir(REPO);
	write(
		join(project, "factory/factory.yaml"),
		"name: F\nrepository: acme/app\nmaintainers: [alice]\nwiki:\n  folder: docs/wiki\n",
	);
	clone = join(project, "repo");
	mkdirSync(clone, { recursive: true });
	git(clone, "init", "-q", "-b", "main");
	git(clone, "config", "user.email", "t@t");
	git(clone, "config", "user.name", "t");
	write(
		join(clone, "docs/wiki/index.md"),
		"# Index\n\n- [Payments](areas/payments.md)\n",
	);
	write(
		join(clone, "docs/wiki/areas/payments.md"),
		"# Payments\n\nCharges go through Stripe.\n",
	);
	write(join(clone, "src/pay.ts"), "// Stripe here too\n");
	git(clone, "add", "-A");
	git(clone, "commit", "-q", "-m", "wiki");
	head = git(clone, "rev-parse", "HEAD");
	// What the poll writes: the default branch's head as GitHub said.
	write(join(project, "cursor.json"), JSON.stringify({ branch: head }));
});

it("lists the wiki's pages at the default branch's head", async () => {
	expect(await readWiki(REPO)).toEqual({
		folder: "docs/wiki",
		refresh: "manual",
		commit: head.slice(0, 7),
		date: expect.any(String),
		pages: ["areas/payments.md", "index.md"],
		titles: { "areas/payments.md": "Payments" },
	});
});

it("names the pages as index.md links them", () => {
	expect(
		titlesFromIndex(
			"- [SDLC pack](areas/sdlc-pack.md): the workflows\n- [**Start** here](./start-here.md#top)\n- [code](../src/a.ts)\n- [Again](areas/sdlc-pack.md)",
		),
	).toEqual({
		"areas/sdlc-pack.md": "SDLC pack",
		"start-here.md": "Start here",
	});
});

it("reads only a page the wiki lists, as committed", async () => {
	write(join(clone, "docs/wiki/areas/payments.md"), "changed, not committed\n");
	expect(await wikiPage(REPO, "areas/payments.md")).toEqual({
		text: expect.stringContaining("Stripe"),
	});
	expect(await wikiPage(REPO, "../../src/pay.ts")).toEqual({ missing: "page" });
	expect(await wikiPage(REPO, "missing.md")).toEqual({ missing: "page" });
});

it("finds the words as typed, in the wiki only", async () => {
	expect(await searchWiki(REPO, "stripe")).toEqual([
		{ page: "areas/payments.md", line: 3, text: "Charges go through Stripe." },
	]);
	expect(await searchWiki(REPO, "[a-z]+")).toEqual([]);
	expect(await searchWiki(REPO, "  ")).toEqual([]);
});

it("reads git grep's lines in the wiki's folder only", () => {
	const ref = "4f2a9c1";
	const out = [
		`${ref}:docs/wiki/index.md\x003\x00  - [Payments](areas/payments.md)  `,
		`${ref}:docs/wiki/areas/payments.md\x0012\x00a\x00b`,
		`${ref}:docs/wikis/other.md\x001\x00not the folder`,
		`${ref}:docs/wiki/no-number.md`,
		`${ref}:docs/wiki/long.md\x001\x00${"x".repeat(400)}`,
		"",
	].join("\n");
	expect(parseGrep(out, ref, "docs/wiki")).toEqual([
		{ page: "index.md", line: 3, text: "- [Payments](areas/payments.md)" },
		{ page: "areas/payments.md", line: 12, text: "a\x00b" },
		{ page: "long.md", line: 1, text: "x".repeat(300) },
	]);
	expect(parseGrep("", ref, "docs/wiki")).toEqual([]);
});

it("says nothing is there yet before the clone has the branch", async () => {
	write(
		join(projectDir(REPO), "cursor.json"),
		JSON.stringify({ branch: "0".repeat(40) }),
	);
	expect(await readWiki(REPO)).toEqual({
		folder: "docs/wiki",
		refresh: "manual",
		pages: [],
		titles: {},
	});
});

it("finds no line of a diagram's source: a reader does not search it", async () => {
	write(
		join(clone, "docs/wiki/areas/payments.md"),
		"# Payments\n\nCharges go through Stripe.\n\n```mermaid\nflowchart LR\n  api --> stripe([Stripe])\n```\n",
	);
	git(clone, "commit", "-q", "-am", "diagram");
	write(
		join(projectDir(REPO), "cursor.json"),
		JSON.stringify({ branch: git(clone, "rev-parse", "HEAD") }),
	);
	expect(await searchWiki(REPO, "stripe")).toEqual([
		{ page: "areas/payments.md", line: 3, text: "Charges go through Stripe." },
	]);
	expect(
		[...diagramLines("a\n```mermaid\nx\n```\n```ts\ny\n```")].sort(),
	).toEqual([2, 3, 4]);
});

it("reads the engine's own merge, which the cursor keeps apart from the branch it saw", async () => {
	write(join(clone, "docs/wiki/start-here.md"), "# Start here\n");
	git(clone, "add", "-A");
	git(clone, "commit", "-q", "-m", "merged by the engine");
	const merged = git(clone, "rev-parse", "HEAD");
	write(
		join(projectDir(REPO), "cursor.json"),
		JSON.stringify({ branch: head, mergedHead: merged }),
	);
	expect((await readWiki(REPO))?.commit).toBe(merged.slice(0, 7));
	expect(await wikiPage(REPO, "start-here.md")).toEqual({
		text: "# Start here\n",
	});
});
