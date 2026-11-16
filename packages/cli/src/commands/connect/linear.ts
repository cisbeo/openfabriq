import { setTimeout as wait } from "node:timers/promises";
import { errorText, exec, linearQuery } from "@openfabriq/runner";
import type { CommandResult } from "../../result.js";
import {
	connectedRelay,
	NO_RELAY,
	RESTART_START,
	type RelayDeps,
	relayCall,
} from "./shared.js";

// openfabriq connect linear: installs openfabriq as an app in Linear, through the relay.

interface RelayOrganization {
	organizationId: string;
	organizationName: string;
	accessToken: string;
}

/** Linear, as the openfabriq app: delegations and labels arrive at the relay as webhooks. */
export async function connectLinear(deps: RelayDeps): Promise<CommandResult> {
	const relay = connectedRelay();
	if (!relay) return NO_RELAY;
	deps.print(
		[
			`Linear, as the openfabriq app: people assign or mention it in an issue, or add a label. Linear reaches your relay, ${relay.url}.`,
			"An admin of the Linear workspace accepts the install; what the factory writes in Linear appears as openfabriq.",
			"",
			'1. In Linear, open Settings, API, "OAuth Applications", "New", and fill in:',
			"     Application name   openfabriq (the name on what the factory writes in Linear)",
			"     Developer name     you or your company",
			`     Redirect URIs      ${relay.url}/oauth/linear/callback`,
			`     Webhooks           on, URL ${relay.url}/hooks/linear, tick "Agent session events" and "Issues"`,
			'   Leave the other fields empty, and "Public" and "Client credentials" off.',
			"2. Create the app, then copy its client ID, client secret and webhook signing secret here.",
			"",
		].join("\n"),
	);
	const clientId = (await deps.ask("Client ID: ")).trim();
	const clientSecret = (
		await deps.ask("Client secret: ", { secret: true })
	).trim();
	const webhookSecret = (
		await deps.ask("Webhook signing secret: ", { secret: true })
	).trim();
	if (!clientId || !clientSecret || !webhookSecret)
		return {
			code: 1,
			output:
				"The client ID, the client secret and the webhook signing secret are all needed. Nothing was sent.",
		};
	try {
		// A new token, not only a new organization: installing again in the same one counts too.
		const seen = new Set(
			(await organizations(relay, deps)).map((o) => o.accessToken),
		);
		const response = await relayCall(relay, deps, "POST", "/config/linear", {
			webhookSecret,
			clientId,
			clientSecret,
		});
		const { authorizeUrl } = (await response.json().catch(() => ({}))) as {
			authorizeUrl?: string;
		};
		if (!response.ok || !authorizeUrl)
			throw new Error(`POST /config/linear answered ${response.status}`);
		// Opened by the system: only a web page, never a file or another app's scheme.
		if (!authorizeUrl.startsWith("https:"))
			throw new Error(
				"the relay gave an address to authorize the app that is not https",
			);
		deps.print(
			`Opening ${authorizeUrl}\nA Linear admin must accept the install. Waiting up to 5 minutes...`,
		);
		// The address is printed above: without a browser, it can be opened by hand.
		await (deps.exec ?? exec)(
			process.platform === "darwin" ? "open" : "xdg-open",
			[authorizeUrl],
		).catch(() => undefined);
		const installed = await waitForInstall(relay, deps, seen);
		if (!installed)
			return {
				code: 1,
				output:
					'No install came back within 5 minutes. Check the callback URL of the Linear app, then run "openfabriq connect linear" again.',
			};
		const { viewer, organization } = await linearQuery<{
			viewer: { name: string };
			organization: { name: string };
		}>(
			`Bearer ${installed.accessToken}`,
			"query { viewer { id name } organization { name } }",
			{},
			deps.fetch,
		);
		return {
			code: 0,
			output: [
				`✓ openfabriq is installed in ${organization.name} as ${viewer.name}. Assign it an issue or mention it in Linear: "openfabriq start" runs the factories of its team.`,
				RESTART_START,
				"",
				"So that each issue lists its pull request and moves to Done when it is merged, connect Linear to GitHub too: in Linear, Settings, Integrations, GitHub, add the repository.",
			].join("\n"),
		};
	} catch (error) {
		return {
			code: 1,
			output: `The install did not work (${errorText(error)}).`,
		};
	}
}

/** The organizations where the relay holds a Linear token. */
async function organizations(
	relay: { url: string; token: string },
	deps: RelayDeps,
): Promise<RelayOrganization[]> {
	const response = await relayCall(relay, deps, "GET", "/tokens/linear");
	const body = (await response.json().catch(() => ({}))) as {
		organizations?: RelayOrganization[];
	};
	if (!response.ok || !body.organizations)
		throw new Error(`GET /tokens/linear answered ${response.status}`);
	return body.organizations;
}

/** Asks the relay every 3 s for a token it did not hold before; none within 5 minutes is undefined. */
async function waitForInstall(
	relay: { url: string; token: string },
	deps: RelayDeps,
	seen: Set<string>,
): Promise<RelayOrganization | undefined> {
	const sleep = deps.sleep ?? wait;
	const now = deps.now ?? Date.now;
	const deadline = now() + 5 * 60_000;
	for (;;) {
		const installed = (await organizations(relay, deps)).find(
			(o) => !seen.has(o.accessToken),
		);
		if (installed) return installed;
		if (now() >= deadline) return undefined;
		await sleep(3000);
	}
}
