import { describeTool, type ToolSummary } from "@openfabriq/core";
import { jsonLines } from "@openfabriq/runner";

/**
 * A run's conversation, shaped like assistant-ui's `ThreadMessageLike` (JSON, with
 * `createdAt` as an ISO string), each part with the time it was written.
 */
export type TranscriptPart =
	| { type: "text"; text: string; at?: string }
	| { type: "reasoning"; text: string; at?: string }
	| {
			type: "tool-call";
			at?: string;
			/** From the call to its result. */
			durationMs?: number;
			toolCallId: string;
			toolName: string;
			args: Record<string, unknown>;
			result?: string;
			isError?: boolean;
			/** How to name the call; `output` marks the tools that propose an output to the engine. */
			artifact: ToolSummary;
	  };

export interface TranscriptMessage {
	id: string;
	role: "user" | "assistant";
	createdAt?: string;
	content: TranscriptPart[];
}

export interface Transcript {
	messages: TranscriptMessage[];
	/** The SDK's closing message, when the run got that far. */
	result?: { isError: boolean; text?: string; turns?: number };
}

interface Block {
	type: string;
	text?: string;
	thinking?: string;
	id?: string;
	name?: string;
	input?: unknown;
	tool_use_id?: string;
	content?: unknown;
	is_error?: boolean;
}

interface Line {
	type?: string;
	subtype?: string;
	uuid?: string;
	timestamp?: string;
	isSynthetic?: boolean;
	parent_tool_use_id?: string | null;
	message?: { content?: string | Block[] };
	is_error?: boolean;
	result?: string;
	num_turns?: number;
}

/** Tool results can be whole files: enough to read, not enough to freeze the page. */
const MAX_RESULT = 20_000;

function resultText(content: unknown): string {
	const text =
		typeof content === "string"
			? content
			: Array.isArray(content)
				? content
						.map((c: { type?: string; text?: string }) =>
							c.type === "text" ? (c.text ?? "") : `[${c.type ?? "content"}]`,
						)
						.join("\n")
				: "";
	return text.length > MAX_RESULT
		? `${text.slice(0, MAX_RESULT)}\n… ${text.length - MAX_RESULT} more characters`
		: text;
}

type ToolCall = Extract<TranscriptPart, { type: "tool-call" }>;

/** The SDK's closing message. */
const closing = (line: Line): NonNullable<Transcript["result"]> => ({
	isError: line.is_error === true || line.subtype !== "success",
	...(line.result ? { text: line.result } : {}),
	...(line.num_turns !== undefined ? { turns: line.num_turns } : {}),
});

/** What an assistant line says, thinks and calls, each part with the line's time; empty text and thinking left out. */
function assistantParts(blocks: Block[], timestamp?: string): TranscriptPart[] {
	const at = timestamp ? { at: timestamp } : {};
	return blocks.flatMap((block): TranscriptPart[] => {
		if (block.type === "text" && block.text?.trim())
			return [{ type: "text", text: block.text, ...at }];
		if (block.type === "thinking" && block.thinking?.trim())
			return [{ type: "reasoning", text: block.thinking, ...at }];
		if (block.type === "tool_use" && block.id && block.name) {
			const args =
				block.input && typeof block.input === "object"
					? (block.input as Record<string, unknown>)
					: {};
			return [
				{
					type: "tool-call",
					toolCallId: block.id,
					toolName: block.name,
					// No argsText: the app writes it from args, and a run's page is read every few seconds.
					args,
					artifact: describeTool(block.name, args),
					...at,
				},
			];
		}
		return [];
	});
}

/** The tool call, already in its message, gets its result and how long it took. */
function addResult(
	call: ToolCall | undefined,
	block: Block,
	timestamp?: string,
): void {
	if (!call) return;
	call.result = resultText(block.content);
	if (block.is_error) call.isError = true;
	if (call.at && timestamp)
		call.durationMs =
			new Date(timestamp).getTime() - new Date(call.at).getTime();
}

/**
 * A user line: the person's words, as new messages numbered from `count`, or the results of
 * the tool calls in `calls`, added to them. Text the SDK wrote itself (isSynthetic) is left out.
 */
function userLine(
	line: Line,
	calls: Map<string, ToolCall>,
	count: number,
): TranscriptMessage[] {
	const content = line.message?.content;
	const said = (text: string, i: number): TranscriptMessage => ({
		id: line.uuid ?? `m${count + i}`,
		role: "user",
		...(line.timestamp ? { createdAt: line.timestamp } : {}),
		content: [{ type: "text", text }],
	});
	if (typeof content === "string")
		return !line.isSynthetic && content.trim() ? [said(content, 0)] : [];
	const texts: string[] = [];
	for (const block of content ?? []) {
		if (block.type === "tool_result" && block.tool_use_id)
			addResult(calls.get(block.tool_use_id), block, line.timestamp);
		else if (block.type === "text" && !line.isSynthetic && block.text?.trim())
			texts.push(block.text);
	}
	return texts.map(said);
}

/**
 * transcript.jsonl (one Agent SDK message per line) → the messages of a read-only thread,
 * each part with its time. Each tool call carries its result and how long it took. What the person would not read
 * (system lines, rate limits, empty thinking, skill text loaded by the SDK, a subagent's
 * inner turns) is left out.
 */
export function parseTranscript(jsonl: string): Transcript {
	const messages: TranscriptMessage[] = [];
	// The calls by id, for the results that come in later lines.
	const calls = new Map<string, ToolCall>();
	let result: Transcript["result"];

	/** Consecutive assistant lines make one message, like one turn of a Claude Code session. */
	const assistant = (line: Line): TranscriptMessage => {
		const last = messages.at(-1);
		if (last?.role === "assistant") return last;
		const message: TranscriptMessage = {
			id: line.uuid ?? `m${messages.length}`,
			role: "assistant",
			...(line.timestamp ? { createdAt: line.timestamp } : {}),
			content: [],
		};
		messages.push(message);
		return message;
	};

	// A run killed mid-write leaves a truncated last line: skipped.
	for (const line of jsonLines<Line>(jsonl)) {
		if (line.parent_tool_use_id) continue;
		const content = line.message?.content;
		if (line.type === "result") result = closing(line);
		else if (line.type === "assistant" && Array.isArray(content))
			for (const part of assistantParts(content, line.timestamp)) {
				if (part.type === "tool-call") calls.set(part.toolCallId, part);
				assistant(line).content.push(part);
			}
		else if (line.type === "user")
			messages.push(...userLine(line, calls, messages.length));
	}
	return { messages, ...(result ? { result } : {}) };
}
