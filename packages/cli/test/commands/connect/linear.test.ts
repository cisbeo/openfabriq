import { expect, it } from "vitest";
import { connectCommand } from "../../../src/commands/connect/index.js";
import type { RelayDeps } from "../../../src/commands/connect/shared.js";
import { calls, printed, RELAY, withRelay } from "./helpers.js";

function linearAgentDeps(
	installAfter: number,
	authorizeUrl = "https://linear.app/oauth/authorize?x",
): RelayDeps & {
	clock: number;
	posted: unknown[];
} {
	let polls = 0;
	const state = {
		clock: 0,
		posted: [] as unknown[],
	};
	return Object.assign(state, {
		ask: async (question: string) =>
			({ "Client ID: ": "cid", "Client secret: ": "csecret" })[question] ??
			"whsecret",
		print: (text: string) => printed.push(text),
		now: () => state.clock,
		sleep: async (ms: number) => {
			state.clock += ms;
		},
		exec: async (command: string, args: string[]) => {
			calls.push(`${command} ${args.join(" ")}`);
			return "";
		},
		fetch: (async (url: string, init: RequestInit = {}) => {
			const auth = (init.headers as Record<string, string>).Authorization;
			calls.push(`${init.method ?? "GET"} ${url} ${auth}`);
			if (url.endsWith("/config/linear")) {
				state.posted.push(JSON.parse(String(init.body)));
				return {
					ok: true,
					json: async () => ({
						authorizeUrl,
					}),
				} as Response;
			}
			if (url.endsWith("/tokens/linear")) {
				const old = {
					organizationId: "o0",
					organizationName: "Old",
					accessToken: "a0",
				};
				const fresh = {
					organizationId: "o1",
					organizationName: "Acme",
					accessToken: "a1",
				};
				return {
					ok: true,
					json: async () => ({
						organizations: polls++ > installAfter ? [old, fresh] : [old],
					}),
				} as Response;
			}
			return {
				status: 200,
				json: async () => ({
					data: {
						viewer: { id: "app", name: "openfabriq" },
						organization: { name: "Acme" },
					},
				}),
			} as Response;
		}) as typeof fetch,
	});
}

it("needs a relay before installing openfabriq in Linear", async () => {
	expect(await connectCommand("linear", linearAgentDeps(0))).toEqual({
		code: 1,
		output: 'No relay yet: run "openfabriq connect relay" first.',
	});
});

it("gives the Linear app to the relay, opens the install, and waits for it", async () => {
	withRelay();
	const linear = linearAgentDeps(2);
	const result = await connectCommand("linear", linear);
	expect(result).toEqual({
		code: 0,
		output: expect.stringContaining(
			"✓ openfabriq is installed in Acme as openfabriq.",
		),
	});
	expect(result.output).toContain("Settings, Integrations, GitHub");
	expect(printed[0]).toContain(`${RELAY}/hooks/linear`);
	expect(printed[0]).toContain(`${RELAY}/oauth/linear/callback`);
	expect(printed[0]).toContain('tick "Agent session events" and "Issues"');
	expect(linear.posted).toEqual([
		{ webhookSecret: "whsecret", clientId: "cid", clientSecret: "csecret" },
	]);
	const opener = process.platform === "darwin" ? "open" : "xdg-open";
	expect(calls).toEqual([
		`GET ${RELAY}/tokens/linear Bearer rt`,
		`POST ${RELAY}/config/linear Bearer rt`,
		`${opener} https://linear.app/oauth/authorize?x`,
		...Array(3).fill(`GET ${RELAY}/tokens/linear Bearer rt`),
		"POST https://api.linear.app/graphql Bearer a1",
	]);
	expect(linear.clock).toBe(6000);
	expect(printed.join("\n")).toContain("https://linear.app/oauth/authorize?x");
});

it("stops waiting for the Linear install after 5 minutes", async () => {
	withRelay();
	const linear = linearAgentDeps(Number.POSITIVE_INFINITY);
	expect(await connectCommand("linear", linear)).toEqual({
		code: 1,
		output: expect.stringContaining("No install came back within 5 minutes."),
	});
	expect(linear.clock).toBe(300_000);
});

it("opens only an https address to authorize the Linear app", async () => {
	withRelay();
	const linear = linearAgentDeps(0, "file:///etc/passwd");
	expect(await connectCommand("linear", linear)).toEqual({
		code: 1,
		output:
			"The install did not work (the relay gave an address to authorize the app that is not https).",
	});
	expect(calls).toEqual([
		`GET ${RELAY}/tokens/linear Bearer rt`,
		`POST ${RELAY}/config/linear Bearer rt`,
	]);
	expect(printed.join("\n")).not.toContain("file:");
});
