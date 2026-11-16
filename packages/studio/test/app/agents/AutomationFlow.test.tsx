// @vitest-environment happy-dom
import type { Automation } from "@openfabriq/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AutomationFlow } from "../../../app/src/features/agents/AutomationFlow.js";

afterEach(cleanup);

it("draws a trigger without tags as its event alone, never a stray 0", () => {
	const automation = {
		name: "review-pull-requests",
		when: [{ event: "pull_request.opened", ignore_paths: [] }],
		can: [],
		instructions: "",
	} as unknown as Automation;
	render(<AutomationFlow automation={automation} agent="reviewer" />);
	expect(screen.getByText("Trigger").parentElement?.textContent).not.toContain(
		"0",
	);
});

it("draws two tags that read the same, without a duplicate key", () => {
	const errors = vi.spyOn(console, "error").mockImplementation(() => {});
	const automation = {
		name: "triage-sentry",
		when: [
			{ event: "sentry.issue.created", labels: ["urgent"], query: "urgent" },
		],
		can: [],
		instructions: "",
	} as unknown as Automation;
	render(<AutomationFlow automation={automation} agent="triager" />);
	expect(screen.getAllByText("urgent")).toHaveLength(2);
	expect(errors).not.toHaveBeenCalled();
	errors.mockRestore();
});

it("says an automation without an event runs when asked, with the command that asks", () => {
	const automation = {
		name: "wiki",
		when: [],
		can: [],
		instructions: "",
		builtIn: true,
	} as unknown as Automation;
	render(<AutomationFlow automation={automation} agent="wiki" />);
	const trigger = screen.getByText("Trigger").parentElement?.textContent;
	expect(trigger).toContain("When asked");
	expect(trigger).toContain("openfabriq run wiki");
});

it("shows the reviewer of an automation with reviewed_by, as a link, with its rounds", () => {
	const automation = {
		name: "implement-ready-issues",
		agent: "implementer",
		reviewedBy: "reviewer",
		when: [{ event: "issue.labeled", labels: ["ready-for-agent"] }],
		can: [{ action: "create_pull_request" }],
		instructions: "",
	} as unknown as Automation;
	render(
		<AutomationFlow
			automation={automation}
			agent="implementer"
			project="acme/task-app"
			current="implementer"
			reviewRounds={3}
		/>,
	);
	const agent = screen.getByText("Agent").parentElement;
	expect(agent?.textContent).toContain("Reviewed before it reaches GitHub by");
	expect(agent?.textContent).toContain("up to 3 rounds");
	expect(
		screen.getByRole("link", { name: "reviewer" }).getAttribute("href"),
	).toBe("#/agents/reviewer?project=acme%2Ftask-app");
	// The page's own agent is not a link to itself.
	expect(screen.queryByRole("link", { name: "implementer" })).toBeNull();
});
