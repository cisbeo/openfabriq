import { useEffect, useSyncExternalStore } from "react";
import type { ChatThreadSummary as ThreadSummary } from "../../../../src/chat/threads.js";
import { OFFLINE, query } from "../../lib/api.js";
import {
	applyEvent,
	type ChatEvent,
	type ChatTurn,
	refusal,
	splitEvents,
} from "./chat-stream.js";

/**
 * The chat's conversations, outside React: an answer keeps streaming while the person reads
 * another page, and the conversation is there when they come back. The server keeps every
 * conversation in `chats/<id>.json`; this store mirrors the ones opened here.
 */

export interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	createdAt: Date;
	text?: string;
	turn?: ChatTurn;
	running?: boolean;
}

interface StoredThread {
	id: string;
	turns: { at: string; message: string; events: ChatEvent[] }[];
}

interface Thread {
	id: string;
	messages: ChatMessage[];
	/** Read from the server, or new here: either way, its messages are all in `messages`. */
	loaded: boolean;
	abort?: AbortController;
	error?: string;
}

export interface ProjectChats {
	/** The conversations the server knows, latest first. */
	list: ThreadSummary[];
	listLoaded: boolean;
	current: string;
	threads: Record<string, Thread>;
}

/** The turns the server stored, as the messages the thread shows. Pure. */
export function threadMessages(stored: StoredThread): ChatMessage[] {
	return stored.turns.flatMap((t, i) => {
		const at = new Date(t.at);
		let turn: ChatTurn = { parts: [], done: false };
		for (const event of t.events) turn = applyEvent(turn, event);
		if (!turn.done && !turn.error)
			turn = { ...turn, error: "This answer stopped before its end." };
		return [
			{
				id: `${stored.id}:u${i}`,
				role: "user" as const,
				createdAt: at,
				text: t.message,
			},
			{
				id: `${stored.id}:a${i}`,
				role: "assistant" as const,
				createdAt: at,
				turn,
			},
		];
	});
}

const newId = () => crypto.randomUUID();

let state: Record<string, ProjectChats> = {};
const listeners = new Set<() => void>();

function set(project: string, update: (p: ProjectChats) => ProjectChats) {
	const before = state[project];
	if (!before) return;
	state = { ...state, [project]: update(before) };
	for (const l of listeners) l();
}

function setThread(project: string, id: string, update: (t: Thread) => Thread) {
	set(project, (p) => {
		const thread = p.threads[id];
		return thread
			? { ...p, threads: { ...p.threads, [id]: update(thread) } }
			: p;
	});
}

const empty = (id: string): Thread => ({ id, messages: [], loaded: true });

async function refreshList(project: string) {
	try {
		const res = await fetch(`/api/chats${query({ project })}`);
		if (!res.ok) throw new Error(String(res.status));
		const list = (await res.json()) as ThreadSummary[];
		set(project, (p) => ({ ...p, list, listLoaded: true }));
	} catch {
		// an older server keeps no conversations: the chat still works, without history
		set(project, (p) => ({ ...p, listLoaded: true }));
	}
}

/** The project's conversations, created blank the first time: no read, safe while rendering. */
function peek(project: string): ProjectChats {
	const existing = state[project];
	if (existing) return existing;
	const id = newId();
	const created: ProjectChats = {
		list: [],
		listLoaded: false,
		current: id,
		threads: { [id]: empty(id) },
	};
	state = { ...state, [project]: created };
	return created;
}

/** The projects whose list of conversations was asked for. */
const listAsked = new Set<string>();

/** The project's conversations, and their list read from the server the first time. */
function ensure(project: string): ProjectChats {
	const chats = peek(project);
	if (!listAsked.has(project)) {
		listAsked.add(project);
		void refreshList(project);
	}
	return chats;
}

async function load(project: string, id: string) {
	try {
		const res = await fetch(`/api/chats/${id}${query({ project })}`);
		if (!res.ok) throw new Error("This conversation could not be read.");
		const messages = threadMessages((await res.json()) as StoredThread);
		setThread(project, id, (t) => ({ ...t, messages, loaded: true }));
	} catch (error) {
		setThread(project, id, (t) => ({
			...t,
			loaded: true,
			error: error instanceof Error ? error.message : String(error),
		}));
	}
}

export const chats = {
	/** Starts the project's store: reads its list of conversations once. */
	open(project: string) {
		ensure(project);
	},

	select(project: string, id: string) {
		ensure(project);
		set(project, (p) => ({
			...p,
			current: id,
			threads: p.threads[id]
				? p.threads
				: { ...p.threads, [id]: { id, messages: [], loaded: false } },
		}));
		if (!state[project]?.threads[id]?.loaded) void load(project, id);
	},

	/** A blank conversation, unless the current one is still blank. */
	start(project: string) {
		const p = ensure(project);
		if (p.threads[p.current]?.messages.length === 0) return;
		const id = newId();
		set(project, (q) => ({
			...q,
			current: id,
			threads: { ...q.threads, [id]: empty(id) },
		}));
	},

	async send(project: string, text: string) {
		const p = ensure(project);
		const id = p.current;
		const thread = p.threads[id];
		// An old conversation still loading would replace the message once read.
		if (!thread?.loaded || thread.abort) return;
		const now = new Date();
		const answerId = newId();
		const abort = new AbortController();
		setThread(project, id, (t) => ({
			...t,
			abort,
			messages: [
				...t.messages,
				{ id: newId(), role: "user", createdAt: now, text },
				{
					id: answerId,
					role: "assistant",
					createdAt: now,
					turn: { parts: [], done: false },
					running: true,
				},
			],
		}));
		const update = (turn: ChatTurn, running = true) =>
			setThread(project, id, (t) => ({
				...t,
				messages: t.messages.map((m) =>
					m.id === answerId ? { ...m, turn, running } : m,
				),
			}));

		let turn: ChatTurn = { parts: [], done: false };
		try {
			const res = await fetch("/api/chat", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ project, threadId: id, message: text }),
				signal: abort.signal,
			});
			if (!res.ok || !res.body) {
				const body = (await res.json().catch(() => ({}))) as {
					error?: string;
				};
				throw new Error(refusal(res.status, body.error));
			}
			let buffer = "";
			const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				const { events, rest } = splitEvents(buffer + value);
				buffer = rest;
				if (events.length === 0) continue;
				const first = turn.parts.length === 0 && !turn.sessionId;
				turn = events.reduce(applyEvent, turn);
				// The answer is over at `done`; the suggestion still comes after it.
				update(turn, !turn.done);
				// The server stored the conversation before answering: list it now.
				if (first) void refreshList(project);
			}
			if (!turn.done && !turn.error)
				turn = { ...turn, error: "The answer stopped before its end." };
		} catch (error) {
			turn = abort.signal.aborted
				? { ...turn, done: true, error: "Stopped." }
				: {
						...turn,
						error:
							error instanceof TypeError
								? OFFLINE
								: error instanceof Error
									? error.message
									: String(error),
					};
		}
		update(turn, false);
		setThread(project, id, ({ abort: _, ...t }) => t);
		void refreshList(project);
	},

	cancel(project: string) {
		const p = state[project];
		p?.threads[p.current]?.abort?.abort();
	},

	/** Deletes a conversation; the server's refusal when it does not, and the conversation stays. */
	async remove(project: string, id: string): Promise<string | undefined> {
		let res: Response;
		try {
			res = await fetch(`/api/chats/${id}${query({ project })}`, {
				method: "DELETE",
			});
		} catch {
			return OFFLINE;
		}
		// 404: already gone, as wanted.
		if (!res.ok && res.status !== 404) {
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			return body.error ?? `${res.status} ${res.statusText}`;
		}
		set(project, (p) => {
			const { [id]: _, ...threads } = p.threads;
			return { ...p, list: p.list.filter((t) => t.id !== id), threads };
		});
		if (state[project]?.current === id) {
			const fresh = newId();
			set(project, (p) => ({
				...p,
				current: fresh,
				threads: { ...p.threads, [fresh]: empty(fresh) },
			}));
		}
	},
};

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

/** One project's conversations; its history is read once the page shows. */
export function useProjectChats(project: string): ProjectChats {
	useEffect(() => chats.open(project), [project]);
	return useSyncExternalStore(subscribe, () => peek(project));
}

/** Whether any conversation, in any project, is answering right now. */
export function useChatBusy(): boolean {
	return useSyncExternalStore(subscribe, () =>
		Object.values(state).some((p) =>
			Object.values(p.threads).some((t) => t.abort),
		),
	);
}
