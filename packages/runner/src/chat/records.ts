import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonLines } from "../files.js";
import { projectDir } from "../state/projects.js";

/** One line per chat turn in chats.jsonl, so the metrics can count what the chat costs. */
export interface ChatRecord {
	at: string;
	sessionId: string;
	costUsd: number;
	durationMs: number;
}

const chats = (repository: string) =>
	join(projectDir(repository), "chats.jsonl");

export function readChats(repository: string): ChatRecord[] {
	if (!existsSync(chats(repository))) return [];
	return jsonLines<ChatRecord>(readFileSync(chats(repository), "utf8"));
}

/** What the session had cost before this turn: a resumed session's result carries the running total. */
export const sessionCost = (
	repository: string,
	sessionId: string | undefined,
) =>
	sessionId
		? readChats(repository)
				.filter((c) => c.sessionId === sessionId)
				.reduce((sum, c) => sum + c.costUsd, 0)
		: 0;

export function recordTurn(repository: string, record: ChatRecord): void {
	mkdirSync(projectDir(repository), { recursive: true });
	appendFileSync(chats(repository), `${JSON.stringify(record)}\n`);
}
