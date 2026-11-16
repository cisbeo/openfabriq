import { useEffect, useRef } from "react";
import type { Components } from "react-markdown";
import { Prose } from "../../components/markdown.js";
import { wikiHref } from "../../lib/route.js";
import { Diagram } from "./Diagram.js";
import { hastText, isMermaid } from "./wiki-markdown.js";
import { plainText, slug, type WikiView, wikiLink } from "./wiki-view.js";

// Outside the component: a new function on each refresh would remount every diagram.
const MARKDOWN_COMPONENTS: Components = {
	h2: ({ node, children }) => (
		<h2 id={slug(plainText(hastText(node)))}>{children}</h2>
	),
	pre: ({ node, children }) =>
		isMermaid(node) ? (
			<Diagram source={hastText(node).trimEnd()} />
		) : (
			<pre>{children}</pre>
		),
};

/**
 * The page's text: links sent where wikiLink says, sections with ids for the contents, Mermaid
 * diagrams drawn, and the words searched brought into view.
 */
export function WikiPageText({
	project,
	page,
	body,
	view,
	find,
}: {
	project: string;
	page: string;
	body: string;
	view: WikiView;
	find: string | undefined;
}) {
	const box = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const words = find?.trim().toLowerCase();
		if (!words || !box.current || !body) return;
		const hit = [
			...box.current.querySelectorAll("p, li, h1, h2, h3, h4, td, pre"),
		].find((el) => el.textContent?.toLowerCase().includes(words));
		hit?.scrollIntoView({ block: "center" });
		hit?.classList.add("bg-accent-soft");
		return () => hit?.classList.remove("bg-accent-soft");
	}, [find, body]);
	return (
		<div ref={box}>
			<Prose
				className="prose-read prose-wiki"
				components={{
					a: ({ href, children }) => {
						const to =
							href === undefined
								? undefined
								: wikiLink(href, { page, view, repository: project });
						if (!to || to.kind === "anchor") return <span>{children}</span>;
						if (to.kind === "page")
							return (
								<a href={wikiHref({ project, page: to.page })}>{children}</a>
							);
						return (
							<a href={to.href} target="_blank" rel="noreferrer noopener">
								{children}
							</a>
						);
					},
					...MARKDOWN_COMPONENTS,
				}}
			>
				{body}
			</Prose>
		</div>
	);
}
