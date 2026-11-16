// What react-markdown hands the wiki's renderers: hast nodes, read here without a hast library.

/** The text of a hast node (react-markdown's `node`), for a heading's id or a diagram's source. */
export function hastText(node: unknown): string {
	const n = node as { value?: unknown; children?: unknown[] } | undefined;
	if (typeof n?.value === "string") return n.value;
	return (n?.children ?? []).map(hastText).join("");
}

/** Whether a `<pre>` holds a Mermaid diagram: its `<code>` is of the language mermaid. */
export const isMermaid = (node: unknown) => {
	const code = (node as { children?: unknown[] } | undefined)?.children?.[0] as
		| { tagName?: string; properties?: { className?: unknown } }
		| undefined;
	const classes = code?.properties?.className;
	return (
		code?.tagName === "code" &&
		Array.isArray(classes) &&
		classes.includes("language-mermaid")
	);
};
