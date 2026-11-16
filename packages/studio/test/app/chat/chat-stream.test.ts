import { expect, it } from "vitest";
import {
	applyEvent,
	type ChatTurn,
	refusal,
	splitEvents,
} from "../../../app/src/features/chat/chat-stream.js";

const sse = (...events: object[]) =>
	events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

it("splits a stream into events, keeping an event cut between two chunks", () => {
	const whole = sse(
		{ type: "session", sessionId: "s1" },
		{ type: "text", delta: "Hel" },
	);
	const first = splitEvents(whole.slice(0, 50));
	expect(first.events).toEqual([{ type: "session", sessionId: "s1" }]);
	const second = splitEvents(first.rest + whole.slice(50));
	expect(second.events).toEqual([{ type: "text", delta: "Hel" }]);
	expect(second.rest).toBe("");
	expect(splitEvents(": keep-alive\n\ndata: {oops\n\n").events).toEqual([]);
});

it("builds the answer: text, reasoning, tool calls with their results, cost", () => {
	const events = splitEvents(
		sse(
			{ type: "session", sessionId: "s1" },
			{ type: "reasoning", delta: "Look at " },
			{ type: "reasoning", delta: "the runs." },
			{
				type: "tool-call",
				id: "t1",
				name: "list_runs",
				args: { status: "failed" },
			},
			{ type: "tool-result", id: "t1", result: [{ id: "r1" }] },
			{ type: "text", delta: "One run " },
			{ type: "text", delta: "failed." },
			{ type: "done", costUsd: 0.04, durationMs: 1200 },
		),
	).events;
	const turn = events.reduce(applyEvent, {
		parts: [],
		done: false,
	} as ChatTurn);
	expect(turn).toMatchObject({
		sessionId: "s1",
		costUsd: 0.04,
		durationMs: 1200,
		done: true,
	});
	expect(turn.parts).toEqual([
		{ type: "reasoning", text: "Look at the runs." },
		{
			type: "tool-call",
			toolCallId: "t1",
			toolName: "list_runs",
			args: { status: "failed" },
			argsText: JSON.stringify({ status: "failed" }, null, 2),
			result: [{ id: "r1" }],
			artifact: { title: "List failed runs", output: false },
		},
		{ type: "text", text: "One run failed." },
	]);
});

it("keeps reading after an error, to get the cost of the failed turn", () => {
	const turn = splitEvents(
		sse(
			{ type: "error", message: "Budget reached" },
			{ type: "done", costUsd: 0.5 },
		),
	).events.reduce(applyEvent, { parts: [], done: false } as ChatTurn);
	expect(turn).toEqual({
		parts: [],
		error: "Budget reached",
		costUsd: 0.5,
		done: true,
	});
});

it("keeps the suggested next message, which comes after the end of the turn", () => {
	const turn = splitEvents(
		sse(
			{ type: "text", delta: "Done." },
			{ type: "done", costUsd: 0.1 },
			{ type: "suggestion", text: "Show the failed run" },
		),
	).events.reduce(applyEvent, { parts: [], done: false } as ChatTurn);
	expect(turn).toMatchObject({
		done: true,
		suggestion: "Show the failed run",
	});
});

it("explains a refusal in words", () => {
	expect(refusal(409, "A message is already running for acme/shop.")).toBe(
		"A message is already running for acme/shop.",
	);
	expect(refusal(404, "Not found.")).toContain("no chat yet");
	expect(refusal(404, "Unknown project acme/shop.")).toBe(
		"Unknown project acme/shop.",
	);
	expect(refusal(413)).toContain("too long");
});

it("turns a stored conversation back into messages, and marks an answer cut short", async () => {
	const { threadMessages } = await import(
		"../../../app/src/features/chat/chat-store.js"
	);
	const messages = threadMessages({
		id: "t",
		turns: [
			{
				at: "2026-11-02T10:00:00Z",
				message: "Why?",
				events: [
					{ type: "text", delta: "Because." },
					{ type: "done", costUsd: 0.01, durationMs: 900 },
				],
			},
			{ at: "2026-11-02T10:01:00Z", message: "And?", events: [] },
		],
	});
	expect(
		messages.map((m) => [m.role, m.text ?? m.turn?.error ?? "ok"]),
	).toEqual([
		["user", "Why?"],
		["assistant", "ok"],
		["user", "And?"],
		["assistant", "This answer stopped before its end."],
	]);
	expect(messages[1]?.turn?.costUsd).toBe(0.01);
});
