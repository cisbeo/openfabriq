import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

const subscribe = (change: () => void) => {
	const query = matchMedia(QUERY);
	query.addEventListener("change", change);
	return () => query.removeEventListener("change", change);
};

/**
 * The visitor asked for less motion: the demos show a finished state instead of playing.
 * The static page is rendered with motion, so hydration starts from false.
 */
export function useReducedMotion() {
	return useSyncExternalStore(
		subscribe,
		() => matchMedia(QUERY).matches,
		() => false,
	);
}
