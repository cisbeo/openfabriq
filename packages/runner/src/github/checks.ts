// The checks of a pull request, as `gh pr ... --json statusCheckRollup` returns them.

interface RollupEntry {
	__typename?: string;
	name?: string;
	context?: string;
	status?: string;
	conclusion?: string;
	state?: string;
	detailsUrl?: string;
	targetUrl?: string;
}

export interface FailedCheck {
	name: string;
	conclusion: string;
	url: string;
}

// CANCELLED is left out: it is usually a run replaced by a newer one.
const FAILED = ["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ERROR"];
const PENDING_STATES = ["PENDING", "EXPECTED"];

const entriesOf = (rollup: unknown) =>
	Array.isArray(rollup) ? (rollup as RollupEntry[]) : [];
const isStatus = (e: RollupEntry) => e.__typename === "StatusContext";
const stillRunning = (entries: RollupEntry[]) =>
	entries.some((e) =>
		isStatus(e)
			? PENDING_STATES.includes(e.state ?? "")
			: e.status !== "COMPLETED",
	);

/** The failed checks, once every check has finished; empty while one still runs. */
export function failedChecks(rollup: unknown): FailedCheck[] {
	const entries = entriesOf(rollup);
	if (stillRunning(entries)) return [];
	return entries
		.map((e) => ({
			name: (isStatus(e) ? e.context : e.name) ?? "",
			conclusion: (isStatus(e) ? e.state : e.conclusion) ?? "",
			url: (isStatus(e) ? e.targetUrl : e.detailsUrl) ?? "",
		}))
		.filter((c) => FAILED.includes(c.conclusion));
}

// A finished check that failed: a check run counts only once COMPLETED.
const failedEntry = (e: RollupEntry) =>
	isStatus(e)
		? FAILED.includes(e.state ?? "")
		: e.status === "COMPLETED" && FAILED.includes(e.conclusion ?? "");

/** Where the checks of a commit stand: none at all, one failed (even while others run), still running, or all passed. */
export function checksState(
	rollup: unknown,
): "none" | "pending" | "failed" | "passed" {
	const entries = entriesOf(rollup);
	if (entries.length === 0) return "none";
	if (entries.some(failedEntry)) return "failed";
	return stillRunning(entries) ? "pending" : "passed";
}

/** The GitHub Actions job id in a check's URL, if it is one. */
export const jobId = (url: string) =>
	url.match(/\/actions\/runs\/\d+\/job\/(\d+)/)?.[1];

const EXCERPT_LINES = 100;

/** The lines before the last error: the end of a job log is only the runner cleaning up. */
export function logExcerpt(log: string): string {
	const lines = log.split("\n");
	const lastError = lines.findLastIndex((l) => l.includes("##[error]"));
	const end = lastError === -1 ? lines.length : lastError + 1;
	return lines.slice(Math.max(0, end - EXCERPT_LINES), end).join("\n");
}
