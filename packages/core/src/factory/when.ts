import type { z } from "zod";
import { parseCron } from "../cron/parse.js";
import {
	COMMENTED_EVENTS,
	EVENTS,
	type EventName,
	LABELED_EVENTS,
} from "../vocabulary.js";
import { isOneOf, sentenceList, unknownWord } from "../words.js";
import type { AutomationShape } from "./schema.js";
import type { Trigger } from "./types.js";

type FilterKey =
	| "labels"
	| "cron"
	| "ignore_paths"
	| "query"
	| "webhook"
	| "mentions"
	| "opened_by";

/** The filters of one event, as written. */
type Written = Partial<Record<FilterKey, string | string[] | undefined>>;

/**
 * Each filter a trigger can take, in the order its problems are said: the events that take
 * it, the events that cannot do without it, and what is wrong with a value.
 */
const FILTERS: {
	key: FilterKey;
	/** "does not take <name>" */
	name: string;
	takes: (event: EventName) => boolean;
	/** "only <takenBy>" */
	takenBy: string;
	/** Said for an empty list, whatever the event. */
	empty?: (event: EventName) => string;
	/** The event that needs it, and what it is told without it. */
	needed?: [EventName, string];
	/** What is wrong with the value of an event that takes it. */
	check?: (value: string) => string | undefined;
	/** The trigger's field, when it is not the key. */
	field?: keyof Trigger;
}[] = [
	{
		key: "labels",
		name: "labels",
		// On a comment: the labels the issue or pull request carries.
		takes: (event) =>
			LABELED_EVENTS.includes(event) || COMMENTED_EVENTS.includes(event),
		takenBy: `${sentenceList([...LABELED_EVENTS, ...COMMENTED_EVENTS])} do`,
		empty: (event) =>
			`when.${event}.labels is empty: list at least one label, or remove labels to start on any label`,
	},
	{
		key: "cron",
		name: "a cron",
		takes: (event) => event === "schedule",
		takenBy: "schedule does",
		needed: [
			"schedule",
			'when.schedule needs a cron, for example { cron: "0 9 * * 1" }',
		],
		check: (cron) => {
			const parsed = parseCron(cron);
			return "error" in parsed
				? `when.schedule.cron: ${parsed.error}`
				: undefined;
		},
	},
	{
		key: "ignore_paths",
		name: "ignore_paths",
		takes: (event) => event.startsWith("pull_request."),
		takenBy: "pull_request events do",
	},
	{
		key: "query",
		name: "a query",
		takes: (event) => event === "sentry.issue.created",
		takenBy: "sentry.issue.created does",
	},
	{
		key: "webhook",
		name: "a webhook",
		takes: (event) => event === "webhook.received",
		takenBy: "webhook.received does",
		needed: [
			"webhook.received",
			"when.webhook.received needs the webhook's name, for example { webhook: deploy-failed }",
		],
	},
	{
		key: "mentions",
		name: "mentions",
		takes: (event) => COMMENTED_EVENTS.includes(event),
		takenBy: `${sentenceList(COMMENTED_EVENTS)} do`,
	},
	{
		// The agent whose run opened the pull request, read in the engine's journal.
		key: "opened_by",
		name: "opened_by",
		takes: (event) => event.startsWith("pull_request."),
		takenBy: "pull_request events do",
		field: "openedBy",
	},
];

/** The trigger of one event with its filters, and what is wrong with them. */
function readTrigger(
	event: EventName,
	written: Written | null,
): { trigger: Trigger; problems: string[] } {
	const trigger: Trigger = { event };
	const problems: string[] = [];
	for (const filter of FILTERS) {
		const value = written?.[filter.key];
		if (!value) {
			if (filter.needed?.[0] === event) problems.push(filter.needed[1]);
			continue;
		}
		const problem =
			Array.isArray(value) && value.length === 0
				? filter.empty?.(event)
				: !filter.takes(event)
					? `when.${event} does not take ${filter.name}; only ${filter.takenBy}`
					: typeof value === "string"
						? filter.check?.(value)
						: undefined;
		if (problem) problems.push(problem);
		else Object.assign(trigger, { [filter.field ?? filter.key]: value });
	}
	return { trigger, problems };
}

export function parseWhen(raw: z.output<(typeof AutomationShape)["when"]>): {
	when: Trigger[];
	problems: string[];
} {
	const entries: [string, Written | null][] =
		typeof raw === "string"
			? [[raw, null]]
			: Array.isArray(raw)
				? raw.map((event) => [event, null])
				: Object.entries(raw);
	const problems: string[] = [];
	if (entries.length === 0) problems.push("when needs at least one event");
	const triggers: Trigger[] = [];
	for (const [event, written] of entries) {
		if (!isOneOf(EVENTS, event)) {
			problems.push(unknownWord("event", event, EVENTS, "when"));
			continue;
		}
		const read = readTrigger(event, written);
		problems.push(...read.problems);
		triggers.push(read.trigger);
	}
	return { when: triggers, problems };
}
