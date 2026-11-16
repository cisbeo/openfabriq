import { type Factory, type FactoryEvent, sameName } from "@openfabriq/core";
import { remember } from "../../engine/cursors.js";
import { errorText } from "../../files.js";
import { appliedProjects } from "../projects.js";
import type { RelayEvent } from "../relay.js";
import type { LinearAgent } from "./agent.js";

/** The parts of Linear's AgentSessionEvent the engine reads; anything else in it is ignored. */
export interface SessionEvent {
	type?: string;
	action?: string;
	organizationId?: string;
	createdAt?: string;
	promptContext?: string;
	agentSession?: {
		id?: string;
		creator?: { name?: string } | null;
		comment?: { body?: string } | null;
		issue?: {
			id?: string;
			identifier?: string;
			url?: string;
			team?: { key?: string };
		} | null;
	};
	agentActivity?: {
		id?: string;
		signal?: string | null;
		body?: string;
		content?: { body?: string };
		user?: { name?: string };
	} | null;
}

const listens = (factory: Factory) =>
	Object.values(factory.automations).some((a) =>
		a.when.some((t) => t.event === "linear.issue.delegated"),
	);

/**
 * What the relay passes on: an issue delegated to openfabriq in Linear, or an answer in its
 * session, is queued for each factory of its team that listens to linear.issue.delegated
 *. A session the engine cannot take gets an error activity that says why.
 */
export function delegation({
	appliedFactory,
	linearApp,
	queue,
	log,
}: {
	appliedFactory: (repo: string) => Factory | undefined;
	linearApp: ((organizationId: string) => LinearAgent) | undefined;
	queue: (repo: string, factory: Factory, event: FactoryEvent) => void;
	log: (line: string) => void;
}): (events: RelayEvent[]) => Promise<void> {
	// An event whose ack was lost comes back, maybe after its run ended: it is not queued again.
	const handled = new Set<string>();
	return async (events) => {
		for (const event of events) {
			if (handled.has(event.id)) continue;
			await handle(event);
			remember(handled, event.id);
		}
	};

	async function handle(event: RelayEvent) {
		if (event.service !== "linear") return;
		if (event.kind === "installed") {
			log(`linear: openfabriq installed in ${String(event.organizationName)}`);
			return;
		}
		const payload = event.payload as SessionEvent | undefined;
		if (event.kind !== "webhook" || payload?.type !== "AgentSessionEvent")
			return;
		const taken = delegationOf(event, payload, () =>
			appliedProjects(appliedFactory).map((p) => p.factory),
		);
		if (!taken) return;
		if ("unsupported" in taken) log(`linear: ${taken.unsupported}`);
		else if ("refused" in taken) await refuse(taken);
		else
			for (const found of taken.queued)
				queue(found.factory.repository, found.factory, found.event);
	}

	async function refuse({ refused, session }: Refusal) {
		log(`linear: ${refused}`);
		if (!linearApp) return;
		// A session left without an answer reads as broken in Linear; a failed post only gets logged.
		await linearApp(session.organizationId)
			.activity(session.id, { type: "error", body: refused })
			.catch((error: unknown) =>
				log(`linear: the error activity failed: ${errorText(error)}`),
			);
	}
}

/** A session the engine cannot take: the reason is said in the session. */
export interface Refusal {
	refused: string;
	session: { id: string; organizationId: string };
}

/** What a session event asks: runs to queue, a refusal, or something not supported yet. */
export type Delegation =
	| { queued: { factory: Factory; event: FactoryEvent }[] }
	| Refusal
	| { unsupported: string };

/**
 * A session created or answered, among the applied factories: one run per factory of its team
 * that listens to linear.issue.delegated. Undefined for an event with nothing to do.
 */
export function delegationOf(
	event: RelayEvent,
	payload: SessionEvent,
	/** Read only for a session the engine can take. */
	factories: () => Factory[],
): Delegation | undefined {
	const session = payload.agentSession;
	const issue = session?.issue;
	const organizationId = payload.organizationId;
	const activity = payload.agentActivity;
	if (payload.action !== "created" && payload.action !== "prompted") return;
	if (!session?.id || !organizationId) return;
	if (activity?.signal === "stop")
		return { unsupported: "stop is not supported yet" };
	const sessionId = session.id;
	const refused = (reason: string): Refusal => ({
		refused: reason,
		session: { id: sessionId, organizationId },
	});
	const team = issue?.team?.key;
	if (!issue?.id || !issue.identifier || !issue.url || !team)
		return refused("openfabriq only works on a Linear issue.");
	const ofTeam = factories().filter((f) =>
		sameName(f.linear?.team ?? "", team),
	);
	if (ofTeam.length === 0)
		return refused(
			`The Linear team ${team} is not the team of any factory: openfabriq does not work for it.`,
		);
	const listening = ofTeam.filter(listens);
	if (listening.length === 0)
		return refused(
			"No automation of this team listens to linear.issue.delegated.",
		);
	const prompted = payload.action === "prompted";
	const request = prompted
		? (activity?.content?.body ?? activity?.body ?? "")
		: (payload.promptContext ?? session.comment?.body ?? "");
	const { id, identifier, url } = issue;
	return {
		queued: listening.map((factory) => ({
			factory,
			event: {
				key: `linear-session:${sessionId}:${activity?.id ?? (prompted ? event.id : "created")}`,
				event: "linear.issue.delegated",
				isPullRequest: false,
				actor: (prompted ? activity?.user?.name : session.creator?.name) ?? "",
				at: payload.createdAt ?? new Date(event.receivedAt).toISOString(),
				source: {
					kind: "linear",
					issueId: id,
					identifier,
					url,
					session: { id: sessionId, organizationId, request },
				},
			},
		})),
	};
}
