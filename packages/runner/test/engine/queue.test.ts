import type { FactoryEvent } from "@openfabriq/core";
import { expect, it } from "vitest";
import {
	enqueue,
	type QueuedRun,
	recoverQueue,
	startable,
} from "../../src/engine/queue.js";

const event = {
	key: "k",
	event: "issue.opened",
	isPullRequest: false,
	actor: "a",
	at: "",
} satisfies FactoryEvent;
const run = (
	id: string,
	number: number | undefined,
	more: Partial<QueuedRun> = {},
): QueuedRun => ({
	id,
	repository: "acme/app",
	automation: `auto-${id}`,
	...(number === undefined ? {} : { number }),
	repoWide: false,
	event,
	...more,
});

it("keeps one waiting run per automation and subject", () => {
	const queue = enqueue(
		[run("a", 1, { automation: "triage" })],
		run("b", 1, { automation: "triage" }),
	);
	expect(queue.map((r) => r.id)).toEqual(["a"]);
	expect(
		enqueue(queue, run("c", 2, { automation: "triage" })).map((r) => r.id),
	).toEqual(["a", "c"]);
});

it("queues a waiting run per Linear session of one issue", () => {
	const inSession = (id: string, session: string) =>
		run(id, undefined, {
			automation: "delegated",
			event: {
				...event,
				source: {
					kind: "linear",
					issueId: "uuid-7",
					identifier: "ENG-7",
					url: "u",
					session: { id: session, organizationId: "org", request: "" },
				},
			},
		});
	const queue = enqueue([inSession("a", "s1")], inSession("b", "s2"));
	expect(queue.map((r) => r.id)).toEqual(["a", "b"]);
	expect(enqueue(queue, inSession("c", "s1")).map((r) => r.id)).toEqual([
		"a",
		"b",
	]);
});

it("does not queue again the event a run of the same automation is running", () => {
	const running = [run("a", 1, { automation: "triage" })];
	expect(enqueue([], run("b", 1, { automation: "triage" }), running)).toEqual(
		[],
	);
	const next = run("c", 1, {
		automation: "triage",
		event: { ...event, key: "other" },
	});
	expect(enqueue([], next, running)).toEqual([next]);
});

it("runs one at a time per issue, a repoWide run alone, and at most max", () => {
	const ids = (q: QueuedRun[], a: QueuedRun[], max = 5) =>
		startable(q, a, max).map((r) => r.id);
	expect(ids([run("a", 1), run("b", 1), run("c", 2)], [])).toEqual(["a", "c"]);
	expect(ids([run("a", 1), run("c", 2)], [run("x", 1)])).toEqual(["c"]);
	expect(
		ids([run("w", undefined, { repoWide: true }), run("c", 2)], [run("x", 1)]),
	).toEqual(["c"]);
	expect(ids([run("c", 2)], [run("w", undefined, { repoWide: true })])).toEqual(
		[],
	);
	expect(ids([run("a", 1), run("c", 2)], [], 1)).toEqual(["a"]);
	expect(
		ids([run("a", 1)], [run("x", 1, { repository: "acme/other" })]),
	).toEqual(["a"]);
});

it("after a stop, fails what was running and queues it again once", () => {
	let n = 0;
	const recovered = recoverQueue(
		{
			queued: [run("w", 3)],
			running: [run("r", 1), run("again", 2, { requeued: true })],
		},
		() => `new-${++n}`,
	);
	expect(recovered.interrupted.map((r) => r.id)).toEqual(["r", "again"]);
	expect(
		recovered.queued.map((r) => [r.id, r.number, r.requeued ?? false]),
	).toEqual([
		["w", 3, false],
		["new-1", 1, true],
	]);
});
