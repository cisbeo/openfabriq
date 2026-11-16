import type { ReactNode } from "react";

/** A row of mutually exclusive choices, as links: the URL holds the state. */
export function Segmented<T extends string>({
	value,
	options,
	href,
	label,
}: {
	value: T;
	options: readonly { value: T; label: ReactNode }[];
	href: (value: T) => string;
	label: string;
}) {
	return (
		<nav
			aria-label={label}
			className="inline-flex h-8 items-center rounded-lg border border-line bg-sunken p-0.5"
		>
			{options.map((o) => (
				<a
					key={o.value}
					href={href(o.value)}
					aria-current={o.value === value ? "true" : undefined}
					className="flex h-full items-center gap-1.5 rounded-md px-2.5 text-sm text-fg-2 no-underline transition-colors duration-150 hover:text-fg aria-[current]:bg-panel aria-[current]:font-medium aria-[current]:text-fg aria-[current]:shadow-1"
				>
					{o.label}
				</a>
			))}
		</nav>
	);
}
