import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { cancel, confirm, isCancel, password, text } from "@clack/prompts";
import { drawsPrompts } from "./ui.js";

// How the CLI asks: drawn by @clack/prompts for a person at a terminal with colors, plain
// readline otherwise, and one line per question when the answers are piped in.

/** "y" or "yes", whatever the case, is a yes; Enter alone or anything else is a no. */
export const isYes = (answer: string) =>
	["y", "yes"].includes(answer.trim().toLowerCase());

/** Asks on the terminal, no by default. */
export async function terminalConfirm(question: string): Promise<boolean> {
	if (drawsPrompts) return promptConfirm(question);
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await rl.question(`${question} [y/N] `);
	rl.close();
	return isYes(answer);
}

/** A yes or no drawn by @clack/prompts, no by default; Escape is a no. */
async function promptConfirm(question: string): Promise<boolean> {
	const value = await confirm({
		message: question,
		initialValue: false,
		withGuide: false,
	});
	return value === true;
}

/** A question drawn by @clack/prompts; a secret answer shows as dots. */
async function promptAsk(
	question: string,
	options: { secret?: boolean; initial?: string },
): Promise<string> {
	const message = question.replace(/:\s*$/, "");
	const value = options.secret
		? await password({ message, withGuide: false })
		: await text({
				message,
				withGuide: false,
				...(options.initial ? { initialValue: options.initial } : {}),
			});
	// Escape or Ctrl-C stops the command, as Ctrl-C did before.
	if (isCancel(value)) {
		cancel("Cancelled.", { withGuide: false });
		process.exit(130);
	}
	return value ?? "";
}

/** A terminal can wrap pasted text in bracketed-paste marks (ESC[200~ … ESC[201~): a secret must not keep them. */
export const withoutPasteMarks = (text: string) =>
	text.replaceAll("\u001b[200~", "").replaceAll("\u001b[201~", "");

/**
 * Answers piped in, one line per question. One reader for the whole command: a reader per
 * question would drop the lines it read ahead, such as a token sent with the URL before it.
 */
interface PipedAnswers {
	lines: string[];
	ended: boolean;
	waiting?: ((line: string | undefined) => void) | undefined;
	pause(): void;
	resume(): void;
}
let piped: PipedAnswers | undefined;

function pipedLine(): Promise<string | undefined> {
	if (!piped) {
		const rl = createInterface({ input: process.stdin, terminal: false });
		const state: PipedAnswers = {
			lines: [],
			ended: false,
			// Paused and unreferenced between questions: the command ends while the pipe stays open.
			pause: () => {
				// Once the pipe has ended, the interface is closed: pausing it would throw.
				if (!state.ended) rl.pause();
				(process.stdin as { unref?: () => void }).unref?.();
			},
			resume: () => {
				(process.stdin as { ref?: () => void }).ref?.();
				rl.resume();
			},
		};
		rl.on("line", (line) => {
			const waiting = state.waiting;
			state.waiting = undefined;
			if (waiting) waiting(line);
			else state.lines.push(line);
		});
		rl.on("close", () => {
			state.ended = true;
			state.waiting?.(undefined);
		});
		piped = state;
	}
	const state = piped;
	if (state.lines.length || state.ended) {
		state.pause();
		return Promise.resolve(state.lines.shift());
	}
	state.resume();
	return new Promise((resolve) => {
		state.waiting = (line) => {
			state.pause();
			resolve(line);
		};
	});
}

/** Asks in the terminal; a secret answer is not echoed. */
export async function terminalAsk(
	question: string,
	options: { secret?: boolean; initial?: string } = {},
): Promise<string> {
	if (drawsPrompts)
		return withoutPasteMarks(await promptAsk(question, options));
	if (!process.stdin.isTTY) {
		process.stdout.write(question);
		const line = await pipedLine();
		process.stdout.write("\n");
		return withoutPasteMarks(line ?? "");
	}
	let muted = false;
	const output = new Writable({
		write(chunk, encoding, done) {
			if (!muted) process.stdout.write(chunk, encoding);
			done();
		},
	});
	const rl = createInterface({ input: process.stdin, output, terminal: true });
	const answer = rl.question(question);
	// Typed in only for a person: piped answers would come after it, on the same line.
	if (options.initial && !options.secret && process.stdin.isTTY)
		rl.write(options.initial);
	muted = options.secret === true;
	try {
		return withoutPasteMarks(await answer);
	} finally {
		rl.close();
		if (muted) process.stdout.write("\n");
	}
}

/** The clipboard command of each system: pbcopy, clip, then Wayland's or X11's. */
const CLIPBOARD: Record<string, [string, string[]][]> = {
	darwin: [["pbcopy", []]],
	win32: [["clip", []]],
	linux: [
		["wl-copy", []],
		["xclip", ["-selection", "clipboard"]],
	],
};

export async function copyToClipboard(text: string): Promise<boolean> {
	for (const [command, args] of CLIPBOARD[process.platform] ?? []) {
		const copied = await new Promise<boolean>((resolve) => {
			const child = spawn(command, args, {
				stdio: ["pipe", "ignore", "ignore"],
			});
			child.on("error", () => resolve(false));
			child.on("close", (code) => resolve(code === 0));
			child.stdin.end(text);
		});
		if (copied) return true;
	}
	return false;
}
