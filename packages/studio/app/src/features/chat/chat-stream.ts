import { describeTool, type ToolSummary } from "@openfabriq/core";
import type { ChatEvent } from "@openfabriq/runner";

/** The events of `POST /api/chat`, one per `data: <json>` line. */
export type { ChatEvent };

/** Splits what arrived so far into whole events, and keeps the unfinished rest for the next chunk. */
export function splitEvents(buffer: string): {
	events: ChatEvent[];
	rest: string;
} {
	const blocks = buffer.replace(/\r\n/g, "\n").split("\n\n");
	const rest = blocks.pop() ?? "";
	const events: ChatEvent[] = [];
	for (const block of blocks) {
		const data = block
			.split("\n")
			.filter((l) => l.startsWith("data:"))
			.map((l) => l.slice(5).trimStart())
			.join("\n");
		if (!data) continue; // comments and keep-alives
		try {
			events.push(JSON.parse(data) as ChatEvent);
		} catch {
			// a line the client does not understand is not worth breaking the answer for
		}
	}
	return { events, rest };
}

type ChatPart =
	| { type: "text"; text: string }
	| { type: "reasoning"; text: string }
	| {
			type: "tool-call";
			toolCallId: string;
			toolName: string;
			args: Record<string, unknown>;
			argsText: string;
			result?: unknown;
			isError?: boolean;
			artifact: ToolSummary;
	  };

export interface ChatTurn {
	parts: ChatPart[];
	sessionId?: string;
	costUsd?: number;
	durationMs?: number;
	error?: string;
	done: boolean;
	/** The person's likely next message. */
	suggestion?: string;
}

/** One event applied to the answer being built. Pure: returns a new turn. */
export function applyEvent(turn: ChatTurn, event: ChatEvent): ChatTurn {
	const parts = [...turn.parts];
	const last = parts.at(-1);
	switch (event.type) {
		case "session":
			return { ...turn, sessionId: event.sessionId };
		case "text":
		case "reasoning":
			if (last?.type === event.type)
				parts[parts.length - 1] = { ...last, text: last.text + event.delta };
			else if (event.delta) parts.push({ type: event.type, text: event.delta });
			return { ...turn, parts };
		case "tool-call": {
			const args =
				event.args && typeof event.args === "object"
					? (event.args as Record<string, unknown>)
					: {};
			parts.push({
				type: "tool-call",
				toolCallId: event.id,
				toolName: event.name,
				args,
				argsText: JSON.stringify(args, null, 2),
				artifact: describeTool(event.name, args),
			});
			return { ...turn, parts };
		}
		case "tool-result":
			return {
				...turn,
				parts: parts.map((p) =>
					p.type === "tool-call" && p.toolCallId === event.id
						? {
								...p,
								result: event.result,
								...(event.isError ? { isError: true } : {}),
							}
						: p,
				),
			};
		case "suggestion":
			return { ...turn, suggestion: event.text };
		case "error":
			// A failed turn still sends `done` with its cost: keep reading.
			return { ...turn, error: event.message };
		case "done":
			return {
				...turn,
				done: true,
				...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
				...(event.durationMs !== undefined
					? { durationMs: event.durationMs }
					: {}),
			};
	}
	return turn;
}

/** What to tell the person when the server refuses the message, by status code. */
export function refusal(status: number, error?: string): string {
	switch (status) {
		case 404:
			return error && !error.startsWith("Not found")
				? error
				: "This server has no chat yet. Update openfabriq and run `openfabriq start` again.";
		case 405:
			return "This server has no chat yet. Update openfabriq and run `openfabriq start` again.";
		case 403:
			return "The server did not recognize this page. Reload it, then send your message again.";
		case 409:
			return (
				error ??
				"The factory is still answering a message for this project. Wait for it, then send yours."
			);
		case 413:
			return "That message is too long. Shorten it and send it again.";
		default:
			return error ?? `The chat failed (${status}).`;
	}
}
