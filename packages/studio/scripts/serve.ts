// Development only: serves the app and its read-only API, without the engine (never
// `openfabriq start`, which polls GitHub and launches agents). With --fake-chat, the chat
// route answers with a canned event stream, to work on the chat without spending anything;
// it still stores the conversations, so point OPENFABRIQ_HOME at a copy to keep yours clean.
//
//   [PORT=4310] pnpm --filter @openfabriq/studio serve [--fake-chat]   then open the address it prints
//   (and `pnpm --filter @openfabriq/studio dev` for the app with hot reload, on :5173)
//
// Reads ~/.openfabriq (or $OPENFABRIQ_HOME) like the real studio: read only.

import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import {
	type ChatEvent,
	type ChatTurnInput,
	studioTokenPath,
} from "@openfabriq/runner";
import { startStudio } from "../dist/index.js";

const PORT = Number(process.env.PORT ?? 4310);

/** A canned answer, streamed like the real one: through the real route, which stores it. */
async function* fakeChat({
	message,
	sessionId,
	signal,
}: ChatTurnInput): AsyncIterable<ChatEvent> {
	const wait = (ms: number) => sleep(ms, undefined, { signal });
	yield { type: "session", sessionId: crypto.randomUUID() };
	await wait(500);
	yield { type: "reasoning", delta: "The question is about runs. " };
	await wait(200);
	yield { type: "reasoning", delta: "List the failed ones first." };
	yield {
		type: "tool-call",
		id: "t1",
		name: "list_runs",
		args: { status: "failed" },
	};
	await wait(1500);
	yield {
		type: "tool-result",
		id: "t1",
		result: [{ id: "mvygkm0d-e680", reason: "review_rounds reached (1)" }],
	};
	yield {
		type: "tool-call",
		id: "t2",
		name: "read_run",
		args: { id: "mvygkm0d-e680" },
	};
	await wait(1800);
	yield { type: "tool-result", id: "t2", result: '{ "status": "failed" }' };
	await wait(900);
	if (message.includes("error")) {
		yield {
			type: "error",
			message: "The chat reached its cost limit (usd_per_run).",
		};
		yield { type: "done", costUsd: 0.5, durationMs: 4000 };
		return;
	}
	for (const word of "One run failed: **review-pull-requests** on PR #17 stopped because `review_rounds` was reached.\n\n- It had already asked for changes once.\n- The factory allows one round, so the engine handed the pull request to a human.".split(
		/(?<= )/,
	)) {
		yield { type: "text", delta: word };
		await wait(25);
	}
	yield { type: "done", costUsd: 0.042, durationMs: 5200 };
	// Like the SDK: no suggestion on a conversation's first message.
	if (sessionId) {
		await wait(1800);
		yield { type: "suggestion", text: "Show me the review agent's last run" };
	}
}

const fake = process.argv.includes("--fake-chat");
startStudio(PORT, undefined, fake ? { chat: fakeChat } : {});
console.log(
	`Studio${fake ? " with a fake chat" : ""} on http://127.0.0.1:${PORT}/?token=${readFileSync(studioTokenPath(), "utf8")}`,
);
