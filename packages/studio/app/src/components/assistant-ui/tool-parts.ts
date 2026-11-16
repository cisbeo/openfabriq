import {
	isOutputTool,
	OUTPUT_TOOL_PREFIX,
	type ToolSummary,
} from "@openfabriq/core";

// What the thread reads from a tool call: its name in words, the output it proposes, the
// runs it read. Pure, shared by the chat and the run's page.

export interface ToolCallPart {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	argsText?: string;
	result?: unknown;
	isError?: boolean;
	artifact?: unknown;
	status?: { type: string };
}

export const summaryOf = (part: ToolCallPart): ToolSummary =>
	(part.artifact as ToolSummary | undefined) ?? {
		title: part.toolName,
		output: isOutput(part.toolName),
	};

/** A proposed output's action: `mcp__openfabriq__add_labels` → `add_labels`. */
export const actionOf = (name: string) => name.replace(OUTPUT_TOOL_PREFIX, "");

export const isOutput = isOutputTool;

/** A result as text: a string as it is, anything else as indented JSON. */
export const show = (value: unknown) =>
	typeof value === "string" ? value : JSON.stringify(value, null, 2);

/** Whether an outcome is the one of this proposal: same action, and the same summary, except a merge, one per run, whose summary is the engine's. */
export const isOutcomeOf = (
	o: { action: string; summary: string },
	action: string,
	args: Record<string, unknown>,
) =>
	o.action === action &&
	(action === "merge_pull_request" ||
		o.summary === outcomeSummary(action, args));

/** What the runner records as an outcome's summary, to find the outcome of a proposal. */
export function outcomeSummary(
	action: string,
	a: Record<string, unknown>,
): string {
	if (Array.isArray(a.labels)) return a.labels.join(", ");
	if (action === "create_pull_request" || action === "create_issue")
		return String(a.title ?? "");
	if (action === "push_to_pull_request") return String(a.summary ?? "");
	return (String(a.body ?? "").split("\n")[0] ?? "").slice(0, 120);
}

/** What a proposal's card shows under its title; nothing when the proposal has no text (a merge, a close). */
export function outputBody(
	part: { toolName: string; args: Record<string, unknown> },
	outcome:
		| { status: string; summary: string; reason?: string; removed?: string[] }
		| undefined,
) {
	const a = part.args;
	const body = typeof a.body === "string" ? a.body : undefined;
	const heading =
		typeof a.title === "string"
			? a.title
			: typeof a.summary === "string"
				? a.summary
				: undefined;
	const proposed = Array.isArray(a.labels) ? a.labels.map(String) : undefined;
	// A removal the engine reported: only the labels it really took off.
	const removed = outcome?.removed;
	const labels = removed ? (removed.length ? removed : undefined) : proposed;
	// A merge has no text of its own: the engine's result says what happened.
	const result =
		actionOf(part.toolName) === "merge_pull_request" &&
		outcome?.status === "applied"
			? outcome.summary
			: removed?.length === 0
				? "Nothing to remove."
				: undefined;
	const refusal =
		outcome?.reason && outcome.status !== "applied"
			? outcome.reason
			: undefined;
	const empty = !heading && !labels && !body && !result && !refusal;
	return { heading, labels, body, result, refusal, empty };
}

/** A folded block of steps in one line: its first four titles, and how many more. */
export function stepsLine(calls: ToolCallPart[]): string {
	const titles = calls.map((c) => {
		const { title, detail } = summaryOf(c);
		return detail ? `${title} ${detail}` : title;
	});
	return `${titles.slice(0, 4).join(" · ")}${titles.length > 4 ? ` · +${titles.length - 4}` : ""}`;
}

/** The runs a chat tool read (`list_runs`, `read_run`), to open them in the app. */
export function runIds(part: ToolCallPart): string[] {
	const ids = new Set<string>();
	for (const key of ["id", "runId", "run_id"])
		if (part.toolName === "read_run" && typeof part.args[key] === "string")
			ids.add(part.args[key] as string);
	let result = part.result;
	if (typeof result === "string")
		try {
			result = JSON.parse(result);
		} catch {
			// a text answer: nothing to link
		}
	const list = Array.isArray(result)
		? result
		: result && typeof result === "object" && "runs" in result
			? (result as { runs: unknown }).runs
			: [];
	for (const item of Array.isArray(list) ? list : [])
		if (item && typeof item === "object" && typeof item.id === "string")
			ids.add(item.id);
	return [...ids].slice(0, 12);
}
