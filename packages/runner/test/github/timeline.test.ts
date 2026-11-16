import { WORKING_LABEL } from "@openfabriq/core";
import { expect, it } from "vitest";
import { sign, signChangesRequested } from "../../src/github/markers.js";
import { itemEvents } from "../../src/github/timeline.js";

const SINCE = "2026-11-01T21:00:00Z";
const issue = {
	number: 4,
	created_at: "2026-11-01T21:05:00Z",
	user: { login: "ada" },
};
const pr = { ...issue, number: 5, pull_request: {} };

it("turns an issue's timeline into events, skipping old ones and the engine's comments", () => {
	expect(
		itemEvents(
			issue,
			[
				{
					event: "labeled",
					id: 1,
					created_at: "2026-11-01T20:00:00Z",
					actor: { login: "ada" },
					label: { name: "old" },
				},
				{
					event: "labeled",
					id: 2,
					created_at: "2026-11-01T21:06:00Z",
					actor: { login: "ada" },
					label: { name: "ready-for-agent" },
				},
				{
					event: "commented",
					id: 3,
					created_at: "2026-11-01T21:07:00Z",
					user: { login: "ada" },
					body: "Here is the answer",
				},
				{
					event: "commented",
					id: 4,
					created_at: "2026-11-01T21:08:00Z",
					user: { login: "ada" },
					body: sign("Triage done", "r1"),
				},
			],
			SINCE,
		),
	).toEqual([
		{
			key: "4:opened",
			event: "issue.opened",
			number: 4,
			isPullRequest: false,
			actor: "ada",
			at: "2026-11-01T21:05:00Z",
		},
		{
			key: "labeled:2",
			event: "issue.labeled",
			number: 4,
			isPullRequest: false,
			actor: "ada",
			at: "2026-11-01T21:06:00Z",
			label: "ready-for-agent",
		},
		{
			key: "comment:3",
			event: "issue.commented",
			number: 4,
			isPullRequest: false,
			actor: "ada",
			at: "2026-11-01T21:07:00Z",
			// The comment, for a trigger that waits for a word.
			text: "Here is the answer",
		},
	]);
});

it("reads change requests and comments on a pull request, but not the engine's comments", () => {
	const events = itemEvents(
		{ ...pr, created_at: "2026-11-01T20:00:00Z" },
		[
			{
				event: "commented",
				id: 5,
				created_at: "2026-11-01T21:10:00Z",
				user: { login: "x" },
				body: "nice",
			},
			{
				event: "reviewed",
				id: 6,
				submitted_at: "2026-11-01T21:11:00Z",
				user: { login: "x" },
				state: "changes_requested",
				body: "fix",
			},
			{
				event: "reviewed",
				id: 7,
				submitted_at: "2026-11-01T21:12:00Z",
				user: { login: "ada" },
				state: "commented",
				body: signChangesRequested("fix", "r2"),
			},
			{
				event: "reviewed",
				id: 8,
				submitted_at: "2026-11-01T21:13:00Z",
				user: { login: "ada" },
				state: "commented",
				body: "just a remark",
			},
			{
				event: "commented",
				id: 9,
				created_at: "2026-11-01T21:14:00Z",
				user: { login: "ada" },
				body: sign("Review done", "r3"),
			},
			{ event: "committed" },
		],
		SINCE,
	);
	expect(events.map((e) => `${e.event} ${e.key}`)).toEqual([
		"pull_request.commented comment:5",
		"pull_request.changes_requested review:6",
		"pull_request.changes_requested review:7",
		"pull_request.commented review:8",
	]);
});

it("marks what the engine wrote for a run no maintainer started (VULN-009)", () => {
	const opened = itemEvents(
		{ ...issue, body: sign("From a Sentry error", "r1", true) },
		[
			{
				event: "reviewed",
				id: 10,
				submitted_at: "2026-11-01T21:15:00Z",
				user: { login: "ada" },
				state: "commented",
				body: signChangesRequested("fix", "r4", true),
			},
		],
		SINCE,
	);
	expect(opened.map((e) => [e.event, e.fromUntrustedRun])).toEqual([
		["issue.opened", true],
		["pull_request.changes_requested", true],
	]);
	expect(
		itemEvents(
			{ ...issue, body: sign("By a maintainer's run", "r2") },
			[],
			SINCE,
		)[0]?.fromUntrustedRun,
	).toBeUndefined();
	expect(sign("x", "r1", true)).toBe(
		"x\n\n<!-- openfabriq run=r1 untrusted -->",
	);
});

it("gives a comment the labels its issue or pull request carries, for a trigger that filters on them", () => {
	const comment = {
		event: "commented",
		id: 11,
		created_at: "2026-11-01T21:16:00Z",
		user: { login: "ada" },
		body: "1",
	};
	const labeled = {
		event: "labeled",
		id: 12,
		created_at: "2026-11-01T21:17:00Z",
		actor: { login: "ada" },
		label: { name: "bug" },
	};
	const labels = [{ name: "migration:decision" }, { name: "docs" }];
	const onIssue = itemEvents(
		{ ...issue, created_at: "2026-11-01T20:00:00Z", labels },
		[comment, labeled],
		SINCE,
	);
	expect(onIssue.map((e) => [e.event, e.labels])).toEqual([
		["issue.commented", ["migration:decision", "docs"]],
		// A labeled event keeps the one label just added.
		["issue.labeled", undefined],
	]);
	const onPull = itemEvents(
		{ ...pr, created_at: "2026-11-01T20:00:00Z", labels },
		[
			comment,
			{
				event: "reviewed",
				id: 13,
				submitted_at: "2026-11-01T21:18:00Z",
				user: { login: "ada" },
				state: "commented",
				body: "a remark",
			},
		],
		SINCE,
	);
	expect(onPull.map((e) => [e.event, e.labels])).toEqual([
		["pull_request.commented", ["migration:decision", "docs"]],
		["pull_request.commented", ["migration:decision", "docs"]],
	]);
});

it("ignores the working label the engine puts while a run works", () => {
	expect(
		itemEvents(
			{ ...pr, created_at: "2026-11-01T20:00:00Z" },
			[
				{
					event: "labeled",
					id: 11,
					created_at: "2026-11-01T21:06:00Z",
					actor: { login: "ada" },
					label: { name: WORKING_LABEL },
				},
			],
			SINCE,
		),
	).toEqual([]);
});
