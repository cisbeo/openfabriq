import { expect, it } from "vitest";
import type { ChatMessage } from "../../../app/src/features/chat/chat-store.js";
import {
	messageText,
	toThreadMessage,
} from "../../../app/src/features/chat/to-thread.js";

const at = new Date("2026-11-03T10:00:00.000Z");
const answer = (over: Partial<ChatMessage> = {}): ChatMessage => ({
	id: "a",
	role: "assistant",
	createdAt: at,
	turn: { parts: [{ type: "text", text: "Hi" }], done: true },
	...over,
});

it("shows a person's message as its text", () => {
	expect(
		toThreadMessage({ id: "u", role: "user", createdAt: at, text: "Why?" }),
	).toEqual({
		id: "u",
		role: "user",
		createdAt: at,
		content: [{ type: "text", text: "Why?" }],
	});
});

it("says whether an answer is running, stopped, failed or complete", () => {
	expect(toThreadMessage(answer({ running: true })).status).toEqual({
		type: "running",
	});
	expect(
		toThreadMessage(
			answer({ turn: { parts: [], done: true, error: "Stopped." } }),
		).status,
	).toEqual({ type: "incomplete", reason: "cancelled" });
	expect(
		toThreadMessage(answer({ turn: { parts: [], done: true, error: "Boom" } }))
			.status,
	).toEqual({ type: "incomplete", reason: "error", error: "Boom" });
	expect(toThreadMessage(answer()).status).toEqual({
		type: "complete",
		reason: "stop",
	});
});

it("carries an answer's cost and time, only when known", () => {
	expect(toThreadMessage(answer()).metadata).toEqual({ custom: {} });
	expect(
		toThreadMessage(
			answer({
				turn: { parts: [], done: true, costUsd: 0.04, durationMs: 5200 },
			}),
		).metadata,
	).toEqual({ custom: { costUsd: 0.04, durationMs: 5200 } });
});

it("shows an answer not started yet as empty", () => {
	const { turn: _turn, ...waiting } = answer();
	expect(toThreadMessage(waiting).content).toEqual([]);
});

it("reads the text a person sent, without the other parts", () => {
	expect(
		messageText({
			content: [
				{ type: "text", text: "  Hello" },
				{ type: "image", image: "x" },
				{ type: "text", text: "world  " },
			],
		} as never),
	).toBe("Hello\n\nworld");
	expect(messageText({ content: [] })).toBe("");
});
