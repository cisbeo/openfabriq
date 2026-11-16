import { useMemo, useSyncExternalStore } from "react";
import { readHash } from "../lib/route.js";

const subscribeHash = (update: () => void) => {
	window.addEventListener("hashchange", update);
	return () => window.removeEventListener("hashchange", update);
};

/** The page, its path and its parameters, read again whenever the hash changes. */
export function useHash() {
	const hash = useSyncExternalStore(subscribeHash, () => window.location.hash);
	return useMemo(() => readHash(hash), [hash]);
}
