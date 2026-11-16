import { type exec, readSecrets } from "@openfabriq/runner";
import type { CommandResult } from "../../result.js";

// What every "openfabriq connect <service>" shares: its prompts, passed in so the logic is tested
// (they are in src/prompts.ts), and the relay every service comes through.

export interface ConnectDeps {
	/** `initial` is typed in already: Enter keeps it, and it can be edited. */
	ask(
		question: string,
		options?: { secret?: boolean; initial?: string },
	): Promise<string>;
	print(text: string): void;
	fetch?: typeof fetch;
	/** Puts text in the clipboard; false when this machine has no way to. */
	copy?(text: string): Promise<boolean>;
}

/** Said after each connection: a running engine reads them when it starts. */
export const RESTART_START =
	'If "openfabriq start" is running, restart it (Ctrl-C, then "openfabriq start"): it reads the connections when it starts.';

export interface RelayDeps extends ConnectDeps {
	exec?: typeof exec;
	WebSocket?: typeof WebSocket;
	randomToken?: () => string;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	relayDir?: string;
	signals?: Pick<NodeJS.Process, "once" | "off" | "exit">;
}

/** Over http a token would travel in clear: only to a server on this machine. */
export function isSafeUrl(url: string): boolean {
	const parsed = URL.canParse(url) ? new URL(url) : undefined;
	return (
		parsed?.protocol === "https:" ||
		(parsed?.protocol === "http:" &&
			["localhost", "127.0.0.1"].includes(parsed.hostname))
	);
}

/** The relay this machine is connected to, when it has both its address and its token. */
export function connectedRelay(): { url: string; token: string } | undefined {
	const relay = readSecrets().relay;
	return relay?.url && relay.token ? relay : undefined;
}

/** A call to one of the relay's engine routes, with its token. */
export function relayCall(
	relay: { url: string; token: string },
	deps: ConnectDeps,
	method: string,
	path: string,
	body?: unknown,
): Promise<Response> {
	return (deps.fetch ?? fetch)(`${relay.url}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${relay.token}`,
			...(body ? { "Content-Type": "application/json" } : {}),
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	});
}

export const NO_RELAY: CommandResult = {
	code: 1,
	output: 'No relay yet: run "openfabriq connect relay" first.',
};
