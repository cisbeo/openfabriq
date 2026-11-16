"use client";

import { Maximize2, X } from "lucide-react";
import { useRef } from "react";

/**
 * Opens a template's workflow image at full size, in a modal: Escape, the cross or a click beside
 * the image closes it. The icon shows when its `group` is hovered, and always on touch. `cover`: a
 * click anywhere on the image opens it; otherwise only the icon does (a card, whose click opens the
 * template's page).
 */
export function FullscreenImage({
	src,
	alt,
	cover = false,
}: {
	src: string;
	alt: string;
	cover?: boolean;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const icon =
		"flex size-9 items-center justify-center rounded-lg border border-of-line bg-of-panel/90 text-fd-muted-foreground opacity-0 shadow-of-2 backdrop-blur transition-[opacity,color] duration-200 group-hover:opacity-100 [@media(hover:none)]:opacity-100";
	return (
		<>
			<button
				type="button"
				onClick={() => dialog.current?.showModal()}
				aria-label={`Open full screen: ${alt}`}
				className={
					cover
						? "absolute inset-0 z-10 cursor-zoom-in rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
						: `absolute right-3 bottom-3 z-10 ${icon} hover:text-fd-foreground focus-visible:opacity-100`
				}
			>
				{cover ? (
					<span
						className={`absolute right-3 bottom-3 ${icon} group-hover:text-fd-foreground`}
					>
						<Maximize2 className="size-4" aria-hidden />
					</span>
				) : (
					<Maximize2 className="size-4" aria-hidden />
				)}
			</button>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop click is a mouse shortcut; Escape and the close button serve the keyboard */}
			<dialog
				ref={dialog}
				aria-label={alt}
				// A click on the backdrop lands on the dialog itself, not on the image.
				onClick={(e) => {
					if (e.target === dialog.current) dialog.current.close();
				}}
				className="m-auto max-h-[calc(100dvh-2rem)] w-fit max-w-[calc(100vw-2rem)] bg-transparent p-0 backdrop:bg-black/75 backdrop:backdrop-blur-sm"
			>
				<form method="dialog" className="mb-2 flex justify-end">
					<button
						type="submit"
						aria-label="Close"
						className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
					>
						<X className="size-5" aria-hidden />
					</button>
				</form>
				{/* The image and its ground share the dark theme's filter, as on the page. */}
				<div className="of-diagram overflow-auto rounded-2xl bg-[#f3f4f6] p-4 sm:p-8">
					{/* biome-ignore lint/performance/noImgElement: a static export has no image optimizer. */}
					<img
						src={src}
						alt={alt}
						loading="lazy"
						className="max-h-[calc(100dvh-8rem)] w-auto max-w-full object-contain"
					/>
				</div>
			</dialog>
		</>
	);
}
