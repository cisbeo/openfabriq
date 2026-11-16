import { CircleAlert, GitPullRequest, Loader2, RefreshCw } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";
import { Elapsed } from "../../components/badges.js";
import { useModalDialog } from "../../hooks/use-modal-dialog.js";
import { runHref } from "../../lib/route.js";
import { PROSE_LINK } from "./wiki-ui.js";
import type { WikiNotice } from "./wiki-view.js";

// Asking for a run of the wiki, and following it: the button, its confirmation, the notice.

/** Off while a run of the wiki waits or works: one at a time. */
export function RefreshButton({
	label,
	busy,
	onClick,
}: {
	label: string;
	busy: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={busy}
			className="inline-flex h-8.5 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-medium text-ink-fg shadow-1 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
		>
			{busy ? (
				<Loader2 className="size-3.5 animate-spin" aria-hidden />
			) : (
				<RefreshCw className="size-3.5" aria-hidden />
			)}
			{busy ? "Writing the wiki…" : label}
		</button>
	);
}

/**
 * Asked before a run of the wiki: it spends Claude usage, so the person says yes knowing what it
 * does and what it may cost. Cancel has the focus: Enter alone never starts a run.
 */
export function ConfirmRun({
	first,
	open,
	folder,
	usdPerRun,
	onCancel,
	onConfirm,
}: {
	first: boolean;
	open: boolean;
	folder: string;
	usdPerRun: number | undefined;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const cancel = useRef<HTMLButtonElement>(null);
	const dialog = useModalDialog(open, () => cancel.current?.focus());
	const titleId = useId();
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: a click on the backdrop cancels; Escape does by keyboard
		<dialog
			ref={dialog}
			aria-labelledby={titleId}
			onClose={onCancel}
			onClick={(e) => {
				if (e.target === dialog.current) onCancel();
			}}
			className="wiki-dialog mx-auto mt-[18vh] w-[min(28rem,calc(100%-2rem))] max-w-none rounded-xl border border-line bg-panel p-0 text-fg shadow-pop backdrop:bg-ink/25"
		>
			<div className="px-5 pt-5 pb-4">
				<h2 id={titleId} className="text-base font-semibold text-fg">
					{first ? "Generate the wiki?" : "Update the wiki?"}
				</h2>
				<p className="mt-2 text-sm text-pretty text-fg-2">
					{first
						? `An agent reads the whole repository, writes the pages in ${folder}/ and opens a pull request for you to review.`
						: `An agent rewrites the pages that the latest commits made out of date, then opens a pull request for you to review.`}
				</p>
				{usdPerRun !== undefined && (
					<p className="mt-3 rounded-lg bg-sunken px-3 py-2 text-sm text-fg-2">
						It uses Claude, and stops at{" "}
						<span className="font-medium text-fg tnum">${usdPerRun}</span>, this
						factory&rsquo;s limit per run.
					</p>
				)}
			</div>
			<div className="flex justify-end gap-2 border-t border-line bg-sunken px-5 py-3">
				<button
					ref={cancel}
					type="button"
					onClick={onCancel}
					className="h-8.5 rounded-lg px-3 text-sm font-medium text-fg-2 transition-colors duration-150 hover:bg-hover hover:text-fg"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={onConfirm}
					className="h-8.5 rounded-lg bg-ink px-3 text-sm font-medium text-ink-fg shadow-1 transition-opacity hover:opacity-90"
				>
					{first ? "Generate" : "Update"}
				</button>
			</div>
		</dialog>
	);
}

/** Where the latest run of the wiki stands, above the wiki. */
export function RunNotice({
	notice,
	project,
	failure,
}: {
	notice: WikiNotice | undefined;
	project: string;
	failure: string | undefined;
}) {
	const runLink = (id: string) => (
		<a
			href={runHref(id, { project })}
			className={`whitespace-nowrap ${PROSE_LINK}`}
		>
			See the run
		</a>
	);
	const noticeBox = (tone: string, icon: ReactNode, children: ReactNode) => (
		<div
			role="status"
			className={`mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${tone}`}
		>
			<span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span>
			<p className="min-w-0 text-pretty">{children}</p>
		</div>
	);
	const working = "border-accent-line bg-accent-soft text-fg";
	if (failure)
		return noticeBox(
			"border-line bg-panel text-fg",
			<CircleAlert className="text-bad" aria-hidden />,
			failure,
		);
	if (!notice) return null;
	switch (notice.kind) {
		case "asked":
			return noticeBox(
				working,
				<Loader2 className="animate-spin text-accent-text" aria-hidden />,
				"Asked. The engine starts writing the wiki within a minute.",
			);
		case "queued":
			return noticeBox(
				working,
				<Loader2 className="animate-spin text-accent-text" aria-hidden />,
				<>
					Waiting for its turn: the engine runs a few agents at a time.{" "}
					{runLink(notice.id)}
				</>,
			);
		case "running":
			return noticeBox(
				working,
				<Loader2 className="animate-spin text-accent-text" aria-hidden />,
				<>
					The engine is writing the wiki, for <Elapsed since={notice.since} />{" "}
					so far. It opens a pull request when it is done. {runLink(notice.id)}
				</>,
			);
		case "merge":
			return noticeBox(
				"border-ok/30 bg-ok-soft text-fg",
				<GitPullRequest className="text-ok" aria-hidden />,
				<>
					The wiki is written.{" "}
					<a
						href={notice.pullRequest}
						target="_blank"
						rel="noreferrer noopener"
						className={PROSE_LINK}
					>
						Merge its pull request
					</a>{" "}
					and the pages show here, within a minute.
				</>,
			);
		case "failed":
			return noticeBox(
				"border-line bg-panel text-fg",
				<CircleAlert className="text-bad" aria-hidden />,
				<>
					The last update did not finish
					{notice.reason ? `: ${notice.reason}` : ""}. {runLink(notice.id)}
				</>,
			);
	}
}
