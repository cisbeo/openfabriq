import { EventEmitter } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { beforeEach, expect, it } from "vitest";
import { connectCommand } from "../../../src/commands/connect/index.js";
import type { RelayDeps } from "../../../src/commands/connect/shared.js";
import { calls, printed, RELAY, saved } from "./helpers.js";

let socketFrame: string | undefined;

class FakeSocket {
	onmessage?: (message: { data: string }) => void;
	onerror?: () => void;
	onclose?: () => void;
	constructor(url: string, init: { headers: Record<string, string> }) {
		calls.push(`ws ${url} ${init.headers.Authorization}`);
		queueMicrotask(() =>
			socketFrame ? this.onmessage?.({ data: socketFrame }) : this.onclose?.(),
		);
	}
	// Like undici, closing fires the handlers again.
	close() {
		this.onclose?.();
	}
}

function relayDeps(
	options: {
		loggedIn?: boolean;
		deploy?: "fails" | string[];
		/** false: /health always answers 404; a number: it answers 404 that many times first, as a new workers.dev address does. */
		health?: boolean | number;
		token?: string;
	} = {},
): RelayDeps & { deployed: { secretsFile?: string; secrets?: unknown } } {
	const deployed: { secretsFile?: string; secrets?: unknown } = {};
	return {
		deployed,
		ask: async (question, askOptions) => {
			calls.push(`ask ${question}${askOptions?.secret ? "(hidden)" : ""}`);
			return options.token ?? "";
		},
		print: (text) => printed.push(text),
		relayDir: "/repo/packages/relay",
		randomToken: () => "engine-token",
		WebSocket: FakeSocket as unknown as typeof WebSocket,
		exec: async (command, args, execOptions) => {
			calls.push(`${command} ${args.join(" ")} in ${execOptions?.cwd}`);
			if (args[1] === "whoami" && options.loggedIn === false)
				throw new Error("not authenticated");
			if (args[1] === "deploy") {
				deployed.secretsFile = args[3] ?? "";
				deployed.secrets = JSON.parse(
					readFileSync(deployed.secretsFile, "utf8"),
				);
				if (options.deploy === "fails") throw new Error("deploy refused");
				const targets = options.deploy ?? [RELAY];
				writeFileSync(
					execOptions?.env?.WRANGLER_OUTPUT_FILE_PATH ?? "",
					`{"type":"wrangler-session","version":1}\n${JSON.stringify({ type: "deploy", targets })}\n`,
				);
			}
			return "";
		},
		sleep: async () => {},
		fetch: (async (url: string) => {
			calls.push(`GET ${url}`);
			const down =
				options.health === false ||
				(typeof options.health === "number" && options.health-- > 0);
			return {
				ok: !down,
				status: down ? 404 : 200,
				json: async () => (down ? {} : { ok: true }),
			} as Response;
		}) as typeof fetch,
	};
}

beforeEach(() => {
	socketFrame = '{"type":"events","events":[]}';
});

it("asks to log in to wrangler before deploying the relay", async () => {
	const result = await connectCommand("relay", relayDeps({ loggedIn: false }));
	expect(result).toEqual({
		code: 1,
		output: expect.stringContaining(
			'Run "npx wrangler login" in /repo/packages/relay (a free Cloudflare account is enough)',
		),
	});
	expect(calls).toEqual(["npx wrangler whoami --json in /repo/packages/relay"]);
});

it("deploys the relay with a new token, checks it, then saves it", async () => {
	const relay = relayDeps();
	const result = await connectCommand("relay", relay);
	expect(result).toEqual({
		code: 0,
		output: expect.stringContaining(`Relay connected: ${RELAY}.`),
	});
	expect(result.output).toContain(
		'"openfabriq connect slack", "linear" or "sentry"',
	);
	expect(result.output).not.toContain("engine-token");
	expect(relay.deployed.secrets).toEqual({ ENGINE_TOKEN: "engine-token" });
	expect(existsSync(relay.deployed.secretsFile ?? "")).toBe(false);
	expect(calls.slice(2)).toEqual([
		`GET ${RELAY}/health`,
		"ws wss://openfabriq-relay.acme.workers.dev/engine Bearer engine-token",
	]);
	expect(saved()).toEqual({ relay: { url: RELAY, token: "engine-token" } });
});

it("deletes the secrets file when the deploy fails, and saves nothing", async () => {
	const relay = relayDeps({ deploy: "fails" });
	expect((await connectCommand("relay", relay)).output).toContain(
		"The deploy failed (deploy refused). Nothing was saved.",
	);
	expect(relay.deployed.secretsFile).toBeDefined();
	expect(existsSync(relay.deployed.secretsFile ?? "")).toBe(false);
	expect(() => saved()).toThrow();
});

it("deletes the secrets file when the deploy is interrupted, then exits 130", async () => {
	const relay = relayDeps();
	const exits: number[] = [];
	const signals = Object.assign(new EventEmitter(), {
		exit: (code: number) => {
			exits.push(code);
		},
	});
	relay.signals = signals as unknown as NonNullable<RelayDeps["signals"]>;
	const deploy = relay.exec;
	let leftAfterSignal: boolean | undefined;
	relay.exec = async (command, args, options) => {
		const output = await deploy?.(command, args, options);
		if (args[1] === "deploy") {
			signals.emit("SIGINT");
			leftAfterSignal = existsSync(relay.deployed.secretsFile ?? "");
		}
		return output ?? "";
	};
	await connectCommand("relay", relay);
	expect(leftAfterSignal).toBe(false);
	expect(exits).toEqual([130]);
	expect(
		signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM"),
	).toBe(0);
});

it("says how to create the workers.dev subdomain when the deploy has no address", async () => {
	const result = await connectCommand(
		"relay",
		relayDeps({ deploy: ["openfabriq-relay.example.com/*"] }),
	);
	expect(result).toEqual({
		code: 1,
		output: expect.stringContaining("Open the Cloudflare dashboard"),
	});
	expect(() => saved()).toThrow();
});

it("checks a relay already deployed with --url, asking its token hidden, without deploying", async () => {
	const result = await connectCommand("relay", relayDeps({ token: " t0 " }), {
		url: `${RELAY}/`,
	});
	expect(result.code).toBe(0);
	expect(calls).toEqual([
		"ask Relay token: (hidden)",
		`GET ${RELAY}/health`,
		"ws wss://openfabriq-relay.acme.workers.dev/engine Bearer t0",
	]);
	expect(saved()).toEqual({ relay: { url: RELAY, token: "t0" } });
	expect(
		(await connectCommand("relay", relayDeps(), { url: RELAY })).code,
	).toBe(1);
	expect(
		(
			await connectCommand("relay", relayDeps({ token: "t" }), {
				url: "http://relay.acme.dev",
			})
		).code,
	).toBe(1);
});

it("saves nothing when the relay's health check or WebSocket fails", async () => {
	expect(
		await connectCommand("relay", relayDeps({ health: false, token: "t" }), {
			url: RELAY,
		}),
	).toEqual({
		code: 1,
		output: `The relay at ${RELAY} does not answer as expected (GET /health answered 404). Nothing was saved.`,
	});
	expect(calls).toEqual(["ask Relay token: (hidden)", `GET ${RELAY}/health`]);
	socketFrame = undefined;
	expect(
		(await connectCommand("relay", relayDeps({ token: "t" }), { url: RELAY }))
			.output,
	).toContain("/engine closed the WebSocket");
	expect(() => saved()).toThrow();
});

it("waits for a relay just deployed, whose new address answers 404 for a few seconds", async () => {
	const result = await connectCommand("relay", relayDeps({ health: 2 }));
	expect(result.output).toContain(`Relay connected: ${RELAY}.`);
	expect(calls.filter((c) => c.startsWith("GET"))).toHaveLength(3);
	calls.length = 0;
	const never = await connectCommand("relay", relayDeps({ health: false }));
	expect(never.output).toContain("GET /health answered 404");
	expect(calls.filter((c) => c.startsWith("GET"))).toHaveLength(15);
});
