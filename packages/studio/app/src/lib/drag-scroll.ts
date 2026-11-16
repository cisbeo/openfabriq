/** How far a press moves before it is a drag, not a click. */
const THRESHOLD = 5;

/**
 * Lets a mouse drag sideways a row that scrolls with no scrollbar (a finger already can). A drag
 * does not open the link it started on. A ref callback: `<nav ref={dragToScroll}>`.
 */
export function dragToScroll(
	row: HTMLElement | null,
): (() => void) | undefined {
	if (!row) return;
	let start: { x: number; left: number } | undefined;
	let dragged = false;
	const down = (e: PointerEvent) => {
		if (e.pointerType !== "mouse" || e.button !== 0) return;
		start = { x: e.clientX, left: row.scrollLeft };
		dragged = false;
	};
	const move = (e: PointerEvent) => {
		if (!start) return;
		const dx = e.clientX - start.x;
		if (!dragged && Math.abs(dx) < THRESHOLD) return;
		dragged = true;
		row.scrollLeft = start.left - dx;
	};
	const up = () => {
		start = undefined;
	};
	const click = (e: MouseEvent) => {
		if (!dragged) return;
		dragged = false;
		e.preventDefault();
		e.stopPropagation();
	};
	// A link would start the browser's own drag and drop instead.
	const dragstart = (e: DragEvent) => e.preventDefault();
	row.addEventListener("pointerdown", down);
	window.addEventListener("pointermove", move);
	window.addEventListener("pointerup", up);
	row.addEventListener("click", click, true);
	row.addEventListener("dragstart", dragstart);
	return () => {
		row.removeEventListener("pointerdown", down);
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerup", up);
		row.removeEventListener("click", click, true);
		row.removeEventListener("dragstart", dragstart);
	};
}
