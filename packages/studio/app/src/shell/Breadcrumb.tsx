import { ChevronRight } from "lucide-react";
import { crumbs } from "../lib/route.js";
import { pageLabel } from "./pages.js";

/**
 * Where the person is: the project, the page, and the run or agent open in it. Each step but
 * the last leads back up.
 */
export function Breadcrumb({
	project,
	page,
	detail,
}: {
	project: string | undefined;
	page: string;
	detail: string | undefined;
}) {
	const steps = crumbs(project, { id: page, label: pageLabel(page) }, detail);
	return (
		<nav aria-label="Breadcrumb" className="min-w-0">
			<ol className="flex min-w-0 items-center gap-1.5 text-sm">
				{steps.map((c, i) => {
					const last = i === steps.length - 1;
					return (
						<li key={c.label} className="flex min-w-0 items-center gap-1.5">
							{i > 0 && (
								<ChevronRight
									className="size-3.5 shrink-0 text-fg-3"
									aria-hidden
								/>
							)}
							{last ? (
								<span
									aria-current="page"
									className="truncate font-medium text-fg"
								>
									{c.label}
								</span>
							) : (
								<a
									href={c.href}
									className="truncate text-fg-2 no-underline transition-colors duration-150 hover:text-fg"
								>
									{c.label}
								</a>
							)}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}
