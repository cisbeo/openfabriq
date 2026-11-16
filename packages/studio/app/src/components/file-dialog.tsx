import { ExternalLink } from "lucide-react";
import { useId, useRef } from "react";
import { useModalDialog } from "../hooks/use-modal-dialog.js";

/**
 * A file of the factory in full, read only, in a modal: factory.yaml, an agent.md. Close has the
 * focus; Escape or the backdrop closes it too.
 */
export function FileDialog({
	open,
	path,
	note,
	text,
	repository,
	onClose,
}: {
	open: boolean;
	/** Its path in the repository, the dialog's title. */
	path: string;
	note: string;
	text: string;
	repository: string;
	onClose: () => void;
}) {
	const close = useRef<HTMLButtonElement>(null);
	const dialog = useModalDialog(open, () => close.current?.focus());
	const titleId = useId();
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: a click on the backdrop closes; Escape does by keyboard
		<dialog
			ref={dialog}
			aria-labelledby={titleId}
			onClose={onClose}
			onClick={(e) => {
				if (e.target === dialog.current) onClose();
			}}
			className="mx-auto mt-[8vh] w-[min(48rem,calc(100%-2rem))] max-w-none rounded-xl border border-line bg-panel p-0 text-fg shadow-pop backdrop:bg-ink/25"
		>
			<div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
				<h2 id={titleId} className="font-mono text-sm font-medium text-fg">
					{path}
				</h2>
				<span className="text-xs text-fg-3">{note}</span>
			</div>
			<pre className="max-h-[65vh] overflow-y-auto bg-sunken px-5 py-4 font-mono text-xs leading-5 whitespace-pre-wrap text-fg [overflow-wrap:anywhere]">
				{text}
			</pre>
			<div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
				<a
					href={`https://github.com/${repository}/blob/HEAD/${path}`}
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center gap-1.5 text-sm text-accent-text"
				>
					On GitHub
					<ExternalLink className="size-3.5" aria-hidden />
				</a>
				<button
					ref={close}
					type="button"
					onClick={onClose}
					className="h-8.5 rounded-lg px-3 text-sm font-medium text-fg-2 transition-colors duration-150 hover:bg-hover hover:text-fg"
				>
					Close
				</button>
			</div>
		</dialog>
	);
}
