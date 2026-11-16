import { spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { ROOT } from "./paths.js";

const CLI = join(ROOT, "packages/cli/dist/index.js");
const FAKE_SERVICES = join(ROOT, "e2e/support/fake-services.mjs");
const PTY = join(ROOT, "e2e/support/terminal.py");
const FAKE_GH = join(ROOT, "e2e/support/fake-gh.mjs");

/**
 * Stand-ins for what the CLI starts on this machine (the browser, the clipboard, Claude Code, gh):
 * they record what they were given, and open, copy or start nothing. gh answers from fake-gh.mjs.
 */
export function fakeCommands(): { dir: string; calls: () => string } {
	const dir = mkdtempSync(join(tmpdir(), "openfabriq-e2e-bin-"));
	const log = join(dir, "calls.log");
	const record = (name: string, readsInput: boolean) => {
		writeFileSync(
			join(dir, name),
			`#!/bin/sh\n{ echo "${name} $*"; ${readsInput ? "cat; echo;" : ""} } >> "${log}"\n`,
		);
		chmodSync(join(dir, name), 0o755);
	};
	for (const name of ["open", "xdg-open", "claude"]) record(name, false);
	for (const name of ["pbcopy", "wl-copy", "xclip"]) record(name, true);
	writeFileSync(
		join(dir, "gh"),
		`#!/bin/sh\nE2E_CALLS="${log}" exec "${process.execPath}" "${FAKE_GH}" "$@"\n`,
	);
	chmodSync(join(dir, "gh"), 0o755);
	return {
		dir,
		calls: () => (existsSync(log) ? readFileSync(log, "utf8") : ""),
	};
}

export interface Session {
	/** Waits until the output, without its colors, shows this text. */
	waitFor(text: string | RegExp, timeoutMs?: number): Promise<void>;
	/** Types keys, as a person does: "\r" is Enter, "\u0003" Ctrl-C, "\u007f" Backspace. */
	type(keys: string): void;
	/** Everything printed so far, colors and moves included. */
	raw(): string;
	/** Waits for the command to end. */
	done(): Promise<{ code: number | null; output: string }>;
	stop(): void;
}

/**
 * The built CLI as a person runs it, with this test's engine home. In a terminal, it runs in a
 * pseudo-terminal (terminal.py, with python3), as a terminal app would; otherwise its input and
 * output are pipes, as in CI or Docker.
 */
export function session(
	args: string[],
	options: {
		terminal?: boolean;
		env?: Record<string, string | undefined>;
		path?: string;
		cwd?: string;
	} = {},
): Session {
	const node = [process.execPath, "--import", FAKE_SERVICES, CLI, ...args];
	const [command = "", ...rest] = options.terminal
		? ["python3", "-I", PTY, ...node]
		: node;
	const env: NodeJS.ProcessEnv = {
		...process.env,
		TERM: "xterm-256color",
		NO_COLOR: undefined,
		FORCE_COLOR: undefined,
		...options.env,
		PATH: [options.path, process.env.PATH].filter(Boolean).join(delimiter),
	};
	for (const key of Object.keys(env))
		if (env[key] === undefined) delete env[key];
	const child = spawn(command, rest, {
		env,
		stdio: "pipe",
		...(options.cwd ? { cwd: options.cwd } : {}),
	});
	let output = "";
	child.stdout.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	child.stderr.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	const exited = new Promise<number | null>((resolve) =>
		child.on("exit", (code) => resolve(code)),
	);
	const plain = () => stripVTControlCharacters(output).replaceAll("\r", "");
	return {
		async waitFor(text, timeoutMs = 20_000) {
			const deadline = Date.now() + timeoutMs;
			const found = () =>
				typeof text === "string" ? plain().includes(text) : text.test(plain());
			while (!found()) {
				if (Date.now() > deadline || child.exitCode !== null)
					throw new Error(`"${text}" never showed. The output:\n${plain()}`);
				await new Promise((r) => setTimeout(r, 50));
			}
		},
		type(keys) {
			child.stdin.write(keys);
		},
		raw: () => output,
		async done() {
			const code = await exited;
			return { code, output: plain().trim() };
		},
		stop() {
			child.kill();
		},
	};
}
