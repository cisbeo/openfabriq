import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectDir } from "@openfabriq/runner";

interface Block {
	type: string;
	name?: string;
	input?: unknown;
	content?: unknown;
	is_error?: boolean;
}

/** The tool calls of a run, with what each returned, read from its transcript. */
export function toolCalls(repository: string, runId: string) {
	const lines = readFileSync(
		join(projectDir(repository), "runs", runId, "transcript.jsonl"),
		"utf8",
	)
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l));
	const blocks = (type: string) =>
		lines
			.filter((m) => m.type === type)
			.flatMap((m) => (m.message?.content ?? []) as Block[]);
	const results = new Map(
		blocks("user")
			.filter((b) => b.type === "tool_result")
			.map((b) => [
				(b as Block & { tool_use_id: string }).tool_use_id,
				{
					text: JSON.stringify(b.content ?? ""),
					error: b.is_error === true,
				},
			]),
	);
	return blocks("assistant")
		.filter((b) => b.type === "tool_use")
		.map((b) => {
			const result = results.get((b as Block & { id: string }).id);
			return {
				name: b.name ?? "",
				input: JSON.stringify(b.input ?? {}),
				result: result?.text ?? "",
				error: result?.error ?? true,
			};
		});
}
