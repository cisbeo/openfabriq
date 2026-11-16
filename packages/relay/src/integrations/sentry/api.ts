// Sentry polled by the relay: new issues of a project, found with the factory's own
// search, kept for the engine like a webhook. Paths and parameters as the engine used them.

export interface SentryConfig {
	token: string;
	/** The Sentry the token was tested against: the token goes nowhere else. */
	origin: string;
}

export interface SentryWatch {
	organization: string;
	project: string;
	query?: string;
}

/** A watch with its own fields only, `query` left out when absent. */
export const watchFields = (w: SentryWatch): SentryWatch => ({
	organization: w.organization,
	project: w.project,
	...(w.query === undefined ? {} : { query: w.query }),
});

export interface SentryIssue {
	id: string;
	shortId: string;
	permalink: string;
	firstSeen: string;
}

/** Pages read per watch and per alarm. */
export const MAX_PAGES = 5;

/** The user's search, or Sentry's default, bounded to the issues first seen after `since`. */
function sentryQuery(query: string | undefined, since: number): string {
	// Sentry's search takes an absolute time without milliseconds: 2026-11-02T10:00:00Z.
	const at = `${new Date(since).toISOString().slice(0, 19)}Z`;
	return `${query ?? "is:unresolved"} firstSeen:>${at}`;
}

/** The next page in a Link header, while Sentry says there are results. */
function nextPage(link: string | null): string | undefined {
	for (const part of (link ?? "").split(",")) {
		const url = /<([^>]+)>/.exec(part)?.[1];
		if (url && /rel="next"/.test(part) && /results="true"/.test(part))
			return url;
	}
	return undefined;
}

/** The http(s) origin of a URL, or undefined. */
export function originOf(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" || parsed.protocol === "http:"
			? parsed.origin
			: undefined;
	} catch {
		return undefined;
	}
}

async function get(
	config: SentryConfig,
	url: string,
): Promise<{ data: unknown; link: string | null }> {
	if (originOf(url) !== config.origin)
		throw new Error(
			`${originOf(url) ?? url} is not the Sentry the token is for (${config.origin})`,
		);
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${config.token}` },
	});
	const data = (await response.json().catch(() => undefined)) as unknown;
	if (!response.ok) {
		const detail = (data as { detail?: string } | undefined)?.detail;
		throw new Error(
			`Sentry GET ${new URL(url).pathname}: ${response.status}${detail ? ` ${detail}` : ""}`,
		);
	}
	return { data, link: response.headers.get("link") };
}

/** The numeric id: older self-hosted Sentry may not accept a slug in ?project=. */
export async function projectId(
	config: SentryConfig,
	watch: SentryWatch,
): Promise<string> {
	const { data } = await get(
		config,
		`${config.origin}/api/0/projects/${encodeURIComponent(watch.organization)}/${encodeURIComponent(watch.project)}/`,
	);
	return String((data as { id: string }).id);
}

/** The issues first seen after `since` (epoch ms), oldest first. */
export async function issuesSince(
	config: SentryConfig,
	watch: SentryWatch,
	project: string,
	since: number,
): Promise<SentryIssue[]> {
	const params = new URLSearchParams({
		project,
		query: sentryQuery(watch.query, since),
		sort: "new",
		// The default time window is not documented: make sure it covers `since`.
		statsPeriod: "14d",
		limit: "100",
	});
	const issues: SentryIssue[] = [];
	let url: string | undefined =
		`${config.origin}/api/0/organizations/${encodeURIComponent(watch.organization)}/issues/?${params}`;
	// shortcut: at most MAX_PAGES pages per watch at each alarm, since the Workers free plan caps subrequests per invocation (around 50, shared by all the watches); spread pages over alarms if a project outgrows it.
	for (let page = 0; url && page < MAX_PAGES; page++) {
		const answer = await get(config, url);
		issues.push(...(answer.data as SentryIssue[]));
		url = nextPage(answer.link);
	}
	return issues.sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
}
