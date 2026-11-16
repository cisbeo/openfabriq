import {
	BookOpen,
	Bot,
	CircleCheck,
	CircleDot,
	Clock,
	Factory,
	FilePen,
	FileText,
	FolderSearch,
	GitCommitHorizontal,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	Globe,
	ListChecks,
	ListTree,
	type LucideIcon,
	MessageSquare,
	MessageSquareWarning,
	Search,
	SquareTerminal,
	Tag,
	Webhook,
} from "lucide-react";
import type { ComponentType } from "react";
import {
	GitHubMark,
	LinearMark,
	SentryMark,
	SlackMark,
} from "./brand-marks.js";

// One place for the icons of tools, outputs and events: a page that shows them loads no
// other page's code for it.

/** A Lucide icon or a service's mark: both take a class and can hide from screen readers. */
export type Icon = ComponentType<{
	className?: string;
	"aria-hidden"?: boolean | "true";
}>;

/** The icon of a tool the agent used, or of an output it proposed (by its action). */
export const ICONS: Record<string, LucideIcon> = {
	Read: FileText,
	Edit: FilePen,
	MultiEdit: FilePen,
	Write: FilePen,
	Bash: SquareTerminal,
	Grep: Search,
	Glob: FolderSearch,
	Skill: BookOpen,
	WebFetch: Globe,
	WebSearch: Globe,
	Task: Bot,
	Agent: Bot,
	TodoWrite: ListTree,
	factory_overview: Factory,
	list_runs: ListChecks,
	read_run: FileText,
	add_comment: MessageSquare,
	add_labels: Tag,
	remove_labels: Tag,
	create_pull_request: GitPullRequest,
	push_to_pull_request: GitCommitHorizontal,
	request_changes: MessageSquareWarning,
	create_issue: CircleDot,
	close_issue: CircleCheck,
	close_pr: GitPullRequestClosed,
	merge_pull_request: GitMerge,
};

/** The event's icon: a pull request or an issue on GitHub, the mark of Slack, Linear or Sentry. */
export const eventIcon = (event: string): Icon =>
	event.startsWith("pull_request.")
		? GitPullRequest
		: event.startsWith("issue.")
			? CircleDot
			: event === "default_branch.updated"
				? GitCommitHorizontal
				: event === "schedule"
					? Clock
					: event.startsWith("slack.")
						? SlackMark
						: event.startsWith("linear.")
							? LinearMark
							: event.startsWith("sentry.")
								? SentryMark
								: event.startsWith("webhook.")
									? Webhook
									: CircleDot;

/** Where a run comes from, as a mark: GitHub unless another service started it. */
export const sourceMark = (r: {
	event: string;
	source?: { kind: string } | undefined;
}): Icon =>
	r.event === "schedule"
		? Clock
		: ({
				slack: SlackMark,
				linear: LinearMark,
				sentry: SentryMark,
				webhook: Webhook,
			}[r.source?.kind ?? ""] ?? GitHubMark);
