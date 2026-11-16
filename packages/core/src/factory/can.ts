import type { z } from "zod";
import { ACTIONS, LISTS_LABELS } from "../vocabulary.js";
import { isOneOf, sentenceList, unknownWord } from "../words.js";
import type { AutomationShape } from "./schema.js";
import type { MergeConditions, Permission } from "./types.js";

/** The conditions as written, without the keys left out, paths read as only_paths. */
function mergeConditions(value: {
	labels?: string[] | undefined;
	only_paths?: string[] | undefined;
	paths?: string[] | undefined;
	except_paths?: string[] | undefined;
}): MergeConditions {
	const merge: MergeConditions = {};
	const onlyPaths = value.only_paths ?? value.paths;
	if (value.labels) merge.labels = value.labels;
	if (onlyPaths) merge.only_paths = onlyPaths;
	if (value.except_paths) merge.except_paths = value.except_paths;
	return merge;
}

export function parseCan(raw: z.output<(typeof AutomationShape)["can"]>): {
	can: Permission[];
	problems: string[];
} {
	const problems: string[] = [];
	const permissions: Permission[] = [];
	for (const item of raw) {
		const entries =
			typeof item === "string"
				? [[item, undefined] as const]
				: Object.entries(item);
		for (const [action, value] of entries) {
			const labels = Array.isArray(value) ? value : undefined;
			if (!isOneOf(ACTIONS, action))
				problems.push(unknownWord("permission", action, ACTIONS, "can"));
			else if (permissions.some((p) => p.action === action))
				problems.push(`can lists ${action} twice; keep one`);
			else if (action === "merge_pull_request") {
				// A merge always has a limit the factory chose.
				if (!value || Array.isArray(value) || Object.keys(value).length === 0)
					problems.push(
						'can.merge_pull_request needs at least one condition: labels, only_paths or except_paths, for example { only_paths: ["docs/**"] }',
					);
				else if (value.only_paths && value.paths)
					problems.push(
						"can.merge_pull_request gives both only_paths and paths, its old name: keep only_paths",
					);
				else permissions.push({ action, merge: mergeConditions(value) });
			} else if (value && !labels)
				problems.push(
					`can.${action} does not take conditions; only merge_pull_request does`,
				);
			else if (labels?.length === 0)
				problems.push(
					`can.${action} is empty: list at least one label, or write ${action} alone to allow any label`,
				);
			else if (labels && !LISTS_LABELS.includes(action))
				problems.push(
					`can.${action} does not take a list of labels; only ${sentenceList(LISTS_LABELS)} do`,
				);
			else permissions.push(labels ? { action, labels } : { action });
		}
	}
	return { can: permissions, problems };
}
