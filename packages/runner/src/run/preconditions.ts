import {
	type EventSource,
	type Factory,
	SOURCE_NAMES,
	sameName,
} from "@openfabriq/core";
import type { QueuedRun } from "../engine/queue.js";
import type { GitHub, Review } from "../github/github.js";
import { isChangesRequested, isFromEngine } from "../github/markers.js";
import { linearIssueGone } from "../sources/linear/subject.js";
import { sentryIssueGone } from "../sources/sentry/subject.js";

/** Why a run from a source that is not connected cannot start. */
export function notConnected(source: EventSource): string {
	return source.kind === "linear"
		? 'the relay is not connected: run "openfabriq connect relay"'
		: `${SOURCE_NAMES[source.kind]} is not connected: run "openfabriq connect ${source.kind}"`;
}

/**
 * Why nobody waits on this run any more, when its subject was queued while it was open and is
 * over since: merged, closed, or done on Linear or Sentry.
 */
export function subjectGone(data: Record<string, unknown>): string | undefined {
	const state = (data.pull_request ?? data.issue) as
		| { state?: string }
		| undefined;
	if (state?.state && state.state !== "OPEN")
		return `the ${data.pull_request ? "pull request" : "issue"} was ${
			state.state === "MERGED" ? "merged" : "closed"
		} before the run started`;
	return linearIssueGone(data) ?? sentryIssueGone(data);
}

/** The rounds of changes the engine requested on a pull request: anyone can copy its mark into a review. */
function engineReviewRounds(reviews: Review[], me: string): number {
	return reviews.filter(
		(r) =>
			sameName(me, r.user?.login) &&
			isFromEngine(r.body) &&
			(isChangesRequested(r.body) || r.state === "CHANGES_REQUESTED"),
	).length;
}

/** For a run on changes requested, the engine's rounds when they reach review_rounds. */
export async function reviewRoundsReached(
	run: QueuedRun,
	factory: Factory,
	github: GitHub,
): Promise<number | undefined> {
	if (
		run.event.event !== "pull_request.changes_requested" ||
		run.number === undefined
	)
		return undefined;
	const me = await github.currentUser();
	const rounds = engineReviewRounds(
		await github.reviews(factory.repository, run.number),
		me,
	);
	return rounds >= factory.limits.review_rounds ? rounds : undefined;
}
