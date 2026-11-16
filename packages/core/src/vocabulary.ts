// The closed lists of the openfabriq/ format. Extending them needs an ADR.

export const EVENTS = [
	"issue.opened",
	"issue.labeled",
	"issue.commented",
	"pull_request.opened",
	"pull_request.updated",
	"pull_request.labeled",
	"pull_request.changes_requested",
	"pull_request.commented",
	"pull_request.checks_failed",
	"pull_request.conflicted",
	"default_branch.updated",
	"schedule",
	"slack.mentioned",
	"linear.issue.labeled",
	"linear.issue.delegated",
	"sentry.issue.created",
	"webhook.received",
] as const;
export type EventName = (typeof EVENTS)[number];

/** Where the events of a run come from, and so where its comments and labels go. */
export type SourceKind = "github" | "slack" | "linear" | "sentry" | "webhook";

export function eventSource(event: EventName): SourceKind {
	if (event.startsWith("slack.")) return "slack";
	if (event.startsWith("linear.")) return "linear";
	if (event.startsWith("sentry.")) return "sentry";
	if (event.startsWith("webhook.")) return "webhook";
	return "github";
}

/** Every event of a service arrives through the relay, a Worker the user deploys; GitHub's through gh. */
export const RELAY_EVENTS: readonly EventName[] = EVENTS.filter(
	(e) => eventSource(e) !== "github",
);

/** How the relay knows a webhook's sender. Each word is a check written in the relay. */
export const SIGNATURES = [
	"github",
	"sentry",
	"stripe",
	"standard",
	"none",
] as const;
export type Signature = (typeof SIGNATURES)[number];

/** How people name each source. */
export const SOURCE_NAMES: Record<SourceKind, string> = {
	github: "GitHub",
	slack: "Slack",
	linear: "Linear",
	sentry: "Sentry",
	webhook: "webhook",
};

export const ACTIONS = [
	"add_comment",
	"add_labels",
	"remove_labels",
	"create_pull_request",
	"push_to_pull_request",
	"request_changes",
	"create_issue",
	"close_issue",
	"close_pr",
	"merge_pull_request",
] as const;
export type Action = (typeof ACTIONS)[number];
export const LABEL_ACTIONS: readonly Action[] = ["add_labels", "remove_labels"];
/** The actions `can` gives a list of labels: on create_issue and create_pull_request, the labels the engine puts on what it opens. */
export const LISTS_LABELS: readonly Action[] = [
	...LABEL_ACTIONS,
	"create_issue",
	"create_pull_request",
];

/** What a run is about: an issue, a pull request, a Slack, Linear or Sentry item, or nothing (schedules, pushes). */
export type SubjectKind =
	| "issue"
	| "pull_request"
	| "none"
	| Exclude<SourceKind, "github">;

export function subjectOf(event: EventName): SubjectKind {
	const source = eventSource(event);
	if (source !== "github") return source;
	if (event.startsWith("issue.")) return "issue";
	if (event.startsWith("pull_request.")) return "pull_request";
	return "none";
}

/** The event a label added to a run's subject starts. */
export const LABELED: Partial<Record<SubjectKind, EventName>> = {
	issue: "issue.labeled",
	pull_request: "pull_request.labeled",
	linear: "linear.issue.labeled",
};
export const LABELED_EVENTS = Object.values(LABELED);

/** The comment events, which can be filtered on a word the comment mentions. */
export const COMMENTED_EVENTS: EventName[] = [
	"issue.commented",
	"pull_request.commented",
];

/** Whether a comment contains the word, whole and whatever the case: "@openfabriq", not "@openfabriq-bot". */
export function mentionsWord(text: string | undefined, word: string): boolean {
	if (!text) return false;
	const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(^|[^\\w@/-])${escaped}(?![\\w-])`, "i").test(text);
}

/** The event each write of the engine starts, besides labels (see LABELED). */
export const PRODUCES: Record<Action, EventName[]> = {
	add_comment: [],
	add_labels: [],
	remove_labels: [],
	create_pull_request: ["pull_request.opened"],
	push_to_pull_request: ["pull_request.updated"],
	request_changes: ["pull_request.changes_requested"],
	create_issue: ["issue.opened"],
	close_issue: [],
	close_pr: [],
	// A merge moves the default branch, as a person's would.
	merge_pull_request: ["default_branch.updated"],
};

/** Why an action cannot apply to a run's subject; undefined when it can. */
export function misfit(
	action: Action,
	subject: SubjectKind,
): string | undefined {
	const labels = LABEL_ACTIONS.includes(action);
	if (labels && subject === "slack") return "a Slack message has no labels";
	if (labels && subject === "sentry") return "a Sentry issue has no labels";
	if ((action === "add_comment" || labels) && subject === "webhook")
		return "a webhook has nowhere to answer";
	if ((action === "add_comment" || labels) && subject === "none")
		return "this run has no issue or pull request";
	if (
		(action === "request_changes" || action === "push_to_pull_request") &&
		subject !== "pull_request"
	)
		return "only on a pull request";
	// Closing reaches only the run's own issue or pull request.
	if (
		(action === "close_pr" || action === "merge_pull_request") &&
		subject !== "pull_request"
	)
		return "only on a pull request";
	if (action === "close_issue" && subject !== "issue")
		return "only on an issue";
	if (action === "create_pull_request" && subject === "pull_request")
		return "not from a pull request";
	return undefined;
}

export const TOOLS = ["read", "edit", "shell", "web", "commands"] as const;
export type Tool = (typeof TOOLS)[number];

export const CONCURRENCY = ["issue", "repository"] as const;
export type Concurrency = (typeof CONCURRENCY)[number];

export const FROM = ["maintainers", "factory", "anyone"] as const;
export type From = (typeof FROM)[number];

/** GitHub's labels and logins ignore case, and so does the engine for every name. */
export const sameName = (a: string, b: string | undefined) =>
	a.toLowerCase() === b?.toLowerCase();
export const includesName = (
	list: readonly string[] | undefined,
	name: string | undefined,
) => list?.some((item) => sameName(item, name)) ?? false;
