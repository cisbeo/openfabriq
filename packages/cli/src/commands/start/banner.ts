import type { WikiView } from "@openfabriq/runner";
import type { StudioAccess } from "@openfabriq/studio";
import { brand, dim } from "../../ui.js";

// What "start" says when it starts: the studio's address and what the engine watches, as a block
// in a terminal or as log lines in a pipe, and the hints it logs once.

/** What "start" says when it starts. */
export interface StartFacts {
	address: string;
	watching: string[];
	everySeconds: number;
	claude: string;
	/** Where and how to sign in, when the studio has a password or GitHub: "<address> with GitHub". */
	signIn?: string;
}

/** Where and how to sign in to the studio, when it has a password or GitHub. */
export function signInAddress(access: StudioAccess, port: number) {
	const how = [
		...(access.github ? ["GitHub"] : []),
		...(access.password ? ["OPENFABRIQ_STUDIO_PASSWORD"] : []),
	].join(" or ");
	return how
		? `${access.url?.origin ?? `http://127.0.0.1:${port}`} with ${how}`
		: undefined;
}

/** The hint under the studio's address. */
const STUDIO_HINT = "open it to follow the runs · Ctrl-C stops the engine";

/** The words of `text` in lines of at most `width` characters; a longer word stays whole. */
function wrapWords(text: string, width: number): string[] {
	const lines: string[] = [];
	for (const word of text.split(" ")) {
		const last = lines.at(-1);
		if (last !== undefined && `${last} ${word}`.length <= width)
			lines[lines.length - 1] = `${last} ${word}`;
		else lines.push(word);
	}
	return lines;
}

/**
 * What "start" shows first in a terminal: the studio's address, then what the engine watches, in
 * `width` columns. Values wrap under themselves, never under their label; the address is never cut,
 * or it would not open from the terminal: when it does not fit after its label, it gets its own line.
 */
export function startBlock(facts: StartFacts, width = 80): string[] {
	const indent = 12;
	const row = (label: string, lines: string[]) =>
		lines.map(
			(line, i) => `  ${(i === 0 ? label : "").padEnd(indent - 2)}${line}`,
		);
	const room = Math.max(20, width - indent);
	const every = `every ${facts.everySeconds} s`;
	const watching = `${facts.watching.join(", ")}, ${every}`;
	return [
		...(indent + facts.address.length <= width
			? row("Studio", [facts.address, STUDIO_HINT])
			: [...row("Studio", wrapWords(STUDIO_HINT, room)), `  ${facts.address}`]),
		...(facts.signIn ? row("Sign in", wrapWords(facts.signIn, room)) : []),
		...row(
			"Watching",
			watching.length <= room ? [watching] : [...facts.watching, every],
		),
		...row("Claude", wrapWords(facts.claude.replace(/^Claude: /, ""), room)),
	];
}

/** Prints the start block, its address and hint styled, then the title of the log. */
export function announce(facts: StartFacts) {
	const block = startBlock(
		facts,
		process.stdout.columns || 80, // 0 in some terminals that do not say their size
	);
	console.log(
		[
			"",
			...block.map((line) =>
				line
					.replace(facts.address, brand(facts.address))
					.replace(STUDIO_HINT, dim(STUDIO_HINT)),
			),
			"",
			dim("  ── activity ──"),
		].join("\n"),
	);
}

/** What "start" logs first when its output is no terminal: a pipe or Docker keeps the lines. */
export function plainStartLines(facts: StartFacts): string[] {
	return [
		`watching ${facts.watching.join(", ")} every ${facts.everySeconds} s`,
		facts.claude,
		`studio on ${facts.address}`,
		...(facts.signIn ? [`studio: sign in at ${facts.signIn}`] : []),
	];
}

/**
 * A wiki that is on but was never generated: nothing runs until someone asks, so say how, once
 * per start. Silent once it exists, when it is off, or before the clone has the default branch.
 */
export function wikiHint(
	repository: string,
	view: WikiView | undefined,
): string | undefined {
	if (!view?.commit || view.pages.includes("index.md")) return undefined;
	return `${repository}: no wiki yet. Generate it on the studio's Wiki page or with "openfabriq run wiki"; removing "wiki" from factory.yaml turns it off.`;
}
