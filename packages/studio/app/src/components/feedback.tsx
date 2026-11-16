import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

// What a page shows instead of its content: an error, nothing yet, or its shape while it loads.

export function ErrorNote({ children }: { children: ReactNode }) {
	return (
		<div
			role="alert"
			className="flex items-start gap-2.5 rounded-xl border border-bad/25 bg-bad-soft px-4 py-3 text-sm text-fg"
		>
			<CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
			<div className="min-w-0">{children}</div>
		</div>
	);
}

/** An empty state that says what would fill the space, and how. */
export function Empty({
	icon,
	title,
	children,
}: {
	icon?: ReactNode;
	title: string;
	children?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-2 px-6 py-14 text-center">
			{icon && <div className="mb-3 text-fg-3 [&_svg]:size-5">{icon}</div>}
			<p className="text-sm font-medium text-fg">{title}</p>
			{children && (
				<div className="mt-1 max-w-[52ch] text-sm text-fg-2">{children}</div>
			)}
		</div>
	);
}

export function Skeleton({ className = "" }: { className?: string }) {
	return <div className={`skeleton ${className}`} aria-hidden />;
}

/** A page still loading: the shape of what comes, not a spinner. */
export function PageSkeleton() {
	return (
		<div
			role="status"
			aria-busy="true"
			aria-label="Loading"
			className="space-y-4"
		>
			<Skeleton className="h-7 w-48" />
			<Skeleton className="h-4 w-80" />
			<div className="grid gap-3 pt-4 sm:grid-cols-3">
				<Skeleton className="h-24" />
				<Skeleton className="h-24" />
				<Skeleton className="h-24" />
			</div>
			<Skeleton className="h-64" />
		</div>
	);
}
