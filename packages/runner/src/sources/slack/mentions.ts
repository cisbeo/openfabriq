import type { Factory, FactoryEvent } from "@openfabriq/core";
import { remember } from "../../engine/cursors.js";
import { listProjects } from "../../state/projects.js";
import type { RelayEvent } from "../relay.js";
import type { Slack, SlackMention } from "./client.js";

type Options = {
	appliedFactory: (repo: string) => Factory | undefined;
	warn: (line: string) => void;
	queue: (repo: string, factory: Factory, event: FactoryEvent) => void;
};

/** The relay's Slack events: each mention of the bot is heard once. */
export function slackEvents(
	slack: Slack,
	options: Options,
): (events: RelayEvent[]) => Promise<void> {
	const heard = slackMentions(slack, options);
	return async (events) => {
		for (const event of events)
			if (event.service === "slack" && event.kind === "webhook") {
				const m = await slack.mentionIn(event.payload);
				if (m) await heard(m);
			}
	};
}

/**
 * Hears a mention of the bot in Slack. It counts for the projects whose factory listens to that
 * channel: the bot only hears channels it was invited to, and the channel is checked again here.
 */
function slackMentions(
	slack: Slack,
	{ appliedFactory, warn, queue }: Options,
): (m: SlackMention) => Promise<void> {
	const seen = new Set<string>();
	return async (m) => {
		const key = `slack:${m.channel}:${m.ts}`;
		if (seen.has(key)) return; // Slack retries an event it thinks was not received
		remember(seen, key);
		try {
			for (const { repository: repo } of listProjects()) {
				const factory = appliedFactory(repo);
				if (!factory?.slack) continue;
				const id = await slack.channelId(factory.slack.channel);
				if (id === undefined)
					warn(
						`${repo}: Slack channel #${factory.slack.channel} not found; create it and invite the bot`,
					);
				if (id !== m.channel) continue;
				queue(repo, factory, {
					key,
					event: "slack.mentioned",
					isPullRequest: false,
					actor: m.user,
					at: new Date(Number(m.ts) * 1000).toISOString(),
					source: {
						kind: "slack",
						channel: m.channel,
						thread: m.threadTs ?? m.ts,
						ts: m.ts,
					},
				});
			}
		} catch (error) {
			seen.delete(key); // Slack's retry gets another chance
			throw error;
		}
	};
}
