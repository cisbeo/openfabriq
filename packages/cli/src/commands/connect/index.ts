import type { CommandResult } from "../../result.js";
import { connectGithub } from "./github.js";
import { connectLinear } from "./linear.js";
import { connectRelay } from "./relay.js";
import { connectSentry } from "./sentry.js";
import type { RelayDeps } from "./shared.js";
import { connectSlack } from "./slack.js";
import { connectWebhook } from "./webhook.js";

// openfabriq connect slack | linear | sentry | relay | webhook: guides the setup, tests the tokens, and
// gives the relay what it needs; every service comes through it. One file per service.
// connect github is apart: the engine's own GitHub App, no relay.

export async function connectCommand(
	service: string | undefined,
	deps: RelayDeps,
	options: {
		url?: string;
		remove?: boolean;
		name?: string;
		org?: string;
		workflows?: boolean;
		repository?: string;
	} = {},
): Promise<CommandResult> {
	if (service === "github")
		return connectGithub(deps, {
			...(options.org ? { org: options.org } : {}),
			...(options.workflows ? { workflows: true } : {}),
			...(options.url ? { url: options.url } : {}),
			...(options.name ? { action: options.name } : {}),
			...(options.repository ? { repository: options.repository } : {}),
		});
	if (service === "webhook") return connectWebhook(options.name, deps, options);
	if (service === "slack") return connectSlack(deps);
	if (service === "linear") return connectLinear(deps);
	if (service === "sentry") return connectSentry(deps);
	if (service === "relay") return connectRelay(deps, options);
	return {
		code: 1,
		output:
			"Usage: openfabriq connect github [--org name] [--workflows] [--url u] | relay [--url <url>] | slack | linear | sentry | webhook <name> [--remove]",
	};
}
