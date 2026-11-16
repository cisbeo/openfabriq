import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Wiki } from "@openfabriq/core";
import { cursorHead, cursorPath } from "../engine/cursors.js";
import { readJsonIfExists } from "../files.js";
import { projectDir, readAppliedFactory } from "../state/projects.js";
import { cloneGit } from "./hardened-git.js";

/** The wiki as the studio and the chat read it: at the default branch, in the engine's clone. */
export interface WikiView {
	folder: string;
	refresh: Wiki["refresh"];
	/** The commit read, short, and its date; absent before the clone has the default branch. */
	commit?: string;
	date?: string;
	/** Its Markdown pages, relative to the folder, index.md among them once it exists. */
	pages: string[];
	/** Page → its name, as index.md links it: the agent named them ("SDLC pack"). */
	titles: Record<string, string>;
}

/** The pages index.md links to, with the text of their link: `[SDLC pack](areas/sdlc-pack.md)`. */
export function titlesFromIndex(index: string): Record<string, string> {
	const titles: Record<string, string> = {};
	for (const [, text = "", target = ""] of index.matchAll(
		/\[([^\]]+)\]\(\s*(?:\.\/)?([^)\s#]+\.md)(?:#[^)]*)?\s*\)/g,
	)) {
		const name = text.replace(/[`*_]/g, "").trim();
		if (name && !(target in titles)) titles[target] = name;
	}
	return titles;
}

export interface WikiMatch {
	page: string;
	line: number;
	text: string;
}

export const MAX_SEARCH = 200;
const MAX_MATCHES = 50;

interface Opened {
	wiki: Wiki;
	clone: string;
	ref?: string;
}

/**
 * The commit to read: the default branch's head as GitHub last said (the poll's cursor), when the
 * clone has it, or origin/HEAD. Refs in the clone are the agents' to move; the cursor is not.
 */
async function open(repository: string): Promise<Opened | undefined> {
	const wiki = readAppliedFactory(repository)?.wiki;
	if (!wiki) return undefined;
	const clone = join(projectDir(repository), "repo");
	// apply makes the clone: until then, there is nothing to read.
	if (!existsSync(join(clone, ".git"))) return { wiki, clone };
	// After the engine's own merge, the cursor keeps the branch it saw before and the new head apart.
	const cursor = readJsonIfExists<{ branch?: string; mergedHead?: string }>(
		cursorPath(repository),
	);
	const seen = cursor ? cursorHead(cursor) : undefined;
	for (const ref of [seen, "origin/HEAD"]) {
		if (!ref) continue;
		const sha = await cloneGit(clone, [
			"rev-parse",
			"--verify",
			"--quiet",
			`${ref}^{commit}`,
		]).then(
			(out) => out.trim(),
			() => "",
		);
		if (sha) return { wiki, clone, ref: sha };
	}
	return { wiki, clone };
}

/** The wiki's Markdown pages at the commit, relative to its folder, sorted. */
async function listPages({
	wiki,
	clone,
	ref,
}: Opened & { ref: string }): Promise<string[]> {
	const listed = await cloneGit(clone, [
		"ls-tree",
		"-r",
		"-z",
		"--name-only",
		ref,
		"--",
		`${wiki.folder}/`,
	]);
	return listed
		.split("\0")
		.filter((p) => p.endsWith(".md"))
		.map((p) => p.slice(wiki.folder.length + 1))
		.sort();
}

export async function readWiki(
	repository: string,
): Promise<WikiView | undefined> {
	const opened = await open(repository);
	if (!opened) return undefined;
	const { wiki, clone, ref } = opened;
	const view: WikiView = {
		folder: wiki.folder,
		refresh: wiki.refresh,
		pages: [],
		titles: {},
	};
	if (!ref) return view;
	const [pages, last] = await Promise.all([
		listPages({ wiki, clone, ref }),
		cloneGit(clone, ["log", "-1", "--format=%h %cI", ref]),
	]);
	const [commit, date] = last.trim().split(" ");
	const index = pages.includes("index.md")
		? await cloneGit(clone, ["show", `${ref}:${wiki.folder}/index.md`])
		: "";
	return {
		...view,
		...(commit ? { commit } : {}),
		...(date ? { date } : {}),
		pages,
		titles: titlesFromIndex(index),
	};
}

/** A page's Markdown, or undefined when the wiki has no such page: only listed pages are read. */
export async function wikiPage(
	repository: string,
	page: string,
): Promise<{ text: string } | { missing: "off" | "not fetched" | "page" }> {
	const opened = await open(repository);
	if (!opened) return { missing: "off" };
	const { wiki, clone, ref } = opened;
	if (!ref) return { missing: "not fetched" };
	if (!(await listPages({ wiki, clone, ref })).includes(page))
		return { missing: "page" };
	return {
		text: await cloneGit(clone, ["show", `${ref}:${wiki.folder}/${page}`]),
	};
}

export const WIKI_OFF = "The wiki is off.";
export const WIKI_NOT_FETCHED =
	"The wiki is not fetched yet: the engine reads it once its clone has the default branch.";

/** The lines of the wiki that contain the words, as typed: a fixed string, any case. */
export async function searchWiki(
	repository: string,
	query: string,
): Promise<WikiMatch[]> {
	const words = query.trim().slice(0, MAX_SEARCH);
	if (!words) return [];
	const opened = await open(repository);
	if (!opened?.ref) return [];
	const { wiki, clone, ref } = opened;
	// git grep exits 1 when nothing matches.
	const out = await cloneGit(clone, [
		"grep",
		"-n",
		"-I",
		"-i",
		"-F",
		"--null",
		"--no-color",
		"-e",
		words,
		ref,
		"--",
		`${wiki.folder}/*.md`,
	]).catch(() => "");
	const found = parseGrep(out, ref, wiki.folder);
	// A diagram's source is not text a reader searches: drop the lines inside its ```mermaid block.
	const pages = [...new Set(found.map((m) => m.page))];
	const diagrams = new Map(
		await Promise.all(
			pages.map(async (page) => {
				const blob = `${ref}:${wiki.folder}/${page}`;
				let lines = seenDiagrams.get(blob);
				if (!lines) {
					lines = diagramLines(await cloneGit(clone, ["show", blob]));
					if (seenDiagrams.size > 2000) seenDiagrams.clear();
					seenDiagrams.set(blob, lines);
				}
				return [page, lines] as const;
			}),
		),
	);
	return found
		.filter((m) => !diagrams.get(m.page)?.has(m.line))
		.slice(0, MAX_MATCHES);
}

/** git grep's lines at `ref`, `<ref>:<path>\0<line>\0<text>`, as matches: only those in the folder. */
export function parseGrep(
	out: string,
	ref: string,
	folder: string,
): WikiMatch[] {
	return out.split("\n").flatMap((line) => {
		const [where = "", number = "", ...text] = line.split("\0");
		const path = where.slice(ref.length + 1);
		return path.startsWith(`${folder}/`) && number
			? [
					{
						page: path.slice(folder.length + 1),
						line: Number(number),
						text: text.join("\0").trim().slice(0, 300),
					},
				]
			: [];
	});
}

// A page at a commit never changes: each search as you type reads it once.
const seenDiagrams = new Map<string, Set<number>>();

/** The line numbers (from 1) of a page that sit inside a ```mermaid block, fences included. */
export function diagramLines(text: string): Set<number> {
	const lines = new Set<number>();
	let inside = false;
	text.split("\n").forEach((line, i) => {
		const fence = /^\s*(```|~~~)\s*(\w*)/.exec(line);
		if (fence && !inside && fence[2] === "mermaid") inside = true;
		else if (fence && inside) {
			lines.add(i + 1);
			inside = false;
			return;
		}
		if (inside) lines.add(i + 1);
	});
	return lines;
}
