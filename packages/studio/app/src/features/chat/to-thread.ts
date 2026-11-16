import type { AppendMessage, ThreadMessageLike } from "@assistant-ui/react";
import type { ChatMessage } from "./chat-store.js";

// The parts hold JSON from the server: the shape assistant-ui wants.
type Content = Exclude<ThreadMessageLike["content"], string>;

/** A message of the store as assistant-ui shows it: the answer's state and its cost and time. */
export const toThreadMessage = (m: ChatMessage): ThreadMessageLike => {
	if (m.role === "user")
		return {
			id: m.id,
			role: "user",
			createdAt: m.createdAt,
			content: [{ type: "text", text: m.text ?? "" }],
		};
	const turn = m.turn ?? { parts: [], done: false };
	return {
		id: m.id,
		role: "assistant",
		createdAt: m.createdAt,
		content: turn.parts as unknown as Content,
		status: m.running
			? { type: "running" }
			: turn.error === "Stopped."
				? { type: "incomplete", reason: "cancelled" }
				: turn.error
					? { type: "incomplete", reason: "error", error: turn.error }
					: { type: "complete", reason: "stop" },
		metadata: {
			custom: {
				...(turn.costUsd !== undefined ? { costUsd: turn.costUsd } : {}),
				...(turn.durationMs !== undefined
					? { durationMs: turn.durationMs }
					: {}),
			},
		},
	};
};

/** What the person typed: the text parts of a new message, trimmed. */
export const messageText = (message: Pick<AppendMessage, "content">) =>
	message.content
		.map((p) => (p.type === "text" ? p.text : ""))
		.join("\n")
		.trim();
