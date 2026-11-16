import { join } from "node:path";
import { readJsonIfExists, writeFileAtomic } from "../files.js";
import { home } from "./projects.js";

// The relay keeps an event 7 days: an id older than that never comes back.
const KEPT_MS = 7 * 24 * 60 * 60 * 1000;
const file = () => join(home(), "relay-handled.json");

/** The relay events the engine handled already, by id, with when: a restart must not run them again. */
export function readHandledRelayEvents(): Map<string, number> {
	return new Map(
		Object.entries(readJsonIfExists<Record<string, number>>(file()) ?? {}),
	);
}

/** Saves them, without those the relay no longer keeps. */
export function saveHandledRelayEvents(
	handled: Map<string, number>,
	now: number,
): void {
	for (const [id, at] of handled) if (now - at > KEPT_MS) handled.delete(id);
	writeFileAtomic(file(), `${JSON.stringify(Object.fromEntries(handled))}\n`);
}
