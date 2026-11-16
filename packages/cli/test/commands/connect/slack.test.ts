import { expect, it } from "vitest";
import { connectCommand } from "../../../src/commands/connect/index.js";
import type { RelayDeps } from "../../../src/commands/connect/shared.js";
import { slackManifest } from "../../../src/commands/connect/slack.js";
import { calls, printed, RELAY, saved, withRelay } from "./helpers.js";

it("prints a Slack manifest pointing at the relay, with app_mention and the minimal scopes", () => {
	const manifest = slackManifest(`${RELAY}/hooks/slack`);
	expect(manifest).toContain(
		[
			"oauth_config:",
			"  scopes:",
			"    bot:",
			"      - app_mentions:read",
			"      - chat:write",
			"      - channels:history",
			"      - groups:history",
			"      - channels:read",
			"      - groups:read",
			"      - users:read",
			"settings:",
			"  event_subscriptions:",
			`    request_url: ${RELAY}/hooks/slack`,
			"    bot_events:",
			"      - app_mention",
		].join("\n"),
	);
	expect(manifest).toContain("  socket_mode_enabled: false");
	// Replies to the bot in a thread, without the mention.
	expect(manifest).toContain(
		[
			"      - app_mention",
			"      - message.channels",
			"      - message.groups",
		].join("\n"),
	);
});

function slackRelayDeps(
	configStatus = 204,
): RelayDeps & { posted: unknown[]; copied: string[]; asked: string[] } {
	const posted: unknown[] = [];
	const copied: string[] = [];
	const asked: string[] = [];
	return {
		posted,
		copied,
		asked,
		ask: async (question) => {
			asked.push(question);
			if (question === "Signing secret: ") return " sign-1 ";
			if (question.startsWith("Bot token")) return "xoxb-2-B";
			return "";
		},
		copy: async (text) => {
			copied.push(text);
			return true;
		},
		print: (text) => printed.push(text),
		fetch: (async (url: string, init: RequestInit) => {
			const auth = (init.headers as Record<string, string>).Authorization;
			calls.push(`${url} ${auth}`);
			if (url.endsWith("/config/slack")) {
				posted.push(JSON.parse(String(init.body)));
				return { ok: configStatus < 300, status: configStatus } as Response;
			}
			return {
				json: async () => ({ ok: true, user: "openfabriq", team: "Acme" }),
			} as Response;
		}) as typeof fetch,
	};
}

it("needs a relay before setting Slack up through it", async () => {
	expect(await connectCommand("slack", slackRelayDeps())).toEqual({
		code: 1,
		output: 'No relay yet: run "openfabriq connect relay" first.',
	});
});

it("points Slack at the relay: the signing secret to the relay, the bot token here", async () => {
	withRelay();
	const slack = slackRelayDeps();
	const result = await connectCommand("slack", slack);
	expect(result).toEqual({
		code: 0,
		output: expect.stringContaining("Slack connected: @openfabriq in Acme."),
	});
	expect(printed[0]).toContain(`    request_url: ${RELAY}/hooks/slack`);
	expect(printed[0]).toContain("  socket_mode_enabled: false");
	expect(slack.posted).toEqual([{ signingSecret: "sign-1" }]);
	// Step 1 on its own: the manifest copied on Enter, then a wait until the app exists.
	expect(slack.copied).toEqual([slackManifest(`${RELAY}/hooks/slack`)]);
	expect(slack.asked).toEqual([
		"Copy the manifest to your clipboard? [Y/n] ",
		"Press Enter once the app is created. ",
		"Signing secret: ",
		"Bot token (xoxb-...): ",
	]);
	expect(printed).toContain("Copied: paste it in Slack.");
	// Step 5 comes once the token works: the invitation follows the connection.
	expect(printed.join("\n")).not.toContain("/invite");
	expect(result.output).toContain("5. In Slack, invite the bot");
	expect(calls).toEqual([
		`${RELAY}/config/slack Bearer rt`,
		"https://slack.com/api/auth.test Bearer xoxb-2-B",
	]);
	expect(saved()).toEqual({
		relay: { url: RELAY, token: "rt" },
		slack: { bot_token: "xoxb-2-B" },
	});
});

it("saves nothing when the relay refuses the signing secret", async () => {
	withRelay();
	expect(await connectCommand("slack", slackRelayDeps(401))).toEqual({
		code: 1,
		output:
			"The relay did not take the signing secret (POST /config/slack answered 401). Nothing was saved.",
	});
	expect(saved().slack).toBeUndefined();
});
