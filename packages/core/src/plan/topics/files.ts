import { areasOf, splitArea } from "../../factory/files.js";
import { isScript } from "../../factory/scripts.js";
import type { FactoryFiles } from "../../factory/types.js";
import type { PlanTopic } from "./topic.js";

const SKILL_FILE = /^(agents\/[^/]+\/)?skills\//;
/** The files whose content the plan describes line by line. */
const DESCRIBED =
	/^(factory\.yaml|agents\/[^/]+\/agent\.md|automations\/[^/]+\/automation\.md)$/;

/**
 * Paths are read without their area: `qa/skills/x/SKILL.md` is a skill file as `skills/x/SKILL.md` is.
 * A line per changed file the plan does not describe otherwise: what is applied is exactly
 * what the plan shows. Skill files steer agents and scripts run on this machine, so a
 * change to one is a security line (the factory only keeps their names); any other file (a README,
 * a test of the scripts) is a setting.
 */
export function fileChanges(
	before: FactoryFiles,
	after: FactoryFiles,
): PlanTopic {
	const security: string[] = [];
	const settings: string[] = [];
	const areas = new Set([...areasOf(before), ...areasOf(after)]);
	for (const path of Object.keys({ ...before, ...after }).sort()) {
		const { rest } = splitArea(path, areas);
		if (before[path] === after[path] || DESCRIBED.test(rest)) continue;
		const what = SKILL_FILE.test(rest)
			? "skill file"
			: isScript(path)
				? "script"
				: "file";
		(what === "file" ? settings : security).push(
			before[path] === undefined
				? `+ ${what} ${path}`
				: after[path] === undefined
					? `- ${what} ${path}`
					: `~ ${what} ${path} changed`,
		);
	}
	return { security, settings };
}
