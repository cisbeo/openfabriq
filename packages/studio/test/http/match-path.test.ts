import { expect, it } from "vitest";
import { matchPath } from "../../src/http/match-path.js";

it("matches a path exactly, nothing more and nothing less", () => {
	expect(matchPath("/api/runs", "/api/runs")).toEqual({});
	expect(matchPath("/api/runs", "/api/runs/")).toBeUndefined();
	expect(matchPath("/api/runs", "/api")).toBeUndefined();
	expect(matchPath("/api/runs", "/api/run")).toBeUndefined();
});

it("takes one segment that is not empty for :name, as sent", () => {
	expect(matchPath("/api/chats/:id", "/api/chats/a%2Fb")).toEqual({
		id: "a%2Fb",
	});
	expect(matchPath("/api/chats/:id", "/api/chats/")).toBeUndefined();
	expect(matchPath("/api/chats/:id", "/api/chats/a/b")).toBeUndefined();
	expect(matchPath("/api/chats/:id", "/api/chats")).toBeUndefined();
});

it("takes whatever follows the slash for a final *, even nothing, but needs the slash", () => {
	expect(matchPath("/api/chats/*", "/api/chats/")).toEqual({});
	expect(matchPath("/api/chats/*", "/api/chats/a/b")).toEqual({});
	expect(matchPath("/api/chats/*", "/api/chats")).toBeUndefined();
});
