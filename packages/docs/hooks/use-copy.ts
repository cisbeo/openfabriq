import { useEffect, useRef, useState } from "react";

/** Copies a text, and says so for a moment. */
export function useCopy(text: string) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			clearTimeout(timer.current);
			timer.current = setTimeout(() => setCopied(false), 1600);
		} catch {
			// No clipboard (an insecure page, a refused permission): the text stays selectable.
		}
	};
	return [copied, copy] as const;
}
