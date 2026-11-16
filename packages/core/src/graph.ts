import { permissionText } from "./factory/text.js";
import type {
	Automation,
	Factory,
	Permission,
	Trigger,
} from "./factory/types.js";
import { REVIEW_LABELS } from "./plan/labels.js";
import {
	COMMENTED_EVENTS,
	type EventName,
	eventSource,
	includesName,
	LABELED,
	LABELED_EVENTS,
	PRODUCES,
	type SourceKind,
	subjectOf,
} from "./vocabulary.js";

// The factory's workflow as a graph, read from its files only:
// events start automations, and what an automation may write produces the next events.

export interface WorkflowNode {
	id: string;
	/** A review: the agent that reviews an automation's change before it leaves the machine (reviewed_by). */
	kind: "event" | "automation" | "review";
	/** Event: what happens. Automation: its name. Review: the automation it reviews. */
	title: string;
	/** Event: its label, cron, Sentry query or "any label". Automation: its agent. Review: its reviewer. */
	detail?: string;
	/** Automation: what it may write. */
	can?: string[];
	/** Automation that a GitHub action of anyone starts, not only of a maintainer. */
	anyone?: boolean;
	/** Automation: the folder of openfabriq/ it is in, like qa. */
	area?: string;
	/** Event that nothing in the factory produces: a person, GitHub, Slack, Linear or the clock starts it. */
	entry?: boolean;
	/** Event that no automation listens to: the work leaves the factory there. */
	end?: boolean;
	/** Event from outside GitHub: where it happens. */
	source?: Exclude<SourceKind, "github">;
}

export interface WorkflowEdge {
	id: string;
	source: string;
	target: string;
	/** On an automation's arrow: the permission that produces the event. */
	label?: string;
}

export interface WorkflowGraph {
	nodes: WorkflowNode[];
	edges: WorkflowEdge[];
}

interface EventPoint {
	event: EventName;
	/** A label filter or a label added; undefined on a labeled event means any label. */
	label?: string;
	cron?: string;
	/** A Sentry search. */
	query?: string;
	/** A webhook's name. */
	webhook?: string;
	/** The word a comment must contain. */
	mentions?: string;
}

const eventId = (e: EventPoint) =>
	["event", e.event, e.label, e.cron ?? e.query ?? e.webhook ?? e.mentions]
		.filter(Boolean)
		.join(":");

/** The events a trigger listens to: one per label filter. */
const listened = (t: Trigger): EventPoint[] =>
	t.labels
		? t.labels.map((label) => ({
				event: t.event,
				label,
				...(t.mentions ? { mentions: t.mentions } : {}),
			}))
		: [
				{
					event: t.event,
					...(t.cron ? { cron: t.cron } : {}),
					...(t.query ? { query: t.query } : {}),
					...(t.webhook ? { webhook: t.webhook } : {}),
					...(t.mentions ? { mentions: t.mentions } : {}),
				},
			];

/** Does this event start this trigger? A label added freely may be any label. */
function pointStartsTrigger(e: EventPoint, t: Trigger): boolean {
	if (e.event !== t.event) return false;
	if (t.cron) return e.cron === t.cron;
	if (t.query) return e.query === t.query;
	if (t.webhook) return e.webhook === t.webhook;
	// A comment that mentions the word starts both; a plain comment only those without a word.
	if (t.mentions && e.mentions !== t.mentions) return false;
	if (!t.labels) return true;
	// A comment on a labeled issue is drawn from its trigger's own box, on that label only.
	if (e.label === undefined) return LABELED_EVENTS.includes(e.event);
	return includesName(t.labels, e.label);
}

/** Every event the automations listen to, by id. */
const listenedEvents = (automations: Automation[]): [string, EventPoint][] =>
	automations
		.flatMap((automation) => automation.when.flatMap(listened))
		.map((e) => [eventId(e), e]);

/** The events a permission produces when the engine applies what the automation wrote. */
function producedEvents(
	automation: Automation,
	permission: Permission,
	/** Every trigger of the factory: a label the engine puts is drawn only where one starts on it. */
	triggers: Trigger[],
): EventPoint[] {
	if (permission.action === "add_labels") {
		// Labels land on the run's subject: an issue, a pull request, a Linear issue, or nothing
		// for schedules and Slack messages.
		const labeled = new Set(
			automation.when.flatMap((t) => LABELED[subjectOf(t.event)] ?? []),
		);
		return [...labeled].flatMap((event) =>
			(permission.labels ?? [undefined]).map((label) => ({
				event,
				...(label ? { label } : {}),
			})),
		);
	}
	const events: EventPoint[] = PRODUCES[permission.action].map((event) => ({
		event,
	}));
	// The labels create_issue and create_pull_request put on what they open.
	if (permission.action === "create_issue")
		for (const label of permission.labels ?? [])
			events.push({ event: "issue.labeled", label });
	if (permission.action === "create_pull_request")
		for (const label of permission.labels ?? [])
			events.push({ event: "pull_request.labeled", label });
	// After an internal review, the engine labels the pull request: drawn only where an automation listens.
	if (
		automation.reviewedBy &&
		(permission.action === "create_pull_request" ||
			permission.action === "push_to_pull_request")
	)
		for (const label of REVIEW_LABELS) {
			const labeled: EventPoint = { event: "pull_request.labeled", label };
			if (triggers.some((t) => pointStartsTrigger(labeled, t)))
				events.push(labeled);
		}
	return events;
}

const edge = (
	source: string,
	target: string,
	label?: string,
): WorkflowEdge => ({
	id: `${source}→${target}`,
	source,
	target,
	...(label ? { label } : {}),
});

/** Each event the automations produce, with the arrow from the automation, labeled by the permission. */
const productions = (automations: Automation[]) => {
	const triggers = automations.flatMap((a) => a.when);
	return automations.flatMap((automation) =>
		automation.can.flatMap((permission) =>
			producedEvents(automation, permission, triggers).map((event) => ({
				event,
				arrow: edge(
					`automation:${automation.name}`,
					eventId(event),
					permission.action,
				),
			})),
		),
	);
};

/** An arrow from each event to each automation it starts. */
const listenerEdges = (
	events: Map<string, EventPoint>,
	automations: Automation[],
): WorkflowEdge[] =>
	[...events].flatMap(([id, e]) =>
		automations
			.filter((automation) =>
				automation.when.some((t) => pointStartsTrigger(e, t)),
			)
			.map((automation) => edge(id, `automation:${automation.name}`)),
	);

/** The edges without repeats: the first one drawn keeps its label. */
function firstOfEach(edges: WorkflowEdge[]): WorkflowEdge[] {
	const byId = new Map<string, WorkflowEdge>();
	for (const e of edges) if (!byId.has(e.id)) byId.set(e.id, e);
	return [...byId.values()];
}

function eventNode(
	id: string,
	e: EventPoint,
	{ produced, listenedTo }: { produced: boolean; listenedTo: boolean },
): WorkflowNode {
	const detail =
		(e.label && COMMENTED_EVENTS.includes(e.event)
			? [
					`labeled ${e.label}`,
					...(e.mentions ? [`mentions ${e.mentions}`] : []),
				].join(", ")
			: e.label) ??
		e.cron ??
		e.query ??
		e.webhook ??
		(e.mentions ? `mentions ${e.mentions}` : undefined) ??
		(LABELED_EVENTS.includes(e.event) ? "any label" : undefined);
	const source = eventSource(e.event);
	return {
		id,
		kind: "event",
		title: e.event,
		...(detail ? { detail } : {}),
		...(produced ? {} : { entry: true }),
		...(listenedTo ? {} : { end: true }),
		...(source !== "github" ? { source } : {}),
	};
}

const automationNode = (a: Automation): WorkflowNode => ({
	id: `automation:${a.name}`,
	kind: "automation",
	title: a.name,
	detail: a.agent,
	can: a.can.map(permissionText),
	...(a.from === "anyone" ? { anyone: true } : {}),
	...(a.area ? { area: a.area } : {}),
});

/** The reviewer of an automation's change, in a loop with it: the change goes to it, needs changes comes back. */
const reviewLoops = (automations: Automation[]) =>
	automations.flatMap((a) => {
		if (!a.reviewedBy) return [];
		const node: WorkflowNode = {
			id: `review:${a.name}`,
			kind: "review",
			title: a.name,
			detail: a.reviewedBy,
			...(a.area ? { area: a.area } : {}),
		};
		return [
			{
				node,
				edges: [
					edge(`automation:${a.name}`, node.id, "its change"),
					edge(node.id, `automation:${a.name}`, "needs changes"),
				],
			},
		];
	});

export function workflowGraph(factory: Factory): WorkflowGraph {
	const automations = Object.values(factory.automations).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	const reviews = reviewLoops(automations);
	const outputs = productions(automations);
	const events = new Map([
		...listenedEvents(automations),
		...outputs.map(({ event, arrow }): [string, EventPoint] => [
			arrow.target,
			event,
		]),
	]);
	const produced = new Set(outputs.map(({ arrow }) => arrow.target));
	const listeners = listenerEdges(events, automations);
	const listenedTo = new Set(listeners.map((e) => e.source));
	return {
		nodes: [
			...[...events]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([id, e]) =>
					eventNode(id, e, {
						produced: produced.has(id),
						listenedTo: listenedTo.has(id),
					}),
				),
			...automations.map(automationNode),
			...reviews.map((r) => r.node),
		],
		edges: firstOfEach([
			...outputs.map((o) => o.arrow),
			...listeners,
			...reviews.flatMap((r) => r.edges),
		]).sort((a, b) => a.id.localeCompare(b.id)),
	};
}

/** The agents in the order the work reaches them: fewest steps from where it enters the factory, then by name. */
export function agentOrder(factory: Factory): string[] {
	const { nodes, edges } = workflowGraph(factory);
	const steps = new Map<string, number>();
	let frontier = nodes.filter((n) => n.entry).map((n) => n.id);
	for (let depth = 0; frontier.length > 0; depth++) {
		for (const id of frontier) steps.set(id, depth);
		const from = new Set(frontier);
		frontier = [
			...new Set(
				edges
					.filter((e) => from.has(e.source) && !steps.has(e.target))
					.map((e) => e.target),
			),
		];
	}
	// The answer to mentions on an agent's pull requests comes after its own work, not where work enters.
	const counts = (a: Automation) =>
		!a.builtIn || factory.agents[a.agent]?.builtIn === true;
	const reached = (agent: string) =>
		Math.min(
			...Object.values(factory.automations)
				.filter((a) => a.agent === agent && counts(a))
				.map((a) => steps.get(`automation:${a.name}`) ?? Infinity),
			...Object.values(factory.automations)
				.filter((a) => a.reviewedBy === agent)
				.map((a) => steps.get(`review:${a.name}`) ?? Infinity),
		);
	return Object.keys(factory.agents).sort(
		(a, b) => reached(a) - reached(b) || a.localeCompare(b),
	);
}
