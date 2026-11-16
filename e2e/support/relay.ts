import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./paths.js";

export interface LocalRelay {
	url: string;
	token: string;
	stop(): Promise<void>;
}

export const freePort = () =>
	new Promise<number>((resolve, reject) => {
		const server = createServer();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});

/** The relay of packages/relay, run by wrangler dev with a fresh storage and its own engine token. */
export async function startRelay(): Promise<LocalRelay> {
	const dir = mkdtempSync(join(tmpdir(), "openfabriq-e2e-relay-"));
	const token = `e2e-${Math.random().toString(36).slice(2)}`;
	writeFileSync(join(dir, ".dev.vars"), `ENGINE_TOKEN=${token}\n`);
	const [port, inspector] = [await freePort(), await freePort()];
	return serve(port, token, [
		"wrangler",
		"dev",
		"--ip",
		"127.0.0.1",
		"--port",
		String(port),
		"--inspector-port",
		String(inspector),
		"--env-file",
		join(dir, ".dev.vars"),
		"--persist-to",
		join(dir, "state"),
	]);
}

/**
 * The self-hosted relay: the bundled Worker in workerd alone, with workerd.capnp, as the
 * Docker image runs it. Started again with the same `data` folder and port, it is the same relay.
 */
export async function startSelfHostedRelay(
	data: string,
	port: number,
	token: string,
): Promise<LocalRelay> {
	return serve(
		port,
		token,
		[
			"workerd",
			"serve",
			"workerd.capnp",
			"--socket-addr",
			`http=127.0.0.1:${port}`,
			"--directory-path",
			`data=${data}`,
		],
		{ ENGINE_TOKEN: token },
	);
}

/** Bundles the Worker into packages/relay/dist, for workerd. */
export function bundleRelay(): void {
	const result = spawnSync("pnpm", ["bundle"], {
		cwd: join(ROOT, "packages/relay"),
		encoding: "utf8",
	});
	if (result.status !== 0)
		throw new Error(`pnpm bundle failed:\n${result.stdout}${result.stderr}`);
}

async function serve(
	port: number,
	token: string,
	args: string[],
	env: Record<string, string> = {},
): Promise<LocalRelay> {
	let output = "";
	const child: ChildProcess = spawn("pnpm", ["exec", ...args], {
		cwd: join(ROOT, "packages/relay"),
		env: { ...process.env, ...env },
		// Its own process group: stop() ends pnpm and the workerd it starts.
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const keep = (chunk: Buffer) => {
		output = (output + chunk.toString()).slice(-8000);
	};
	child.stdout?.on("data", keep);
	child.stderr?.on("data", keep);
	const url = `http://127.0.0.1:${port}`;
	const stop = async () => {
		if (child.exitCode !== null || !child.pid) return;
		const exited = new Promise((r) => child.once("exit", r));
		process.kill(-child.pid, "SIGTERM");
		await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
	};
	for (let i = 0; i < 120; i++) {
		const ok = await fetch(`${url}/health`).then(
			(r) => r.ok,
			() => false,
		);
		if (ok) return { url, token, stop };
		if (child.exitCode !== null) break;
		await new Promise((r) => setTimeout(r, 500));
	}
	await stop();
	throw new Error(`the relay did not start:\n${output}`);
}

/** A call to the relay's engine routes, with its token. */
export const relayConfig = (
	relay: LocalRelay,
	path: string,
	body: unknown,
	method = "POST",
) =>
	fetch(`${relay.url}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${relay.token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
