import {
	errorText,
	SENTRY_URL,
	secretsPath,
	writeSecrets,
} from "@openfabriq/runner";
import type { CommandResult } from "../../result.js";
import {
	type ConnectDeps,
	connectedRelay,
	isSafeUrl,
	NO_RELAY,
	RESTART_START,
	relayCall,
} from "./shared.js";

// openfabriq connect sentry: tests the token, gives it to the relay, which searches
// for new issues, and keeps it here to read an issue and add notes.

/** The scopes the engine needs from Sentry: a write scope also covers reading. */
const SENTRY_SCOPES = [
	["project:read", "find the project's id"],
	["event:read", "list new issues (the relay) and read their latest event"],
	["event:write", "add notes to an issue"],
] as const;

export async function connectSentry(deps: ConnectDeps): Promise<CommandResult> {
	const relay = connectedRelay();
	if (!relay) return NO_RELAY;
	deps.print(
		[
			`Sentry: your relay, ${relay.url}, looks for new issues every minute with an auth token; this machine keeps it too, to read an issue and add notes.`,
			"",
			'1. In Sentry, open User settings, API, "Personal Tokens", then "Create New Token".',
			"2. Name it openfabriq. Under Permissions, pick in the dropdowns:",
			"     Project         Read",
			"     Issue & Event   Read & Write",
			'   and leave the other dropdowns on "No Access". "Permissions Preview", at the bottom, then shows the scopes the engine needs:',
			...SENTRY_SCOPES.map(([scope, why]) => `     ${scope.padEnd(13)} ${why}`),
			"3. Create the token, copy it, and paste it below.",
			"   An internal integration token with the same permissions works too. An organization token (sntrys_...) does not: it cannot add notes.",
			"",
		].join("\n"),
	);
	const url = (
		(await deps.ask("Sentry URL: ", { initial: SENTRY_URL })).trim() ||
		SENTRY_URL
	).replace(/\/+$/, "");
	const token = (await deps.ask("Auth token: ", { secret: true })).trim();
	if (!isSafeUrl(url) || !token)
		return {
			code: 1,
			output:
				"A URL starting with https:// (http:// only for localhost) and a token are needed. Nothing was saved.",
		};
	try {
		// GET /api/0/ needs no scope and tells which scopes the token has.
		const response = await (deps.fetch ?? fetch)(`${url}/api/0/`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		const body = (await response.json().catch(() => ({}))) as {
			auth?: { scopes?: string[] } | null;
			user?: { username?: string; email?: string } | null;
		};
		if (!response.ok || !body.auth)
			throw new Error(`Sentry did not accept the token (${response.status})`);
		const scopes = body.auth.scopes ?? [];
		const has = (...any: string[]) => any.some((s) => scopes.includes(s));
		const missing = [
			...(has("project:read", "project:write", "project:admin")
				? []
				: ["project:read"]),
			...(has("event:write", "event:admin") ? [] : ["event:write"]),
		];
		if (missing.length)
			return {
				code: 1,
				output: `The token lacks ${missing.join(" and ")}. Nothing was saved.`,
			};
		// The relay only ever sends the token to this url.
		const given = await relayCall(relay, deps, "POST", "/config/sentry", {
			token,
			url,
		});
		if (!given.ok)
			throw new Error(
				`the relay answered ${given.status} to POST /config/sentry`,
			);
		writeSecrets("sentry", { token, url });
		const who = body.user?.username ?? body.user?.email;
		return {
			code: 0,
			output: `Sentry connected${who ? ` as ${who}` : ""} on ${url}. Token given to the relay and saved in ${secretsPath()}. "openfabriq start" tells the relay which projects to watch.\n${RESTART_START}`,
		};
	} catch (error) {
		return {
			code: 1,
			output: `The token does not work (${errorText(error)}). Nothing was saved.`,
		};
	}
}
