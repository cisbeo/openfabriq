import { areasOf, type FactoryFiles, splitArea } from "@openfabriq/core";

/** A skill an agent reads, as the app shows it. */
export interface SkillDoc {
	name: string;
	/** Its own (agents/<name>/skills/), its area's (<area>/skills/), or shared by every agent (skills/). */
	scope: "own" | "area" | "shared";
	/** Its SKILL.md, in openfabriq/. */
	path: string;
	description?: string;
	content: string;
}

const SKILL = /^(?:agents\/([^/]+)\/)?skills\/([^/]+)\/SKILL\.md$/;

/** `description:` from a SKILL.md header, and the text below it. */
function read(text: string): { description?: string; content: string } {
	const header = /^---\n([\s\S]*?)\n---\n?/.exec(text);
	if (!header) return { content: text.trim() };
	const line = /^description:\s*(.+)$/m.exec(header[1] ?? "")?.[1]?.trim();
	const description = line?.replace(/^(["'])(.*)\1$/, "$2");
	const content = text.slice(header[0].length).trim();
	return description ? { description, content } : { content };
}

/**
 * The skills an agent reads at run time: its own, its area's, then the factory's shared ones,
 * as the engine copies them into the run's plugin (workspace.plugin).
 */
export function skillDocs(
	files: FactoryFiles,
	agent: string,
	area?: string,
): SkillDoc[] {
	const found: Record<SkillDoc["scope"], SkillDoc[]> = {
		own: [],
		area: [],
		shared: [],
	};
	const areas = areasOf(files);
	for (const [path, text] of Object.entries(files).sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		const { area: folder, rest } = splitArea(path, areas);
		const match = SKILL.exec(rest);
		if (!match) continue;
		const [, owner, name = ""] = match;
		// Names are unique: an agent's own skills are in its folder, wherever that is.
		if (owner ? owner !== agent : folder !== undefined && folder !== area)
			continue;
		const scope = owner ? "own" : folder ? "area" : "shared";
		found[scope].push({ name, scope, path, ...read(text) });
	}
	return [...found.own, ...found.area, ...found.shared];
}
