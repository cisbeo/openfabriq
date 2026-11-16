import { type RefObject, useEffect, useRef, useState } from "react";

/** True while the element is on screen: the demos play only when someone can see them. */
export function useInView<T extends Element>(
	margin = "0px",
): [RefObject<T | null>, boolean] {
	const ref = useRef<T>(null);
	const [inView, setInView] = useState(false);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const observer = new IntersectionObserver(
			([entry]) => setInView(entry?.isIntersecting ?? false),
			{ rootMargin: margin },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [margin]);
	return [ref, inView];
}
