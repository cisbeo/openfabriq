import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parseTranscript } from "../../src/runs/transcript.js";

const fixture = readFileSync(
	join(import.meta.dirname, "../fixtures/transcript.jsonl"),
	"utf8",
);

it("turns a run into one assistant turn, each tool call with its result", () => {
	const { messages } = parseTranscript(fixture);
	expect(messages).toHaveLength(1);
	const [turn] = messages;
	expect(turn?.role).toBe("assistant");
	expect(turn?.createdAt).toBe("2026-10-01T10:00:01.000Z");
	expect(turn?.content.map((p) => p.type)).toEqual([
		"reasoning",
		"text",
		"tool-call",
		"tool-call",
		"tool-call",
		"text",
	]);
	const [read, bash, pr] = (turn?.content ?? []).filter(
		(p) => p.type === "tool-call",
	);
	expect(read).toMatchObject({
		toolCallId: "toolu_read",
		toolName: "Read",
		result: "export const tasks = [];",
		artifact: { title: "Read", detail: "lib/tasks.ts", output: false },
	});
	expect(bash).toMatchObject({
		result: "Exit code 1\n1 test failed",
		isError: true,
		artifact: { title: "Run", detail: "Run the tests" },
	});
	expect(pr).toMatchObject({
		toolName: "mcp__openfabriq__create_pull_request",
		args: { title: "Show the number of tasks left", body: "Closes #9" },
		artifact: {
			title: "Open pull request",
			detail: "Show the number of tasks left",
			output: true,
		},
	});
	// The arguments go once, as args: the app writes them out.
	expect(pr).not.toHaveProperty("argsText");
});

it("leaves out what a person would not read", () => {
	const text = JSON.stringify(parseTranscript(fixture).messages);
	expect(text).not.toContain("subagent chatter"); // a subagent's inner turns
	expect(text).not.toContain("Base directory for this skill"); // skill text loaded by the SDK
	expect(text).not.toContain("cut off"); // a truncated last line
	expect(text).not.toContain("rate_limit");
});

it("times each step and keeps the result", () => {
	const { messages, result } = parseTranscript(fixture);
	const parts = messages[0]?.content ?? [];
	expect(parts.map((p) => p.at)).toEqual([
		"2026-10-01T10:00:01.000Z",
		"2026-10-01T10:00:02.000Z",
		"2026-10-01T10:00:03.000Z",
		"2026-10-01T10:00:06.000Z",
		"2026-10-01T10:00:09.000Z",
		"2026-10-01T10:00:11.000Z",
	]);
	expect(
		parts.map((p) => (p.type === "tool-call" ? p.durationMs : undefined)),
	).toEqual([undefined, undefined, 1000, 2000, 1000, undefined]);
	expect(result).toEqual({
		isError: false,
		text: "I opened a pull request.",
		turns: 4,
	});
});

it("keeps a person's message as a user turn, and an empty transcript empty", () => {
	const lines = [
		{ type: "user", uuid: "a", message: { content: "Why did it fail?" } },
		{
			type: "assistant",
			uuid: "b",
			message: { content: [{ type: "text", text: "Because…" }] },
		},
	].map((l) => JSON.stringify(l));
	expect(parseTranscript(lines.join("\n")).messages.map((m) => m.role)).toEqual(
		["user", "assistant"],
	);
	expect(parseTranscript("")).toEqual({ messages: [] });
});

it("reads every kind of line into the same messages", () => {
	const lines = [
		// No uuid, no time: an id from the message's place.
		{ type: "user", message: { content: "  " } },
		{ type: "user", message: { content: "Start" } },
		{
			type: "assistant",
			uuid: "a1",
			timestamp: "2026-10-01T10:00:00.000Z",
			message: {
				content: [
					{ type: "text", text: "  " },
					{ type: "thinking", thinking: "Hmm" },
					{ type: "tool_use", id: "t1", name: "Read", input: "not an object" },
					{ type: "tool_use", id: "t2" },
					{
						type: "tool_use",
						id: "t3",
						name: "Bash",
						input: { command: "ls" },
					},
				],
			},
		},
		{
			type: "assistant",
			uuid: "a2",
			message: { content: [{ type: "text", text: "Same turn" }] },
		},
		{
			type: "user",
			uuid: "u1",
			timestamp: "2026-10-01T10:00:04.000Z",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "t1",
						content: [{ type: "image" }, { type: "text", text: "x" }, {}],
					},
					{ type: "tool_result", tool_use_id: "unknown", content: "lost" },
					{ type: "tool_result", content: "no id" },
					{ type: "text", text: "A person's words" },
					{ type: "text", text: " " },
				],
			},
		},
		{
			type: "user",
			uuid: "u2",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "t3",
						content: "y".repeat(20_005),
						is_error: true,
					},
				],
			},
		},
		{ type: "user", isSynthetic: true, message: { content: "Synthetic" } },
		{ type: "user", uuid: "u3", message: {} },
		{ type: "assistant", message: { content: "not blocks" } },
		{
			type: "assistant",
			timestamp: "2026-10-01T10:00:09.000Z",
			message: { content: [{ type: "text", text: "New turn" }] },
		},
		{ type: "result", subtype: "error_max_turns", is_error: false },
	].map((l) => JSON.stringify(l));
	expect(parseTranscript(lines.join("\n"))).toEqual({
		messages: [
			{ id: "m0", role: "user", content: [{ type: "text", text: "Start" }] },
			{
				id: "a1",
				role: "assistant",
				createdAt: "2026-10-01T10:00:00.000Z",
				content: [
					{ type: "reasoning", text: "Hmm", at: "2026-10-01T10:00:00.000Z" },
					{
						type: "tool-call",
						toolCallId: "t1",
						toolName: "Read",
						args: {},
						artifact: expect.objectContaining({ title: "Read" }),
						at: "2026-10-01T10:00:00.000Z",
						result: "[image]\nx\n[content]",
						durationMs: 4000,
					},
					{
						type: "tool-call",
						toolCallId: "t3",
						toolName: "Bash",
						args: { command: "ls" },
						artifact: expect.any(Object),
						at: "2026-10-01T10:00:00.000Z",
						result: `${"y".repeat(20_000)}\n… 5 more characters`,
						isError: true,
					},
					{ type: "text", text: "Same turn" },
				],
			},
			{
				id: "u1",
				role: "user",
				createdAt: "2026-10-01T10:00:04.000Z",
				content: [{ type: "text", text: "A person's words" }],
			},
			{
				id: "m3",
				role: "assistant",
				createdAt: "2026-10-01T10:00:09.000Z",
				content: [
					{ type: "text", text: "New turn", at: "2026-10-01T10:00:09.000Z" },
				],
			},
		],
		result: { isError: true },
	});
});
