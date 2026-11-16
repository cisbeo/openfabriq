import { type ReactNode, Suspense } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import { PageSkeleton } from "../components/feedback.js";
import type { Board } from "../lib/types.js";
import { Breadcrumb } from "./Breadcrumb.js";
import type { Frame } from "./frame.js";
import { PhoneHeader } from "./PhoneHeader.js";
import { Sidebar } from "./Sidebar.js";

/** The pages drawn edge to edge: a graph, a chat or columns need the whole width. */
const FILLS_SCREEN = ["workflow", "chat", "board"];

/** A page that has not come yet: its shape, while it loads. */
export function LoadingPage() {
	return (
		<div className="px-4 py-6 sm:px-8 sm:py-8">
			<PageSkeleton />
		</div>
	);
}

/**
 * The frame around every page: the menu (down the left, or across the top on a phone), the
 * breadcrumb, then the page, which an error or a slow load never takes the frame down with.
 */
export function AppShell({
	frame,
	board,
	chatBusy,
	breadcrumbDetail,
	children,
}: {
	frame: Frame;
	board: Board | undefined;
	chatBusy: boolean;
	breadcrumbDetail: string | undefined;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-dvh">
			<Sidebar {...frame} board={board} chatBusy={chatBusy} />

			<div className="flex min-w-0 flex-1 flex-col">
				<header className="sticky top-0 z-20 hidden h-14 shrink-0 items-center border-b border-line bg-bg/90 px-8 backdrop-blur-md md:flex">
					<Breadcrumb
						project={frame.project}
						page={frame.menuPage}
						detail={breadcrumbDetail}
					/>
				</header>
				<PhoneHeader {...frame} />
				<main
					className={
						FILLS_SCREEN.includes(frame.page)
							? "flex min-h-0 flex-1 flex-col"
							: "mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-8 sm:py-8"
					}
				>
					<ErrorBoundary key={frame.page}>
						<Suspense fallback={<LoadingPage />}>{children}</Suspense>
					</ErrorBoundary>
				</main>
			</div>
		</div>
	);
}
