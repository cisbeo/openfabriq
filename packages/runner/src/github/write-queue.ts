// GitHub asks for a second between writes, and at least a minute, growing, after a rate limit
// refusal; insisting while refused can get the account's API access suspended. gh never retries.
const WRITE_GAP_MS = 1000;
const RATE_LIMIT_WAITS_MS = [60_000, 120_000, 240_000];
const isRateLimited = (error: unknown) =>
	/secondary rate limit|rate limit exceeded|\(HTTP 429\)/i.test(String(error));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// One queue for every write of the engine: GitHub counts a user's writes together, whatever the run.
let writes: Promise<unknown> = Promise.resolve();
let lastWrite = Number.NEGATIVE_INFINITY;

/** Runs a write in its turn, a second after the previous one, and waits out GitHub's rate limits. */
export function write<T>(call: () => Promise<T>): Promise<T> {
	const next = writes.then(async () => {
		for (let attempt = 0; ; attempt++) {
			const gap = lastWrite + WRITE_GAP_MS - Date.now();
			if (gap > 0) await sleep(gap);
			lastWrite = Date.now();
			try {
				return await call();
			} catch (error) {
				if (!isRateLimited(error)) throw error;
				const wait = RATE_LIMIT_WAITS_MS[attempt];
				if (wait === undefined) {
					const minutes = RATE_LIMIT_WAITS_MS.reduce((a, b) => a + b) / 60_000;
					throw new Error(
						`GitHub's rate limit: refused ${attempt + 1} times over ${minutes} minutes. ${(error as Error).message}`,
					);
				}
				await sleep(wait);
			}
		}
	});
	writes = next.catch(() => undefined);
	return next;
}
