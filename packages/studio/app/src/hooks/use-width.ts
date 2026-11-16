import { useEffect, useState } from "react";

/**
 * The width of an element, again on every resize: `ref` goes on the element. A callback ref,
 * so an element that appears later (with the data) is measured too. 0 until measured.
 */
export function useWidth(): [(el: HTMLElement | null) => void, number] {
	const [el, setEl] = useState<HTMLElement | null>(null);
	const [width, setWidth] = useState(0);
	useEffect(() => {
		if (!el) return;
		const observer = new ResizeObserver(([entry]) =>
			setWidth(entry?.contentRect.width ?? 0),
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [el]);
	return [setEl, width];
}
