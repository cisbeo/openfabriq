import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { errorText, exec, secretsPath, writeSecrets } from "@openfabriq/runner";
import { RELAY_DIR } from "../../paths.js";
import type { CommandResult } from "../../result.js";
import { isSafeUrl, RESTART_START, type RelayDeps } from "./shared.js";

// openfabriq connect relay: deploys the relay with wrangler, or checks one already
// deployed. Every service comes through it.

/** The https workers.dev address in wrangler's output file (one JSON object per line). */
function workersDevUrl(ndjson: string): string | undefined {
	for (const line of ndjson.split("\n").filter((l) => l.trim())) {
		const entry = JSON.parse(line) as { type?: string; targets?: string[] };
		if (entry.type === "deploy")
			return entry.targets?.find((t) =>
				/^https:\/\/[^/]+\.workers\.dev\/?$/.test(t),
			);
	}
	return undefined;
}

/** How long a relay just deployed may take to answer: a new workers.dev address answers 404 for a few seconds. */
const FRESH_TRIES = 15;
const FRESH_PAUSE_MS = 2_000;

/**
 * GET /health, then a WebSocket on /engine that must send its first events frame within 10 s.
 * Right after a deploy, /health is asked again for about 30 s before it counts as a failure.
 */
async function checkRelay(
	url: string,
	token: string,
	deps: RelayDeps,
	fresh = false,
): Promise<void> {
	const sleep = deps.sleep ?? wait;
	for (let tries = fresh ? FRESH_TRIES : 1; ; tries--) {
		const health = await (deps.fetch ?? fetch)(`${url}/health`);
		const body = (await health.json().catch(() => ({}))) as { ok?: boolean };
		if (health.ok && body.ok === true) break;
		if (tries <= 1) throw new Error(`GET /health answered ${health.status}`);
		await sleep(FRESH_PAUSE_MS);
	}
	// Node 22's WebSocket (undici) takes headers; the DOM type that wins in this build does not say so.
	const Socket = (deps.WebSocket ?? WebSocket) as unknown as new (
		url: string,
		init: { headers: Record<string, string> },
	) => WebSocket;
	await new Promise<void>((resolve, reject) => {
		const socket = new Socket(`${url.replace(/^http/, "ws")}/engine`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		// Settles once: the handlers are dropped first, since close() can fire them again.
		const settle = (why?: string) => {
			clearTimeout(timer);
			socket.onmessage = socket.onerror = socket.onclose = null;
			socket.close();
			if (why) reject(new Error(why));
			else resolve();
		};
		const timer = setTimeout(
			() => settle("/engine sent nothing within 10 seconds"),
			10_000,
		);
		socket.onmessage = (message) => {
			try {
				const frame = JSON.parse(String(message.data)) as { type?: string };
				if (frame.type === "events") settle();
			} catch {}
		};
		socket.onerror = () =>
			settle("/engine refused the WebSocket (wrong token?)");
		socket.onclose = () => settle("/engine closed the WebSocket");
	});
}

export async function connectRelay(
	deps: RelayDeps,
	options: { url?: string },
): Promise<CommandResult> {
	const relay =
		options.url !== undefined
			? await askExistingRelay(options.url, deps)
			: await deployRelay(deps);
	if ("code" in relay) return relay;
	const { url, token } = relay;
	try {
		await checkRelay(url, token, deps, options.url === undefined);
	} catch (error) {
		return {
			code: 1,
			output: `The relay at ${url} does not answer as expected (${errorText(error)}). Nothing was saved.`,
		};
	}
	writeSecrets("relay", { url, token });
	return {
		code: 0,
		output: `Relay connected: ${url}. Token saved in ${secretsPath()}.\n${RESTART_START}\nNext: "openfabriq connect slack", "linear" or "sentry", or "openfabriq connect webhook <name>".`,
	};
}

/** A relay already running at `given`: its token is asked. */
async function askExistingRelay(
	given: string,
	deps: RelayDeps,
): Promise<{ url: string; token: string } | CommandResult> {
	const url = given.replace(/\/+$/, "");
	// Asked, never a flag: a flag stays in the shell history and shows in ps.
	const token = (await deps.ask("Relay token: ", { secret: true })).trim();
	if (!url || !token || !isSafeUrl(url))
		return {
			code: 1,
			output:
				"--url (https://, http:// only for localhost) and the relay's token are needed. Nothing was saved.",
		};
	return { url, token };
}

/** Deploys the relay with wrangler, with a new token: its workers.dev address and that token. */
async function deployRelay(
	deps: RelayDeps,
): Promise<{ url: string; token: string } | CommandResult> {
	const run = deps.exec ?? exec;
	const dir = deps.relayDir ?? RELAY_DIR;
	try {
		await run("npx", ["wrangler", "whoami", "--json"], { cwd: dir });
	} catch {
		return {
			code: 1,
			output: `Wrangler is not logged in to Cloudflare. Run "npx wrangler login" in ${dir} (a free Cloudflare account is enough), then "openfabriq connect relay" again.\nOr run the relay on a machine of your own (${dir}/docker-compose.yml), then "openfabriq connect relay --url https://<its address>".`,
		};
	}
	const token = (
		deps.randomToken ?? (() => randomBytes(32).toString("base64url"))
	)();
	deps.print("Deploying the relay to your Cloudflare account...");
	// The secrets file holds the token: it lives only during the deploy, even one stopped by Ctrl-C,
	// which ends the process without running finally.
	const tmp = mkdtempSync(join(tmpdir(), "openfabriq-relay-"));
	const signals = deps.signals ?? process;
	const removeTmp = () => rmSync(tmp, { recursive: true, force: true });
	const interrupted = () => {
		removeTmp();
		signals.exit(130);
	};
	signals.once("SIGINT", interrupted);
	signals.once("SIGTERM", interrupted);
	let url: string | undefined;
	try {
		const secretsFile = join(tmp, "secrets.json");
		const outputFile = join(tmp, "output.ndjson");
		writeFileSync(secretsFile, JSON.stringify({ ENGINE_TOKEN: token }), {
			mode: 0o600,
		});
		await run("npx", ["wrangler", "deploy", "--secrets-file", secretsFile], {
			cwd: dir,
			env: { ...process.env, WRANGLER_OUTPUT_FILE_PATH: outputFile },
		});
		url = workersDevUrl(readFileSync(outputFile, "utf8"))?.replace(/\/+$/, "");
	} catch (error) {
		return {
			code: 1,
			output: `The deploy failed (${errorText(error)}). Nothing was saved.`,
		};
	} finally {
		signals.off("SIGINT", interrupted);
		signals.off("SIGTERM", interrupted);
		removeTmp();
	}
	if (!url)
		return {
			code: 1,
			output:
				'The relay is deployed but has no workers.dev address yet. Open the Cloudflare dashboard, "Workers & Pages", once: it creates your workers.dev subdomain. Then run "openfabriq connect relay" again.',
		};
	return { url, token };
}
