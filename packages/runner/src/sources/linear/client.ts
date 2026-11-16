// Linear's GraphQL API, with the openfabriq app's token the relay keeps. Field and
// argument names checked against Linear's published schema on 2026-11-02.

import { sameName } from "@openfabriq/core";

const ENDPOINT = "https://api.linear.app/graphql";

export interface LinearIssue {
	id: string;
	identifier: string;
	title: string;
	description: string;
	url: string;
	/** The type of its workflow state: triage, backlog, unstarted, started, completed, canceled, duplicate. */
	state: string;
	labels: string[];
	comments: { author: string; body: string; createdAt: string }[];
}

/** The state types of an issue whose work is over. */
export const LINEAR_OVER = ["completed", "canceled", "duplicate"];

/** What the engine needs from Linear. */
export interface Linear {
	issue(id: string): Promise<LinearIssue>;
	/** Comments on the issue; returns the comment's URL. */
	comment(issueId: string, body: string): Promise<string | undefined>;
	/** Adds and removes labels by name; only labels that exist in the team or the workspace. */
	changeLabels(
		issueId: string,
		team: string,
		change: { add?: string[]; remove?: string[] },
	): Promise<void>;
}

type Fetch = typeof fetch;

/** `authorization` is the whole header: an app's OAuth token goes as `Bearer <token>`. */
export async function linearQuery<T>(
	authorization: string,
	query: string,
	variables: Record<string, unknown> = {},
	fetchImpl: Fetch = fetch,
): Promise<T> {
	const response = await fetchImpl(ENDPOINT, {
		method: "POST",
		headers: {
			Authorization: authorization,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ query, variables }),
	});
	const body = (await response.json().catch(() => ({}))) as {
		data?: T;
		errors?: { message: string }[];
	};
	if (body.errors?.length || !body.data)
		throw new Error(
			`Linear: ${body.errors?.map((e) => e.message).join("; ") || `HTTP ${response.status}`}`,
		);
	return body.data;
}

const ISSUE = `query ($id: String!) {
  issue(id: $id) {
    id identifier title description url state { type }
    labels { nodes { name } }
    comments(first: 100) { nodes { body createdAt user { name } } }
  }
}`;

const LABELS = `query ($filter: IssueLabelFilter!) {
  issueLabels(filter: $filter, first: 250) { nodes { id name } }
}`;

/** `authorization`: how to get the app's current `Bearer` header. */
export function linearClient(
	authorization: () => Promise<string>,
	fetchImpl: Fetch = fetch,
): Linear {
	const query = async <T>(
		text: string,
		variables: Record<string, unknown> = {},
	) => linearQuery<T>(await authorization(), text, variables, fetchImpl);
	return {
		async issue(id) {
			const { issue } = await query<{
				issue: {
					id: string;
					identifier: string;
					title: string;
					description: string | null;
					url: string;
					state: { type: string };
					labels: { nodes: { name: string }[] };
					comments: {
						nodes: {
							body: string;
							createdAt: string;
							user: { name: string } | null;
						}[];
					};
				};
			}>(ISSUE, { id });
			return {
				id: issue.id,
				identifier: issue.identifier,
				title: issue.title,
				description: issue.description ?? "",
				url: issue.url,
				state: issue.state.type,
				labels: issue.labels.nodes.map((l) => l.name),
				comments: issue.comments.nodes
					.map((c) => ({
						author: c.user?.name ?? "integration",
						body: c.body,
						createdAt: c.createdAt,
					}))
					.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
			};
		},
		async comment(issueId, body) {
			const { commentCreate } = await query<{
				commentCreate: { success: boolean; comment: { url: string } | null };
			}>(
				`mutation ($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) { success comment { url } }
}`,
				{ issueId, body },
			);
			if (!commentCreate.success) throw new Error("Linear refused the comment");
			return commentCreate.comment?.url;
		},
		async changeLabels(issueId, team, change) {
			const names = [...(change.add ?? []), ...(change.remove ?? [])];
			if (names.length === 0) return;
			// Only the wanted labels, by name and in any case: a workspace can have more than a page of them.
			const { issueLabels } = await query<{
				issueLabels: { nodes: { id: string; name: string }[] };
			}>(LABELS, {
				filter: {
					and: [
						{ or: [{ team: { key: { eq: team } } }, { team: { null: true } }] },
						{ or: names.map((name) => ({ name: { eqIgnoreCase: name } })) },
					],
				},
			});
			const find = (name: string) =>
				issueLabels.nodes.find((l) => sameName(l.name, name))?.id;
			const added = (change.add ?? []).map((name) => {
				const id = find(name);
				if (!id)
					throw new Error(
						`the label "${name}" does not exist in the Linear team ${team}`,
					);
				return id;
			});
			// A label that does not exist cannot be on the issue: nothing to remove.
			const removed = (change.remove ?? []).flatMap((name) => find(name) ?? []);
			const { issueUpdate } = await query<{
				issueUpdate: { success: boolean };
			}>(
				`mutation ($id: String!, $added: [String!], $removed: [String!]) {
  issueUpdate(id: $id, input: { addedLabelIds: $added, removedLabelIds: $removed }) { success }
}`,
				{ id: issueId, added, removed },
			);
			if (!issueUpdate.success) throw new Error("Linear refused the labels");
		},
	};
}
