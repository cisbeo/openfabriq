import type { EventSource } from "@openfabriq/core";
import type { SourceWriter } from "../../run/outputs/apply.js";
import type { LinearAgent } from "./agent.js";
import { LINEAR_OVER } from "./client.js";

type LinearSource = Extract<EventSource, { kind: "linear" }>;
type LinearSession = NonNullable<LinearSource["session"]>;

/** At most one step activity this often: Linear's rate limit is per hour. */
const STEP_EVERY_MS = 3000;

/** The openfabriq app in the issue's Linear organization, which reads and writes it. */
export function linearClientFor(
	source: EventSource | undefined,
	linearApp: ((organizationId: string) => LinearAgent) | undefined,
): LinearAgent | undefined {
	if (source?.kind !== "linear") return undefined;
	const organizationId =
		source.session?.organizationId ?? source.organizationId;
	return organizationId ? linearApp?.(organizationId) : undefined;
}

/** Where a Linear run writes: its agent session when delegated, the issue when labeled. */
export function linearSourceWriter(
	source: LinearSource,
	linearApp: ((organizationId: string) => LinearAgent) | undefined,
	team: string,
	now: () => Date,
): SourceWriter | undefined {
	if (source.session)
		return linearApp
			? sessionWriter(
					source,
					source.session,
					linearApp(source.session.organizationId),
					team,
					now,
				)
			: undefined;
	const linear = linearClientFor(source, linearApp);
	return linear ? linearWriter(source, linear, team) : undefined;
}

/** A labeled Linear issue: comments and labels on the issue. */
function linearWriter(
	source: LinearSource,
	linear: LinearAgent,
	team: string,
): SourceWriter {
	return {
		comment: (body) => linear.comment(source.issueId, body),
		changeLabels: (change) => linear.changeLabels(source.issueId, team, change),
		titlePrefix: source.identifier,
		bodyFooter: `Linear: [${source.identifier}](${source.url})`,
	};
}

/** A delegated Linear issue: everything goes to its agent session, with the app's token. */
function sessionWriter(
	source: LinearSource,
	session: LinearSession,
	app: LinearAgent,
	team: string,
	now: () => Date,
): SourceWriter {
	let stepAt = Number.NEGATIVE_INFINITY;
	return {
		// A reply with nothing delivered is a question: the session waits for an answer.
		comment: async (body, options) => {
			await app.activity(session.id, {
				type: options?.delivers === false ? "elicitation" : "response",
				body,
			});
			return source.url;
		},
		changeLabels: (change) => app.changeLabels(source.issueId, team, change),
		titlePrefix: source.identifier,
		bodyFooter: `Linear: [${source.identifier}](${source.url})`,
		link: (label, url) => app.externalUrls(session.id, [{ label, url }]),
		start: () => app.start(source.issueId),
		step(step) {
			// A proposed output is the agent's own text, not reviewed against `can` yet.
			if (step.output) return;
			const at = now().getTime();
			if (at - stepAt < STEP_EVERY_MS) return;
			stepAt = at;
			void app
				.activity(
					session.id,
					{ type: "action", action: step.title, parameter: step.detail ?? "" },
					{ ephemeral: true },
				)
				.catch(() => undefined); // a step is only a sign of life
		},
		async close(record) {
			// Never the agent's text: the engine's reason, or a fixed word with the link.
			if (record.status !== "succeeded")
				return app.activity(session.id, {
					type: "error",
					body: `openfabriq stopped: ${record.reason ?? record.status}.`,
				});
			const done = (action: string) =>
				record.outputs.find(
					(o) => o.action === action && o.status === "applied" && o.url,
				);
			if (done("add_comment")) return;
			const url = (done("create_pull_request") ?? done("create_issue"))?.url;
			return app.activity(session.id, {
				type: "response",
				body: url ? `Done: ${url}` : "Done, nothing to publish.",
			});
		},
	};
}

/** Why nobody waits on a run whose Linear issue, read at its start, is done since it was queued. */
export function linearIssueGone(
	data: Record<string, unknown>,
): string | undefined {
	const linear = (data.linear_issue as { state?: string } | undefined)?.state;
	if (linear && LINEAR_OVER.includes(linear))
		return `the Linear issue was ${linear === "duplicate" ? "marked as a duplicate" : linear} before the run started`;
	return undefined;
}

/** The issue, and for a delegated one the session's conversation; the issue names the run. */
export async function readLinearIssue(
	source: LinearSource,
	app: LinearAgent,
): Promise<{ data: Record<string, unknown>; title: string; url: string }> {
	const data: Record<string, unknown> = {};
	const { session } = source;
	const [issue, activities] = await Promise.all([
		app.issue(source.issueId),
		session && app.sessionHistory(session.id),
	]);
	data.linear_issue = issue;
	// Linear's advice: the conversation is the session's activities, not the comments.
	if (session) data.linear_session = { request: session.request, activities };
	return { data, title: `${issue.identifier} ${issue.title}`, url: issue.url };
}
