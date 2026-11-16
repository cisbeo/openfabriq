import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { expect, it } from "vitest";
import { z } from "zod";
import { readAppPost } from "../../src/http/app-post.js";
import { readBody } from "../../src/http/body.js";

const request = (chunks: string[], headers: Record<string, string> = {}) =>
	Object.assign(Readable.from(chunks.map((c) => Buffer.from(c))), {
		headers: { host: "127.0.0.1:4310", ...headers },
	}) as unknown as IncomingMessage;

it("reads a body up to its limit, and nothing past it", async () => {
	expect((await readBody(request(["ab", "cd"]), 4))?.toString()).toBe("abcd");
	expect(await readBody(request(["ab", "cde"]), 4)).toBeUndefined();
	expect((await readBody(request([]), 4))?.toString()).toBe("");
});

it("returns the body of the app's POST, or the refusal to send", async () => {
	const opts = {
		schema: z.strictObject({ project: z.string() }),
		expected: "{ project }",
		max: 64,
		projects: () => ["acme/app"],
	};
	const json = { "content-type": "application/json" };
	const post = (body: string, headers: Record<string, string> = json) =>
		readAppPost(request([body], headers), opts);
	expect(await post('{"project":"acme/app"}')).toEqual({
		body: { project: "acme/app" },
	});
	expect(
		await post('{"project":"acme/app"}', {
			...json,
			origin: "https://evil.example",
		}),
	).toEqual({ status: 403, error: "Cross-origin requests are refused." });
	expect(await post('{"project":"acme/app"}', {})).toEqual({
		status: 415,
		error: "Send { project } as application/json.",
	});
	expect(await post(`{"project":"${"a".repeat(64)}"}`)).toEqual({
		status: 413,
		error: "Too long.",
	});
	expect(await post('{"other":1}')).toEqual({
		status: 400,
		error: "Expected JSON { project }.",
	});
	expect(await post('{"project":"acme/other"}')).toEqual({
		status: 404,
		error: "No project acme/other.",
	});
});
