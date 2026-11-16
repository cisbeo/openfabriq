import {
	type Factory,
	type FactoryEvent,
	includesName,
	mentionsWord,
} from "@openfabriq/core";
import {
	openerOf,
	type RunRecord,
	readRuns,
	untrustedPushTo,
} from "../state/journal.js";

/**
 * The event with, from the journal, the agent whose run opened its pull request or issue
 * (opened_by), and the agent that answers a mention on it: that one, else the last agent of the
 * factory with an answer to mentions that worked on it, on a pull request or issue a person opened.
 */
export function withOpener(
	factory: Factory,
	event: FactoryEvent,
	runs: () => RunRecord[],
): FactoryEvent {
	if (event.number === undefined) return event;
	// The journal is read only for a comment that could start such an automation.
	const followed = Object.values(factory.automations).flatMap((a) =>
		a.when.filter(
			(t) =>
				(t.openedBy || t.answeredBy) &&
				t.event === event.event &&
				(!t.mentions || mentionsWord(event.text, t.mentions)),
		),
	);
	if (followed.length === 0) return event;
	const all = runs();
	const isPullRequest = event.isPullRequest === true;
	const opener = openerOf(all, event.number, isPullRequest);
	const answering = new Set(followed.flatMap((t) => t.answeredBy ?? []));
	// On what an agent opened, only that agent answers; on what a person opened, the last that
	// answers mentions and worked on it (the journal comes latest first).
	const answerer = opener
		? answering.has(opener)
			? opener
			: undefined
		: all.find(
				(r) =>
					r.number === event.number &&
					(r.isPullRequest === true) === isPullRequest &&
					answering.has(r.agent),
			)?.agent;
	return {
		...event,
		...(opener ? { openedBy: opener } : {}),
		...(answerer ? { answeredBy: answerer } : {}),
	};
}

/**
 * A push, a failed check or a conflict of a pull request a run no maintainer started pushed to.
 * The poll names the pull request's author for these: that run's commits are what changed.
 */
export function pushedForUntrustedRun(
	event: FactoryEvent,
	runs: () => RunRecord[],
): boolean {
	const fromPoll = [
		"pull_request.updated",
		"pull_request.checks_failed",
		"pull_request.conflicted",
	].includes(event.event);
	return (
		fromPoll &&
		event.number !== undefined &&
		untrustedPushTo(runs(), event.number)
	);
}

/**
 * A label the engine's account put while a run no maintainer started applied its labels: a label
 * event has no text to sign, so the journal tells. Labels a person puts with the same
 * account (a laptop) at another time still count as theirs.
 */
export function labeledForUntrustedRun(
	repo: string,
	event: FactoryEvent,
	engineAccounts: readonly string[],
	runs: () => RunRecord[] = () => readRuns(repo),
): boolean {
	if (!event.event.endsWith(".labeled") || event.number === undefined)
		return false;
	if (!includesName(engineAccounts, event.actor)) return false;
	// Labels on its own subject, or on an issue or a pull request it opened with labels.
	const labeledThere = (run: RunRecord, o: RunRecord["outputs"][number]) =>
		o.status === "applied" &&
		((o.action === "add_labels" && run.number === event.number) ||
			(o.action === "create_issue" &&
				o.url?.endsWith(`/issues/${event.number}`) === true) ||
			(o.action === "create_pull_request" &&
				o.url?.endsWith(`/pull/${event.number}`) === true));
	return runs().some(
		(run) =>
			run.untrusted &&
			run.startedAt !== undefined &&
			run.startedAt <= event.at &&
			// A minute more: GitHub's clock is not the engine's.
			(run.endedAt === undefined ||
				Date.parse(event.at) <= Date.parse(run.endedAt) + 60_000) &&
			run.outputs.some((o) => labeledThere(run, o)),
	);
}
