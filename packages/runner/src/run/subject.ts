import type { Automation, Factory } from "@openfabriq/core";
import type { QueuedRun } from "../engine/queue.js";
import { failedChecks, jobId, logExcerpt } from "../github/checks.js";
import type { GitHub } from "../github/github.js";
import type { LinearAgent } from "../sources/linear/agent.js";
import {
	linearClientFor,
	linearSourceWriter,
	readLinearIssue,
} from "../sources/linear/subject.js";
import type { Sentry } from "../sources/sentry/client.js";
import { readSentryIssue, sentryWriter } from "../sources/sentry/subject.js";
import type { Slack } from "../sources/slack/client.js";
import { readSlackThread, slackWriter } from "../sources/slack/subject.js";
import { readWebhook, webhookWriter } from "../sources/webhook/subject.js";
import type { SourceWriter } from "./outputs/apply.js";

// Where a run reads its subject and writes back: GitHub here, every other source in
// sources/<name>/subject.ts.

interface Clients {
	github: GitHub;
	slack?: Slack;
	linearApp?: (organizationId: string) => LinearAgent;
	sentry?: Sentry;
	now?: () => Date;
}

/**
 * Slack, Linear and Sentry runs write there; GitHub runs on their issue or pull request.
 * Undefined for a GitHub run, and for a source that is not connected.
 */
export function sourceWriter(
	run: QueuedRun,
	factory: Factory,
	{ slack, linearApp, sentry, now }: Clients,
): SourceWriter | undefined {
	const source = run.event.source;
	if (source?.kind === "linear")
		return linearSourceWriter(
			source,
			linearApp,
			factory.linear?.team ?? "",
			now ?? (() => new Date()),
		);
	if (source?.kind === "slack")
		return slack
			? slackWriter(source, slack, factory.slack?.channel ?? source.channel)
			: undefined;
	if (source?.kind === "sentry")
		return sentry && factory.sentry
			? sentryWriter(source, sentry, factory.sentry)
			: undefined;
	if (source?.kind === "webhook") return webhookWriter(source);
	return undefined;
}

/** A run's subject, read from where the run comes from. */
export interface SubjectRead {
	/** What the agent is given about it. */
	data: Record<string, unknown>;
	/** The ref to check out. */
	ref: string;
	headRef?: string;
	/** For the journal; absent for a run on the whole repository. */
	title?: string;
	url?: string;
	/** A Slack thread's permalink: the run's source has no link before it is read. */
	sourceUrl?: string;
}

/**
 * The subject itself. What a GitHub issue or pull request points at is read after, by
 * readLinked: when that read fails, the run keeps the subject's title.
 */
export async function readSubject(
	run: QueuedRun,
	factory: Factory,
	{ github, slack, linearApp, sentry }: Clients,
	defaultBranch: string,
): Promise<SubjectRead> {
	const source = run.event.source;
	const app = linearClientFor(source, linearApp);
	const sentryProject = factory.sentry;
	const ref = defaultBranch;
	if (source?.kind === "slack" && slack) {
		const read = await readSlackThread(source, slack, factory);
		return { ...read, ref, ...(read.url ? { sourceUrl: read.url } : {}) };
	}
	if (source?.kind === "linear" && app)
		return { ...(await readLinearIssue(source, app)), ref };
	if (source?.kind === "sentry" && sentry && sentryProject)
		return { ...(await readSentryIssue(source, sentry, sentryProject)), ref };
	if (source?.kind === "webhook") return { ...readWebhook(source), ref };
	if (run.number === undefined) return { data: {}, ref };
	const item = await github.subject(
		factory.repository,
		run.number,
		run.event.isPullRequest,
	);
	const headRef =
		run.event.isPullRequest && !item.isCrossRepository
			? String(item.headRefName)
			: undefined;
	return {
		data: { [run.event.isPullRequest ? "pull_request" : "issue"]: item },
		ref: headRef ?? defaultBranch,
		...(headRef ? { headRef } : {}),
		title: String(item.title ?? ""),
		url: String(item.url ?? ""),
	};
}

/**
 * The subject's data with what its GitHub issue or pull request points at: the issues a pull
 * request closes, and for checks_failed the failed checks with the end of their log.
 */
export async function readLinked(
	run: QueuedRun,
	factory: Factory,
	{ github }: Clients,
	data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	// Slack, Linear, Sentry and webhooks name their subject in their own words: only GitHub's links.
	if (run.event.source) return data;
	const repo = factory.repository;
	const item = data[run.event.isPullRequest ? "pull_request" : "issue"] as
		| Record<string, unknown>
		| undefined;
	if (!item) return data;
	const linked: Record<string, unknown> = { ...data };
	if (run.event.isPullRequest) {
		const closing =
			(item.closingIssuesReferences as { number: number }[] | undefined) ?? [];
		linked.closes = await Promise.all(
			closing.map((i) => github.subject(repo, i.number, false)),
		);
	}
	if (run.event.event === "pull_request.checks_failed")
		// The agent cannot read job logs without GitHub access: the engine reads them for it.
		linked.failed_checks = await Promise.all(
			failedChecks(item.statusCheckRollup).map(async (check) => {
				const id = jobId(check.url);
				const log =
					id &&
					(await github
						.jobLog(repo, id)
						.then(logExcerpt)
						.catch(() => undefined));
				return log ? { ...check, log } : check;
			}),
		);
	return linked;
}

/** The branch a run's pull request is pushed to, named after where the run comes from. */
export function branchName(run: QueuedRun, automation: Automation): string {
	const source = run.event.source;
	return `openfabriq/${
		source?.kind === "linear"
			? source.identifier.toLowerCase()
			: source?.kind === "sentry"
				? `sentry-${source.shortId.toLowerCase()}`
				: source?.kind === "slack"
					? "slack"
					: source?.kind === "webhook"
						? `webhook-${source.webhook}`
						: (run.number ?? automation.name)
	}-${run.id}`;
}
