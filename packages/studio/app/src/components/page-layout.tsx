import type { ReactNode } from "react";

// How a page is laid out: its title row, and its sections.

/** A page's title row: what this is, in one line, and its controls on the right. */
export function PageHeader({
	title,
	description,
	children,
}: {
	title: ReactNode;
	description?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
			<div className="min-w-0">
				<h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">
					{title}
				</h1>
				{description && (
					<p className="mt-1.5 max-w-[70ch] text-sm text-fg-2">{description}</p>
				)}
			</div>
			{children && (
				<div className="flex flex-wrap items-center gap-2">{children}</div>
			)}
		</header>
	);
}

/** A section of a page: its heading, an optional line on the right, then its content. */
export function Section({
	title,
	aside,
	children,
	className = "",
}: {
	title: ReactNode;
	aside?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section className={className}>
			<div className="mb-3 flex items-baseline justify-between gap-4">
				<h2 className="text-sm font-semibold text-fg">{title}</h2>
				{aside && <div className="text-xs text-fg-2">{aside}</div>}
			</div>
			{children}
		</section>
	);
}
