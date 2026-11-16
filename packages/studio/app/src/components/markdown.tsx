import { ChevronDown, FileText } from "lucide-react";
import { memo, type ReactNode, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownPreview } from "../lib/format.js";

/**
 * Links open in a new tab. An image shows as a link to it, never loaded: its URL could
 * carry data out the moment the page opens (index.html's CSP blocks it too).
 */
export const MARKDOWN: Components = {
	a: ({ node: _node, ...props }) => (
		<a {...props} target="_blank" rel="noreferrer noopener" />
	),
	img: ({ src, alt }) =>
		typeof src === "string" && src ? (
			<a href={src} target="_blank" rel="noreferrer noopener">
				{alt || "image"}
			</a>
		) : (
			alt
		),
};

/**
 * Markdown from people and agents. No raw HTML: react-markdown drops it, and its default
 * URL transform drops `javascript:` links. Content from GitHub is data, never markup. Memoized: a
 * run's log, read again every few seconds, parses only the rows that changed.
 */
export const Prose = memo(function Prose({
	children,
	className = "",
	components,
}: {
	children: string;
	className?: string;
	/** Overrides, such as the wiki's links. */
	components?: Components;
}) {
	return (
		<div className={`prose ${className}`}>
			<Markdown
				remarkPlugins={[remarkGfm]}
				skipHtml
				components={components ? { ...MARKDOWN, ...components } : MARKDOWN}
			>
				{children}
			</Markdown>
		</div>
	);
});

/**
 * A Markdown file of the factory, read where it stands: a row that says what it is (title,
 * first words, path) and opens in place on the whole text, with its source one click away.
 * `flush` drops the row's own frame when it sits inside a card, so boxes never nest.
 */
export function MarkdownDoc({
	path,
	text,
	title,
	badge,
	summary,
	flush = false,
	defaultOpen = false,
}: {
	path: string;
	text: string;
	/** What the file is ("Task", "Brief", a skill's name); its first heading comes after. */
	title: string;
	/** A tag next to the title, such as who reads a skill. */
	badge?: ReactNode;
	/** One line that says what the file is for, shown instead of its first words. */
	summary?: string;
	flush?: boolean;
	/** Open on the whole text, where the file is all there is to read. */
	defaultOpen?: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const [source, setSource] = useState(false);
	const preview = markdownPreview(text);
	const tab =
		"h-6 rounded-md px-2 text-2xs font-medium transition-colors duration-150";
	return (
		<div
			className={flush ? "" : "rounded-xl border border-line bg-panel shadow-1"}
		>
			<div
				className={`group/doc relative flex items-start gap-3.5 rounded-lg transition-colors duration-150 ${flush ? "py-3" : "p-4"}`}
			>
				<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sunken ring-1 ring-line">
					<FileText
						className="size-4 text-fg-2 transition-colors duration-150 group-hover/doc:text-fg"
						aria-hidden
					/>
				</span>
				{/* The whole row opens the file: the button's ::after covers it. */}
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
					className="min-w-0 flex-1 text-left outline-none after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-accent"
				>
					<span className="flex items-center gap-2">
						<span className="text-sm font-semibold text-fg underline decoration-transparent underline-offset-4 transition-colors duration-150 group-hover/doc:decoration-line-2">
							{title}
						</span>
						{badge}
						{!summary && preview.title && preview.title !== title && (
							<span className="truncate text-sm text-fg-2">
								{preview.title}
							</span>
						)}
					</span>
					{summary && (
						<span className="mt-1 block text-sm text-pretty text-fg-2">
							{summary}
						</span>
					)}
					{!summary && !open && preview.excerpt && (
						<span className="mt-1 line-clamp-2 block text-sm text-pretty text-fg-2">
							{preview.excerpt}
						</span>
					)}
					<span className="mt-1.5 block truncate font-mono text-2xs text-fg-3">
						{path}
					</span>
				</button>
				<span className="relative z-10 flex shrink-0 items-center gap-2">
					{open && (
						<fieldset className="flex items-center gap-0.5 rounded-lg bg-hover p-0.5">
							<legend className="sr-only">View</legend>
							<button
								type="button"
								aria-pressed={!source}
								onClick={() => setSource(false)}
								className={`${tab} ${source ? "text-fg-2 hover:text-fg" : "bg-panel text-fg shadow-1"}`}
							>
								Preview
							</button>
							<button
								type="button"
								aria-pressed={source}
								onClick={() => setSource(true)}
								className={`${tab} ${source ? "bg-panel text-fg shadow-1" : "text-fg-2 hover:text-fg"}`}
							>
								Markdown
							</button>
						</fieldset>
					)}
					<button
						type="button"
						aria-expanded={open}
						onClick={() => setOpen(!open)}
						tabIndex={-1}
						className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-fg-2 transition-colors group-hover/doc:text-fg hover:bg-hover"
					>
						{open ? "Close" : "Read"}
						<ChevronDown
							className={`size-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
							aria-hidden
						/>
					</button>
				</span>
			</div>
			{open && (
				<div
					className={`rise ${flush ? "pt-1 pb-3 pl-[50px]" : "pr-4 pb-6 pl-[66px] sm:pr-10"}`}
				>
					{source ? (
						<pre className="overflow-x-auto rounded-lg bg-sunken px-4 py-3 font-mono text-[13px] leading-6 whitespace-pre-wrap text-fg">
							{text}
						</pre>
					) : (
						<Prose className="prose-read">{text}</Prose>
					)}
				</div>
			)}
		</div>
	);
}
