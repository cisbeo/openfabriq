import { pageHref } from "../lib/route.js";
import type { Frame } from "./frame.js";
import { LogoMark } from "./LogoMark.js";
import { ProjectSelect } from "./ProjectSelect.js";
import { PAGES } from "./pages.js";
import { ThemeButton } from "./ThemeButton.js";

/** On a phone: the mark, the project and the theme, then the pages in a row that scrolls. */
export function PhoneHeader({
	projects,
	project,
	page,
	menuPage,
	theme,
	nextTheme,
}: Frame) {
	return (
		<header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-md md:hidden">
			<div className="flex h-12 items-center gap-2 px-4">
				<LogoMark />
				<span className="font-semibold tracking-[-0.02em]">openfabriq</span>
				<ProjectSelect
					projects={projects}
					project={project}
					page={page}
					className="ml-auto max-w-[45vw]"
				/>
				<ThemeButton theme={theme} next={nextTheme} />
			</div>
			<nav
				aria-label="Pages"
				className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none]"
			>
				{PAGES.map(({ id, label }) => (
					<a
						key={id}
						href={pageHref(id, project)}
						aria-current={menuPage === id ? "page" : undefined}
						className="shrink-0 rounded-md px-2.5 py-1 text-sm text-fg-2 no-underline aria-[current]:bg-hover aria-[current]:font-medium aria-[current]:text-fg"
					>
						{label}
					</a>
				))}
			</nav>
		</header>
	);
}
