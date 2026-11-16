import type { AgentHue } from "../../lib/agent-hue.js";
import { duration, wait } from "../../lib/format.js";
import type { Board, Metrics } from "../../lib/types.js";

// The overview's figures from a project's metrics: what each card shows, in words and numbers.

/** A CSS width: `part` of `whole`, 0% of nothing. */
export const percent = (part: number, whole: number) =>
	whole > 0 ? `${(part / whole) * 100}%` : "0%";

/**
 * The lines of an axis from 0: about four steps of 1, 2 or 5 (times a power of ten), the top
 * at or above `max`. `minStep` keeps the steps whole where a part means nothing (a run, a cent).
 */
export function axisTicks(max: number, minStep = 0): number[] {
	if (max <= 0) return [0, Math.max(minStep, 1)];
	const rough = max / 4;
	const power = 10 ** Math.floor(Math.log10(rough));
	const nice = [1, 2, 5, 10].find((m) => rough <= m * power) ?? 10;
	const step = Math.max(nice * power, minStep);
	const count = Math.ceil(max / step - 1e-9);
	return Array.from({ length: count + 1 }, (_, i) =>
		Number((i * step).toFixed(10)),
	);
}

const STEPPED_IN = [
	{ key: "handoffs", words: ["handoff", "handoffs"] },
	{ key: "failedRuns", words: ["failed run", "failed runs"] },
	{ key: "refusedOutputs", words: ["refused output", "refused outputs"] },
] as const;

/** "2 handoffs · 1 failed run"; a figure made of one part only names it, its number being the figure's. */
const breakdown = (parts: [number, string][]) => {
	const [first, ...rest] = parts;
	return first && rest.length === 0
		? first[1]
		: parts.map(([n, word]) => `${n} ${word}`).join(" · ");
};

/** The productivity cards' lines: what each figure is made of, only what is not zero. */
export function productivity(m: Metrics) {
	const { outputs } = m;
	return {
		/** "2 handoffs · 1 failed run". */
		steppedInWords: breakdown(
			STEPPED_IN.filter((s) => m.interventions[s.key] > 0).map((s) => {
				const n = m.interventions[s.key];
				return [n, s.words[n === 1 ? 0 : 1]];
			}),
		),
		/** The applied outputs, most first, and the most as the bars' full width. */
		outputs,
		applied: outputs.reduce((sum, a) => sum + a.count, 0),
		most: outputs[0]?.count ?? 0,
	};
}

/** The finished runs nobody had to step in on: "87%", and "26 of 30 finished runs · 2h 10m of agent work". */
export function unaided(m: Metrics) {
	const finished = m.runs.succeeded + m.runs.failed;
	return {
		share:
			finished > 0
				? `${Math.round((m.runs.unaided / finished) * 100)}%`
				: undefined,
		words: [
			finished > 0 && `${m.runs.unaided} of ${finished} finished runs`,
			m.agentTimeMs > 0 && `${duration(m.agentTimeMs)} of agent work`,
		]
			.filter(Boolean)
			.join(" · "),
	};
}

const pulls = (n: number) => `${n} pull ${n === 1 ? "request" : "requests"}`;

/** The gains cards: merged as written, and how long an issue waits for its merge against the team. */
export function gains(m: Metrics) {
	const { asWritten, changed, unknown } = m.gains.merged;
	const { factoryMs, factoryPulls, teamMs, teamPulls } = m.gains.issueToMerge;
	return {
		/** Undefined until a merged pull request can be told. */
		asWritten: asWritten + changed > 0 ? asWritten : undefined,
		/** "of 5 merged · 1 changed by a person · 2 not checked". */
		asWrittenWords: [
			asWritten + changed + unknown > 0 &&
				`of ${asWritten + changed + unknown} merged`,
			changed > 0 && `${changed} changed by a person`,
			unknown > 0 && `${unknown} not checked`,
		]
			.filter(Boolean)
			.join(" · "),
		issueToMerge: factoryMs === undefined ? undefined : wait(factoryMs),
		/** "median of 4 pull requests · your team: 3.2 days, 12 pull requests in 90 days". */
		issueToMergeWords: [
			factoryPulls > 0 && `median of ${pulls(factoryPulls)}`,
			teamMs !== undefined &&
				`your team: ${wait(teamMs)}, ${pulls(teamPulls)} in 90 days`,
		]
			.filter(Boolean)
			.join(" · "),
	};
}

/** The return cards: what a pull request merged as written cost, and the time an issue gains against the team's. */
export function returns(m: Metrics) {
	const { asWritten } = m.gains.merged;
	const { factoryMs, teamMs } = m.gains.issueToMerge;
	const gap =
		factoryMs !== undefined && teamMs !== undefined
			? teamMs - factoryMs
			: undefined;
	return {
		perAsWritten: asWritten > 0 ? m.cost.totalUsd / asWritten : undefined,
		/** "4.2 days", or "3 h lost" when the factory is slower. */
		timeGained:
			gap === undefined
				? undefined
				: gap >= 0
					? wait(gap)
					: `${wait(-gap)} lost`,
		/** "issue to merge: 6 h, your team: 4.2 days". */
		timeGainedWords:
			factoryMs !== undefined && teamMs !== undefined
				? `issue to merge: ${wait(factoryMs)}, your team: ${wait(teamMs)}`
				: "",
	};
}

/** Who spent the money: each agent that spent or ran, in its color, then the chat when it spent. */
export function spendingParts(m: Metrics, agentHue: AgentHue) {
	return [
		...m.cost.byAgent.map((a) => ({
			key: a.agent,
			value: a.usd,
			runs: a.runs as number | undefined,
			color: agentHue(a.agent),
		})),
		{
			key: "chat",
			value: m.cost.chatUsd,
			runs: undefined,
			color: "var(--fg-3)",
		},
	].filter((p) => p.value > 0 || p.runs);
}

/** What a unit of work cost; undefined when there is no such unit yet. */
export function costRatios(m: Metrics) {
	const { merged } = m.pullRequests;
	return {
		/** The agents' cost, without the chat. */
		perRun:
			m.runs.total > 0
				? (m.cost.totalUsd - m.cost.chatUsd) / m.runs.total
				: undefined,
		perMergedPr: merged > 0 ? m.cost.totalUsd / merged : undefined,
	};
}

/** How many of the project's cards wait for a person; undefined until the board is read. */
export const waitingFor = (board: Board | undefined, repository: string) =>
	board?.stages
		.find((s) => s.id === "needs-you")
		?.cards.filter((c) => c.run.repository === repository).length;

/**
 * The runs per day of the chart: every agent's, cut in parts by agent (the same order each day,
 * so an agent keeps its place in the column), or one agent's when the filter names it.
 */
export function runsPerDay(
	byDay: { day: string; runs: number; agents: Record<string, number> }[],
	agent?: string,
): { day: string; value: number; parts?: { key: string; value: number }[] }[] {
	if (agent)
		return byDay.map((d) => ({ day: d.day, value: d.agents[agent] ?? 0 }));
	const order = [
		...new Set(byDay.flatMap((d) => Object.keys(d.agents))),
	].sort();
	return byDay.map((d) => ({
		day: d.day,
		value: d.runs,
		parts: order.flatMap((a) => {
			const value = d.agents[a] ?? 0;
			return value > 0 ? [{ key: a, value }] : [];
		}),
	}));
}
