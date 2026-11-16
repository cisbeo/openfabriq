import { useState } from "react";
import { useInView } from "./use-in-view";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * A demo that plays by itself: only while on screen, never when the visitor asked for less
 * motion, and not once paused.
 */
export function useAutoplay<T extends Element>(margin: string) {
	const [ref, inView] = useInView<T>(margin);
	const reduced = useReducedMotion();
	const [paused, setPaused] = useState(false);
	return {
		ref,
		reduced,
		paused,
		setPaused,
		running: inView && !paused && !reduced,
	};
}
