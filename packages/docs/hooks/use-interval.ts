import { useEffect, useRef } from "react";

/** Calls `step` every `ms` while `running`; the interval starts over each time it resumes. */
export function useInterval(running: boolean, ms: number, step: () => void) {
	const saved = useRef(step);
	saved.current = step;
	useEffect(() => {
		if (!running) return;
		const id = setInterval(() => saved.current(), ms);
		return () => clearInterval(id);
	}, [running, ms]);
}
