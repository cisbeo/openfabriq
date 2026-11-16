import { cn } from "@/lib/cn";

// The studio's mark (packages/studio/app/src/shell/Nav.tsx): a factory roof, following the site's theme.
export function LogoMark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 20 20"
			aria-hidden="true"
			className={cn("size-6 shrink-0", className)}
		>
			<rect
				width="20"
				height="20"
				rx="5"
				className="fill-zinc-900 dark:fill-zinc-50"
			/>
			<path
				d="M4.5 14.5V8.6l3.6 2.3V8.6l3.6 2.3V5.5h3.8v9z"
				className="fill-zinc-50 dark:fill-zinc-900"
			/>
		</svg>
	);
}

/** The mark and the name, as the sidebar and the home page show them. */
export function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
	return (
		<span
			className={cn(
				"inline-flex items-center font-semibold tracking-tight",
				size === "lg" ? "gap-3 text-4xl sm:text-5xl" : "gap-2",
			)}
		>
			<LogoMark className={size === "lg" ? "size-12 sm:size-14" : undefined} />
			openfabriq
		</span>
	);
}
