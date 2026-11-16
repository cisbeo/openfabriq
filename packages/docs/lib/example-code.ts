import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { highlight } from "fumadocs-core/highlight";
import { EXAMPLES } from "./templates";

/** A file of an example factory, as it is in the repository. */
export const exampleFile = (example: string, path: string) =>
	readFileSync(join(EXAMPLES, example, "openfabriq", path), "utf8").trimEnd();

/** Every file of an example factory, factory.yaml first, then in path order. */
export const exampleFiles = (example: string) =>
	readdirSync(join(EXAMPLES, example, "openfabriq"), { recursive: true })
		.map(String)
		.filter((path) => /\.(md|yaml)$/.test(path))
		.sort((a, b) =>
			a === "factory.yaml" ? -1 : b === "factory.yaml" ? 1 : a.localeCompare(b),
		);

/**
 * Highlighted at build time in GitHub's two themes. `notes`: a short gloss after a line,
 * by line number from 1, that the page sets in the margin.
 */
export function highlightCode(
	code: string,
	lang: string,
	notes: Record<number, string> = {},
) {
	return highlight(code, {
		lang,
		themes: { light: "github-light-default", dark: "github-dark-default" },
		defaultColor: false,
		transformers: [
			{
				line(node, line) {
					const note = notes[line];
					if (note) node.properties["data-note"] = note;
				},
			},
		],
	});
}

// Glosses set beside a file's top-level keys, by file name.
const NOTES: Record<string, Record<string, string>> = {
	"factory.yaml": {
		repository: "where it works",
		maintainers: "who can start it",
		checks: "must pass before any PR",
		limits: "what it may spend",
	},
	"agent.md": {
		description: "its job, in one line",
		tools: "what it may use here",
	},
	"automation.md": {
		when: "when work starts",
		agent: "who does it",
		reviewed_by: "the agent that reviews it",
		can: "what the engine may write",
	},
	"SKILL.md": { description: "tells agents when to use it" },
};

/** The line numbers of a file's noted keys: "can:" at the start of line 5 → { 5: "…" }. */
function notesOf(path: string, code: string) {
	const notes = NOTES[path.split("/").at(-1) ?? ""] ?? {};
	return Object.fromEntries(
		code.split("\n").flatMap((line, i) => {
			const note = notes[line.match(/^([\w.]+):/)?.[1] ?? ""];
			return note ? [[i + 1, note]] : [];
		}),
	);
}

/**
 * Every file of an example factory, highlighted. `notes`: glosses beside the key lines,
 * where the file has a margin wide enough for them.
 */
export const exampleFactory = (example: string, { notes = true } = {}) =>
	Promise.all(
		exampleFiles(example).map(async (path) => {
			const lang = path.endsWith(".yaml") ? "yaml" : "markdown";
			const code = exampleFile(example, path);
			return {
				path,
				lang,
				code: await highlightCode(code, lang, notes ? notesOf(path, code) : {}),
			};
		}),
	);
