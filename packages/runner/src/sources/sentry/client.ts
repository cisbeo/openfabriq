// Sentry's REST API with an auth token: what an agent reads of an issue, and its notes.
// The relay looks for new issues. Paths and fields checked against docs.sentry.io and
// getsentry/sentry on 2026-11-02.

export interface SentryProject {
	organization: string;
	project: string;
	/** Base URL, https://sentry.io by default. */
	url?: string;
}

/** What the engine needs from Sentry. */
export interface Sentry {
	/** The Sentry the token was tested against: it goes nowhere else. */
	readonly origin: string;
	/** What the agent reads: the issue, and the stack trace of its latest event. */
	issueContext(
		project: SentryProject,
		issueId: string,
	): Promise<Record<string, unknown>>;
	/** Adds a note to the issue. */
	note(project: SentryProject, issueId: string, text: string): Promise<void>;
	/** The issue's status: unresolved, resolved, ignored… Only the organization and url of `project` are used. */
	status(project: SentryProject, issueId: string): Promise<string>;
}

/** The statuses of an issue whose work is over. */
export const SENTRY_OVER = ["resolved", "ignored"];

/** The Sentry a factory reads when it names no url, and a token is for when none was given. */
export const SENTRY_URL = "https://sentry.io";
export const sameOrigin = (a: string, b: string) =>
	new URL(a).origin === new URL(b).origin;

const base = (p: SentryProject) => p.url ?? SENTRY_URL;

interface Frame {
	filename?: string | null;
	absPath?: string | null;
	function?: string | null;
	module?: string | null;
	lineNo?: number | null;
	colNo?: number | null;
	inApp?: boolean | null;
	context?: [number, string][] | null;
}

interface SentryEvent {
	entries?: {
		type?: string;
		data?: {
			values?: {
				type?: string | null;
				value?: string | null;
				stacktrace?: { frames?: Frame[] | null } | null;
			}[];
		};
	}[];
	tags?: { key: string; value: string }[];
	release?: { version?: string } | null;
	dateCreated?: string;
}

const STACK_LIMIT = 8000;

/**
 * The exceptions of an event and their frames, innermost frame first, as text. Frame variables
 * (`vars`) are left out: they are where personal data most often sits.
 */
export function stackTrace(event: SentryEvent, limit = STACK_LIMIT): string {
	const lines: string[] = [];
	for (const entry of event.entries ?? []) {
		if (entry.type !== "exception") continue;
		for (const value of entry.data?.values ?? []) {
			lines.push(`${value.type ?? "Error"}: ${value.value ?? ""}`);
			const frames = [...(value.stacktrace?.frames ?? [])].reverse();
			for (const frame of frames) {
				const where = [
					frame.filename ?? frame.absPath ?? frame.module ?? "?",
					frame.lineNo,
					frame.colNo,
				]
					.filter((x) => x !== null && x !== undefined)
					.join(":");
				lines.push(
					`  at ${frame.function ?? "?"} (${where})${frame.inApp ? "" : " [library]"}`,
				);
				const line = frame.context?.find(([n]) => n === frame.lineNo)?.[1];
				if (frame.inApp && line) lines.push(`      ${line.trim()}`);
			}
		}
	}
	const text = lines.join("\n");
	return text.length > limit
		? `${text.slice(0, limit)}\n… (cut at ${limit} characters)`
		: text;
}

/** The fields the agent reads, from the issue details and its latest event. */
export function issueContext(
	issue: Record<string, unknown>,
	event: SentryEvent | undefined,
): Record<string, unknown> {
	const tag = (key: string) => event?.tags?.find((t) => t.key === key)?.value;
	const pick = (key: string) => issue[key];
	return {
		short_id: pick("shortId"),
		title: pick("title"),
		culprit: pick("culprit"),
		level: pick("level"),
		status: pick("status"),
		events: pick("count"),
		users: pick("userCount"),
		first_seen: pick("firstSeen"),
		last_seen: pick("lastSeen"),
		environment: tag("environment"),
		release: event?.release?.version ?? tag("release"),
		url: pick("permalink"),
		latest_event_at: event?.dateCreated,
		stack_trace: event ? stackTrace(event) : undefined,
	};
}

type Fetch = typeof fetch;

/** origin: the Sentry the token is for. The token never goes anywhere else, whatever factory.yaml says. */
export function sentryClient(
	/** Or how to read it: the token saved now, so one replaced by "connect sentry" needs no restart. */
	token: string | (() => string),
	options: { origin: string; fetch?: Fetch },
): Sentry {
	const { origin, fetch: fetchImpl = fetch } = options;
	const call = async (
		url: string,
		init: { method?: string; body?: unknown } = {},
	): Promise<{ data: unknown; link: string | null }> => {
		if (!sameOrigin(url, origin))
			throw new Error(
				`${new URL(url).origin} is not the Sentry the token is for (${new URL(origin).origin}); run "openfabriq connect sentry"`,
			);
		const response = await fetchImpl(url, {
			method: init.method ?? "GET",
			headers: {
				Authorization: `Bearer ${typeof token === "function" ? token() : token}`,
				...(init.body ? { "Content-Type": "application/json" } : {}),
			},
			...(init.body ? { body: JSON.stringify(init.body) } : {}),
		});
		const data = (await response.json().catch(() => undefined)) as unknown;
		if (!response.ok) {
			const detail = (data as { detail?: string } | undefined)?.detail;
			throw new Error(
				`Sentry ${init.method ?? "GET"} ${new URL(url).pathname}: ${response.status}${detail ? ` ${detail}` : ""}`,
			);
		}
		return { data, link: response.headers.get("link") };
	};
	const issuePath = (p: SentryProject, id: string) =>
		`${base(p)}/api/0/organizations/${encodeURIComponent(p.organization)}/issues/${encodeURIComponent(id)}/`;

	return {
		origin,
		async issueContext(p, issueId) {
			const [{ data: issue }, latest] = await Promise.all([
				call(issuePath(p, issueId)),
				call(`${issuePath(p, issueId)}events/latest/`).then(
					(r) => r.data as SentryEvent,
					() => undefined, // an issue without a readable event still has its summary
				),
			]);
			return issueContext(issue as Record<string, unknown>, latest);
		},
		async note(p, issueId, text) {
			// Not in Sentry's public API docs: the endpoint its own UI uses.
			await call(`${issuePath(p, issueId)}comments/`, {
				method: "POST",
				body: { text },
			});
		},
		async status(p, issueId) {
			const { data } = await call(issuePath(p, issueId));
			return String((data as { status?: unknown }).status);
		},
	};
}
