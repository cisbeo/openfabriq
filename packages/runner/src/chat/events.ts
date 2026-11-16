import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { SERVER } from "./tools.js";

/** What a chat turn streams to the app. */
export type ChatEvent =
	| { type: "session"; sessionId: string }
	| { type: "text"; delta: string }
	| { type: "reasoning"; delta: string }
	| { type: "tool-call"; id: string; name: string; args: unknown }
	| { type: "tool-result"; id: string; result: unknown; isError?: boolean }
	| { type: "done"; costUsd: number; durationMs: number }
	/** The person's likely next message, after `done`. */
	| { type: "suggestion"; text: string }
	| { type: "error"; message: string };

/**
 * SDK message → chat events. Text and reasoning come from the streamed deltas; the complete
 * assistant message that follows only adds its tool calls. `costBefore` is what the session
 * had cost before this turn: a resumed session's result carries the running total.
 */
export function toChatEvents(message: SDKMessage, costBefore = 0): ChatEvent[] {
	if (message.type === "system" && message.subtype === "init")
		return [{ type: "session", sessionId: message.session_id }];
	if (message.type === "result") {
		const done: ChatEvent = {
			type: "done",
			costUsd: Math.max(0, message.total_cost_usd - costBefore),
			durationMs: message.duration_ms,
		};
		if (message.subtype === "success") return [done];
		const reason =
			message.subtype === "error_max_budget_usd"
				? "stopped at the cost limit of the factory (usd_per_run)"
				: [message.subtype, ...message.errors].join(": ");
		return [{ type: "error", message: reason }, done];
	}
	if (message.type === "prompt_suggestion")
		return message.suggestion.trim()
			? [{ type: "suggestion", text: message.suggestion.trim() }]
			: [];
	if (
		(message.type === "stream_event" ||
			message.type === "assistant" ||
			message.type === "user") &&
		message.parent_tool_use_id
	)
		return [];
	if (message.type === "stream_event") {
		const event = message.event;
		if (event.type !== "content_block_delta") return [];
		// Some models stream their thinking as empty deltas: nothing to show.
		if (event.delta.type === "text_delta" && event.delta.text)
			return [{ type: "text", delta: event.delta.text }];
		if (event.delta.type === "thinking_delta" && event.delta.thinking)
			return [{ type: "reasoning", delta: event.delta.thinking }];
		return [];
	}
	if (message.type === "assistant")
		return message.message.content.flatMap((block) =>
			block.type === "tool_use"
				? [
						{
							type: "tool-call" as const,
							id: block.id,
							name: block.name.replace(`mcp__${SERVER}__`, ""),
							args: block.input,
						},
					]
				: [],
		);
	if (message.type === "user" && Array.isArray(message.message.content))
		return message.message.content.flatMap((block) =>
			block.type === "tool_result"
				? [
						{
							type: "tool-result" as const,
							id: block.tool_use_id,
							result:
								typeof block.content === "string"
									? block.content
									: (block.content ?? [])
											.map((c) => (c.type === "text" ? c.text : `[${c.type}]`))
											.join("\n"),
							...(block.is_error ? { isError: true } : {}),
						},
					]
				: [],
		);
	return [];
}
