import {
	existsSync,
	mkdtempSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ChatEvent,
	type ChatTurnInput,
	projectDir,
	readFactoryFolder,
	studioTokenPath,
	writeApplied,
} from "@openfabriq/runner";
import { afterAll, beforeAll, expect, it } from "vitest";
import { cookieName } from "../../src/access/session.js";
import type { ChatThread } from "../../src/chat/threads.js";
import { startStudio } from "../../src/server.js";

const REPO = "acme/task-app";
const SESSION = "2955f819-9f50-4da0-b7a9-92467a611e07";
/** The conversation of the tests that are not about conversations. */
const SCRATCH = "9b8a7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
let server: ReturnType<typeof startStudio>;
let port: number;
let token: string;
const calls: ChatTurnInput[] = [];
let release: () => void = () => {};
let aborted: Promise<void>;

/** Plays two events; "wait" holds the turn until released or aborted. */
async function* fakeChat(input: ChatTurnInput): AsyncIterable<ChatEvent> {
	calls.push(input);
	yield { type: "session", sessionId: SESSION };
	if (input.message === "wait") {
		aborted = new Promise((ok) =>
			input.signal?.addEventListener("abort", () => ok()),
		);
		await new Promise<void>((ok) => {
			release = ok;
			input.signal?.addEventListener("abort", () => ok());
		});
	}
	yield { type: "text", delta: "Two agents." };
	yield { type: "done", costUsd: 0.01, durationMs: 5 };
}

beforeAll(async () => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	writeApplied(
		REPO,
		readFactoryFolder(
			join(import.meta.dirname, "../../../../fixtures/valid/sdlc/openfabriq"),
		),
	);
	const app = mkdtempSync(join(tmpdir(), "openfabriq-app-"));
	writeFileSync(
		join(app, "index.html"),
		'<!doctype html><html><head><meta name="openfabriq-token" content="" /></head></html>',
	);
	server = startStudio(0, app, { chat: fakeChat });
	await new Promise((ok) => server.once("listening", ok));
	port = (server.address() as AddressInfo).port;
	token = readFileSync(studioTokenPath(), "utf8");
});
afterAll(() => {
	server.close();
});

function post(
	headers: Record<string, string>,
	body: unknown,
	onResponse?: (abort: () => void) => void,
): Promise<{ status: number; text: string }> {
	return new Promise((ok, ko) => {
		const req = request(
			{
				host: "127.0.0.1",
				port,
				method: "POST",
				path: "/api/chat",
				headers: {
					host: `127.0.0.1:${port}`,
					cookie: `${cookieName(port)}=${token}`,
					"content-type": "application/json",
					...headers,
				},
			},
			(res) => {
				let text = "";
				res.on("data", (c) => {
					text += c;
				});
				res.on("end", () => ok({ status: res.statusCode ?? 0, text }));
				res.on("error", () => ok({ status: res.statusCode ?? 0, text }));
				onResponse?.(() => req.destroy());
			},
		);
		req.on("error", ko);
		req.end(typeof body === "string" ? body : JSON.stringify(body));
	});
}

function del(
	path: string,
	headers: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
	return new Promise((ok, ko) => {
		const req = request(
			{
				host: "127.0.0.1",
				port,
				method: "DELETE",
				path,
				headers: {
					host: `127.0.0.1:${port}`,
					cookie: `${cookieName(port)}=${token}`,
					...headers,
				},
			},
			(res) => {
				let text = "";
				res.on("data", (c) => {
					text += c;
				});
				res.on("end", () => ok({ status: res.statusCode ?? 0, text }));
			},
		);
		req.on("error", ko);
		req.end();
	});
}

const get = async (path: string) => {
	const res = await fetch(`http://127.0.0.1:${port}${path}`, {
		headers: { cookie: `${cookieName(port)}=${token}` },
	});
	return { status: res.status, body: await res.json() };
};

const threadFile = (id: string) =>
	join(projectDir(REPO), "chats", `${id}.json`);
const stored = (id: string) =>
	JSON.parse(readFileSync(threadFile(id), "utf8")) as ChatThread;

const events = (text: string) =>
	text
		.split("\n\n")
		.filter(Boolean)
		.map((chunk) => JSON.parse(chunk.replace(/^data: /, "")));

it("keeps the token in a file only the user can read, never in the page", async () => {
	expect(token).toMatch(/^[0-9a-f]{64}$/);
	expect(statSync(studioTokenPath()).mode & 0o777).toBe(0o600);
	const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
	expect(page).not.toContain(token);
});

it("streams a chat turn as server-sent events", async () => {
	const res = await post(
		{ origin: `http://127.0.0.1:${port}` },
		{ project: REPO, message: "Which agents?", threadId: SCRATCH },
	);
	expect(res.status).toBe(200);
	expect(events(res.text)).toEqual([
		{ type: "session", sessionId: SESSION },
		{ type: "text", delta: "Two agents." },
		{ type: "done", costUsd: 0.01, durationMs: 5 },
	]);
	expect(calls.at(-1)).toMatchObject({
		repository: REPO,
		message: "Which agents?",
	});
	// localhost is this server too.
	expect(
		(
			await post(
				{ host: `localhost:${port}` },
				{ project: REPO, message: "Hi", threadId: SCRATCH },
			)
		).status,
	).toBe(200);
});

it("refuses a request that does not come from the app", async () => {
	const ok = { project: REPO, message: "Hi", threadId: SCRATCH };
	const count = calls.length;
	for (const [headers, status] of [
		[{ host: `evil.example:${port}` }, 403],
		[{ host: "127.0.0.1:1" }, 403],
		[{ origin: "http://evil.example" }, 403],
		[{ origin: `http://localhost:${port}` }, 403],
		[{ cookie: "" }, 401],
		[{ cookie: `${cookieName(port)}=${"0".repeat(64)}` }, 401],
	] as const)
		expect((await post(headers, ok)).status, JSON.stringify(headers)).toBe(
			status,
		);
	// A cross-origin "simple" POST (text/plain, form) cannot carry application/json.
	for (const type of ["text/plain", "application/x-www-form-urlencoded", ""])
		expect((await post({ "content-type": type }, ok)).status, type).toBe(415);
	expect(
		(
			await post(
				{ "content-type": "application/json; charset=utf-8" },
				{ project: "someone/else", message: "Hi", threadId: SCRATCH },
			)
		).status,
	).toBe(404);
	expect(
		(await post({}, { project: REPO, message: "  ", threadId: SCRATCH }))
			.status,
	).toBe(400);
	expect((await post({}, "not json")).status).toBe(400);
	expect((await post({}, { ...ok, sessionId: SESSION })).status).toBe(400);
	expect((await post({}, { project: REPO, message: "Hi" })).status).toBe(400);
	expect(
		(
			await post(
				{},
				{ project: REPO, message: "x".repeat(70_000), threadId: SCRATCH },
			)
		).status,
	).toBe(413);
	expect(
		(
			await post(
				{},
				{ project: "someone/else", message: "Hi", threadId: SCRATCH },
			)
		).status,
	).toBe(404);
	expect(calls.length).toBe(count);
});

it("runs one turn at a time per project and stops it when the client leaves", async () => {
	let leave: () => void = () => {};
	const first = post(
		{},
		{ project: REPO, message: "wait", threadId: SCRATCH },
		(abort) => {
			leave = abort;
		},
	);
	await new Promise((ok) => setTimeout(ok, 50));
	expect(
		(await post({}, { project: REPO, message: "Hi", threadId: SCRATCH }))
			.status,
	).toBe(409);
	leave();
	await first.catch(() => undefined);
	await aborted;
	await new Promise((ok) => setTimeout(ok, 20));
	// Free again once the first turn has stopped.
	expect(
		(await post({}, { project: REPO, message: "Hi", threadId: SCRATCH }))
			.status,
	).toBe(200);
	release();
});

const THREAD = "6f1c2b0e-6a4d-4f8e-9b1a-3c2d1e0f9a8b";
const HELD = "0d9a8b7c-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

it("keeps a conversation and resumes it with its stored session", async () => {
	expect(
		(await post({}, { project: REPO, message: "First", threadId: "../x" }))
			.status,
	).toBe(400);
	expect(
		(
			await post(
				{},
				{ project: REPO, message: " First\n question ", threadId: THREAD },
			)
		).status,
	).toBe(200);
	expect(calls.at(-1)?.sessionId).toBeUndefined();
	expect(stored(THREAD)).toMatchObject({
		id: THREAD,
		title: "First question",
		sessionId: SESSION,
		costUsd: 0.01,
		turns: [
			{
				message: "First\n question",
				events: [
					{ type: "session", sessionId: SESSION },
					{ type: "text", delta: "Two agents." },
					{ type: "done", costUsd: 0.01, durationMs: 5 },
				],
			},
		],
	});
	await post({}, { project: REPO, message: "Second", threadId: THREAD });
	expect(calls.at(-1)?.sessionId).toBe(SESSION);
	expect(stored(THREAD)).toMatchObject({
		title: "First question",
		costUsd: 0.02,
	});
	expect(stored(THREAD).turns.map((t) => t.message)).toEqual([
		"First\n question",
		"Second",
	]);
});

it("saves the message before the answer, and what was streamed when the client leaves", async () => {
	let leave: () => void = () => {};
	const turn = post(
		{},
		{ project: REPO, message: "wait", threadId: HELD },
		(abort) => {
			leave = abort;
		},
	);
	await new Promise((ok) => setTimeout(ok, 50));
	expect(stored(HELD).turns).toEqual([
		{ at: expect.any(String), message: "wait", events: [] },
	]);
	expect((await del(`/api/chats/${HELD}?project=${REPO}`)).status).toBe(409);
	leave();
	await turn.catch(() => undefined);
	await aborted;
	await new Promise((ok) => setTimeout(ok, 20));
	expect(stored(HELD).turns[0]?.events).toEqual([
		{ type: "session", sessionId: SESSION },
	]);
	expect(stored(HELD).sessionId).toBe(SESSION);
	release();
});

it("lists the conversations of a project and serves one", async () => {
	const list = await get(`/api/chats?project=${REPO}`);
	expect(list.status).toBe(200);
	expect(list.body).toEqual([
		expect.objectContaining({ id: HELD, title: "wait", turns: 1 }),
		{
			id: THREAD,
			title: "First question",
			createdAt: expect.any(String),
			updatedAt: expect.any(String),
			costUsd: 0.02,
			turns: 2,
		},
		expect.objectContaining({ id: SCRATCH, title: "Which agents?" }),
	]);
	expect(await get(`/api/chats/${THREAD}?project=${REPO}`)).toEqual({
		status: 200,
		body: stored(THREAD),
	});
	for (const path of [
		`/api/chats/${SESSION}?project=${REPO}`,
		`/api/chats/..%2Fstate?project=${REPO}`,
	])
		expect(await get(path), path).toEqual({
			status: 404,
			body: { error: "No such conversation." },
		});
	expect((await get("/api/chats?project=someone/else")).status).toBe(404);
	expect((await get(`/api/chats/${THREAD}?project=someone/else`)).status).toBe(
		404,
	);
});

it("deletes a conversation only from the app", async () => {
	const path = `/api/chats/${THREAD}?project=${REPO}`;
	for (const [headers, status] of [
		[{ cookie: "" }, 401],
		[{ cookie: `${cookieName(port)}=${"0".repeat(64)}` }, 401],
		[{ origin: "http://evil.example" }, 403],
		[{ host: `evil.example:${port}` }, 403],
	] as const)
		expect((await del(path, headers)).status, JSON.stringify(headers)).toBe(
			status,
		);
	expect(existsSync(threadFile(THREAD))).toBe(true);
	expect((await del(`/api/chats/${THREAD}?project=someone/else`)).status).toBe(
		404,
	);
	expect((await del(`/api/chats/..%2Fstate?project=${REPO}`)).status).toBe(404);
	expect((await del(path, { origin: `http://127.0.0.1:${port}` })).status).toBe(
		204,
	);
	expect(existsSync(threadFile(THREAD))).toBe(false);
	expect((await del(path)).status).toBe(404);
	expect((await get(path)).status).toBe(404);
});

it("frees the project when a conversation's file does not read", async () => {
	const broken = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
	writeFileSync(threadFile(broken), "{ cut");
	const res = await post(
		{},
		{ project: REPO, message: "Hi", threadId: broken },
	).catch(() => ({ status: 0 }));
	expect(res.status).toBe(500);
	expect(
		(await post({}, { project: REPO, message: "Hi", threadId: SCRATCH }))
			.status,
	).toBe(200);
});
