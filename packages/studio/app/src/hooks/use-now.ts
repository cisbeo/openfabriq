import { useEffect, useState } from "react";

/** The time now, again every `everyMs`: for clocks of work in progress. */
export function useNow(everyMs = 1000): number {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), everyMs);
		return () => clearInterval(timer);
	}, [everyMs]);
	return now;
}
