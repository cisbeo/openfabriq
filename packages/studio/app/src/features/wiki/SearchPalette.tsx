import { CornerDownLeft, FileText, Search, TextSearch } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useApi } from "../../hooks/use-api.js";
import { useDebouncedValue } from "../../hooks/use-debounced-value.js";
import { useModalDialog } from "../../hooks/use-modal-dialog.js";
import { query } from "../../lib/api.js";
import { MAC } from "../../lib/platform.js";
import {
	highlight,
	type PaletteItem,
	pageTitle,
	paletteItems,
	plainText,
	type WikiMatch,
	type WikiView,
} from "./wiki-view.js";

/** ⌘K, or Ctrl+K: how the wiki's search opens. */
const SHORTCUT = MAC ? "⌘K" : "Ctrl K";

const Kbd = ({ children }: { children: string }) => (
	<kbd className="rounded border border-line bg-sunken px-1.5 font-sans text-2xs text-fg-3">
		{children}
	</kbd>
);

function Marked({ text, words }: { text: string; words: string }) {
	return (
		<>
			{highlight(text, words).map((part, i) =>
				part.match ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string
					<mark key={i} className="rounded-[3px] bg-accent-soft text-fg">
						{part.text}
					</mark>
				) : (
					part.text
				),
			)}
		</>
	);
}

/** The button that stands where the search was: it opens the palette, and says how by keyboard. */
export function SearchButton({ onOpen }: { onOpen: () => void }) {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex h-8.5 w-full items-center gap-2 rounded-lg border border-line bg-panel px-2.5 text-sm text-fg-3 shadow-1 transition-colors duration-150 hover:border-line-2 hover:text-fg-2"
		>
			<Search className="size-3.5 shrink-0" aria-hidden />
			<span className="flex-1 text-left">Search the wiki</span>
			<Kbd>{SHORTCUT}</Kbd>
		</button>
	);
}

/**
 * The wiki's search, over the page: pages by name as you type, then the lines of text that hold
 * the words. Arrows move, Enter opens, Escape closes; a click on the backdrop closes too.
 */
export function SearchPalette({
	project,
	view,
	open,
	onClose,
	onPick,
}: {
	project: string;
	view: WikiView;
	open: boolean;
	onClose: () => void;
	onPick: (page: string, find?: string) => void;
}) {
	const input = useRef<HTMLInputElement>(null);
	const dialog = useModalDialog(open, () => input.current?.select());
	const list = useId();
	const [words, setWords] = useState("");
	// What the search asks: the words once the person stops typing.
	const debouncedWords = useDebouncedValue(words.trim(), 200);
	const [active, setActive] = useState(0);
	const found = useApi<WikiMatch[]>(
		open && debouncedWords.length > 1
			? `/api/wiki/search${query({ project, q: debouncedWords })}`
			: undefined,
	);
	const matches = debouncedWords === words.trim() ? (found.data ?? []) : [];
	const items = paletteItems(words, view, matches);
	const searching =
		words.trim().length > 1 &&
		(debouncedWords !== words.trim() || found.loading);
	const pick = (item: PaletteItem | undefined) => {
		if (!item) return;
		onPick(item.page, item.kind === "line" ? words.trim() : undefined);
	};
	const optionId = (i: number) => `${list}-${i}`;
	const pages = items.filter((i) => i.kind === "page");
	const lines = items.filter((i) => i.kind === "line");
	const row = (item: PaletteItem, i: number) => {
		const selected = i === active;
		return (
			// biome-ignore lint/a11y/useKeyWithClickEvents: the combobox's input drives the keyboard (arrows, Enter)
			<div
				key={item.kind === "page" ? item.page : `${item.page}:${item.line}`}
				id={optionId(i)}
				role="option"
				tabIndex={-1}
				aria-selected={selected}
				onMouseMove={() => setActive(i)}
				onClick={() => pick(item)}
				className={`flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 ${selected ? "bg-hover" : ""}`}
			>
				{item.kind === "page" ? (
					<FileText className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden />
				) : (
					<TextSearch
						className="mt-0.5 size-4 shrink-0 text-fg-3"
						aria-hidden
					/>
				)}
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium text-fg">
						{item.kind === "page" ? (
							<Marked text={pageTitle(item.page, view.titles)} words={words} />
						) : (
							pageTitle(item.page, view.titles)
						)}
					</span>
					{item.kind === "line" && (
						<span className="mt-0.5 line-clamp-2 block text-xs text-fg-2">
							<Marked text={plainText(item.text)} words={words} />
						</span>
					)}
				</span>
				{selected && (
					<CornerDownLeft
						className="mt-0.5 size-3.5 shrink-0 text-fg-3"
						aria-hidden
					/>
				)}
			</div>
		);
	};
	const group = "px-3 pt-3 pb-1 text-xs font-medium text-fg-3";
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: a click on the backdrop closes it; Escape does by keyboard
		<dialog
			ref={dialog}
			aria-label="Search the wiki"
			onClose={onClose}
			onClick={(e) => {
				if (e.target === dialog.current) onClose();
			}}
			className="wiki-dialog mx-auto mt-[12vh] w-[min(40rem,calc(100%-2rem))] max-w-none overflow-hidden rounded-xl border border-line bg-panel p-0 text-fg shadow-pop backdrop:bg-ink/25"
		>
			<div className="flex items-center gap-2.5 border-b border-line px-4">
				<Search className="size-4 shrink-0 text-fg-3" aria-hidden />
				<input
					ref={input}
					type="text"
					role="combobox"
					aria-expanded="true"
					aria-controls={list}
					aria-activedescendant={items.length ? optionId(active) : undefined}
					aria-label="Search the wiki"
					placeholder="Search pages and text"
					value={words}
					onChange={(e) => {
						setWords(e.target.value);
						setActive(0);
					}}
					onKeyDown={(e) => {
						if (e.key === "ArrowDown" || e.key === "ArrowUp") {
							e.preventDefault();
							const step = e.key === "ArrowDown" ? 1 : -1;
							setActive((a) =>
								items.length ? (a + step + items.length) % items.length : 0,
							);
						} else if (e.key === "Enter") {
							e.preventDefault();
							pick(items[active]);
						}
					}}
					className="h-13 min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-3"
				/>
				{searching && (
					<span className="text-xs text-fg-3" aria-live="polite">
						Searching…
					</span>
				)}
			</div>
			<div
				id={list}
				role="listbox"
				aria-label="Results"
				className="max-h-[min(26rem,60vh)] overflow-y-auto p-2"
			>
				{pages.length > 0 && (
					<div role="presentation" className={group}>
						Pages
					</div>
				)}
				{pages.map(row)}
				{lines.length > 0 && (
					<div role="presentation" className={group}>
						In the text
					</div>
				)}
				{lines.map((item, i) => row(item, pages.length + i))}
				{items.length === 0 && !searching && (
					<p className="px-3 py-8 text-center text-sm text-fg-2">
						No page has “{words.trim()}”.
					</p>
				)}
			</div>
			<div className="flex items-center gap-4 border-t border-line bg-sunken px-4 py-2 text-2xs text-fg-3">
				<span className="flex items-center gap-1.5">
					<Kbd>↑</Kbd>
					<Kbd>↓</Kbd> to move
				</span>
				<span className="flex items-center gap-1.5">
					<Kbd>↵</Kbd> to open
				</span>
				<span className="flex items-center gap-1.5">
					<Kbd>esc</Kbd> to close
				</span>
			</div>
		</dialog>
	);
}
