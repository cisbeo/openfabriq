// @vitest-environment happy-dom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Chat } from "../../../app/src/features/chat/Chat.js";
import { OFFLINE } from "../../../app/src/lib/api.js";

// Deleting a past conversation: when the server does not delete it, it stays in the list.

const old = {
	id: "3f0c1d2e-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
	title: "How are pull requests reviewed?",
	createdAt: "2026-11-01T10:00:00.000Z",
	updatedAt: "2026-11-01T10:00:00.000Z",
	costUsd: 0.25,
	turns: 1,
};

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

/** The chat of `project`, whose server lists one old conversation and answers its DELETE with `deleted`. */
async function chatWithOld(project: string, deleted: () => Promise<unknown>) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_path: string, init?: RequestInit) =>
			init?.method === "DELETE"
				? deleted()
				: { ok: true, status: 200, json: async () => [old] },
		),
	);
	render(<Chat project={project} projects={[project]} />);
	await act(async () => {});
	fireEvent.click(screen.getByLabelText("Delete this conversation"));
	await act(async () => {
		fireEvent.click(screen.getByText("Delete"));
	});
}

it("keeps the conversation and says why when the server refuses to delete it", async () => {
	await chatWithOld("acme/refused", async () => ({
		ok: false,
		status: 409,
		statusText: "Conflict",
		json: async () => ({ error: "This conversation is answering right now." }),
	}));
	expect(screen.getByRole("alert").textContent).toBe(
		"This conversation is answering right now.",
	);
	expect(screen.getByText(old.title)).toBeTruthy();
});

it("keeps the conversation when the server does not answer", async () => {
	await chatWithOld("acme/offline", async () => {
		throw new TypeError("Failed to fetch");
	});
	expect(screen.getByRole("alert").textContent).toBe(OFFLINE);
	expect(screen.getByText(old.title)).toBeTruthy();
});

it("takes the conversation out of the list once deleted", async () => {
	await chatWithOld("acme/deleted", async () => ({ ok: true, status: 204 }));
	expect(screen.queryByRole("alert")).toBeNull();
	expect(screen.queryByText(old.title)).toBeNull();
});
