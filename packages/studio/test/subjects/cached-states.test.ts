import { expect, it, vi } from "vitest";
import {
	ASK_NEEDED_AGAIN_MS,
	cachedStates,
} from "../../src/subjects/cached-states.js";

const PR = "https://github.com/acme/task-app/pull/7";

it("asks gh again only about open pull requests, four at a time", async () => {
	const asked: string[] = [];
	let running = 0;
	let most = 0;
	const states = cachedStates(async (url) => {
		asked.push(url);
		most = Math.max(most, ++running);
		await new Promise((ok) => setTimeout(ok, 5));
		running--;
		return { merged: false, open: url.endsWith("/1") };
	});
	const urls = Array.from({ length: 10 }, (_, i) => `${PR}/${i}`);
	expect((await states(urls))[`${PR}/2`]).toEqual({
		merged: false,
		open: false,
	});
	expect(asked).toHaveLength(10);
	expect(most).toBe(4);
	vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 6 * 60_000 });
	try {
		await states(urls);
	} finally {
		vi.useRealTimers();
	}
	// A closed pull request stays closed, like a merged one.
	expect(asked.slice(10)).toEqual([`${PR}/1`]);
});

it("asks the board's subjects again after a minute, the metrics' many pull requests after five", async () => {
	const asked: string[] = [];
	const states = cachedStates(async (url) => {
		asked.push(url);
		return { merged: false, open: true };
	});
	await states([PR]);
	vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2 * 60_000 });
	try {
		await states([PR]);
		expect(asked).toHaveLength(1);
		await states([PR], ASK_NEEDED_AGAIN_MS);
		expect(asked).toHaveLength(2);
	} finally {
		vi.useRealTimers();
	}
});
