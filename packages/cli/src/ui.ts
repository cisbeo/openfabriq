import { styleText } from "node:util";
import type { CommandResult } from "./result.js";

// How the CLI looks in a terminal. Commands return plain text, which tests read; it is
// styled here, only when printed to a terminal with colors. Pipes, CI, Docker logs and NO_COLOR
// get the plain text.

// Three facts about where the CLI runs, from the widest to the narrowest:
// - canAsk: someone at a terminal can answer a question, with or without colors;
// - styled: the output is a terminal with colors, whatever reads the input;
// - drawsPrompts: both, so questions are drawn by @clack/prompts.

/** stdin and stdout are a terminal, colors or not: someone can answer a question. */
export const canAsk = Boolean(process.stdin.isTTY && process.stdout.isTTY);

/** stdout is a terminal that shows colors: not a pipe, not NO_COLOR, not TERM=dumb. */
export const styled = Boolean(
	process.stdout.isTTY && process.stdout.hasColors?.(),
);

/** Someone types the answers in a terminal with colors: prompts are drawn by @clack/prompts. */
export const drawsPrompts = styled && Boolean(process.stdin.isTTY);

/** Prints a command's text, styled in a terminal with colors. */
export const print = (text: string) => console.log(styled ? paint(text) : text);

type Format = Parameters<typeof styleText>[0];
const paintWith = (format: Format, text: string) =>
	styleText(format, text, { validateStream: false });

/** The studio's blue (packages/studio's --accent), when the terminal has 24-bit colors. */
export const brand = (text: string) =>
	process.stdout.getColorDepth?.() >= 24
		? `\u001b[38;2;42;102;219m${text}\u001b[39m`
		: paintWith("blue", text);

export const dim = (text: string) => paintWith("dim", text);

/** The docs' mark, a factory roof, then the name and what the command does. */
export function header(subtitle = ""): string {
	const mark = ["      ███", "█▄ █▄ ███", "█████████"];
	const right = [
		"",
		paintWith("bold", "openfabriq"),
		subtitle && dim(subtitle),
	];
	return `\n${mark.map((m, i) => `  ${brand(m)}  ${right[i]}`.trimEnd()).join("\n")}\n`;
}

const SIGNS: Record<string, Format> = {
	"✓": "green",
	"+": "green",
	"✗": "red",
	"-": "red",
	"!": "yellow",
	"~": "yellow",
};

/** The status of a run, as "openfabriq status" lists them and "openfabriq start" logs them. */
const RUN_STATUS: Record<string, Format> = {
	succeeded: "green",
	failed: "red",
	running: "blue",
	started: "blue",
	queued: "yellow",
	skipped: "dim",
};

/** Commands to type and addresses, in the brand's blue. */
const inline = (text: string) =>
	text.replace(
		/"openfabriq [^"]*"|https?:\/\/[^\s"')]*[^\s"').,:;]/g,
		(found) => brand(found),
	);

function paintLine(line: string, next: string | undefined): string {
	const sign = /^(\s*)([✓✗!+~-]) (.*)$/.exec(line);
	if (sign) {
		const [, indent = "", mark = "", rest = ""] = sign;
		return `${indent}${paintWith(SIGNS[mark] ?? "reset", mark)} ${inline(rest)}`;
	}
	const run = /^( {4}|)(\w+)( .*)$/.exec(line);
	if (run && RUN_STATUS[run[2] ?? ""])
		return `${run[1]}${paintWith(RUN_STATUS[run[2] ?? ""] ?? "reset", run[2] ?? "")}${run[3]}`;
	if (line.startsWith("Security changes"))
		return paintWith(["bold", "red"], line);
	// A title: the indented lines under it are its items (plan sections, usage, steps).
	if (/^[^\s]/.test(line) && next?.startsWith("  "))
		return paintWith("bold", inline(line));
	if (line.startsWith("Plan: ")) return paintWith("bold", line);
	if (/^(Next:|If "openfabriq)/.test(line)) return dim(line);
	return inline(line);
}

/** The plain output of a command, with colors that each have one role. Strips back to the same text. */
export function paint(text: string): string {
	const lines = text.split("\n");
	return lines.map((line, i) => paintLine(line, lines[i + 1])).join("\n");
}

/** The usage, painted, with each command's name in the brand's blue. */
export const paintUsage = (text: string) =>
	paint(
		text.replace(
			/^ {2}(\S.*?)(?= {2,}|$)/gm,
			(_, command: string) => `  ${brand(command)}`,
		),
	);

/** What a command ends with: its output, led by ✓ or ✗ when it says how the command went. */
export function outcome(result: CommandResult, marked: boolean): string {
	const { code, output } = result;
	const lead =
		output &&
		!/^[✓✗!]/.test(output) &&
		!output.startsWith("Usage:") &&
		(code !== 0 || marked)
			? `${code === 0 ? "✓" : "✗"} `
			: "";
	return paint(`${lead}${output}`);
}
