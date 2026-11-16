import { dragToScroll } from "../lib/drag-scroll.js";

/** A tab of a page: its `tab=` value, its name, and a count beside the name when it helps. */
export interface TabItem<T extends string> {
	id: T;
	label: string;
	count?: number;
}

/** A page's tabs, as links: each one is an address, so a link opens it. */
export function Tabs<T extends string>({
	label,
	tabs,
	current,
	href,
}: {
	/** What the tabs belong to, for a screen reader: "Run", "Agent". */
	label: string;
	tabs: TabItem<T>[];
	current: T;
	href: (tab: T) => string;
}) {
	return (
		// The line under the tabs is a shadow, not a border, so a row too wide for a phone scrolls.
		<nav
			ref={dragToScroll}
			aria-label={label}
			className="mb-6 flex overflow-x-auto shadow-[inset_0_-1px_0_var(--color-line)] [scrollbar-width:none] sm:gap-1"
		>
			{tabs.map((t) => (
				<a
					key={t.id}
					href={href(t.id)}
					aria-current={t.id === current ? "page" : undefined}
					className="inline-flex h-10 shrink-0 items-center gap-2 border-b-2 border-transparent px-2 sm:px-3 text-sm font-medium text-fg-2 no-underline transition-colors duration-150 hover:text-fg aria-[current]:border-fg aria-[current]:text-fg"
				>
					{t.label}
					{t.count !== undefined && (
						<span className="tnum rounded-md bg-hover px-1.5 text-2xs leading-5 text-fg-2">
							{t.count}
						</span>
					)}
				</a>
			))}
		</nav>
	);
}
