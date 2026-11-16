import { ArrowLeft, ArrowRight } from "lucide-react";
import { wikiHref } from "../../lib/route.js";
import { SearchButton } from "./SearchPalette.js";
import { type pageGroups, pageName } from "./wiki-view.js";

// The ways around the wiki: its pages, the page's sections and sources, the pages beside it.

const NAV_ITEM =
	"block truncate rounded-md px-2.5 py-1.5 text-sm text-fg-2 no-underline transition-colors duration-150 hover:bg-hover hover:text-fg aria-[current]:bg-panel aria-[current]:font-medium aria-[current]:text-fg aria-[current]:shadow-1";

/** The search, then the pages by folder: a list from tablets up, a menu on a phone. */
export function PageNav({
	project,
	page,
	groups,
	title,
	onSearch,
}: {
	project: string;
	page: string;
	groups: ReturnType<typeof pageGroups>;
	title: (page: string) => string;
	onSearch: () => void;
}) {
	return (
		<nav
			aria-label="Wiki pages"
			className="min-w-0 md:sticky md:top-20 md:-mx-1 md:-mt-1 md:max-h-[calc(100dvh-6rem)] md:self-start md:overflow-y-auto md:px-1 md:pt-1 md:pb-6"
		>
			<div className="mb-3">
				<SearchButton onOpen={onSearch} />
			</div>

			{/* On a phone, one menu: the list would push the page far down. */}
			<label className="block md:hidden">
				<span className="sr-only">Page</span>
				<select
					value={page}
					onChange={(e) => {
						window.location.hash = wikiHref({ project, page: e.target.value });
					}}
					className="h-9 w-full rounded-lg border border-line bg-panel px-2.5 text-sm text-fg shadow-1"
				>
					{groups.map((group) =>
						group.pages.map((p) => (
							<option key={p} value={p}>
								{group.folder ? `${pageName(group.folder)} · ` : ""}
								{title(p)}
							</option>
						)),
					)}
				</select>
			</label>
			<div className="hidden md:block">
				{groups.map((group) => (
					<div key={group.folder ?? ""} className="mt-1 first:mt-0">
						{group.folder && (
							<p className="mt-4 mb-1 px-2.5 text-xs font-medium text-fg-3">
								{pageName(group.folder)}
							</p>
						)}
						<ul className="space-y-px">
							{group.pages.map((p) => (
								<li key={p}>
									<a
										href={wikiHref({ project, page: p })}
										aria-current={p === page ? "page" : undefined}
										className={NAV_ITEM}
									>
										{title(p)}
									</a>
								</li>
							))}
						</ul>
					</div>
				))}
			</div>
		</nav>
	);
}

/** The files a page was written from, on GitHub. */
export function Sources({
	sources,
	github,
}: {
	sources: string[];
	github: (path: string) => string;
}) {
	return (
		<section
			aria-labelledby="wiki-sources"
			className="mt-12 border-t border-line pt-5"
		>
			<h2 id="wiki-sources" className="text-sm font-medium text-fg">
				Sources
			</h2>
			<p className="mt-0.5 text-xs text-fg-3">
				The files this page was written from.
			</p>
			<ul className="mt-3 flex flex-wrap gap-1.5">
				{sources.map((path) => (
					<li key={path}>
						<a
							href={github(path)}
							target="_blank"
							rel="noreferrer noopener"
							className="inline-flex max-w-full rounded-md bg-sunken px-2 py-1 font-mono text-2xs [overflow-wrap:anywhere] text-fg-2 no-underline ring-1 ring-line transition-colors duration-150 hover:text-fg hover:ring-line-2"
						>
							{path}
						</a>
					</li>
				))}
			</ul>
		</section>
	);
}

/** The pages before and after this one, in the order of the list. */
export function Neighbors({
	project,
	previous,
	next,
	title,
}: {
	project: string;
	previous: string | undefined;
	next: string | undefined;
	title: (page: string) => string;
}) {
	return (
		<nav
			aria-label="Previous and next pages"
			className="mt-10 grid grid-cols-2 gap-3 border-t border-line pt-5"
		>
			{previous ? (
				<a
					href={wikiHref({ project, page: previous })}
					className="group rounded-lg px-3 py-2.5 no-underline transition-colors duration-150 hover:bg-hover"
				>
					<span className="flex items-center gap-1 text-xs text-fg-3">
						<ArrowLeft className="size-3" aria-hidden />
						Previous
					</span>
					<span className="mt-0.5 block truncate text-sm font-medium text-fg">
						{title(previous)}
					</span>
				</a>
			) : (
				<span />
			)}
			{next && (
				<a
					href={wikiHref({ project, page: next })}
					className="group rounded-lg px-3 py-2.5 text-right no-underline transition-colors duration-150 hover:bg-hover"
				>
					<span className="flex items-center justify-end gap-1 text-xs text-fg-3">
						Next
						<ArrowRight className="size-3" aria-hidden />
					</span>
					<span className="mt-0.5 block truncate text-sm font-medium text-fg">
						{title(next)}
					</span>
				</a>
			)}
		</nav>
	);
}

/** The page's sections, from wide screens up: a click scrolls to one. */
export function Contents({
	contents,
}: {
	contents: { text: string; id: string }[];
}) {
	return (
		<aside
			aria-label="On this page"
			className="hidden xl:sticky xl:top-20 xl:block xl:self-start"
		>
			<p className="mb-2 text-xs font-medium text-fg-2">On this page</p>
			<ul className="space-y-1 border-l border-line">
				{contents.map((s) => (
					<li key={s.id}>
						<button
							type="button"
							onClick={() =>
								document
									.getElementById(s.id)
									?.scrollIntoView({ behavior: "smooth", block: "start" })
							}
							className="-ml-px block border-l border-transparent py-0.5 pl-3 text-left text-sm text-fg-2 transition-colors duration-150 hover:border-line-2 hover:text-fg"
						>
							{s.text}
						</button>
					</li>
				))}
			</ul>
		</aside>
	);
}
