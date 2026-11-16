import type { IncomingMessage } from "node:http";
import type { z } from "zod";
import { notFromApp } from "../access/origin.js";
import { readBody } from "./body.js";

/** A POST from the app's page: its body, or the refusal to send. */
export type AppPost<T> = { body: T } | { status: number; error: string };

/**
 * The JSON body of a POST from the app's page, for a known project, or why it is refused:
 * not from the app (403), not JSON (415), too long (413), not the schema (400), no such project (404).
 */
export async function readAppPost<T extends { project: string }>(
	req: IncomingMessage,
	opts: {
		schema: z.ZodType<T>;
		/** What the body should be, for the refusals: "{ project }". */
		expected: string;
		max: number;
		projects: () => string[];
		url?: URL | undefined;
	},
): Promise<AppPost<T>> {
	const refused = notFromApp(req, opts.url);
	if (refused) return { status: 403, error: refused };
	// A cross-origin form or text/plain POST needs no preflight; through the dev proxy it would pass.
	const type = req.headers["content-type"]?.split(";")[0]?.trim();
	if (type?.toLowerCase() !== "application/json")
		return { status: 415, error: `Send ${opts.expected} as application/json.` };
	const raw = await readBody(req, opts.max);
	if (!raw) return { status: 413, error: "Too long." };
	let body: T;
	try {
		body = opts.schema.parse(JSON.parse(raw.toString("utf8")));
	} catch {
		return { status: 400, error: `Expected JSON ${opts.expected}.` };
	}
	if (!opts.projects().includes(body.project))
		return { status: 404, error: `No project ${body.project}.` };
	return { body };
}
