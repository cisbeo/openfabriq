import { type Automation, answerMentionsName } from "@openfabriq/core";
import type { TabItem } from "../../components/tabs.js";
import { ACTION_SHORT } from "../../lib/format.js";
import type { ProjectAgents, RunRecord, Schedule } from "../../lib/types.js";

// What the agents' pages say about an agent, from the factory and its runs.

export interface Stats {
	runs: number;
	succeeded: number;
	failed: number;
	costUsd: number;
	/** Over the runs that ended with a duration. */
	averageMs?: number;
	last?: RunRecord;
	working: boolean;
}

/** An agent's runs, latest first, in figures. */
export function agentStats(runs: RunRecord[]): Stats {
	const ended = runs.filter((r) => r.durationMs !== undefined);
	return {
		runs: runs.length,
		succeeded: runs.filter((r) => r.status === "succeeded").length,
		failed: runs.filter((r) => r.status === "failed").length,
		costUsd: runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
		...(ended.length
			? {
					averageMs:
						ended.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) /
						ended.length,
				}
			: {}),
		...(runs[0] ? { last: runs[0] } : {}),
		working: runs.some((r) => r.status === "running"),
	};
}

/** The outputs of an automation, labels added and removed folded into one "Labels" box. */
export function automationOutputs(a: Automation) {
	const out: {
		key: string;
		action: string;
		label: string;
		tokens: string[];
	}[] = [];
	const labels: string[] = [];
	for (const p of a.can) {
		if (p.action === "add_labels" || p.action === "remove_labels") {
			const sign = p.action === "add_labels" ? "+ " : "− ";
			labels.push(...(p.labels ?? ["any label"]).map((l) => sign + l));
			if (!out.some((o) => o.key === "labels"))
				out.push({
					key: "labels",
					action: "add_labels",
					label: "Labels",
					tokens: labels,
				});
			continue;
		}
		out.push({
			key: p.action,
			action: p.action,
			label: ACTION_SHORT[p.action] ?? p.action,
			// The labels create_issue puts on the issues it opens.
			tokens: p.labels ?? [],
		});
	}
	return out;
}

/**
 * The tags of a trigger: its labels (on a comment, "labeled" ones), its schedule in words, its query, the word a comment must
 * mention, the paths it skips, and the agent whose pull requests it answers (opened_by).
 */
export function triggerTokens(
	t: Automation["when"][number],
	schedules: Schedule[] | undefined,
): string[] {
	const onComment = t.event.endsWith(".commented");
	return [
		...(t.labels ?? []).map((l) => (onComment ? `labeled ${l}` : l)),
		...(t.cron
			? [schedules?.find((s) => s.cron === t.cron)?.words ?? t.cron]
			: []),
		...(t.query ? [t.query] : []),
		...(t.mentions ? [t.mentions] : []),
		...(t.ignore_paths ?? []).map((path) => `skip ${path}`),
		...(t.openedBy ? [`opened by ${t.openedBy}`] : []),
	];
}

/**
 * The factory's commands the agent can run by name (with the `commands` tool), and the checks
 * that judge its code (when it can change code: `edit` or `shell`).
 */
export function harnessOf(
	data: Pick<ProjectAgents, "commands" | "checks">,
	tools: string[],
): { named: string[]; checks: string[] } {
	const changesCode = tools.includes("edit") || tools.includes("shell");
	return {
		named: tools.includes("commands") ? Object.keys(data.commands ?? {}) : [],
		checks: changesCode ? (data.checks ?? []) : [],
	};
}

/** The soonest next run of an automation's schedules. */
export const nextRun = (schedules: Schedule[] | undefined) =>
	schedules
		?.map((s) => s.next)
		.filter((n): n is string => n !== undefined)
		.sort()[0];

/** Every action the agent's automations let it propose, once each. */
export const writesOf = (automations: Automation[]) => [
	...new Set(automations.flatMap((a) => a.can.map((p) => p.action))),
];

/** Who can start an automation, by where its triggers come from. */
const WHO: Record<string, { label: string; hint: string }> = {
	slack: {
		label: "Slack channel",
		hint: "Anyone in the factory's Slack channel can start it: maintainers lists GitHub logins, so it does not apply here. Keep the channel private.",
	},
	linear: {
		label: "Linear team",
		hint: "Anyone who can assign, mention or label in the Linear team of factory.yaml can start it: maintainers lists GitHub logins, so it does not apply here.",
	},
	sentry: {
		label: "Sentry",
		hint: "A new Sentry error starts it, not a person. What the run writes is marked untrusted.",
	},
	webhook: {
		label: "Webhook",
		hint: "A request signed for the webhook starts it, not a person. What the run writes is marked untrusted.",
	},
	schedule: {
		label: "Schedule",
		hint: "It starts at its times, with no one to act.",
	},
};

const sourceOf = (event: string) =>
	event === "schedule" || event === "default_branch.updated"
		? "schedule"
		: (/^(slack|linear|sentry|webhook)\./.exec(event)?.[1] ?? "github");

/**
 * The two chips of an automation, each with what it means in words: who can start it, and how
 * many of its runs go at once (`concurrency`). `from` only counts for GitHub's events: other
 * sources have their own gate.
 */
export function automationChips(
	a: Pick<Automation, "from" | "concurrency" | "when">,
): { key: string; label: string; hint: string }[] {
	const sources = new Set(a.when.map((t) => sourceOf(t.event)));
	const other = sources.size === 1 ? WHO[[...sources][0] ?? ""] : undefined;
	const who =
		other ??
		(a.from === "anyone"
			? {
					label: "Anyone",
					hint: "Anyone who can cause the event on GitHub can start it, not only the maintainers (from: anyone). What such a run writes is marked untrusted.",
				}
			: {
					label: "Maintainers",
					hint: "Only the maintainers of factory.yaml can start it. An issue, a label or a comment from anyone else starts nothing.",
				});
	return [
		{ key: "from", ...who },
		a.concurrency === "repository"
			? {
					key: "concurrency",
					label: "1 per repo",
					hint: "One run at a time for the whole repository. An event that comes during a run waits for it to end.",
				}
			: sources.size === 1 && sources.has("slack")
				? {
						key: "concurrency",
						label: "1 per thread",
						hint: "One run at a time per Slack thread; different threads run side by side. A message in the same thread during a run waits for it to end.",
					}
				: {
						key: "concurrency",
						label: "1 per issue",
						hint: "One run at a time per issue or pull request; different ones run side by side. An event on the same issue during a run waits for it to end.",
					},
	];
}

/**
 * The agents by area, each group in the order given: those at the root first, without a
 * area, then each area by name. One group when the factory has no area.
 */
export function byArea<A extends { name: string; area?: string }>(
	agents: A[],
): { area?: string; agents: A[] }[] {
	const groups = new Map<string | undefined, A[]>();
	for (const agent of agents)
		groups.set(agent.area, [...(groups.get(agent.area) ?? []), agent]);
	return [...groups]
		.sort(([a], [b]) =>
			a === undefined ? -1 : b === undefined ? 1 : a.localeCompare(b),
		)
		.map(([area, agents]) => (area ? { area, agents } : { agents }));
}

/**
 * The automations an agent's page and card show: all but the engine's answer to @openfabriq on its
 * pull requests and issues, which every agent that opens one has, and the plan already names.
 */
export const shownAutomations = <
	A extends Pick<Automation, "name" | "builtIn">,
>(agent: {
	name: string;
	automations: A[];
}): A[] =>
	agent.automations.filter(
		(a) => !(a.builtIn && a.name === answerMentionsName(agent.name)),
	);

/** How many automations the agent's page lists: those it runs, and those it reviews. */
export const automationCount = (agent: {
	name: string;
	automations: Pick<Automation, "name" | "builtIn">[];
	reviews: unknown[];
}) => shownAutomations(agent).length + agent.reviews.length;

export type AgentTab =
	| "automations"
	| "brief"
	| "skills"
	| "resources"
	| "runs";

/**
 * An agent's tabs: when it works first, then its skills and what it works with, its brief, what
 * it did. Automations and Skills stay when empty, to say how to add one; the brief and the runs
 * show only when there is something to read.
 */
export function agentTabs(
	agent: {
		name: string;
		automations: Pick<Automation, "name" | "builtIn">[];
		reviews: unknown[];
		skillDocs: unknown[];
		instructions: string;
	},
	runs: number,
): TabItem<AgentTab>[] {
	return [
		{
			id: "automations",
			label: "Automations",
			count: automationCount(agent),
		},
		{ id: "skills", label: "Skills", count: agent.skillDocs.length },
		{ id: "resources", label: "Resources" },
		...(agent.instructions.trim()
			? [{ id: "brief" as const, label: "Brief" }]
			: []),
		...(runs > 0 ? [{ id: "runs" as const, label: "Runs", count: runs }] : []),
	];
}

/** The tab asked for when the page shows it, else the first. */
export const agentTab = (
	asked: string | undefined,
	tabs: TabItem<AgentTab>[],
): AgentTab => tabs.find((t) => t.id === asked)?.id ?? "automations";
