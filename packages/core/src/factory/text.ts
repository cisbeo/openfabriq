import { COMMENTED_EVENTS } from "../vocabulary.js";
import type {
	Automation,
	MergeConditions,
	Permission,
	Trigger,
} from "./types.js";

// How the plan and the workflow graph write a trigger, a permission and a list.

const triggerText = (t: Trigger) => {
	const filters = [
		...(t.labels && COMMENTED_EVENTS.includes(t.event)
			? [`labeled ${t.labels.join(" or ")}`]
			: (t.labels ?? [])),
		...(t.cron ? [t.cron] : []),
		...(t.ignore_paths ? [`ignoring ${t.ignore_paths.join(", ")}`] : []),
		...(t.query ? [`query ${t.query}`] : []),
		...(t.webhook ? [t.webhook] : []),
		...(t.mentions ? [`mentions ${t.mentions}`] : []),
		...(t.openedBy ? [`opened by ${t.openedBy}`] : []),
	];
	return filters.length ? `${t.event} (${filters.join(", ")})` : t.event;
};
export const whenText = (a: Automation) => a.when.map(triggerText).join(", ");
const mergeText = (m: MergeConditions) =>
	[
		...(m.labels ? [`labels ${m.labels.join(", ")}`] : []),
		...(m.only_paths ? [`only ${m.only_paths.join(", ")}`] : []),
		...(m.except_paths ? [`except ${m.except_paths.join(", ")}`] : []),
	].join("; ");
export const permissionText = (p: Permission) =>
	p.merge
		? `${p.action} (${mergeText(p.merge)})`
		: p.labels
			? `${p.action} (${p.labels.join(", ")})`
			: p.action;
export const listOrNothing = (items: string[]) =>
	items.length ? items.join(", ") : "nothing";
