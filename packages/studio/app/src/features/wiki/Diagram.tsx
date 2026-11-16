import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useDark } from "../../hooks/use-theme.js";

// Mermaid reads hex colors, not the app's oklch tokens: the same tones, written for it.
const PALETTE = {
	light: {
		background: "#ffffff",
		node: "#f4f5f7",
		border: "#d6d9df",
		text: "#1b1e24",
		line: "#7a808b",
		accent: "#3b5bd9",
	},
	dark: {
		background: "#1c1d21",
		node: "#25272c",
		border: "#3b3e45",
		text: "#eef0f3",
		line: "#9a9fa9",
		accent: "#8aa2ff",
	},
};

/**
 * A Mermaid diagram of a wiki page, drawn in the app's colors. Mermaid loads on the first diagram
 * only, renders in strict mode (no script, no click handler, HTML labels sanitized), and a diagram
 * it cannot read stays its source.
 */
export function Diagram({ source }: { source: string }) {
	const id = `diagram-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
	const dark = useDark();
	const [svg, setSvg] = useState<string>();
	const [failed, setFailed] = useState(false);
	const box = useRef<HTMLElement>(null);
	// A diagram a little wider than the page shrinks to fit; a much wider one keeps its size and
	// scrolls, or its labels could not be read.
	useLayoutEffect(() => {
		if (!svg) return;
		const drawn = box.current?.querySelector("svg");
		const room = box.current?.clientWidth ?? 0;
		if (!drawn || !room) return;
		const width =
			drawn.viewBox.baseVal?.width || drawn.getBoundingClientRect().width;
		drawn.style.maxWidth = width <= room * 1.3 ? "100%" : "none";
	}, [svg]);
	useEffect(() => {
		let stopped = false;
		const colors = PALETTE[dark ? "dark" : "light"];
		void import("mermaid")
			.then(async ({ default: mermaid }) => {
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: "strict",
					theme: "base",
					// Drawn at its own size, scrolled when wider than the page: shrunk, its labels cannot be read.
					flowchart: { useMaxWidth: false },
					sequence: { useMaxWidth: false },
					class: { useMaxWidth: false },
					state: { useMaxWidth: false },
					er: { useMaxWidth: false },
					fontFamily: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
					themeVariables: {
						darkMode: dark,
						background: colors.background,
						fontSize: "13px",
						primaryColor: colors.node,
						primaryBorderColor: colors.border,
						primaryTextColor: colors.text,
						secondaryColor: colors.node,
						tertiaryColor: colors.background,
						lineColor: colors.line,
						textColor: colors.text,
						clusterBkg: colors.background,
						clusterBorder: colors.border,
						edgeLabelBackground: colors.background,
						nodeTextColor: colors.text,
						mainBkg: colors.node,
						actorBorder: colors.accent,
					},
				});
				const drawn = await mermaid.render(id, source);
				if (!stopped) setSvg(drawn.svg);
			})
			.catch(() => {
				if (!stopped) setFailed(true);
			});
		return () => {
			stopped = true;
		};
	}, [id, source, dark]);
	if (failed)
		return (
			<pre>
				<code>{source}</code>
			</pre>
		);
	if (!svg)
		return (
			<figure className="wiki-diagram my-6 rounded-xl border border-line bg-panel px-4 py-5">
				<span className="block h-32 animate-pulse rounded-lg bg-sunken" />
			</figure>
		);
	return (
		<figure
			ref={box}
			className="wiki-diagram my-6 overflow-x-auto rounded-xl border border-line bg-panel px-4 py-5"
			aria-label="Diagram"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid's own SVG, sanitized by it in strict mode
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	);
}
