import {
	errorText,
	secretsPath,
	slackCall,
	writeSecrets,
} from "@openfabriq/runner";
import type { CommandResult } from "../../result.js";
import {
	type ConnectDeps,
	connectedRelay,
	NO_RELAY,
	RESTART_START,
	relayCall,
} from "./shared.js";

// openfabriq connect slack: points a Slack app at the relay.

/** The bot scopes the engine uses, and why (checked on docs.slack.dev). */
const SLACK_SCOPES = [
	["app_mentions:read", "hear the mentions of the bot"],
	["chat:write", "reply in the thread"],
	["channels:history", "read the thread, in a public channel"],
	["groups:history", "read the thread, in a private channel"],
	["channels:read", "find the channel of factory.yaml by its name"],
	["groups:read", "same, for a private channel"],
	["users:read", "name the people of a thread, instead of their ids"],
] as const;

/** Slack sends the events to the relay over HTTP. */
export function slackManifest(requestUrl: string): string {
	const name = "openfabriq";
	return [
		"_metadata:",
		"  major_version: 1",
		"display_information:",
		`  name: ${name}`,
		"  description: Runs the software factory of your repository on your machine",
		"features:",
		"  bot_user:",
		`    display_name: ${name}`,
		"    always_online: false",
		"oauth_config:",
		"  scopes:",
		"    bot:",
		...SLACK_SCOPES.map(([scope]) => `      - ${scope}`),
		"settings:",
		"  event_subscriptions:",
		`    request_url: ${requestUrl}`,
		"    bot_events:",
		"      - app_mention",
		// A reply to the bot in a thread, without the mention.
		"      - message.channels",
		"      - message.groups",
		"  org_deploy_enabled: false",
		"  socket_mode_enabled: false",
		"  token_rotation_enabled: false",
	].join("\n");
}

/**
 * Slack over HTTP, through the relay: the signing secret goes to the relay, which
 * checks Slack's requests; the bot token stays here, to read threads and reply.
 */
export async function connectSlack(deps: ConnectDeps): Promise<CommandResult> {
	const relay = connectedRelay();
	if (!relay) return NO_RELAY;
	const manifest = slackManifest(`${relay.url}/hooks/slack`);
	deps.print(
		[
			`Slack, through your relay: Slack sends each mention to ${relay.url}, which keeps it until "openfabriq start" takes it, even while this machine sleeps.`,
			"",
			'1. Open https://api.slack.com/apps, "Create New App", "From a manifest", pick your workspace, choose the YAML tab and paste this manifest:',
			"",
			manifest,
			"",
		].join("\n"),
	);
	if (deps.copy) {
		const answer = await deps.ask(
			"Copy the manifest to your clipboard? [Y/n] ",
		);
		if (!/^n/i.test(answer.trim()))
			deps.print(
				(await deps.copy(manifest))
					? "Copied: paste it in Slack."
					: "This machine has no clipboard command: select the manifest above.",
			);
	}
	await deps.ask("Press Enter once the app is created. ");
	deps.print(
		'2. Slack opens the app\'s settings: in "Basic Information" (left menu), "App Credentials", show the Signing Secret (not the Client Secret nor the Verification Token) and paste it here.\n',
	);
	const signingSecret = (
		await deps.ask("Signing secret: ", { secret: true })
	).trim();
	if (!signingSecret)
		return { code: 1, output: "No signing secret given. Nothing was saved." };
	try {
		const response = await relayCall(relay, deps, "POST", "/config/slack", {
			signingSecret,
		});
		if (!response.ok)
			throw new Error(`POST /config/slack answered ${response.status}`);
	} catch (error) {
		return {
			code: 1,
			output: `The relay did not take the signing secret (${errorText(error)}). Nothing was saved.`,
		};
	}
	deps.print(
		[
			'3. In "App Manifest" (left menu), the banner at the top says the request URL is not verified: click "Click here to verify". The relay answers Slack\'s challenge now that it has the signing secret; if it fails, the signing secret is the wrong one: run "openfabriq connect slack" again.',
			'4. In "Install App" (left menu), install the app to your workspace and allow it, then copy the Bot User OAuth Token (xoxb-...) it shows and paste it here.',
			"",
		].join("\n"),
	);
	const botToken = (
		await deps.ask("Bot token (xoxb-...): ", { secret: true })
	).trim();
	if (!botToken.startsWith("xoxb-"))
		return {
			code: 1,
			output:
				"The bot token starts with xoxb-. Nothing was saved on this machine.",
		};
	try {
		const me = await slackCall<{ user: string; team: string }>(
			botToken,
			"auth.test",
			{},
			deps.fetch ? { fetch: deps.fetch } : {},
		);
		writeSecrets("slack", { bot_token: botToken });
		return {
			code: 0,
			output: [
				`Slack connected: @${me.user} in ${me.team}. Token saved in ${secretsPath()}. "openfabriq start" takes the mentions from ${relay.url}.`,
				RESTART_START,
				"",
				`5. In Slack, invite the bot to the channel named in factory.yaml: /invite @${me.user}. A private channel is safer: whoever is in it can start the factory.`,
			].join("\n"),
		};
	} catch (error) {
		return {
			code: 1,
			output: `The bot token does not work (${errorText(error)}). Nothing was saved on this machine.`,
		};
	}
}
