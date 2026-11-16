// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../../../app/src/components/ErrorBoundary.js";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function Broken(): never {
	throw new Error("Failed to fetch dynamically imported module");
}

it("shows its page while nothing fails", () => {
	render(
		<ErrorBoundary>
			<p>Runs</p>
		</ErrorBoundary>,
	);
	expect(screen.getByText("Runs")).toBeTruthy();
});

it("says why a page could not be shown, and reloads on demand, instead of a blank screen", () => {
	// React reports the caught error on the console; the test only wants what the page shows.
	vi.spyOn(console, "error").mockImplementation(() => {});
	const reload = vi
		.spyOn(window.location, "reload")
		.mockImplementation(() => {});
	render(
		<ErrorBoundary>
			<Broken />
		</ErrorBoundary>,
	);
	expect(
		screen.getByText(
			"This page could not be shown: Failed to fetch dynamically imported module",
		),
	).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Reload" }));
	expect(reload).toHaveBeenCalledOnce();
});
