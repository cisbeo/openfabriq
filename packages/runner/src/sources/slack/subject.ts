import type { EventSource, Factory } from "@openfabriq/core";
import type { SourceWriter } from "../../run/outputs/apply.js";
import type { Slack } from "./client.js";

type SlackSource = Extract<EventSource, { kind: "slack" }>;

/** A Slack run answers in its thread; what it opens on GitHub links the message that asked. */
export function slackWriter(
	source: SlackSource,
	slack: Slack,
	channel: string,
): SourceWriter {
	const writer: SourceWriter = {
		comment: (body) => slack.reply(source.channel, source.thread, body),
	};
	// Asked now, used once the agent is done: the link is there long before the outputs.
	slack.permalink(source.channel, source.ts).then(
		(url) => {
			if (url) writer.bodyFooter = `Slack: [#${channel}](${url})`;
		},
		() => undefined,
	);
	return writer;
}

/**
 * A Slack message as a run's title: its first line, without Slack's markup. A mention of
 * someone is `<@U0CEZEJ8C8L>` in the text, the bot's own included: dropped; a channel or a link
 * keeps its name.
 */
export function slackTitle(text: string): string {
	return (text.split("\n")[0] ?? "")
		.replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, "")
		.replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
		.replace(/<[^|>]+\|([^>]+)>/g, "$1")
		.replace(/<([^>]+)>/g, "$1")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120);
}

/**
 * The thread the bot was mentioned in, for the agent; the mention names the run, and its
 * permalink, when Slack gives one, links it.
 */
export async function readSlackThread(
	source: SlackSource,
	slack: Slack,
	factory: Factory,
): Promise<{ data: Record<string, unknown>; title: string; url?: string }> {
	const [thread, url] = await Promise.all([
		slack.thread(source.channel, source.thread),
		slack.permalink(source.channel, source.ts),
	]);
	const mention = thread.find((m) => m.ts === source.ts) ?? thread.at(-1);
	return {
		data: {
			slack: {
				channel: `#${factory.slack?.channel ?? source.channel}`,
				mention_ts: source.ts,
				thread,
			},
		},
		title: slackTitle(mention?.text ?? ""),
		...(url ? { url } : {}),
	};
}
