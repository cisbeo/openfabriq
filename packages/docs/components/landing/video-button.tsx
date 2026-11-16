"use client";

import { Play, X } from "lucide-react";
import { useRef } from "react";
import { ProductVideo } from "../product-video";

/** The film opens in a modal, playing; Escape, the cross or a click beside it closes it and pauses it. */
export function VideoButton() {
	const dialog = useRef<HTMLDialogElement>(null);
	const video = () => dialog.current?.querySelector("video");
	return (
		<>
			<button
				type="button"
				onClick={() => {
					dialog.current?.showModal();
					void video()?.play();
				}}
				className="group inline-flex items-center gap-2.5 text-sm font-medium text-fd-foreground"
			>
				<span className="flex size-8 items-center justify-center rounded-full border border-of-line bg-of-panel shadow-of-2 transition-transform group-hover:scale-105">
					<Play className="size-3.5 translate-x-px fill-current" aria-hidden />
				</span>
				Watch the film
				<span className="text-fd-muted-foreground">· 85 s</span>
			</button>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop click is a mouse shortcut; Escape and the close button serve the keyboard */}
			<dialog
				ref={dialog}
				aria-label="openfabriq in 85 seconds"
				onClose={() => video()?.pause()}
				// A click on the backdrop lands on the dialog itself, not on the film.
				onClick={(e) => {
					if (e.target === dialog.current) dialog.current.close();
				}}
				className="m-auto w-[calc(100%-2rem)] max-w-5xl bg-transparent p-0 backdrop:bg-black/75 backdrop:backdrop-blur-sm"
			>
				<form method="dialog" className="mb-2 flex justify-end">
					<button
						type="submit"
						aria-label="Close the film"
						className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
					>
						<X className="size-5" aria-hidden />
					</button>
				</form>
				<ProductVideo />
			</dialog>
		</>
	);
}
