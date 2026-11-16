// @vitest-environment happy-dom
import { onlineManager } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApi } from "../../../app/src/hooks/use-api.js";
import { OFFLINE } from "../../../app/src/lib/api.js";
import { WithQueries } from "../query.js";

// Each read waits until the test answers it: with data, with the server's error, or with no answer at all.
interface Read {
	path: string;
	data: (data: unknown) => void;
	error: (error: string) => void;
	none: () => void;
}
let reads: Read[];

beforeEach(() => {
	vi.useFakeTimers();
	reads = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(
			(path: string) =>
				new Promise((ok, fail) =>
					reads.push({
						path,
						data: (data) => ok({ ok: true, json: async () => data }),
						error: (error) =>
							ok({
								ok: false,
								status: 400,
								statusText: "Bad Request",
								json: async () => ({ error }),
							}),
						none: () => fail(new TypeError("fetch failed")),
					}),
				),
		),
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const tick = (ms: number) =>
	act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
const answer = (fn: () => void) =>
	act(async () => {
		fn();
		await vi.advanceTimersByTimeAsync(0);
	});

it("keeps a path's data on screen when the server stops answering, and says so", async () => {
	const { result } = renderHook(() => useApi<number>("/a", 1000), {
		wrapper: WithQueries,
	});
	expect(result.current.loading).toBe(true);
	await answer(() => reads[0]?.data(1));
	expect(result.current).toMatchObject({ data: 1, loading: false });
	await tick(1000);
	await answer(() => reads[1]?.none());
	expect(result.current).toMatchObject({ data: 1, error: OFFLINE });
	await tick(1000);
	await answer(() => reads[2]?.data(2));
	expect(result.current.data).toBe(2);
	expect(result.current.error).toBeUndefined();
});

it("shows the server's error instead of the data it had", async () => {
	const { result } = renderHook(() => useApi<number>("/a", 1000), {
		wrapper: WithQueries,
	});
	await answer(() => reads[0]?.data(1));
	await tick(1000);
	await answer(() => reads[1]?.error("No."));
	expect(result.current.data).toBeUndefined();
	expect(result.current.error).toBe("No.");
});

it("never shows another path's data: a new path starts from nothing", async () => {
	const { result, rerender } = renderHook(({ path }) => useApi<number>(path), {
		wrapper: WithQueries,
		initialProps: { path: "/a" },
	});
	await answer(() => reads[0]?.data(1));
	rerender({ path: "/b" });
	expect(result.current.data).toBeUndefined();
	expect(result.current.loading).toBe(true);
	await answer(() => reads[1]?.none());
	expect(result.current).toMatchObject({ error: OFFLINE, loading: false });
	expect(result.current.data).toBeUndefined();
});

it("reads nothing without a path, and is not loading", () => {
	const { result } = renderHook(() => useApi<number>(undefined, 1000), {
		wrapper: WithQueries,
	});
	expect(reads).toHaveLength(0);
	expect(result.current.loading).toBe(false);
});

it("starts no read while one waits: an older answer can never replace a newer one", async () => {
	const { result } = renderHook(() => useApi<number>("/a", 1000), {
		wrapper: WithQueries,
	});
	await tick(3500);
	expect(reads).toHaveLength(1);
	await answer(() => reads[0]?.data(1));
	expect(result.current.data).toBe(1);
	await tick(1000);
	expect(reads).toHaveLength(2);
});

it("reads again when asked, past a read in flight, and shows that answer", async () => {
	const { result } = renderHook(() => useApi<number>("/a"), {
		wrapper: WithQueries,
	});
	await answer(() => reads[0]?.data(1));
	const ask = () =>
		act(async () => {
			void result.current.refetch();
			await vi.advanceTimersByTimeAsync(0);
		});
	await ask();
	// Asked again while that read waits: it is dropped, and a new one starts.
	await ask();
	expect(reads).toHaveLength(3);
	await answer(() => reads[2]?.data(3));
	expect(result.current.data).toBe(3);
	await answer(() => reads[1]?.data(2));
	expect(result.current.data).toBe(3);
});

it("shares the reads of one path between the components that show it", async () => {
	const { result } = renderHook(
		() => [useApi<number>("/a", 1000), useApi<number>("/a", 1000)] as const,
		{ wrapper: WithQueries },
	);
	expect(reads).toHaveLength(1);
	await answer(() => reads[0]?.data(1));
	expect(result.current.map((r) => r.data)).toEqual([1, 1]);
});

it("reads even when the browser thinks it is offline: the server is on this machine", async () => {
	onlineManager.setOnline(false);
	try {
		const { result } = renderHook(() => useApi<number>("/a", 1000), {
			wrapper: WithQueries,
		});
		await tick(0);
		expect(reads).toHaveLength(1);
		await answer(() => reads[0]?.data(1));
		expect(result.current.data).toBe(1);
		await tick(1000);
		expect(reads).toHaveLength(2);
	} finally {
		onlineManager.setOnline(true);
	}
});
