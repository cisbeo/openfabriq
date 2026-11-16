import { expect, it } from "vitest";
import { linearClient } from "../../../src/sources/linear/client.js";

function fakeLinear(answers: unknown[]) {
	const requests: { auth: string; query: string; variables: unknown }[] = [];
	const fakeFetch = (async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body));
		requests.push({
			auth: (init.headers as Record<string, string>).Authorization ?? "",
			query: body.query,
			variables: body.variables,
		});
		return { status: 200, json: async () => answers.shift() } as Response;
	}) as typeof fetch;
	return {
		requests,
		client: linearClient(async () => "Bearer lin_oauth_1", fakeFetch),
	};
}

it("sends the app's Bearer token, asked for on every call", async () => {
	const { requests, client } = fakeLinear([
		{
			data: {
				commentCreate: {
					success: true,
					comment: { url: "https://linear.app/c/1" },
				},
			},
		},
	]);
	expect(await client.comment("uuid-7", "hi")).toBe("https://linear.app/c/1");
	expect(requests[0]?.auth).toBe("Bearer lin_oauth_1");
	expect(requests[0]?.variables).toEqual({ issueId: "uuid-7", body: "hi" });
});

it("adds and removes labels by id, among the team's and the workspace's labels", async () => {
	const { requests, client } = fakeLinear([
		{
			data: {
				issueLabels: {
					nodes: [
						{ id: "l1", name: "Needs-Info" },
						{ id: "l2", name: "agent" },
					],
				},
			},
		},
		{ data: { issueUpdate: { success: true } } },
	]);
	await client.changeLabels("uuid-7", "ENG", {
		add: ["needs-info"],
		remove: ["agent", "gone"],
	});
	// Only the wanted labels are asked for, in any case: a workspace can have more than 250.
	expect(requests[0]?.variables).toEqual({
		filter: {
			and: [
				{ or: [{ team: { key: { eq: "ENG" } } }, { team: { null: true } }] },
				{
					or: ["needs-info", "agent", "gone"].map((name) => ({
						name: { eqIgnoreCase: name },
					})),
				},
			],
		},
	});
	expect(requests[1]?.variables).toEqual({
		id: "uuid-7",
		added: ["l1"],
		removed: ["l2"],
	});
	const missing = fakeLinear([{ data: { issueLabels: { nodes: [] } } }]);
	await expect(
		missing.client.changeLabels("uuid-7", "ENG", { add: ["urgent"] }),
	).rejects.toThrow('the label "urgent" does not exist in the Linear team ENG');
});

it("reads an issue with the type of its state", async () => {
	const { requests, client } = fakeLinear([
		{
			data: {
				issue: {
					id: "uuid-7",
					identifier: "ENG-7",
					title: "Show the due date",
					description: null,
					url: "https://linear.app/acme/issue/ENG-7",
					state: { type: "completed" },
					labels: { nodes: [{ name: "agent" }] },
					comments: { nodes: [] },
				},
			},
		},
	]);
	expect(await client.issue("uuid-7")).toMatchObject({
		description: "",
		state: "completed",
		labels: ["agent"],
	});
	expect(requests[0]?.query).toContain("state { type }");
});

it("reports GraphQL errors", async () => {
	const { client } = fakeLinear([
		{ errors: [{ message: "Authentication required" }] },
	]);
	await expect(client.comment("uuid-7", "hi")).rejects.toThrow(
		"Linear: Authentication required",
	);
});
