// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { dragToScroll } from "../../../app/src/lib/drag-scroll.js";

let stop: (() => void) | undefined;
afterEach(() => stop?.());

function row() {
	const nav = document.createElement("nav");
	const link = document.createElement("a");
	link.href = "#/board";
	nav.append(link);
	document.body.append(nav);
	stop = dragToScroll(nav);
	nav.scrollLeft = 100;
	return { nav, link };
}

const pointer = (
	target: EventTarget,
	type: string,
	clientX: number,
	pointerType = "mouse",
) =>
	target.dispatchEvent(
		new PointerEvent(type, { clientX, pointerType, button: 0, bubbles: true }),
	);

/** Whether a click on the link still goes through. */
const clicks = (link: HTMLElement) =>
	link.dispatchEvent(
		new MouseEvent("click", { bubbles: true, cancelable: true }),
	);

it("scrolls the row as the mouse drags it, and the drag opens no link", () => {
	const { nav, link } = row();
	pointer(link, "pointerdown", 200);
	pointer(window, "pointermove", 160);
	pointer(window, "pointerup", 160);
	expect(nav.scrollLeft).toBe(140);
	expect(clicks(link)).toBe(false);
	// The next click is a click again.
	expect(clicks(link)).toBe(true);
});

it("leaves a click that barely moves, and a finger, alone", () => {
	const { nav, link } = row();
	pointer(link, "pointerdown", 200);
	pointer(window, "pointermove", 197);
	pointer(window, "pointerup", 197);
	expect(nav.scrollLeft).toBe(100);
	expect(clicks(link)).toBe(true);

	pointer(link, "pointerdown", 200, "touch");
	pointer(window, "pointermove", 100, "touch");
	expect(nav.scrollLeft).toBe(100);
});
