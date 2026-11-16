// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRun } from "../../../app/src/features/run-detail/use-run.js";
import type { RunRecord } from "../../../app/src/lib/types.js";
import { WithQueries } from "../query.js";
import { detail } from "./detail.js";

let status: RunRecord["status"];
const fetched: string[] = [];

beforeEach(() => {
	vi.useFakeTimers();
	fetched.length = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path: string) => {
			fetched.push(path);
			return { ok: true, json: async () => detail({ status }) };
		}),
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

/** Lets the timers run for `ms`, and every answer they ask for arrive. */
const wait = async (ms: number) => {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
};

it("reads a run that waits or works every 3 s, and stops once it is over", async () => {
	status = "queued";
	const { result } = renderHook(() => useRun("r1", "acme/shop"), {
		wrapper: WithQueries,
	});
	await wait(0);
	// The answer says the run waits: the hook reads it every 3 s.
	expect(fetched).toEqual(["/api/run?project=acme%2Fshop&id=r1"]);
	expect(result.current.data?.run.status).toBe("queued");
	await wait(3000);
	expect(fetched).toHaveLength(2);
	status = "running";
	await wait(3000);
	expect(fetched).toHaveLength(3);
	// React Query shows an answer on the next turn of the timers.
	await wait(10);
	expect(result.current.data?.run.status).toBe("running");
	status = "succeeded";
	await wait(3000);
	// The answer says the run is over: the hook stops reading.
	expect(fetched).toHaveLength(4);
	await wait(10);
	expect(result.current.data?.run.status).toBe("succeeded");
	await wait(30_000);
	expect(fetched).toHaveLength(4);
});

it("reads a run that is over once", async () => {
	status = "failed";
	renderHook(() => useRun("r1", undefined), { wrapper: WithQueries });
	await wait(30_000);
	expect(fetched).toEqual(["/api/run?id=r1"]);
});
