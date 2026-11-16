// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FactoryYaml } from "../../../app/src/features/settings/Settings.js";

afterEach(cleanup);

const YAML =
	"name: Task app factory\nrepository: acme/task-app\nsecrets: [STRIPE_KEY]\n";

it("shows factory.yaml in full in a modal, and closes", () => {
	const onClose = vi.fn();
	render(
		<FactoryYaml
			open
			yaml={YAML}
			repository="acme/task-app"
			onClose={onClose}
		/>,
	);
	const dialog = screen.getByRole("dialog", {
		name: "openfabriq/factory.yaml",
	});
	expect(dialog.querySelector("pre")?.textContent).toBe(YAML);
	expect(
		screen.getByRole("link", { name: "On GitHub" }).getAttribute("href"),
	).toBe("https://github.com/acme/task-app/blob/HEAD/openfabriq/factory.yaml");
	fireEvent.click(screen.getByRole("button", { name: "Close" }));
	expect(onClose).toHaveBeenCalled();
});
