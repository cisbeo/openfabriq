import type {
	AskSubject,
	SubjectState,
	SubjectStates,
} from "./subject-state.js";

/** An open subject is asked about again after this by default: the metrics ask about every pull request. A closed or merged one never. */
const ASK_OPEN_AGAIN_MS = 5 * 60_000;
/** For the cards that need someone, few: a card merged on GitHub leaves Needs you within a minute. */
export const ASK_NEEDED_AGAIN_MS = 60_000;
/** gh, Linear and Sentry are asked about four subjects at a time. */
const ASKED_AT_ONCE = 4;

/**
 * `ask`, with a cache: a merged or closed subject is final; an open one is asked again once older than
 * `maxAgeMs` (five minutes unless the caller says otherwise).
 * shortcut: a subject reopened later (or a Sentry issue that regresses) stays closed until the app restarts; ask again if that matters.
 */
export function cachedStates(
	ask: AskSubject,
): (urls: string[], maxAgeMs?: number) => Promise<SubjectStates> {
	const cache = new Map<
		string,
		{ at: number; state: Promise<SubjectState | undefined> }
	>();
	let running = 0;
	const waiting: (() => void)[] = [];
	const limited = async (url: string) => {
		while (running >= ASKED_AT_ONCE)
			await new Promise<void>((ok) => waiting.push(ok));
		running++;
		try {
			return await ask(url);
		} finally {
			running--;
			waiting.shift()?.();
		}
	};
	return async (urls: string[], maxAgeMs = ASK_OPEN_AGAIN_MS) => {
		const now = Date.now();
		const entries = await Promise.all(
			urls.map(async (url) => {
				let hit = cache.get(url);
				if (!hit || now - hit.at > maxAgeMs) {
					hit = { at: now, state: limited(url) };
					cache.set(url, hit);
				}
				const state = await hit.state;
				if (state && !state.open) hit.at = Number.POSITIVE_INFINITY;
				return [url, state] as const;
			}),
		);
		return Object.fromEntries(entries);
	};
}
