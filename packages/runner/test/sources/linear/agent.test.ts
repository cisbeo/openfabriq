import { expect, it } from "vitest";
import {
	appToken,
	linearAgentClient,
} from "../../../src/sources/linear/agent.js";

function fakeLinear(state: string) {
	const requests: { auth: string; query: string; variables: unknown }[] = [];
	const fakeFetch = (async (_url: string, init: RequestInit) => {
		const { query, variables } = JSON.parse(String(init.body));
		requests.push({
			auth: (init.headers as Record<string, string>).Authorization ?? "",
			query,
			variables,
		});
		const data = query.includes("state { type }")
			? {
					issue: {
						state: { type: state },
						team: {
							states: {
								nodes: [
									{ id: "review", position: 3 },
									{ id: "doing", position: 1 },
								],
							},
						},
					},
				}
			: query.includes("agentSession(id")
				? {
						agentSession: {
							activities: {
								nodes: [
									{
										createdAt: "2026-11-03T10:02:00Z",
										content: {
											type: "action",
											action: "Read",
											parameter: "a.ts",
										},
									},
									{
										createdAt: "2026-11-03T10:01:00Z",
										content: { type: "prompt", body: "Fix it" },
									},
								],
							},
						},
					}
				: {
						agentActivityCreate: { success: true },
						issueUpdate: { success: true },
					};
		return { status: 200, json: async () => ({ data }) } as Response;
	}) as unknown as typeof fetch;
	return {
		requests,
		client: linearAgentClient(async () => "lin_oauth_1", fakeFetch),
	};
}

it("moves an issue not started yet to the team's first started state, with the app token", async () => {
	const { requests, client } = fakeLinear("backlog");
	await client.start("issue-1");
	expect(requests.map((r) => r.auth)).toEqual([
		"Bearer lin_oauth_1",
		"Bearer lin_oauth_1",
	]);
	expect(requests[1]?.variables).toEqual({ id: "issue-1", state: "doing" });
	const started = fakeLinear("started");
	await started.client.start("issue-1");
	expect(started.requests).toHaveLength(1); // already started: left alone
});

it("posts an ephemeral step, and reads a session's history oldest first", async () => {
	const { requests, client } = fakeLinear("started");
	await client.activity(
		"session-1",
		{ type: "action", action: "Read", parameter: "a.ts" },
		{ ephemeral: true },
	);
	expect(requests[0]?.variables).toEqual({
		input: {
			agentSessionId: "session-1",
			content: { type: "action", action: "Read", parameter: "a.ts" },
			ephemeral: true,
		},
	});
	expect(await client.sessionHistory("session-1")).toEqual([
		{ type: "prompt", body: "Fix it", at: "2026-11-03T10:01:00Z" },
		{ type: "action", body: "Read a.ts", at: "2026-11-03T10:02:00Z" },
	]);
});

it("finds the token of the organization, or says openfabriq is not installed there", async () => {
	const relay = {
		linearTokens: async () => [
			{
				organizationId: "org-1",
				organizationName: "Acme",
				appUserId: "app",
				accessToken: "lin_oauth_1",
				expiresAt: 0,
			},
		],
	};
	expect(await appToken(relay, "org-1")).toBe("lin_oauth_1");
	await expect(appToken(relay, "org-2")).rejects.toThrow(
		"openfabriq is not installed in this Linear organization",
	);
});
