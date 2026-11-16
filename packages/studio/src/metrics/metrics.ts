import type { Action } from "@openfabriq/core";
import type { RunRecord } from "@openfabriq/runner";
import { byEngineHandoff, handedOver, isLinkNotice } from "../runs/story.js";
import type { SubjectState, SubjectStates } from "../subjects/subject-state.js";
import type { MergedPull } from "./merged-pulls.js";

export const PERIODS = ["7d", "30d", "all"] as const;
export type Period = (typeof PERIODS)[number];

/** One chat message's cost (the chat spends the subscription too). */
export interface ChatCost {
	at: string;
	costUsd: number;
}

export interface Metrics {
	period: Period;
	/** First day counted, YYYY-MM-DD in the machine's time zone; absent for "all" without runs or chats. */
	since?: string;
	runs: {
		total: number;
		succeeded: number;
		failed: number;
		skipped: number;
		active: number;
		/** Succeeded with no handoff and no refused output: nobody had to step in. */
		unaided: number;
	};
	averageDurationMs?: number;
	/** Time the agents spent working, all finished runs together. */
	agentTimeMs: number;
	cost: {
		totalUsd: number;
		chatUsd: number;
		/** What the failed runs cost. */
		failedUsd: number;
		byAgent: { agent: string; usd: number; runs: number }[];
		/** `agents`: the runs of each agent that day, an agent without one left out. */
		byDay: {
			day: string;
			usd: number;
			runs: number;
			agents: Record<string, number>;
		}[];
	};
	pullRequests: {
		opened: number;
		merged: number;
		/** Closed without a merge: a person turned the work down. */
		closed: number;
		unknown: number;
	};
	interventions: {
		total: number;
		handoffs: number;
		failedRuns: number;
		refusedOutputs: number;
	};
	/** The outputs the engine applied for the agents, by kind, most first. */
	outputs: { action: Action; count: number }[];
	/** What the factory saved, as GitHub tells: nothing estimated. */
	gains: {
		/** The factory's merged pull requests: with no commit but the engine's, with one of a person, or not checked (opened before the engine noted its commits, or merged before the repository's 100 latest). */
		merged: { asWritten: number; changed: number; unknown: number };
		/** Median time from the opening of the issue a merged pull request closes to its merge. */
		issueToMerge: {
			factoryMs?: number;
			factoryPulls: number;
			/** The team's pull requests merged in the last TEAM_DAYS days. */
			teamMs?: number;
			teamPulls: number;
		};
	};
}

/** How far back the team's pull requests are compared. */
const TEAM_DAYS = 90;

/** YYYY-MM-DD of a date in the machine's time zone, like `costToday` in the runner. */
const localDay = (date: Date) => date.toLocaleDateString("sv-SE");

function days(from: Date, to: Date): string[] {
	const out: string[] = [];
	const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
	while (day <= to) {
		out.push(localDay(day));
		day.setDate(day.getDate() + 1);
	}
	return out;
}

/** The pull requests the factory opened: applied `create_pull_request` outputs, by URL. */
export function pullRequestUrls(runs: RunRecord[]): string[] {
	return [
		...new Set(
			runs.flatMap((r) =>
				r.outputs
					.filter(
						(o) =>
							o.action === "create_pull_request" &&
							o.status === "applied" &&
							o.url,
					)
					.map((o) => o.url as string),
			),
		),
	];
}

/** A run counts on the day it ended, like the daily cost limit (`costToday`); queued, until then. */
const when = (r: RunRecord) => r.endedAt ?? r.queuedAt;

/** A pull request GitHub says was closed without a merge. */
const closedUnmerged = (state: SubjectState | undefined) =>
	state !== undefined && !state.merged && !state.open;

/** The applied outputs of the agent's work: not the engine's own handoff or link notes. */
const agentOutputs = (r: RunRecord) =>
	r.outputs.filter(
		(o) => o.status === "applied" && !byEngineHandoff(r, o) && !isLinkNotice(o),
	);

/** The first day counted: "all" starts at midnight of the first run or chat message, so none of them is left out. */
function periodStart(
	runs: RunRecord[],
	chats: ChatCost[],
	period: Period,
	now: Date,
): Date | undefined {
	const from =
		period === "all"
			? [...runs.map(when), ...chats.map((c) => c.at)]
					.map((iso) => new Date(iso))
					.reduce<Date | undefined>((a, b) => (!a || b < a ? b : a), undefined)
			: now;
	const back = period === "all" ? 0 : period === "7d" ? 6 : 29;
	return (
		from && new Date(from.getFullYear(), from.getMonth(), from.getDate() - back)
	);
}

/** The runs a period shows: the pull requests GitHub is asked about are theirs only. */
export function runsInPeriod(
	runs: RunRecord[],
	period: Period,
	now: Date,
): RunRecord[] {
	const start =
		period === "all" ? undefined : periodStart(runs, [], period, now);
	return start ? runs.filter((r) => new Date(when(r)) >= start) : runs;
}

interface Day {
	usd: number;
	runs: number;
	agents: Record<string, number>;
}

/** Each day of the period, with what its runs and chat messages cost, and its runs by agent. */
function dayBuckets(
	start: Date | undefined,
	now: Date,
	runs: RunRecord[],
	chats: ChatCost[],
): Map<string, Day> {
	const byDay = new Map<string, Day>(
		(start ? days(start, now) : []).map((d) => [
			d,
			{ usd: 0, runs: 0, agents: {} },
		]),
	);
	for (const r of runs) {
		const day = byDay.get(localDay(new Date(when(r))));
		if (!day) continue;
		day.usd += r.costUsd ?? 0;
		day.runs += 1;
		day.agents[r.agent] = (day.agents[r.agent] ?? 0) + 1;
	}
	for (const c of chats) {
		const day = byDay.get(localDay(new Date(c.at)));
		if (day) day.usd += c.costUsd;
	}
	return byDay;
}

function runCounts(runs: RunRecord[]): Metrics["runs"] {
	const count = (status: RunRecord["status"]) =>
		runs.filter((r) => r.status === status).length;
	return {
		total: runs.length,
		succeeded: count("succeeded"),
		failed: count("failed"),
		skipped: count("skipped"),
		active: count("queued") + count("running"),
		unaided: runs.filter(
			(r) =>
				r.status === "succeeded" &&
				!handedOver(r) &&
				!r.outputs.some((o) => o.status === "refused"),
		).length,
	};
}

/** The most expensive agent first. */
function costByAgent(runs: RunRecord[]): Metrics["cost"]["byAgent"] {
	const byAgent = new Map<string, { usd: number; runs: number }>();
	for (const r of runs) {
		const agent = byAgent.get(r.agent) ?? { usd: 0, runs: 0 };
		agent.usd += r.costUsd ?? 0;
		agent.runs += 1;
		byAgent.set(r.agent, agent);
	}
	return [...byAgent]
		.map(([agent, v]) => ({ agent, ...v }))
		.sort((a, b) => b.usd - a.usd || b.runs - a.runs);
}

function pullRequestsOf(
	runs: RunRecord[],
	states: SubjectStates,
): Metrics["pullRequests"] {
	const urls = pullRequestUrls(runs);
	return {
		opened: urls.length,
		merged: urls.filter((u) => states[u]?.merged).length,
		closed: urls.filter((u) => closedUnmerged(states[u])).length,
		unknown: urls.filter((u) => !states[u]).length,
	};
}

function interventionsOf(runs: RunRecord[]): Metrics["interventions"] {
	// A failed run is already one intervention; the engine's handoff after it is not another.
	const handoffs = runs.filter(
		(r) => r.status !== "failed" && handedOver(r),
	).length;
	const failedRuns = runs.filter((r) => r.status === "failed").length;
	const refusedOutputs = runs
		.flatMap((r) => r.outputs)
		.filter((o) => o.status === "refused").length;
	return {
		total: handoffs + failedRuns + refusedOutputs,
		handoffs,
		failedRuns,
		refusedOutputs,
	};
}

/** The kinds of output applied, most first. */
function outputsOf(runs: RunRecord[]): Metrics["outputs"] {
	const counts = new Map<Action, number>();
	for (const o of runs.flatMap(agentOutputs))
		counts.set(o.action, (counts.get(o.action) ?? 0) + 1);
	return [...counts]
		.map(([action, count]) => ({ action, count }))
		.sort((a, b) => b.count - a.count);
}

const median = (values: number[]) => {
	if (values.length === 0) return undefined;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[mid]
		: ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

const pushesCode = (o: RunRecord["outputs"][number]) =>
	o.status === "applied" &&
	(o.action === "create_pull_request" || o.action === "push_to_pull_request");

/**
 * The factory's merged pull requests, against the repository's merged ones: those it wrote alone,
 * and how long an issue waits for its merge, the factory's against the team's.
 */
function gainsOf(
	all: RunRecord[],
	shown: RunRecord[],
	merged: MergedPull[],
	states: SubjectStates,
	now: Date,
): Metrics["gains"] {
	// A pull request's commits the engine pushed: an opening, then pushes, from any run.
	const engineCommits = new Map<
		string,
		{ opened: boolean; oids: Set<string> }
	>();
	for (const r of all)
		for (const o of r.outputs.filter(pushesCode)) {
			const url = o.url ?? r.url;
			if (!url) continue;
			const pull = engineCommits.get(url) ?? { opened: false, oids: new Set() };
			for (const oid of o.commits ?? []) pull.oids.add(oid);
			if (o.action === "create_pull_request" && o.commits?.length)
				pull.opened = true;
			engineCommits.set(url, pull);
		}
	const byUrl = new Map(merged.map((p) => [p.url, p]));
	const counts = { asWritten: 0, changed: 0, unknown: 0 };
	const factory: MergedPull[] = [];
	for (const u of pullRequestUrls(shown)) {
		const pull = byUrl.get(u);
		if (pull) factory.push(pull);
		// Merged before the repository's 100 latest: it counts, its commits unread.
		else if (states[u]?.merged) counts.unknown++;
	}
	for (const pull of factory) {
		const engine = engineCommits.get(pull.url);
		if (!engine?.opened) counts.unknown++;
		else if (pull.commits.every((oid) => engine.oids.has(oid)))
			counts.asWritten++;
		else counts.changed++;
	}
	const waits = (pulls: MergedPull[]) =>
		pulls.flatMap((p) =>
			p.issueOpenedAt
				? [new Date(p.mergedAt).getTime() - new Date(p.issueOpenedAt).getTime()]
				: [],
		);
	const factoryUrls = new Set(pullRequestUrls(all));
	const since = now.getTime() - TEAM_DAYS * 86_400_000;
	const factoryWaits = waits(factory);
	const teamWaits = waits(
		merged.filter(
			(p) => !factoryUrls.has(p.url) && new Date(p.mergedAt).getTime() >= since,
		),
	);
	const factoryMs = median(factoryWaits);
	const teamMs = median(teamWaits);
	return {
		merged: counts,
		issueToMerge: {
			...(factoryMs !== undefined ? { factoryMs } : {}),
			factoryPulls: factoryWaits.length,
			...(teamMs !== undefined ? { teamMs } : {}),
			teamPulls: teamWaits.length,
		},
	};
}

/** Runs (latest first or not) → the numbers of one project, or of all, over a period. */
export function computeMetrics(
	runs: RunRecord[],
	period: Period,
	now: Date,
	pullRequests: SubjectStates = {},
	chats: ChatCost[] = [],
	merged: MergedPull[] = [],
): Metrics {
	const start = periodStart(runs, chats, period, now);
	const inPeriod = (iso: string) => !start || new Date(iso) >= start;
	const shown = runs.filter((r) => inPeriod(when(r)));
	const shownChats = chats.filter((c) => inPeriod(c.at));
	const chatUsd = shownChats.reduce((sum, c) => sum + c.costUsd, 0);
	const durations = shown.flatMap((r) =>
		r.durationMs !== undefined && r.status !== "skipped" ? [r.durationMs] : [],
	);
	const byDay = dayBuckets(start, now, shown, shownChats);

	return {
		period,
		...(start ? { since: localDay(start) } : {}),
		runs: runCounts(shown),
		...(durations.length
			? {
					averageDurationMs: Math.round(
						durations.reduce((a, b) => a + b, 0) / durations.length,
					),
				}
			: {}),
		agentTimeMs: durations.reduce((a, b) => a + b, 0),
		cost: {
			totalUsd: shown.reduce((sum, r) => sum + (r.costUsd ?? 0), 0) + chatUsd,
			chatUsd,
			failedUsd: shown
				.filter((r) => r.status === "failed")
				.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
			byAgent: costByAgent(shown),
			byDay: [...byDay].map(([day, { usd, runs, agents }]) => ({
				day,
				usd,
				runs,
				agents,
			})),
		},
		pullRequests: pullRequestsOf(shown, pullRequests),
		interventions: interventionsOf(shown),
		outputs: outputsOf(shown),
		gains: gainsOf(runs, shown, merged, pullRequests, now),
	};
}
