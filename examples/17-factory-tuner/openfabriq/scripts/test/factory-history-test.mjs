// Runs factory-history.mjs against a fake GitHub on this machine.
// node --test 'openfabriq/scripts/test/*-test.mjs'
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const script = join(import.meta.dirname, "..", "factory-history.mjs");
const now = new Date().toISOString();
const old = "2020-01-01T00:00:00Z";
const signed = (text) =>
	`${text}\n\n---\n<sub>🤖 Written by [openfabriq](x) · agent \`implementer\` · automation [implement-ready-issues](y) · run \`r1\`</sub>\n\n<!-- openfabriq run=r1 -->`;
const alice = { login: "alice", type: "User" };

/** A fake GitHub: two factory pull requests, one of a person, one too old, and a hand-off. */
const routes = {
	"/repos/acme/app/pulls": [
		{
			number: 1,
			title: "Add export",
			body: signed("Closes #10"),
			state: "closed",
			merged_at: null,
			updated_at: now,
			html_url: "https://github.com/acme/app/pull/1",
			head: { ref: "openfabriq/10-r1" },
		},
		{
			number: 2,
			title: "Fix typo",
			body: signed("Closes #11"),
			state: "closed",
			merged_at: now,
			updated_at: now,
			html_url: "https://github.com/acme/app/pull/2",
			head: { ref: "openfabriq/11-r2" },
		},
		{
			number: 3,
			title: "A person's change",
			body: "mine",
			state: "open",
			updated_at: now,
			head: { ref: "alice/feature" },
		},
		{
			number: 4,
			title: "Too old",
			body: signed(""),
			state: "closed",
			updated_at: old,
			head: { ref: "openfabriq/4-r0" },
		},
	],
	"/repos/acme/app/pulls/1/reviews": [
		{
			id: 7,
			user: alice,
			state: "CHANGES_REQUESTED",
			body: "You rewrote the whole module; the issue asked for one function.",
		},
		{
			id: 8,
			user: alice,
			state: "COMMENTED",
			body: "Engine review text <!-- openfabriq:changes-requested run=r3 -->",
		},
	],
	"/repos/acme/app/pulls/1/comments": [
		{
			user: alice,
			path: "src/export.ts",
			pull_request_review_id: 7,
			body: "No new dependency for this.",
		},
		{
			user: alice,
			path: "src/export.ts",
			pull_request_review_id: 8,
			body: "Inline note of the engine's review",
		},
	],
	"/repos/acme/app/issues/1/comments": [
		{ user: alice, body: "Closing: too big." },
	],
	"/repos/acme/app/pulls/2/reviews": [],
	"/repos/acme/app/pulls/2/comments": [],
	"/repos/acme/app/issues/2/comments": [
		{ user: { login: "ci", type: "Bot" }, body: "Deployed" },
	],
	"/repos/acme/app/issues": [
		{
			number: 12,
			title: "Flaky migration",
			html_url: "https://github.com/acme/app/issues/12",
		},
	],
	"/repos/acme/app/issues/12/comments": [
		{ user: alice, body: "Any news?" },
		{
			user: alice,
			body: "The checks still fail after 3 rounds.\n\n<!-- openfabriq run=r4 -->",
		},
	],
};

async function fakeGitHub() {
	const server = createServer((request, response) => {
		const path = request.url?.split("?")[0] ?? "";
		if (request.headers.authorization !== "Bearer test-token")
			response.statusCode = 401;
		else if (!(path in routes)) response.statusCode = 404;
		response.end(JSON.stringify(routes[path] ?? { message: "Not Found" }));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { url: `http://127.0.0.1:${server.address().port}`, server };
}

async function run(token) {
	const github = await fakeGitHub();
	const dir = mkdtempSync(join(tmpdir(), "factory-history-"));
	try {
		const { stdout } = await promisify(execFile)(script, ["acme/app", "28"], {
			cwd: dir,
			env: {
				PATH: process.env.PATH,
				FACTORY_HISTORY_TOKEN: token,
				FACTORY_HISTORY_API: github.url,
			},
		});
		return {
			stdout,
			report: readFileSync(join(dir, "factory-history.md"), "utf8"),
		};
	} finally {
		github.server.close();
	}
}

test("writes what humans did with the factory's pull requests, without the engine's words", async () => {
	const { stdout, report } = await run("test-token");
	assert.match(stdout, /2 pull requests from 1 agents, 1 hand-offs/);
	assert.match(report, /\| implementer \| 2 \| 1 \| 1 \| 1 \| 1 \|/);
	assert.match(
		report,
		/automation implement-ready-issues · closed without merge/,
	);
	assert.match(
		report,
		/alice requested changes:\n\n> You rewrote the whole module/,
	);
	assert.match(
		report,
		/alice commented on src\/export.ts:\n\n> No new dependency/,
	);
	assert.match(report, /> The checks still fail after 3 rounds\./);
	for (const left of [
		"Engine review text",
		"Inline note of the engine",
		"A person's change",
		"Too old",
		"Deployed",
		"Any news?",
	])
		assert.ok(!report.includes(left), `${left} should not be in the report`);
});

test("fails with a clear message when GitHub refuses the token", async () => {
	await assert.rejects(
		run("wrong-token"),
		/GitHub refused \/repos\/acme\/app\/pulls/,
	);
});
