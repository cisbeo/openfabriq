import { useLayoutEffect, useRef } from "react";

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/**
 * FLIP: after each change of `moved`, every `[data-flip]` element inside the returned ref starts
 * where it was and glides to where it is now; a new one fades in (not on the first render).
 */
export function useFlipAnimation<T extends HTMLElement>(moved: unknown) {
	const root = useRef<T>(null);
	const places = useRef(new Map<string, DOMRect>());
	// biome-ignore lint/correctness/useExhaustiveDependencies: measures the page after each change of `moved`, read from the page.
	useLayoutEffect(() => {
		const box = root.current;
		if (!box) return;
		const origin = box.getBoundingClientRect();
		const now = new Map<string, DOMRect>();
		for (const el of box.querySelectorAll<HTMLElement>("[data-flip]")) {
			const id = el.dataset.flip ?? "";
			const r = el.getBoundingClientRect();
			const at = new DOMRect(r.x - origin.x, r.y - origin.y, r.width, r.height);
			now.set(id, at);
			const before = places.current.get(id);
			if (!before) {
				if (places.current.size > 0)
					el.animate(
						[
							{ opacity: 0, transform: "translateY(-10px) scale(0.97)" },
							{ opacity: 1, transform: "none" },
						],
						{ duration: 520, easing: EASE },
					);
				continue;
			}
			const dx = before.x - at.x;
			const dy = before.y - at.y;
			if (dx || dy)
				el.animate(
					[
						{
							transform: `translate(${dx}px, ${dy}px)`,
							boxShadow: "var(--of-shadow-3)",
						},
						{ transform: "none" },
					],
					{ duration: 760, easing: EASE },
				);
		}
		places.current = now;
	}, [moved]);
	return root;
}
