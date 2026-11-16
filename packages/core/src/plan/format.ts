import type { Plan } from "./plan.js";

export function isEmptyPlan(plan: Plan): boolean {
	return (
		plan.security.length +
			plan.agents.length +
			plan.automations.length +
			plan.settings.length +
			plan.labels.length ===
		0
	);
}

export function formatPlan(plan: Plan): string {
	if (isEmptyPlan(plan))
		return "No changes. The factory matches what is applied.";
	const sections: [string, string[]][] = [
		["Security changes (read these first)", plan.security],
		["Agents", plan.agents],
		["Automations", plan.automations],
		["Factory settings", plan.settings],
		["Labels to create on GitHub", plan.labels.map((l) => `+ ${l}`)],
	];
	const { add, change, remove } = plan.counts;
	const labels = plan.labels.length;
	return [
		...sections
			.filter(([, lines]) => lines.length)
			.map(([title, lines]) =>
				[title, ...lines.map((l) => `  ${l}`)].join("\n"),
			),
		`Plan: ${add} to add, ${change} to change, ${remove} to remove, ${labels} label${labels === 1 ? "" : "s"} to create.`,
	].join("\n\n");
}
