// Linear's agent API, with the app's OAuth token that the relay keeps. What the engine
// writes with it appears as openfabriq. Field names checked against Linear's published schema
// (packages/sdk/src/schema.graphql) on 2026-11-03.

import type { Relay } from "../relay.js";
import { type Linear, linearClient, linearQuery } from "./client.js";

/** What an activity says: `action` is a step, the others a text (Linear's AgentActivityType). */
export type ActivityContent =
	| { type: "thought" | "response" | "elicitation" | "error"; body: string }
	| { type: "action"; action: string; parameter: string; result?: string };

/** What the engine needs from Linear, as the openfabriq app: its issues, and its agent sessions. */
export interface LinearAgent extends Linear {
	/** Only thoughts and actions can be ephemeral: the next activity replaces them. */
	activity(
		sessionId: string,
		content: ActivityContent,
		options?: { ephemeral?: boolean },
	): Promise<void>;
	/** Adds links to the session, such as its pull request. */
	externalUrls(
		sessionId: string,
		urls: { label: string; url: string }[],
	): Promise<void>;
	/** Moves the issue to its team's first started state, unless it is already started, done or canceled. */
	start(issueId: string): Promise<void>;
	/** The session's activities so far, oldest first: what a follow-up run is told. */
	sessionHistory(
		sessionId: string,
	): Promise<{ type: string; body: string; at: string }[]>;
}

const TEXT = ["Thought", "Response", "Prompt", "Error", "Elicitation"]
	.map((kind) => `... on AgentActivity${kind}Content { type body }`)
	.join(" ");

const HISTORY = `query ($id: String!) {
  agentSession(id: $id) {
    activities(first: 100) {
      nodes { createdAt content { ${TEXT} ... on AgentActivityActionContent { type action parameter result } } }
    }
  }
}`;

const STATES = `query ($id: String!) {
  issue(id: $id) {
    state { type }
    team { states(filter: { type: { eq: "started" } }) { nodes { id position } } }
  }
}`;

/** Linear's advice: an issue not started yet moves to started when an agent takes it. */
const NOT_STARTED = ["triage", "backlog", "unstarted"];

export function linearAgentClient(
	accessToken: () => Promise<string>,
	fetchImpl: typeof fetch = fetch,
): LinearAgent {
	const authorization = async () => `Bearer ${await accessToken()}`;
	const query = async <T>(text: string, variables: Record<string, unknown>) =>
		linearQuery<T>(await authorization(), text, variables, fetchImpl);
	const succeeded = (what: string, payload: { success: boolean }) => {
		if (!payload.success) throw new Error(`Linear refused the ${what}`);
	};
	return {
		...linearClient(authorization, fetchImpl),
		async activity(sessionId, content, options = {}) {
			const { agentActivityCreate } = await query<{
				agentActivityCreate: { success: boolean };
			}>(
				`mutation ($input: AgentActivityCreateInput!) {
  agentActivityCreate(input: $input) { success }
}`,
				{
					input: {
						agentSessionId: sessionId,
						content,
						...(options.ephemeral ? { ephemeral: true } : {}),
					},
				},
			);
			succeeded("activity", agentActivityCreate);
		},
		async externalUrls(sessionId, urls) {
			const { agentSessionUpdate } = await query<{
				agentSessionUpdate: { success: boolean };
			}>(
				`mutation ($id: String!, $urls: [AgentSessionExternalUrlInput!]) {
  agentSessionUpdate(id: $id, input: { addedExternalUrls: $urls }) { success }
}`,
				{ id: sessionId, urls },
			);
			succeeded("link", agentSessionUpdate);
		},
		async start(issueId) {
			const { issue: found } = await query<{
				issue: {
					state: { type: string } | null;
					team: { states: { nodes: { id: string; position: number }[] } };
				};
			}>(STATES, { id: issueId });
			if (found.state && !NOT_STARTED.includes(found.state.type)) return;
			const first = [...found.team.states.nodes].sort(
				(a, b) => a.position - b.position,
			)[0];
			if (!first) return;
			const { issueUpdate } = await query<{
				issueUpdate: { success: boolean };
			}>(
				`mutation ($id: String!, $state: String!) {
  issueUpdate(id: $id, input: { stateId: $state }) { success }
}`,
				{ id: issueId, state: first.id },
			);
			succeeded("state", issueUpdate);
		},
		async sessionHistory(sessionId) {
			const { agentSession } = await query<{
				agentSession: {
					activities: {
						nodes: {
							createdAt: string;
							content: {
								type: string;
								body?: string;
								action?: string;
								parameter?: string;
								result?: string | null;
							};
						}[];
					};
				};
			}>(HISTORY, { id: sessionId });
			return agentSession.activities.nodes
				.map(({ createdAt, content: c }) => ({
					type: c.type,
					body:
						c.body ??
						[c.action, c.parameter, c.result].filter(Boolean).join(" "),
					at: createdAt,
				}))
				.sort((a, b) => a.at.localeCompare(b.at));
		},
	};
}

/** The app's token for one organization, from the relay. */
export async function appToken(
	relay: Pick<Relay, "linearTokens">,
	organizationId: string,
): Promise<string> {
	const install = (await relay.linearTokens()).find(
		(o) => o.organizationId === organizationId,
	);
	if (!install)
		throw new Error(
			`openfabriq is not installed in this Linear organization; run "openfabriq connect linear"`,
		);
	return install.accessToken;
}
