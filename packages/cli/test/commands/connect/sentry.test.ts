import { expect, it } from "vitest";
import { connectCommand } from "../../../src/commands/connect/index.js";
import type { ConnectDeps } from "../../../src/commands/connect/shared.js";
import { calls, printed, RELAY, saved, withRelay } from "./helpers.js";

function sentryDeps(
	answers: string[],
	scopes: string[] | null,
	relayStatus = 204,
): ConnectDeps & { given: unknown[] } {
	const given: unknown[] = [];
	return {
		given,
		ask: async () => answers.shift() ?? "",
		print: (text) => printed.push(text),
		fetch: (async (url: string, init: RequestInit) => {
			calls.push(
				`${init.method ?? "GET"} ${url} ${(init.headers as Record<string, string>).Authorization}`,
			);
			if (url.endsWith("/config/sentry")) {
				given.push(JSON.parse(String(init.body)));
				return { ok: relayStatus < 300, status: relayStatus } as Response;
			}
			return {
				ok: scopes !== null,
				status: scopes === null ? 401 : 200,
				json: async () =>
					scopes === null
						? { detail: "Invalid token" }
						: { auth: { scopes }, user: { username: "alice" } },
			} as Response;
		}) as typeof fetch,
	};
}

it("needs a relay before connecting Sentry", async () => {
	expect(await connectCommand("sentry", sentryDeps(["", "t"], []))).toEqual({
		code: 1,
		output: 'No relay yet: run "openfabriq connect relay" first.',
	});
	expect(calls).toEqual([]);
});

it("tests the Sentry token and its scopes, gives it to the relay, then saves it", async () => {
	withRelay();
	const sentry = sentryDeps(
		["", "sntryu_t"],
		["project:read", "event:write", "org:read"],
	);
	const result = await connectCommand("sentry", sentry);
	expect(result).toMatchObject({
		code: 0,
		output: expect.stringContaining(
			"Sentry connected as alice on https://sentry.io.",
		),
	});
	expect(calls).toEqual([
		"GET https://sentry.io/api/0/ Bearer sntryu_t",
		`POST ${RELAY}/config/sentry Bearer rt`,
	]);
	expect(sentry.given).toEqual([
		{ token: "sntryu_t", url: "https://sentry.io" },
	]);
	expect(saved()).toEqual({
		relay: { url: RELAY, token: "rt" },
		sentry: { token: "sntryu_t", url: "https://sentry.io" },
	});
	expect(printed.join("\n")).toContain("event:write");
});

it("saves nothing when the relay refuses the Sentry token", async () => {
	withRelay();
	expect(
		await connectCommand(
			"sentry",
			sentryDeps(["", "t"], ["project:read", "event:write"], 401),
		),
	).toEqual({
		code: 1,
		output:
			"The token does not work (the relay answered 401 to POST /config/sentry). Nothing was saved.",
	});
	expect(saved().sentry).toBeUndefined();
});

it("sends a Sentry token over http only to this machine", async () => {
	withRelay();
	expect(
		await connectCommand(
			"sentry",
			sentryDeps(["http://sentry.acme.dev", "t"], []),
		),
	).toEqual({
		code: 1,
		output:
			"A URL starting with https:// (http:// only for localhost) and a token are needed. Nothing was saved.",
	});
	expect(calls).toEqual([]);
	await connectCommand(
		"sentry",
		sentryDeps(["http://localhost:9000", "t"], []),
	);
	expect(calls).toEqual(["GET http://localhost:9000/api/0/ Bearer t"]);
});

it("names the Sentry scopes a token lacks, and saves nothing", async () => {
	withRelay();
	expect(
		await connectCommand(
			"sentry",
			sentryDeps(["https://sentry.acme.dev/", "t"], ["event:read"]),
		),
	).toEqual({
		code: 1,
		output: "The token lacks project:read and event:write. Nothing was saved.",
	});
	expect(calls).toEqual(["GET https://sentry.acme.dev/api/0/ Bearer t"]);
	expect(
		(await connectCommand("sentry", sentryDeps(["", "bad"], null))).output,
	).toBe(
		"The token does not work (Sentry did not accept the token (401)). Nothing was saved.",
	);
	expect(saved().sentry).toBeUndefined();
});
