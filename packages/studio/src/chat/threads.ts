import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	type ChatEvent,
	projectDir,
	readJsonIfExists,
	writeFileAtomic,
} from "@openfabriq/runner";
import { z } from "zod";

/** Where a project's conversations are kept. */
export const threadsDir = (repository: string) =>
	join(projectDir(repository), "chats");

/** A conversation with a project's factory, kept in `chats/<id>.json`. */
export interface ChatThread {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	/** The Agent SDK session, to resume the conversation. */
	sessionId?: string;
	costUsd: number;
	turns: { at: string; message: string; events: ChatEvent[] }[];
}

export interface ChatThreadSummary {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	costUsd: number;
	turns: number;
}

const TITLE = 80;
const Id = z.uuid();

/** Only a uuid becomes a file name: no path can be built from anything else. */
export const isThreadId = (id: string) => Id.safeParse(id).success;

export function threadTitle(message: string): string {
	const text = message.replace(/\s+/g, " ").trim();
	return text.length > TITLE ? `${text.slice(0, TITLE - 1)}…` : text;
}

/** The thread with a new turn, not yet answered; a new thread when there is none. */
export function startTurn(
	thread: ChatThread | undefined,
	id: string,
	message: string,
	at: string,
): ChatThread {
	const base = thread ?? {
		id,
		title: threadTitle(message),
		createdAt: at,
		updatedAt: at,
		costUsd: 0,
		turns: [],
	};
	return {
		...base,
		updatedAt: at,
		turns: [...base.turns, { at, message, events: [] }],
	};
}

/** Appends the event to the last turn, in place; a turn streams thousands of deltas, kept as one per run. */
export function addEvent(thread: ChatThread, event: ChatEvent): void {
	const events = thread.turns.at(-1)?.events;
	const last = events?.at(-1);
	if (
		(event.type === "text" || event.type === "reasoning") &&
		last?.type === event.type
	)
		last.delta += event.delta;
	else events?.push({ ...event });
	if (event.type === "session") thread.sessionId = event.sessionId;
	if (event.type === "done") thread.costUsd += event.costUsd;
}

const file = (dir: string, id: string) => join(dir, `${id}.json`);

export function readThread(dir: string, id: string): ChatThread | undefined {
	return isThreadId(id)
		? readJsonIfExists<ChatThread>(file(dir, id))
		: undefined;
}

/** Atomic, so a reader never sees half a conversation. */
export function writeThread(dir: string, thread: ChatThread): void {
	if (!isThreadId(thread.id)) throw new Error(`Not a uuid: ${thread.id}`);
	writeFileAtomic(file(dir, thread.id), JSON.stringify(thread));
}

export function deleteThread(dir: string, id: string): boolean {
	if (!isThreadId(id) || !existsSync(file(dir, id))) return false;
	rmSync(file(dir, id));
	return true;
}

/** The conversations, latest first. A file that does not read is left out. */
export function listThreads(dir: string): ChatThreadSummary[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.flatMap((name) => {
			const id = name.replace(/\.json$/, "");
			try {
				const t = readThread(dir, id);
				return t
					? [
							{
								id: t.id,
								title: t.title,
								createdAt: t.createdAt,
								updatedAt: t.updatedAt,
								costUsd: t.costUsd,
								turns: t.turns.length,
							},
						]
					: [];
			} catch {
				return [];
			}
		})
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
