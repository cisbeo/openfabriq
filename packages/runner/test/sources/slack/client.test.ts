import { expect, it, vi } from "vitest";
import {
	neutralizeBroadcasts,
	readEvent,
	slackClient,
	toSlackMrkdwn,
} from "../../../src/sources/slack/client.js";

const bot = { userId: "UBOT" };
const appMention = {
	type: "app_mention",
	user: "U1",
	text: "<@UBOT> fix the header",
	ts: "1700000000.000100",
	channel: "C1",
	event_ts: "1700000000.000100",
};

const body = (event: Record<string, unknown>) => ({
	type: "event_callback",
	event_id: "Ev1",
	event,
});

it("reads the mention of the bot in an Events API body, and its thread", () => {
	expect(readEvent(body(appMention), bot)).toEqual({
		channel: "C1",
		ts: "1700000000.000100",
		user: "U1",
		text: "<@UBOT> fix the header",
	});
	expect(
		readEvent(body({ ...appMention, thread_ts: "1699.1" }), bot),
	).toMatchObject({ threadTs: "1699.1" });
});

it("ignores the bot's own messages and other events", () => {
	for (const event of [
		{ ...appMention, user: "UBOT" },
		{ ...appMention, bot_id: "BBOT" },
		{ ...appMention, subtype: "message_changed" },
		{ ...appMention, type: "message" },
	])
		expect(readEvent(body(event), bot)).toBeUndefined();
	expect(readEvent(null, bot)).toBeUndefined();
});

function fakeSlack(
	thread: { user?: string; bot_id?: string; text: string; ts: string }[] = [],
) {
	const calls: string[] = [];
	const fakeFetch = (async (url: string, init: RequestInit) => {
		const method = url.split("/").pop();
		calls.push(
			`${method} ${(init.headers as Record<string, string>).Authorization}`,
		);
		const body =
			method === "auth.test"
				? { ok: true, user_id: "UBOT", bot_id: "BBOT" }
				: method === "conversations.list"
					? { ok: true, channels: [{ id: "C1", name: "general" }] }
					: method === "conversations.replies"
						? { ok: true, messages: thread }
						: { ok: true };
		return { json: async () => body } as Response;
	}) as typeof fetch;
	const client = slackClient({ botToken: "xoxb-1", fetch: fakeFetch });
	return { calls, client };
}

it("reads the Events API bodies the relay delivers, asking who the bot is once", async () => {
	const { calls, client } = fakeSlack();
	expect(await client.mentionIn(body(appMention))).toEqual({
		channel: "C1",
		ts: "1700000000.000100",
		user: "U1",
		text: "<@UBOT> fix the header",
	});
	expect(
		await client.mentionIn(body({ ...appMention, user: "UBOT" })),
	).toBeUndefined();
	expect(await client.mentionIn(body({ type: "message" }))).toBeUndefined();
	expect(await client.mentionIn(null)).toBeUndefined();
	expect(calls).toEqual(["auth.test Bearer xoxb-1"]);
});

it("does not list the channels again on every mention when one is missing", async () => {
	const { calls, client } = fakeSlack();
	expect(await client.channelId("missing")).toBeUndefined();
	expect(await client.channelId("missing")).toBeUndefined();
	expect(await client.channelId("general")).toBe("C1");
	expect(calls.filter((c) => c.startsWith("conversations.list"))).toHaveLength(
		1,
	);
});

it("looks for a missing channel again soon, so one just created is found", async () => {
	vi.useFakeTimers();
	try {
		const { calls, client } = fakeSlack();
		expect(await client.channelId("missing")).toBeUndefined();
		vi.setSystemTime(Date.now() + 11_000);
		await client.channelId("missing");
		expect(
			calls.filter((c) => c.startsWith("conversations.list")),
		).toHaveLength(2);
	} finally {
		vi.useRealTimers();
	}
});

it("never lets a reply ping the whole channel or a group", () => {
	expect(
		neutralizeBroadcasts(
			"Done <!channel>, <!here|here> and <!everyone>; ask <@U1>, <!subteam^S0ONCALL> or <!subteam^S1|@devs>",
		),
	).toBe(
		"Done @channel, @here and @everyone; ask <@U1>, @subteam^S0ONCALL or @subteam^S1",
	);
});

it("writes an agent's Markdown as Slack's mrkdwn, and leaves code alone", () => {
	expect(
		toSlackMrkdwn(
			"## Options\n1. **Le chargement** de la page, *vraiment*\n2. See [the doc](https://example.com/a) and ~~old~~",
		),
	).toBe(
		"*Options*\n1. *Le chargement* de la page, _vraiment_\n2. See <https://example.com/a|the doc> and ~old~",
	);
	expect(toSlackMrkdwn("Run `a **b** c` then:\n```\n**kept**\n```")).toBe(
		"Run `a **b** c` then:\n```\n**kept**\n```",
	);
	expect(toSlackMrkdwn("- item one\n- item two")).toBe(
		"- item one\n- item two",
	);
	expect(toSlackMrkdwn("2 * 3 * 4 = 24")).toBe("2 * 3 * 4 = 24");
	// Bold around inline code: the stars still pair up across it.
	expect(toSlackMrkdwn("2. **Expose more in `computeTotal`.** Add")).toBe(
		"2. *Expose more in `computeTotal`.* Add",
	);
});

const reply = (text: string) =>
	body({
		type: "message",
		user: "U1",
		text,
		ts: "1700000300.000100",
		thread_ts: "1700000000.000100",
		channel: "C1",
	});

it("counts a reply that answers the bot in its thread, without the mention", async () => {
	const asked = [
		{ user: "U1", text: "<@UBOT> make it faster", ts: "1700000000.000100" },
		{
			user: "UBOT",
			bot_id: "BBOT",
			text: "Which one? 1, 2 or 3",
			ts: "1700000100.000100",
		},
	];
	const { client } = fakeSlack(asked);
	expect(await client.mentionIn(reply("2"))).toMatchObject({
		channel: "C1",
		threadTs: "1700000000.000100",
		text: "2",
		reply: true,
	});
	// Someone else spoke after the bot: the reply answers them, not the bot.
	const { client: talking } = fakeSlack([
		...asked,
		{ user: "U2", text: "I think 3", ts: "1700000200.000100" },
	]);
	expect(await talking.mentionIn(reply("agreed"))).toBeUndefined();
	// A reply that names the bot comes as app_mention: not counted twice.
	expect(readEvent(reply("<@UBOT> 2"), bot)).toBeUndefined();
	// Outside a thread, a message is never a reply.
	expect(
		readEvent(
			body({
				type: "message",
				user: "U1",
				text: "hi",
				ts: "1.1",
				channel: "C1",
			}),
			bot,
		),
	).toBeUndefined();
});

it("names the people of a thread by their display name, asking Slack once per person, and keeps the id when it cannot", async () => {
	const asked: string[] = [];
	const thread = [
		{ user: "U1", text: "The export skips users.", ts: "1.1" },
		{ user: "U2", text: "<@UBOT> why?", ts: "1.2" },
		{ user: "U1", text: "And archived ones.", ts: "1.3" },
		{ bot_id: "BX", text: "A bot.", ts: "1.4" },
	];
	const fakeFetch = (async (url: string, init: RequestInit) => {
		const method = url.split("/").pop();
		const args = new URLSearchParams(String(init.body));
		if (method === "users.info") asked.push(args.get("user") ?? "");
		const body =
			method === "conversations.replies"
				? { ok: true, messages: thread }
				: method === "users.info" && args.get("user") === "U1"
					? {
							ok: true,
							user: {
								name: "camille",
								real_name: "Camille Martin",
								profile: {
									display_name: "Camille",
									real_name: "Camille Martin",
								},
							},
						}
					: method === "users.info"
						? {
								ok: true,
								user: { name: "yanis", profile: { display_name: "" } },
							}
						: { ok: true };
		return { json: async () => body } as Response;
	}) as typeof fetch;
	const client = slackClient({ botToken: "xoxb-1", fetch: fakeFetch });
	expect(await client.thread("C1", "1.1")).toEqual([
		{ user: "U1", name: "Camille", text: "The export skips users.", ts: "1.1" },
		{ user: "U2", name: "yanis", text: "<@UBOT> why?", ts: "1.2" },
		{ user: "U1", name: "Camille", text: "And archived ones.", ts: "1.3" },
		{ user: "BX", text: "A bot.", ts: "1.4" },
	]);
	expect(asked).toEqual(["U1", "U2"]);

	// An app installed before users:read: the ids stay, the thread is still read.
	const { client: older } = fakeSlackWithout("users.info", thread);
	expect((await older.thread("C1", "1.1")).map((m) => m.user)).toEqual([
		"U1",
		"U2",
		"U1",
		"BX",
	]);
});

function fakeSlackWithout(
	missing: string,
	thread: { user?: string; bot_id?: string; text: string; ts: string }[],
) {
	const fakeFetch = (async (url: string) => {
		const method = url.split("/").pop();
		const body =
			method === missing
				? { ok: false, error: "missing_scope" }
				: method === "conversations.replies"
					? { ok: true, messages: thread }
					: { ok: true };
		return { json: async () => body } as Response;
	}) as typeof fetch;
	return { client: slackClient({ botToken: "xoxb-1", fetch: fakeFetch }) };
}
