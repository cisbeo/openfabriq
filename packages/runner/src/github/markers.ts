import { resourceFolder } from "@openfabriq/core";

// The engine signs what it writes with an invisible HTML comment, to recognise its own actions.

const MARK = "<!-- openfabriq";
const CHANGES = "<!-- openfabriq:changes-requested";

/** `untrusted`: no maintainer started the run; what it writes starts only low-risk or `from: factory` automations. */
const tail = (runId: string, untrusted: boolean) =>
	` run=${runId}${untrusted ? " untrusted" : ""} -->`;

/** Marks already in a body, copied by an agent from the comments it read: only the engine signs. */
const unsigned = (body: string) =>
	body.replace(/\s*<!-- openfabriq[^>]*-->/g, "").trimEnd();

/** The line crediting openfabriq, copied by an agent from the comments it read: the engine adds its own. */
export const withoutCredit = (body: string) =>
	body
		.replace(/\s*(?:-{3,}\s*)?<sub>🤖 Written by [^\n]*?<\/sub>/g, "")
		.trimEnd();

export const sign = (body: string, runId: string, untrusted = false) =>
	`${unsigned(body)}\n\n${MARK}${tail(runId, untrusted)}`;

/**
 * GitHub refuses "request changes" on your own pull request, and the engine acts as the gh user,
 * who opened the factory's pull requests. Such a review is posted as a comment review with this mark.
 */
export const signChangesRequested = (
	body: string,
	runId: string,
	untrusted = false,
) => `${unsigned(body)}\n\n${CHANGES}${tail(runId, untrusted)}`;

export const isFromEngine = (body?: string | null) =>
	body?.includes(MARK) ?? false;
export const isChangesRequested = (body?: string | null) =>
	body?.includes(CHANGES) ?? false;
export const isFromUntrustedRun = (body?: string | null) =>
	/<!-- openfabriq(?::changes-requested)? run=\S+ untrusted -->/.test(
		body ?? "",
	);

const PROJECT = "https://github.com/openfabriq/openfabriq";

/**
 * The line people read under what the engine writes: openfabriq wrote it, with the agent,
 * the automation's file in the repository and the run. Not a link to the run: the studio is local.
 */
export function credit(by: {
	repository: string;
	defaultBranch: string;
	automation: string;
	/** The folder of openfabriq/ the automation is in, like security. */
	area?: string;
	/** Absent for the engine's own words, like a hand-off. */
	agent?: string;
	/** The engine's own automation, like the wiki: it has no file. */
	builtIn?: boolean;
	runId: string;
}): string {
	const folder = resourceFolder(
		"automations",
		encodeURIComponent(by.automation),
		by.area && encodeURIComponent(by.area),
	);
	const file = `https://github.com/${by.repository}/blob/${encodeURI(by.defaultBranch)}/openfabriq/${folder}/automation.md`;
	return `---\n<sub>${[
		`🤖 Written by [openfabriq](${PROJECT})`,
		...(by.agent ? [`agent \`${by.agent}\``] : []),
		by.builtIn
			? `automation \`${by.automation}\``
			: `automation [${by.automation}](${file})`,
		`run \`${by.runId}\``,
	].join(" · ")}</sub>`;
}
