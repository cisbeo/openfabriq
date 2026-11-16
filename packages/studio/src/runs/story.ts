import {
	type EventName,
	type Factory,
	HANDOFF_LABEL,
	HANDOFF_SUMMARY,
	includesName,
	REVIEW_HANDOFF,
	sameName,
	triggerMatchesEvent,
	type WorkflowGraph,
} from "@openfabriq/core";
import type { RunRecord, RunStatus } from "@openfabriq/runner";

type Outcome = RunRecord["outputs"][number];

/** A run seen from another: the one that started it, or one it started. */
export interface LinkedRun {
	id: string;
	agent: string;
	automation: string;
	status: RunStatus;
	/** Which output of the earlier run started the later one (its index in `outputs`). */
	output: number;
}

/** An automation that listens to what an output produces: it should run next. */
export interface Follower {
	automation: string;
	agent: string;
}

/** Why a person should look at a run, most pressing first. */
export type Attention =
	| { kind: "failed" }
	/** Stopped with the engine, and queued again: an explanation, nothing to do. */
	| { kind: "interrupted" }
	| { kind: "handed-over"; by: "agent" | "engine" }
	| { kind: "cost-limit" }
	| { kind: "not-applied"; count: number }
	/** Ended well, but the agent proposed nothing: nothing changed where the work came from. */
	| { kind: "no-output" };

/** A run in the chain of work: what started it, what it started, and what it asks of a person. */
export interface RunStory {
	cause?: LinkedRun;
	effects: LinkedRun[];
	/** Per output, in the order of `run.outputs`: the automations it should start. */
	followers: Follower[][];
	/** The run the engine queued again after it stopped during this one. */
	rerun?: { id: string; agent: string; status: RunStatus };
	attention?: Attention;
}

const PULL = /\/pull\/(\d+)$/;
const ISSUE = /\/issues\/(\d+)$/;
/** The engine polls: the next run is queued a little after the output lands, never long after. */
const WINDOW_MS = 30 * 60_000;
const SLACK_MS = 60_000;

const labelsOf = (o: Outcome) => o.summary.split(", ");

/**
 * What a run is about: its issue or pull request, else its source (a Slack thread, a Linear or
 * Sentry issue has no number), else the automation, for a run about the whole repository.
 */
export function subjectKey(run: RunRecord): string {
	const source = run.source?.url ?? run.source?.label;
	return run.number !== undefined
		? `${run.repository}#${run.number}`
		: source !== undefined
			? `${run.repository}@${source}`
			: `${run.repository}:${run.automation}`;
}

/** Did this output of `from` produce the event that queued `run`? */
function started(o: Outcome, from: RunRecord, run: RunRecord): boolean {
	if (o.status !== "applied") return false;
	const same = subjectKey(from) === subjectKey(run);
	switch (run.event) {
		case "issue.labeled":
		case "pull_request.labeled":
		case "linear.issue.labeled":
			return (
				same &&
				o.action === "add_labels" &&
				includesName(labelsOf(o), run.label)
			);
		case "pull_request.changes_requested":
			return same && o.action === "request_changes";
		case "pull_request.updated":
			return same && o.action === "push_to_pull_request";
		case "pull_request.opened":
			return (
				o.action === "create_pull_request" &&
				o.url?.match(PULL)?.[1] === String(run.number)
			);
		case "issue.opened":
			return (
				o.action === "create_issue" &&
				o.url?.match(ISSUE)?.[1] === String(run.number)
			);
		default:
			return false;
	}
}

/**
 * The run whose output queued this one, if an agent of the factory started it. The journal
 * does not record the link, so it is read from the subject and the time.
 * shortcut: a person who repeats the same action within the window is taken for the agent;
 * record the cause in the run if that ever misleads.
 */
export function causeOf(
	run: RunRecord,
	runs: RunRecord[],
): LinkedRun | undefined {
	const queued = new Date(run.queuedAt).getTime();
	let best: { linked: LinkedRun; at: number } | undefined;
	for (const from of runs) {
		if (from.id === run.id || from.repository !== run.repository) continue;
		if (!from.endedAt) continue;
		const at = new Date(from.endedAt).getTime();
		if (at - SLACK_MS > queued || queued - at > WINDOW_MS) continue;
		const output = from.outputs.findIndex((o) => started(o, from, run));
		if (output === -1 || (best && best.at >= at)) continue;
		best = {
			at,
			linked: {
				id: from.id,
				agent: from.agent,
				automation: from.automation,
				status: from.status,
				output,
			},
		};
	}
	return best?.linked;
}

/** The engine labels the subject for a person when it gives up, or an agent does when it is done. */
export const handedOver = (run: RunRecord) =>
	run.outputs.some(
		(o) =>
			o.status === "applied" &&
			o.action === "add_labels" &&
			includesName(labelsOf(o), HANDOFF_LABEL),
	);

/** The engine's own handoff writes this comment; an agent's handoff only adds the label. */
export const isHandoffComment = (o: Outcome) =>
	o.action === "add_comment" && o.summary === HANDOFF_SUMMARY;
/** The engine handed the run over: its comment, or a pull request its internal review left to a person, with needs-human. */
const engineHandoff = (run: RunRecord) =>
	run.outputs.some(isHandoffComment) ||
	run.reason?.startsWith(REVIEW_HANDOFF) === true;

/**
 * The engine's note that links the pull request or issue a run opened, in Slack, Sentry or a
 * Linear session (`notice` in runner's apply.ts). Matched on its words, whatever its action:
 * before the fix, a Linear one was recorded as `create_pull_request`.
 */
export const isLinkNotice = (o: Outcome) =>
	/^link to the (pull request|issue)( in the session)?$/.test(o.summary);

/** An output the engine wrote to hand the run over (its comment and label), not the agent's work. */
export const byEngineHandoff = (run: RunRecord, o: Outcome) =>
	engineHandoff(run) &&
	(isHandoffComment(o) ||
		(o.action === "add_labels" && includesName(labelsOf(o), HANDOFF_LABEL)));

/** Skipped because the factory spent its daily budget: a person decides whether to raise it. */
export const costLimited = (run: RunRecord) =>
	run.status === "skipped" && run.reason?.includes("(usd_per_day)") === true;

/** Failed because the engine stopped during the run (the reason the engine writes). */
export const interrupted = (run: RunRecord) =>
	run.status === "failed" && run.reason?.startsWith("interrupted:") === true;

/**
 * The run queued again after `run` was interrupted: same request, so same queuedAt and subject,
 * and started after `run` ended (an earlier attempt started before). None after a second stop.
 */
function rerunOf(run: RunRecord, runs: RunRecord[]) {
	if (!interrupted(run)) return undefined;
	const ended = run.endedAt ?? "";
	return runs.find(
		(r) =>
			r.id !== run.id &&
			r.queuedAt === run.queuedAt &&
			r.automation === run.automation &&
			subjectKey(r) === subjectKey(run) &&
			(r.startedAt === undefined || r.startedAt >= ended),
	);
}

function attentionOf(run: RunRecord, rerun: boolean): Attention | undefined {
	if (run.status === "failed")
		return { kind: rerun && interrupted(run) ? "interrupted" : "failed" };
	if (handedOver(run) || engineHandoff(run))
		return { kind: "handed-over", by: engineHandoff(run) ? "engine" : "agent" };
	if (costLimited(run)) return { kind: "cost-limit" };
	const count = run.outputs.filter((o) => o.status !== "applied").length;
	if (count > 0) return { kind: "not-applied", count };
	return run.status === "succeeded" && run.outputs.length === 0
		? { kind: "no-output" }
		: undefined;
}

/** The agent whose run opened this pull request, as the engine's journal says it (runner's openerOf); kept here, the app loads this file. */
const openerOf = (runs: RunRecord[], repository: string, number: number) =>
	runs.find(
		(r) =>
			r.repository === repository &&
			r.outputs.some(
				(o) =>
					o.action === "create_pull_request" &&
					o.status === "applied" &&
					o.url?.endsWith(`/pull/${number}`),
			),
	)?.agent;

/**
 * Whether an automation still starts on the pull request a run pushed, by the engine's own filters:
 * the agent that opened it (opened_by) and the files it changes (ignore_paths), when the journal has them.
 */
function startsOnPush(
	factory: Factory | undefined,
	automation: string,
	event: string,
	opener: string | undefined,
	o: Outcome,
): boolean {
	const triggers = factory?.automations[automation]?.when;
	if (!triggers) return true;
	const pushed = {
		key: "",
		event: event as EventName,
		isPullRequest: true,
		actor: "",
		at: "",
		...(opener ? { openedBy: opener } : {}),
		// A new branch from the default one: its files are the pull request's. A push names only its
		// own, and the engine compares ignore_paths with every file of the pull request.
		...(o.files && o.action === "create_pull_request"
			? { files: o.files }
			: {}),
	};
	return triggers.some(
		(t) => t.event === event && triggerMatchesEvent(t, pushed),
	);
}

/** The event an applied output produces on the run's subject, as the workflow graph names it. */
function followersOf(
	run: RunRecord,
	o: Outcome,
	graph: WorkflowGraph | undefined,
	factory: Factory | undefined,
	runs: RunRecord[],
): Follower[] {
	if (!graph || o.status !== "applied") return [];
	const labeled = run.isPullRequest
		? "pull_request.labeled"
		: run.source?.kind === "linear"
			? "linear.issue.labeled"
			: "issue.labeled";
	const labels = o.action === "add_labels" ? labelsOf(o) : [];
	const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
	const events = graph.edges
		.filter(
			(e) =>
				e.source === `automation:${run.automation}` && e.label === o.action,
		)
		.map((e) => nodes.get(e.target))
		.filter((n) => {
			if (!n) return false;
			if (o.action !== "add_labels") return true;
			if (n.title !== labeled) return false;
			// The person's label starts no automation: the board shows it as "needs you".
			return n.detail === "any label"
				? labels.some((l) => !sameName(l, HANDOFF_LABEL))
				: includesName(labels, n.detail) && !sameName(HANDOFF_LABEL, n.detail);
		});
	// The run opened it, or pushed to a pull request someone's run opened.
	const opener =
		o.action === "create_pull_request"
			? run.agent
			: o.action === "push_to_pull_request" && run.number !== undefined
				? openerOf(runs, run.repository, run.number)
				: undefined;
	const pushes =
		o.action === "create_pull_request" || o.action === "push_to_pull_request";
	const followers = new Map<string, Follower>();
	for (const event of events)
		for (const e of graph.edges)
			if (e.source === event?.id) {
				const a = nodes.get(e.target);
				if (
					a?.kind === "automation" &&
					(!pushes ||
						startsOnPush(factory, a.title, event?.title ?? "", opener, o))
				)
					followers.set(a.title, {
						automation: a.title,
						agent: a.detail ?? "",
					});
			}
	return [...followers.values()];
}

/** `runs`: the journal, any order. `graph`: the applied factory's workflow, when it loads. */
export function runStory(
	run: RunRecord,
	runs: RunRecord[],
	graph?: WorkflowGraph,
	factory?: Factory,
): RunStory {
	const cause = causeOf(run, runs);
	// Only a run queued in the window after this one ended can be its effect: no full scan per run.
	const ended = run.endedAt ? new Date(run.endedAt).getTime() : undefined;
	const effects = runs
		.filter((r) => {
			if (ended === undefined || r.id === run.id) return false;
			const queued = new Date(r.queuedAt).getTime();
			return queued >= ended - SLACK_MS && queued - ended <= WINDOW_MS;
		})
		.flatMap((r) => {
			const c = causeOf(r, runs);
			return c?.id === run.id
				? [
						{
							id: r.id,
							agent: r.agent,
							automation: r.automation,
							status: r.status,
							output: c.output,
						},
					]
				: [];
		});
	const rerun = rerunOf(run, runs);
	const attention = attentionOf(run, rerun !== undefined);
	return {
		...(cause ? { cause } : {}),
		effects,
		followers: run.outputs.map((o) =>
			followersOf(run, o, graph, factory, runs),
		),
		...(rerun
			? { rerun: { id: rerun.id, agent: rerun.agent, status: rerun.status } }
			: {}),
		...(attention ? { attention } : {}),
	};
}
