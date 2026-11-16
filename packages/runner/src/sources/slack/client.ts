// Slack through the relay: the relay keeps the Events API bodies, mentionIn reads
// them; the bot token (xoxb-) reads threads and replies with the Web API.
// API shapes checked against docs.slack.dev on 2026-11-02.

export interface SlackMention {
	/** Channel id. */
	channel: string;
	/** ts of the message that mentions the bot. */
	ts: string;
	/** ts of the thread's first message, when the mention is a reply. */
	threadTs?: string;
	user: string;
	text: string;
	/** A reply in a thread without the mention: it counts only if it answers the bot. */
	reply?: true;
}

export interface SlackMessage {
	user: string;
	/** The person's display name, when Slack gives it (users:read). */
	name?: string;
	text: string;
	ts: string;
}

/** What the engine needs from Slack. */
export interface Slack {
	/** The mention in an Events API body the relay delivered, if it carries one. */
	mentionIn(body: unknown): Promise<SlackMention | undefined>;
	channelId(name: string): Promise<string | undefined>;
	/** The messages of a thread, first one first. */
	thread(channel: string, threadTs: string): Promise<SlackMessage[]>;
	permalink(channel: string, ts: string): Promise<string | undefined>;
	/** Replies in a thread; returns the reply's permalink. */
	reply(
		channel: string,
		threadTs: string,
		text: string,
	): Promise<string | undefined>;
}

/** The bot itself, as auth.test returns it: its own messages never start anything. */
export interface BotIdentity {
	userId: string;
}

interface AppMentionEvent {
	type?: string;
	user?: string;
	bot_id?: string;
	subtype?: string;
	text?: string;
	ts?: string;
	thread_ts?: string;
	channel?: string;
}

/**
 * Reads an Events API body the relay delivered: the mention of the bot by a person it
 * carries, if any.
 */
export function readEvent(
	body: unknown,
	bot: BotIdentity,
): SlackMention | undefined {
	const event = (body as { event?: AppMentionEvent } | null)?.event;
	// A reply in a thread that names the bot also comes as app_mention: counted once, there.
	const reply =
		event?.type === "message" &&
		event.thread_ts !== undefined &&
		event.thread_ts !== event.ts &&
		!(event.text ?? "").includes(`<@${bot.userId}>`);
	if (
		(event?.type !== "app_mention" && !reply) ||
		!event.user ||
		!event.channel ||
		!event.ts ||
		// Never the bot's own messages, or a reply that mentions the bot would start a run again.
		event.bot_id !== undefined ||
		event.user === bot.userId ||
		event.subtype !== undefined
	)
		return undefined;
	return {
		channel: event.channel,
		ts: event.ts,
		...(event.thread_ts && event.thread_ts !== event.ts
			? { threadTs: event.thread_ts }
			: {}),
		user: event.user,
		text: event.text ?? "",
		...(reply ? { reply: true as const } : {}),
	};
}

/** An agent's reply never pings a group: <!here>, <!channel>, <!everyone> and <!subteam^ID> become plain text. */
export const neutralizeBroadcasts = (text: string) =>
	text.replace(/<!(here|channel|everyone|subteam\^[^|>]*)(\|[^>]*)?>/g, "@$1");

/** Markdown outside code, as Slack's mrkdwn writes it. */
function mrkdwnText(text: string): string {
	return text
		.replace(/^#{1,6}\s+(.+)$/gm, "\u0000$1\u0000")
		.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `\u0000${a ?? b}\u0000`)
		.replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/g, "$1_$2_")
		.replace(/~~(.+?)~~/g, "~$1~")
		.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "<$2|$1>")
		.replaceAll("\u0000", "*");
}

/**
 * An agent writes Markdown; Slack reads its own mrkdwn: bold is *one star*, a link is
 * <url|text>, and there are no headings. Code, inline or fenced, is left as it is.
 */
export function toSlackMrkdwn(text: string): string {
	// Code is set aside, not split around: bold that wraps inline code must still pair up.
	const code: string[] = [];
	const kept = text.replace(
		/```[\s\S]*?```|`[^`\n]*`/g,
		(c) => `\uE000${code.push(c) - 1}\uE000`,
	);
	return mrkdwnText(kept).replace(
		/\uE000(\d+)\uE000/g,
		(_, i) => code[Number(i)] ?? "",
	);
}

/**
 * A channel not found is looked for again after this long, not on every mention: short, since
 * a mention right after the channel was created and the bot invited would otherwise be lost.
 */
const RELIST_MS = 10_000;

type Fetch = typeof fetch;

export interface SlackClientOptions {
	botToken: string;
	fetch?: Fetch;
}

/** Calls a Web API method. Reads go form-encoded, writes as JSON; the token is always a header. */
export async function slackCall<T>(
	token: string,
	method: string,
	args: Record<string, string | boolean | number> = {},
	options: { json?: boolean; fetch?: Fetch } = {},
): Promise<T & { ok: true }> {
	const body = options.json
		? JSON.stringify(args)
		: new URLSearchParams(
				Object.entries(args).map(([k, v]) => [k, String(v)]),
			).toString();
	const response = await (options.fetch ?? fetch)(
		`https://slack.com/api/${method}`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": options.json
					? "application/json; charset=utf-8"
					: "application/x-www-form-urlencoded",
			},
			body,
		},
	);
	const data = (await response.json()) as { ok: boolean; error?: string };
	if (!data.ok)
		throw new Error(`Slack ${method}: ${data.error ?? response.status}`);
	return data as T & { ok: true };
}

export function slackClient(options: SlackClientOptions): Slack {
	const { botToken } = options;
	const call = <T>(
		method: string,
		args: Record<string, string | boolean | number> = {},
		json = false,
	) =>
		slackCall<T>(botToken, method, args, {
			json,
			...(options.fetch ? { fetch: options.fetch } : {}),
		});
	const channels = new Map<string, string>();
	const names = new Map<string, Promise<string | undefined>>();
	/** A person's display name; undefined for an app installed before users:read, or a failed call. */
	const nameOf = (user: string) => {
		if (!names.has(user))
			names.set(
				user,
				call<{
					user?: {
						name?: string;
						real_name?: string;
						profile?: { display_name?: string; real_name?: string };
					};
				}>("users.info", { user }).then(
					({ user: u }) =>
						u?.profile?.display_name ||
						u?.profile?.real_name ||
						u?.real_name ||
						u?.name ||
						undefined,
					() => undefined,
				),
			);
		return names.get(user) as Promise<string | undefined>;
	};
	let listedAt = Number.NEGATIVE_INFINITY;
	let bot: BotIdentity | undefined;
	const me = async () => {
		bot ??= { userId: (await call<{ user_id: string }>("auth.test")).user_id };
		return bot;
	};

	const permalink = (channel: string, ts: string) =>
		call<{ permalink: string }>("chat.getPermalink", {
			channel,
			message_ts: ts,
		}).then(
			(r) => r.permalink,
			() => undefined,
		);

	return {
		async mentionIn(body) {
			const bot = await me();
			const mention = readEvent(body, bot);
			if (!mention?.reply || !mention.threadTs) return mention;
			// A reply counts when the message right before it in the thread is the bot's.
			const thread = await this.thread(mention.channel, mention.threadTs);
			const before = thread.filter((m) => m.ts < mention.ts).at(-1);
			return before?.user === bot.userId ? mention : undefined;
		},
		async channelId(name) {
			if (channels.has(name) || Date.now() - listedAt < RELIST_MS)
				return channels.get(name);
			let cursor = "";
			do {
				const page = await call<{
					channels: { id: string; name: string }[];
					response_metadata?: { next_cursor?: string };
				}>("conversations.list", {
					types: "public_channel,private_channel",
					exclude_archived: true,
					limit: 200,
					...(cursor ? { cursor } : {}),
				});
				for (const c of page.channels) channels.set(c.name, c.id);
				cursor = page.response_metadata?.next_cursor ?? "";
			} while (cursor && !channels.has(name));
			if (!cursor) listedAt = Date.now();
			return channels.get(name);
		},
		async thread(channel, threadTs) {
			// shortcut: the first 200 messages of a thread; paginate for very long threads.
			const replies = await call<{
				messages: {
					user?: string;
					bot_id?: string;
					text?: string;
					ts: string;
				}[];
			}>("conversations.replies", { channel, ts: threadTs, limit: 200 });
			return Promise.all(
				replies.messages.map(async (m) => {
					const name = m.user ? await nameOf(m.user) : undefined;
					return {
						user: m.user ?? m.bot_id ?? "",
						...(name ? { name } : {}),
						text: m.text ?? "",
						ts: m.ts,
					};
				}),
			);
		},
		permalink,
		async reply(channel, threadTs, text) {
			const posted = await call<{ ts: string }>(
				"chat.postMessage",
				{
					channel,
					thread_ts: threadTs,
					text: neutralizeBroadcasts(toSlackMrkdwn(text)),
					unfurl_links: false,
				},
				true,
			);
			return permalink(channel, posted.ts);
		},
	};
}
