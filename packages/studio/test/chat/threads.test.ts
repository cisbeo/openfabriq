import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
	addEvent,
	type ChatThread,
	deleteThread,
	isThreadId,
	listThreads,
	readThread,
	startTurn,
	threadTitle,
	writeThread,
} from "../../src/chat/threads.js";

const ID = "6f1c2b0e-6a4d-4f8e-9b1a-3c2d1e0f9a8b";
const OTHER = "0d9a8b7c-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

it("titles a conversation with its first message, whitespace collapsed, cut to 80 characters", () => {
	expect(threadTitle("  Which\n agents\t run?  ")).toBe("Which agents run?");
	const title = threadTitle("x".repeat(200));
	expect(title).toHaveLength(80);
	expect(title.endsWith("…")).toBe(true);
	expect(threadTitle("y".repeat(80))).toBe("y".repeat(80));
});

it("starts a conversation, then adds turns and their events", () => {
	const thread = startTurn(
		undefined,
		ID,
		"Which agents?",
		"2026-01-01T00:00:00.000Z",
	);
	expect(thread).toEqual({
		id: ID,
		title: "Which agents?",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		costUsd: 0,
		turns: [
			{ at: "2026-01-01T00:00:00.000Z", message: "Which agents?", events: [] },
		],
	});
	addEvent(thread, { type: "session", sessionId: OTHER });
	addEvent(thread, { type: "text", delta: "Two." });
	addEvent(thread, { type: "done", costUsd: 0.25, durationMs: 5 });
	const next = startTurn(thread, ID, "And then?", "2026-01-02T00:00:00.000Z");
	addEvent(next, { type: "done", costUsd: 0.5, durationMs: 5 });
	expect(next).toMatchObject({
		title: "Which agents?",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-02T00:00:00.000Z",
		sessionId: OTHER,
		costUsd: 0.75,
	});
	expect(next.turns.map((t) => t.events.length)).toEqual([3, 1]);
});

it("keeps a run of deltas as one event, so a long answer stays a small file", () => {
	const thread = startTurn(undefined, ID, "Hi", "t");
	const sent = { type: "text", delta: "Tw" } as const;
	for (const event of [
		sent,
		{ type: "text", delta: "o." },
		{ type: "reasoning", delta: "Hm" },
		{ type: "reasoning", delta: "m." },
		{ type: "text", delta: "Done." },
	] as const)
		addEvent(thread, event);
	expect(thread.turns[0]?.events).toEqual([
		{ type: "text", delta: "Two." },
		{ type: "reasoning", delta: "Hmm." },
		{ type: "text", delta: "Done." },
	]);
	// The event the caller streams is left as it was.
	expect(sent.delta).toBe("Tw");
});

it("only accepts a uuid as an id", () => {
	expect(isThreadId(ID)).toBe(true);
	for (const id of ["../x", "", `${ID}/..`, "not-a-uuid"])
		expect(isThreadId(id), id).toBe(false);
	const dir = mkdtempSync(join(tmpdir(), "openfabriq-chats-"));
	expect(readThread(dir, "../state")).toBeUndefined();
	expect(deleteThread(dir, "../state")).toBe(false);
	expect(() =>
		writeThread(dir, { ...startTurn(undefined, ID, "x", "t"), id: "../x" }),
	).toThrow();
});

it("writes atomically, reads, lists latest first and deletes", () => {
	const dir = join(mkdtempSync(join(tmpdir(), "openfabriq-chats-")), "chats");
	expect(listThreads(dir)).toEqual([]);
	const old: ChatThread = startTurn(
		undefined,
		ID,
		"Old",
		"2026-01-01T00:00:00.000Z",
	);
	const recent = startTurn(
		undefined,
		OTHER,
		"Recent",
		"2026-01-03T00:00:00.000Z",
	);
	addEvent(recent, { type: "done", costUsd: 0.1, durationMs: 1 });
	writeThread(dir, old);
	writeThread(dir, recent);
	writeThread(dir, startTurn(old, ID, "Again", "2026-01-02T00:00:00.000Z"));
	writeFileSync(join(dir, "broken.json"), "{");
	expect(readdirSync(dir).sort()).toEqual(
		[`${ID}.json`, `${OTHER}.json`, "broken.json"].sort(),
	);
	expect(readThread(dir, ID)?.turns).toHaveLength(2);
	expect(listThreads(dir)).toEqual([
		{
			id: OTHER,
			title: "Recent",
			createdAt: "2026-01-03T00:00:00.000Z",
			updatedAt: "2026-01-03T00:00:00.000Z",
			costUsd: 0.1,
			turns: 1,
		},
		{
			id: ID,
			title: "Old",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
			costUsd: 0,
			turns: 2,
		},
	]);
	expect(deleteThread(dir, ID)).toBe(true);
	expect(deleteThread(dir, ID)).toBe(false);
	expect(readThread(dir, ID)).toBeUndefined();
});
