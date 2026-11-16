// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
	chats,
	useProjectChats,
} from "../../../app/src/features/chat/chat-store.js";

afterEach(() => vi.unstubAllGlobals());

it("sends no message while an old conversation is still loading", () => {
	// The server never answers: the conversation stays unread.
	const fetch = vi.fn((_url: string) => new Promise<Response>(() => {}));
	vi.stubGlobal("fetch", fetch);
	vi.stubGlobal("document", { querySelector: () => null });
	chats.select("acme/shop", "old");
	void chats.send("acme/shop", "Hello");
	expect(fetch.mock.calls.map(([url]) => url)).not.toContain("/api/chat");
});

it("reads a project's conversations once its page shows, and only once", async () => {
	const fetch = vi.fn(async (_url: string) => ({
		ok: true,
		json: async () => [],
	}));
	vi.stubGlobal("fetch", fetch);
	const { rerender } = renderHook(() => useProjectChats("acme/once"));
	rerender();
	rerender();
	await act(async () => {});
	expect(fetch.mock.calls.map(([url]) => url)).toEqual([
		"/api/chats?project=acme%2Fonce",
	]);
});
