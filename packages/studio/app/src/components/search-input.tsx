import { Search, X } from "lucide-react";

/** A search field that narrows a list: Escape or the cross clears it. */
export function SearchInput({
	label,
	value,
	onChange,
	className = "",
}: {
	label: string;
	value: string;
	onChange: (text: string) => void;
	className?: string;
}) {
	return (
		<div className={`relative flex min-w-0 items-center ${className}`}>
			<Search
				aria-hidden
				className="pointer-events-none absolute left-2.5 size-3.5 text-fg-3"
			/>
			<input
				type="search"
				aria-label={label}
				placeholder={label}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") onChange("");
				}}
				className="h-8.5 w-full rounded-lg border border-line bg-panel pr-8 pl-8 text-sm text-fg shadow-1 transition-colors placeholder:text-fg-3 hover:border-line-2 focus-visible:rounded-lg [&::-webkit-search-cancel-button]:appearance-none"
			/>
			{value && (
				<button
					type="button"
					aria-label="Clear the search"
					onClick={() => onChange("")}
					className="absolute right-1 grid size-6.5 place-items-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg"
				>
					<X aria-hidden className="size-3.5" />
				</button>
			)}
		</div>
	);
}
