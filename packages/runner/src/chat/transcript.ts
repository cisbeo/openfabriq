import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { jsonLines } from "../files.js";

export const cut = (text: string, max: number) =>
	text.length > max
		? `${text.slice(0, max)}… (${text.length - max} more characters)`
		: text;

/** A run's transcript as a few readable lines, the end kept when it is too long. */
export function condenseTranscript(jsonl: string, max = 30_000): string {
	const lines: string[] = [];
	for (const m of jsonLines<SDKMessage>(jsonl)) {
		if (m.type === "assistant")
			for (const b of m.message.content) {
				if (b.type === "text") lines.push(`agent: ${cut(b.text, 1500)}`);
				if (b.type === "tool_use")
					lines.push(`→ ${b.name} ${cut(JSON.stringify(b.input), 400)}`);
			}
		if (m.type === "user" && Array.isArray(m.message.content))
			for (const b of m.message.content)
				if (b.type === "tool_result") {
					const text =
						typeof b.content === "string"
							? b.content
							: JSON.stringify(b.content ?? "");
					lines.push(`← ${b.is_error ? "error: " : ""}${cut(text, 400)}`);
				}
		if (m.type === "result")
			lines.push(
				`end: ${[m.subtype, ...(m.subtype === "success" ? [] : m.errors)].join(": ")}, ${m.total_cost_usd.toFixed(2)} USD, ${m.num_turns} turns`,
			);
	}
	const text = lines.join("\n");
	return text.length > max
		? `… (earlier steps cut)\n${text.slice(-max)}`
		: text;
}
