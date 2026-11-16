import {
	LINEAR_OVER,
	type LinearInstall,
	linearQuery,
	listProjects,
	readAppliedFactory,
	readSecrets,
	relayClient,
	SENTRY_OVER,
	SENTRY_URL,
	type Sentry,
	type SentryProject,
	sameOrigin,
	sentryClient,
} from "@openfabriq/runner";
import { githubSubjectState } from "./github.js";
import type { AskSubject, SubjectState } from "./subject-state.js";

type State = SubjectState | undefined;

// Field names and values checked against Linear's and Sentry's docs on 2026-11-04.
const LINEAR_ISSUE = `query ($id: String!) { issue(id: $id) { url state { type } } }`;

/** Whether a Linear issue is still open, by its URL, with the app's tokens. Undefined when no organization tells. */
export async function linearIssueState(
	url: string,
	installs: () => Promise<Pick<LinearInstall, "accessToken">[]>,
	fetchImpl: typeof fetch = fetch,
): Promise<State> {
	// https://linear.app/<workspace>/issue/ENG-12/<slug>
	const [, workspace, kind, identifier] = new URL(url).pathname.split("/");
	if (kind !== "issue" || !identifier) return undefined;
	for (const { accessToken } of await installs()) {
		try {
			const { issue } = await linearQuery<{
				issue: { url: string; state: { type: string } };
			}>(`Bearer ${accessToken}`, LINEAR_ISSUE, { id: identifier }, fetchImpl);
			// ENG-12 is unique within one organization only: the issue must be the card's.
			if (new URL(issue.url).pathname.split("/")[1] !== workspace) continue;
			return { merged: false, open: !LINEAR_OVER.includes(issue.state.type) };
		} catch {
			// Not this organization's issue.
		}
	}
	return undefined;
}

/** Whether a Sentry issue is still unresolved, by its permalink, asking each organization the factories name. */
export async function sentryIssueState(
	url: string,
	sentry: Pick<Sentry, "status">,
	projects: SentryProject[],
): Promise<State> {
	// https://<org>.sentry.io/issues/123/ or https://<host>/organizations/<org>/issues/123/
	const id = new URL(url).pathname.match(/\/issues\/(\d+)/)?.[1];
	if (!id) return undefined;
	for (const project of projects) {
		try {
			const status = await sentry.status(project, id);
			return { merged: false, open: !SENTRY_OVER.includes(status) };
		} catch {
			// Not this organization's issue.
		}
	}
	return undefined;
}

/**
 * Asks, read only, whether a board subject is still open, by its URL: Linear with the app's token
 * from the relay, Sentry with the machine's token, GitHub through gh. Undefined when nobody can tell.
 */
export function askSubject(
	gh: AskSubject = githubSubjectState,
	secrets = () => readSecrets(),
	sentryProjects = (): SentryProject[] =>
		listProjects().flatMap(
			(p) => readAppliedFactory(p.repository)?.sentry ?? [],
		),
	fetchImpl: typeof fetch = fetch,
): AskSubject {
	// One relay client while its address and token stay the same: it keeps the Linear tokens.
	let relay:
		| { key: string; client: ReturnType<typeof relayClient> }
		| undefined;
	return async (url) => {
		try {
			const host = new URL(url).hostname;
			const s = secrets();
			if (host === "linear.app") {
				if (!s.relay) return undefined;
				const key = `${s.relay.url} ${s.relay.token}`;
				if (relay?.key !== key)
					relay = { key, client: relayClient(s.relay, { fetch: fetchImpl }) };
				const { client } = relay;
				return await linearIssueState(
					url,
					() => client.linearTokens(),
					fetchImpl,
				);
			}
			const origin = s.sentry?.url ?? SENTRY_URL;
			const sentryHost = new URL(origin).hostname;
			if (host === sentryHost || host.endsWith(`.${sentryHost}`)) {
				if (!s.sentry?.token) return undefined;
				// The token goes only to the Sentry it was tested against.
				return await sentryIssueState(
					url,
					sentryClient(s.sentry.token, { origin, fetch: fetchImpl }),
					sentryProjects().filter((p) =>
						sameOrigin(p.url ?? SENTRY_URL, origin),
					),
				);
			}
			return await gh(url);
		} catch {
			return undefined;
		}
	};
}
