import type { EventSource } from "@openfabriq/core";
import type { SourceWriter } from "../../run/outputs/apply.js";
import { SENTRY_OVER, type Sentry, type SentryProject } from "./client.js";

type SentrySource = Extract<EventSource, { kind: "sentry" }>;

/** A Sentry run adds notes to its issue. */
export function sentryWriter(
	source: SentrySource,
	sentry: Sentry,
	project: SentryProject,
): SourceWriter {
	return {
		comment: async (body) => {
			await sentry.note(project, source.issueId, body);
			return source.url;
		},
		bodyFooter: `Sentry: [${source.shortId}](${source.url})`,
	};
}

/** Why nobody waits on a run whose Sentry issue, read at its start, is resolved or ignored since it was queued. */
export function sentryIssueGone(
	data: Record<string, unknown>,
): string | undefined {
	const sentry = (data.sentry_issue as { status?: unknown } | undefined)
		?.status;
	if (typeof sentry === "string" && SENTRY_OVER.includes(sentry))
		return `the Sentry issue was ${sentry} before the run started`;
	return undefined;
}

/** The issue with its latest event; the issue names the run. */
export async function readSentryIssue(
	source: SentrySource,
	sentry: Sentry,
	project: SentryProject,
): Promise<{ data: Record<string, unknown>; title: string; url: string }> {
	const issue = await sentry.issueContext(project, source.issueId);
	return {
		data: { sentry_issue: issue },
		title: `${source.shortId} ${String(issue.title ?? "")}`,
		url: source.url,
	};
}
