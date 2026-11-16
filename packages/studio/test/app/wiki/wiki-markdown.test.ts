import { expect, it } from "vitest";
import {
	hastText,
	isMermaid,
} from "../../../app/src/features/wiki/wiki-markdown.js";

const text = (value: string) => ({ type: "text", value });
const element = (
	tagName: string,
	children: unknown[],
	className?: string[],
) => ({
	type: "element",
	tagName,
	properties: className ? { className } : {},
	children,
});

it("joins the text of a node and of everything under it", () => {
	expect(
		hastText(element("h2", [text("Pay"), element("code", [text("ments")])])),
	).toBe("Payments");
	expect(hastText(text("alone"))).toBe("alone");
	expect(hastText(undefined)).toBe("");
});

it("sees a Mermaid diagram only in a pre whose first child is code in that language", () => {
	const pre = (code: unknown) => element("pre", [code]);
	expect(
		isMermaid(pre(element("code", [text("graph TD")], ["language-mermaid"]))),
	).toBe(true);
	expect(isMermaid(pre(element("code", [text("x")], ["language-ts"])))).toBe(
		false,
	);
	expect(isMermaid(pre(text("graph TD")))).toBe(false);
	expect(isMermaid(element("pre", []))).toBe(false);
});
