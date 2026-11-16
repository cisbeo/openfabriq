import { useEffect, useEffectEvent, useRef } from "react";

/**
 * A `<dialog>` shown as a modal while `open`, closed otherwise: the ref goes on the dialog.
 * `onShown` runs each time it opens, to put the focus where the dialog wants it.
 */
export function useModalDialog(open: boolean, onShown: () => void) {
	const dialog = useRef<HTMLDialogElement>(null);
	const shown = useEffectEvent(onShown);
	useEffect(() => {
		const box = dialog.current;
		if (!box) return;
		if (open && !box.open) {
			box.showModal();
			shown();
		}
		if (!open && box.open) box.close();
	}, [open]);
	return dialog;
}
