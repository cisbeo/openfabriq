// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Wiki } from "../../../app/src/features/wiki/Wiki.js";
import { WithQueries } from "../query.js";

// A search opens the page on its first hit, highlighted; the next search moves the highlight.

beforeEach(() => {
	Element.prototype.scrollIntoView = () => {};
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path: string) => ({
			ok: true,
			json: async () =>
				path.startsWith("/api/wiki/page?")
					? {
							text: "# Payments\n\nCharges go through Stripe.\n\nRefunds take a week.\n",
						}
					: {
							wiki: {
								folder: "wiki",
								refresh: "manual",
								pages: ["index.md", "payments.md"],
								titles: {},
							},
							run: null,
						},
		})),
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it("highlights only the hit of the latest search", async () => {
	const { rerender } = render(
		<Wiki project="acme/shop" page="payments.md" find="stripe" />,
		{ wrapper: WithQueries },
	);
	const stripe = await screen.findByText("Charges go through Stripe.");
	// The highlight comes from an effect, after the text is in the page: wait for it.
	await waitFor(() =>
		expect(stripe.classList.contains("bg-accent-soft")).toBe(true),
	);
	// rerender runs in act, which flushes that effect before it returns.
	rerender(<Wiki project="acme/shop" page="payments.md" find="refunds" />);
	const refunds = screen.getByText("Refunds take a week.");
	expect(refunds.classList.contains("bg-accent-soft")).toBe(true);
	expect(stripe.classList.contains("bg-accent-soft")).toBe(false);
});
