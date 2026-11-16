import { WORKING_LABEL } from "../plan/labels.js";
import {
	type Action,
	type EventName,
	eventSource,
	includesName,
	LABELED_EVENTS,
	misfit,
	subjectOf,
} from "../vocabulary.js";
import { suggested } from "../words.js";
import type { FactoryShape, Parsed } from "./schema.js";
import type { Automation } from "./types.js";

// The rules of an automation that need the whole of it, and factory.yaml.

const OWN_EVENT: Partial<Record<Action, [EventName, string][]>> = {
	create_pull_request: [
		["pull_request.opened", "opens a pull request, which starts"],
	],
	push_to_pull_request: [
		["pull_request.updated", "updates a pull request, which starts"],
		["pull_request.checks_failed", "runs the checks again, which can start"],
	],
	request_changes: [
		["pull_request.changes_requested", "requests changes, which starts"],
	],
	create_issue: [["issue.opened", "opens an issue, which starts"]],
};

/** An automation must not be able to start itself: the engine's labels, pull requests and reviews trigger automations. */
export function selfTriggerProblems(automation: Automation): string[] {
	const problems: string[] = [];
	for (const permission of automation.can) {
		if (permission.action === "add_labels") {
			for (const trigger of automation.when) {
				if (!LABELED_EVENTS.includes(trigger.event)) continue;
				if (!trigger.labels)
					problems.push(
						`can.add_labels can add labels, and when ${trigger.event} has no labels filter, so any label starts this automation again`,
					);
				else if (!permission.labels)
					problems.push(
						`can.add_labels can add any label, including ${trigger.labels.join(", ")}, which starts this automation again. List the labels it may add`,
					);
				else {
					const overlap = permission.labels.filter((l) =>
						includesName(trigger.labels, l),
					);
					if (overlap.length > 0)
						problems.push(
							`can.add_labels can add the label ${overlap.join(", ")}, which starts this automation again`,
						);
				}
			}
		}
		// The labels create_issue and create_pull_request put on what they open start *.labeled.
		const opened =
			permission.action === "create_issue"
				? "issue"
				: permission.action === "create_pull_request"
					? "pull_request"
					: undefined;
		if (opened && permission.labels)
			for (const trigger of automation.when) {
				if (trigger.event !== `${opened}.labeled`) continue;
				const overlap = permission.labels.filter((l) =>
					includesName(trigger.labels, l),
				);
				if (!trigger.labels)
					problems.push(
						`can.${permission.action} puts labels on the ${opened === "issue" ? "issues" : "pull requests"} it opens, and when ${trigger.event} has no labels filter, so they start this automation again`,
					);
				else if (overlap.length > 0)
					problems.push(
						`can.${permission.action} puts the label ${overlap.join(", ")} on the ${opened === "issue" ? "issues" : "pull requests"} it opens, which starts this automation again`,
					);
			}
		for (const [event, effect] of OWN_EVENT[permission.action] ?? [])
			if (automation.when.some((t) => t.event === event))
				problems.push(
					`can.${permission.action} ${effect} this automation again (when ${event})`,
				);
	}
	return problems;
}

const NEEDS_KEY = {
	slack:
		"when slack.mentioned needs slack: { channel: <name> } under integrations in factory.yaml",
	linear:
		"when linear.issue.labeled or linear.issue.delegated needs linear: { team: <key> } under integrations in factory.yaml",
	sentry:
		"when sentry.issue.created needs sentry: { organization: <slug>, project: <slug> } under integrations in factory.yaml",
} as const;

export function sourceProblems(
	automation: Automation,
	configured: Record<keyof typeof NEEDS_KEY, boolean>,
): string[] {
	const sources = new Set(automation.when.map((t) => eventSource(t.event)));
	return (["slack", "linear", "sentry"] as const)
		.filter((kind) => sources.has(kind) && !configured[kind])
		.map((kind) => NEEDS_KEY[kind]);
}

/**
 * What `can` means depends on what the run is about: the engine only offers
 * the actions that fit it, so a permission that fits none of the triggers means nothing.
 */
export function unusablePermissionProblems(automation: Automation): string[] {
	if (automation.when.length === 0) return [];
	// A stranger's run never merges.
	const stranger =
		automation.from === "anyone" &&
		automation.can.some((p) => p.action === "merge_pull_request")
			? [
					"can.merge_pull_request is refused with from: anyone: a run started by someone who is not a maintainer never merges",
				]
			: [];
	const events = automation.when.map((t) => t.event).join(", ");
	return stranger.concat(
		automation.can.flatMap(({ action }) => {
			const reasons = automation.when.map((t) =>
				misfit(action, subjectOf(t.event)),
			);
			return reasons.every(Boolean)
				? [
						`can.${action} fits none of the events in when (${events}): ${[...new Set(reasons)].join("; ")}`,
					]
				: [];
		}),
	);
}

const WORKING = `${WORKING_LABEL}, the label the engine puts while a run works`;

/** The engine's working label is its own: a trigger on it never starts, a permission on it is not the agent's. */
export function workingLabelProblems(automation: Automation): string[] {
	return [
		...automation.when
			.filter((t) => includesName(t.labels, WORKING_LABEL))
			.map(
				(t) =>
					`when.${t.event} listens to ${WORKING}: it never starts anything`,
			),
		...automation.can
			.filter((p) =>
				includesName(
					[...(p.labels ?? []), ...(p.merge?.labels ?? [])],
					WORKING_LABEL,
				),
			)
			.map(
				(p) =>
					`can.${p.action} lists ${WORKING}: only the engine puts it and takes it off`,
			),
	];
}

/** The rules of an automation that need the whole of it and factory.yaml. */
export function automationProblems(
	automation: Automation,
	fields: Parsed<typeof FactoryShape>,
): string[] {
	const { slack, linear, sentry } = fields.integrations ?? {};
	return [
		...selfTriggerProblems(automation),
		...workingLabelProblems(automation),
		...sourceProblems(automation, {
			slack: slack !== undefined,
			linear: linear !== undefined,
			sentry: sentry !== undefined,
		}),
		...unknownWebhookProblems(automation, Object.keys(fields.webhooks ?? {})),
		...unusablePermissionProblems(automation),
		...reviewProblems(automation),
	];
}

/** reviewed_by reviews code before it leaves the machine: the automation must be able to publish some. */
export function reviewProblems(automation: Automation): string[] {
	return automation.reviewedBy &&
		!automation.can.some(
			(p) =>
				p.action === "create_pull_request" ||
				p.action === "push_to_pull_request",
		)
		? [
				"reviewed_by reviews code before it leaves the machine, and this automation publishes none: can has neither create_pull_request nor push_to_pull_request",
			]
		: [];
}

/** A webhook.received trigger names a webhook of factory.yaml. */
export function unknownWebhookProblems(
	automation: Automation,
	webhooks: readonly string[],
): string[] {
	return automation.when.flatMap((t) =>
		t.webhook && !webhooks.includes(t.webhook)
			? [
					suggested(
						`when.webhook.received names "${t.webhook}", which is not in webhooks of factory.yaml.`,
						t.webhook,
						webhooks,
					),
				]
			: [],
	);
}
