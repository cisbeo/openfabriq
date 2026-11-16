import type { IncomingMessage, ServerResponse } from "node:http";
import { type ChatEvent, type ChatTurn, errorText } from "@openfabriq/runner";
import { z } from "zod";
import { notFromApp } from "../access/origin.js";
import { noContent, refuse, send } from "../http/answer.js";
import { readAppPost } from "../http/app-post.js";
import {
	addEvent,
	type ChatThread,
	deleteThread,
	readThread,
	startTurn,
	writeThread,
} from "./threads.js";

const MAX_BODY = 64 * 1024;

const Body = z.strictObject({
	project: z.string(),
	message: z.string().trim().min(1).max(20_000),
	/** The conversation; it resumes with its own session. */
	threadId: z.uuid(),
});

type ChatBody = z.infer<typeof Body>;

/** The conversation with the new message, not yet answered; undefined when its file does not read. */
function openTurn(dir: string, body: ChatBody): ChatThread | undefined {
	try {
		return startTurn(
			readThread(dir, body.threadId),
			body.threadId,
			body.message,
			new Date().toISOString(),
		);
	} catch {
		return undefined;
	}
}

/**
 * POST /api/chat, the one route that spends the subscription, and
 * DELETE /api/chats/<id>. Both refused unless the request comes from the app's page; the
 * server has already checked the cookie.
 * One turn at a time per project; the turn is kept in `chats/<threadId>.json`.
 */
export function chatHandler(deps: {
	chat: ChatTurn;
	projects: () => string[];
	threadsDir: (repository: string) => string;
	/** The studio's https address, if any. */
	url?: URL;
}) {
	const busy = new Set<string>();
	const running = new Set<string>();

	/** The answer to the turn, as server-sent events; each event is also added to `thread`, in place. */
	const streamTurn = async (
		dir: string,
		body: ChatBody,
		thread: ChatThread,
		res: ServerResponse,
		signal: AbortSignal,
	) => {
		const { sessionId } = thread;
		const send = (event: ChatEvent) => {
			addEvent(thread, event);
			res.write(`data: ${JSON.stringify(event)}\n\n`);
		};
		try {
			// The message is on disk before the answer starts.
			writeThread(dir, thread);
			for await (const event of deps.chat({
				repository: body.project,
				message: body.message,
				signal,
				...(sessionId ? { sessionId } : {}),
			})) {
				if (signal.aborted) break;
				send(event);
			}
		} catch (error) {
			send({
				type: "error",
				message: errorText(error),
			});
		}
	};

	const post = async (req: IncomingMessage, res: ServerResponse) => {
		const read = await readAppPost(req, {
			schema: Body,
			expected: "{ project, message, threadId } with a non-empty message",
			max: MAX_BODY,
			projects: deps.projects,
			url: deps.url,
		});
		if ("error" in read) return refuse(res, read.status, read.error);
		const { body } = read;
		if (busy.has(body.project))
			return refuse(
				res,
				409,
				"A chat message is already running for this project.",
			);

		const dir = deps.threadsDir(body.project);
		// Before the project is busy: a file that does not read must not lock it.
		const thread = openTurn(dir, body);
		if (!thread)
			return refuse(res, 500, "This conversation's file does not read.");
		busy.add(body.project);
		running.add(thread.id);
		const abort = new AbortController();
		res.on("close", () => {
			if (!res.writableEnded) abort.abort();
		});
		res.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-store",
			connection: "keep-alive",
		});
		try {
			await streamTurn(dir, body, thread, res, abort.signal);
		} finally {
			thread.updatedAt = new Date().toISOString();
			try {
				writeThread(dir, thread);
			} catch {
				// The turn was streamed; only its copy on disk is missing.
			}
			running.delete(thread.id);
			busy.delete(body.project);
			res.end();
		}
	};

	/** DELETE /api/chats/<id>?project=: 204, 404 when absent, 409 while one of its turns runs. */
	const remove = async (req: IncomingMessage, res: ServerResponse) => {
		const refused = notFromApp(req, deps.url);
		if (refused) return refuse(res, 403, refused);
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const project = url.searchParams.get("project") ?? "";
		const id = url.pathname.slice("/api/chats/".length);
		if (!deps.projects().includes(project))
			return refuse(res, 404, `No project ${project}.`);
		if (running.has(id))
			return refuse(res, 409, "This conversation is answering right now.");
		if (!deleteThread(deps.threadsDir(project), id))
			return refuse(res, 404, "No such conversation.");
		send(res, noContent());
	};

	return { post, remove };
}
