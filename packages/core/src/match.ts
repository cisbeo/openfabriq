import type { Automation, Factory, Trigger } from "./factory/types.js";
import { onlyIgnoredPaths } from "./paths.js";
import {
	COMMENTED_EVENTS,
	type EventName,
	eventSource,
	includesName,
	mentionsWord,
} from "./vocabulary.js";

/** Where a run comes from when it is not GitHub: where it reads, comments and labels. */
export type EventSource =
	| {
			kind: "slack";
			/** Channel id. */
			channel: string;
			/** The thread the mention is in, or starts: the ts of its first message. */
			thread: string;
			/** The ts of the message that mentions the factory. */
			ts: string;
	  }
	| {
			kind: "linear";
			issueId: string;
			/** ENG-123 */
			identifier: string;
			url: string;
			/** The Linear organization, whose app token reads and writes the issue. */
			organizationId?: string;
			/** linear.issue.delegated: the agent session the run answers in, and what was asked. */
			session?: { id: string; organizationId: string; request: string };
	  }
	| {
			kind: "sentry";
			issueId: string;
			/** WEB-APP-12 */
			shortId: string;
			url: string;
	  }
	| {
			kind: "webhook";
			/** The name of the webhook in factory.yaml. */
			webhook: string;
			/** The sender's delivery id, or a hash of the body. */
			delivery: string;
			/** The body received, as text, cut to a size an agent can read. */
			payload: string;
	  };

/** Something that happened on GitHub, Slack or Linear, as the engine sees it. */
export interface FactoryEvent {
	/** Stable id, used to never handle the same event twice. */
	key: string;
	event: EventName;
	/** The GitHub issue or pull request; absent for schedule, default_branch.updated and other sources. */
	number?: number;
	isPullRequest: boolean;
	actor: string;
	label?: string;
	/** For default_branch.updated: the new commits, as `before..after`. */
	commits?: string;
	/** For pull_request.* events: the files the pull request changes, read when a trigger has ignore_paths. */
	files?: string[];
	/** Absent for GitHub events. */
	source?: EventSource;
	/** sentry.issue.created: the `query` of the trigger the issue was found with. */
	query?: string;
	/** issue.commented and pull_request.commented: the comment, data only, read for `mentions`. */
	text?: string;
	/** issue.commented and pull_request.commented: the labels the issue or pull request carries, read for `labels`. */
	labels?: string[];
	/** pull_request.* only: the agent whose run opened the pull request, from the engine's journal. */
	openedBy?: string;
	/** Comments: the agent that answers a mention, from the journal: the one that opened it, else the last that worked on it. */
	answeredBy?: string;
	/**
	 * Written by the engine for a run that no maintainer started: the engine's own account
	 * then counts as nobody's, even when it is a maintainer's.
	 */
	fromUntrustedRun?: boolean;
	at: string;
}

/** Whether one trigger starts on this event: its event and every filter it writes. */
export const triggerMatchesEvent = (trigger: Trigger, event: FactoryEvent) =>
	trigger.event === event.event &&
	(!trigger.labels ||
		// On a comment, the labels of the issue or pull request; elsewhere, the label just added.
		(COMMENTED_EVENTS.includes(event.event)
			? (event.labels ?? []).some((l) => includesName(trigger.labels, l))
			: includesName(trigger.labels, event.label))) &&
	(!trigger.mentions || mentionsWord(event.text, trigger.mentions)) &&
	(!trigger.openedBy || trigger.openedBy === event.openedBy) &&
	(!trigger.answeredBy || trigger.answeredBy === event.answeredBy) &&
	!(
		trigger.ignore_paths &&
		event.files &&
		onlyIgnoredPaths(event.files, trigger.ignore_paths)
	) &&
	// Sentry searches its own issues: the engine asks once per query and says which one matched.
	(trigger.event !== "sentry.issue.created" ||
		(trigger.query ?? "") === (event.query ?? "")) &&
	(trigger.event !== "webhook.received" ||
		(event.source?.kind === "webhook" &&
			event.source.webhook === trigger.webhook));

/**
 * Whether the engine must read the changed files before matching this event: a pull request's, or
 * the new commits' of the default branch, which only the engine's wiki filters.
 */
export function needsChangedFiles(
	factory: Factory,
	event: FactoryEvent,
): boolean {
	return (
		((event.isPullRequest && event.number !== undefined) ||
			(event.event === "default_branch.updated" &&
				event.commits !== undefined)) &&
		Object.values(factory.automations).some((a) =>
			a.when.some((t) => t.event === event.event && t.ignore_paths),
		)
	);
}

/**
 * The automations an event starts. Only maintainers' actions count, unless the
 * automation says `from: anyone`; the engine's own actions come from the gh user,
 * which is passed in `trusted`. New commits on the default branch always count:
 * GitHub already checks who may write there. Slack, Linear and Sentry events always count
 * too: there the gate is the place, the configured channel, team or project.
 */
export function matchingAutomations(
	factory: Factory,
	event: FactoryEvent,
	trusted: readonly string[] = [],
): Automation[] {
	const allowed = [...factory.maintainers, ...trusted];
	return Object.values(factory.automations)
		.filter((automation) =>
			automation.when.some((t) => triggerMatchesEvent(t, event)),
		)
		.filter(
			(automation) =>
				automation.from === "anyone" ||
				event.event === "default_branch.updated" ||
				eventSource(event.event) !== "github" ||
				(includesName(allowed, event.actor) &&
					(!event.fromUntrustedRun || takesFactoryWrites(factory, automation))),
		)
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Whether an automation continues what the factory wrote for a run no maintainer started:
 * when it says `from: factory`, or when it can neither get code to GitHub nor reach a secret. A
 * reviewer that comments takes it; an implementer that opens a pull request needs `from: factory`.
 */
export function takesFactoryWrites(
	factory: Factory,
	automation: Automation,
): boolean {
	if (automation.from !== "maintainers") return true;
	const agent = factory.agents[automation.agent];
	const writesCode = automation.can.some(
		(c) =>
			c.action === "create_pull_request" || c.action === "push_to_pull_request",
	);
	// setup and checks run the branch's code, and the agent's changes, with the factory's secrets.
	const engineRunsWithSecrets =
		(factory.secrets?.length ?? 0) > 0 &&
		((factory.setup?.length ?? 0) > 0 || (factory.checks?.length ?? 0) > 0);
	const runsWithSecrets =
		!agent ||
		engineRunsWithSecrets ||
		agent.tools.includes("commands") ||
		Object.keys(agent.mcp ?? {}).some((name) => {
			const server = factory.mcp?.[name];
			return !server || "command" in server;
		});
	return !writesCode && !runsWithSecrets;
}

/**
 * Whether a maintainer started this event: then what a run writes for it counts as a maintainer's
 * action. Slack and Linear count: only members of the channel or the team write there
 *. Sentry (a public DSN lets anyone create an issue), webhooks, and an automation open
 * to anyone started by a stranger do not: their runs' writes go only to what takesFactoryWrites lets.
 */
export function startedByMaintainer(
	factory: Factory,
	event: FactoryEvent,
	trusted: readonly string[] = [],
): boolean {
	if (event.fromUntrustedRun) return false;
	if (event.event === "default_branch.updated") return true;
	const source = eventSource(event.event);
	if (source === "slack" || source === "linear") return true;
	return (
		source === "github" &&
		includesName([...factory.maintainers, ...trusted], event.actor)
	);
}
