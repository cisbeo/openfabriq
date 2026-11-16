// Development only, not part of `pnpm test`: opens every page of the built app in a real
// browser, against a small factory in a temporary OPENFABRIQ_HOME, and fails on a page error,
// a console error, a page without a heading, or a page that says it could not be shown.
// Needs `pnpm build` and the `dev-browser` CLI (npm install -g dev-browser && dev-browser install).
//
//   pnpm --filter @openfabriq/studio smoke     screenshots land in ~/.dev-browser/tmp/
//
// It leaves the dev-browser daemon running: `dev-browser stop` when done.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-smoke-"));
const {
	appendRun,
	projectDir,
	readFactoryFolder,
	studioTokenPath,
	writeApplied,
} = await import("@openfabriq/runner");
const { startStudio } = await import("../dist/index.js");

const REPO = "acme/task-app";
const PR = `https://github.com/${REPO}/pull/7`;
const ago = (minutes: number) =>
	new Date(Date.now() - minutes * 60_000).toISOString();

writeApplied(
	REPO,
	readFactoryFolder(
		join(import.meta.dirname, "../../../examples/02-sdlc/openfabriq"),
	),
);
const base = { repository: REPO, isPullRequest: false, outputs: [] };
appendRun({
	...base,
	id: "triage-4",
	automation: "triage-issues",
	agent: "triage",
	event: "issue.opened",
	number: 4,
	title: "Add a counter",
	status: "succeeded",
	queuedAt: ago(60),
	startedAt: ago(60),
	endedAt: ago(58),
	durationMs: 120_000,
	costUsd: 0.12,
	outputs: [
		{ action: "add_labels", summary: "ready-for-agent", status: "applied" },
	],
});
appendRun({
	...base,
	id: "implement-4",
	automation: "implement-ready-issues",
	agent: "implementer",
	event: "issue.labeled",
	label: "ready-for-agent",
	number: 4,
	title: "Add a counter",
	status: "succeeded",
	queuedAt: ago(57),
	startedAt: ago(57),
	endedAt: ago(45),
	durationMs: 720_000,
	costUsd: 1.4,
	tokens: { input: 12_000, output: 3_000 },
	turns: 14,
	model: "sonnet",
	outputs: [
		{
			action: "create_pull_request",
			summary: "Add a counter",
			status: "applied",
			url: PR,
		},
		{
			action: "add_labels",
			summary: "deploy",
			status: "refused",
			reason: "add_labels allows ready-for-agent, needs-info",
		},
	],
});
appendRun({
	...base,
	id: "review-7",
	automation: "review-pull-requests",
	agent: "reviewer",
	event: "pull_request.opened",
	number: 7,
	isPullRequest: true,
	title: "Add a counter",
	status: "failed",
	reason: "Claude Code exited with code 1",
	queuedAt: ago(44),
	startedAt: ago(44),
	endedAt: ago(40),
	durationMs: 240_000,
	costUsd: 0.6,
});
appendRun({
	...base,
	id: "triage-5",
	automation: "triage-issues",
	agent: "triage",
	event: "issue.opened",
	number: 5,
	title: "Dark mode",
	status: "skipped",
	reason: "The issue is already labeled.",
	queuedAt: ago(10),
});
appendRun({
	...base,
	id: "triage-6",
	automation: "triage-issues",
	agent: "triage",
	event: "issue.opened",
	number: 6,
	title: "Export to CSV",
	status: "running",
	queuedAt: ago(1),
	startedAt: ago(1),
});
const runDir = join(projectDir(REPO), "runs", "implement-4");
mkdirSync(runDir, { recursive: true });
writeFileSync(join(runDir, "prompt.md"), "Implement issue #4.");
writeFileSync(
	join(runDir, "transcript.jsonl"),
	readFileSync(join(import.meta.dirname, "../test/fixtures/transcript.jsonl")),
);

const server = startStudio(0, undefined, {
	subjectState: async () => undefined,
});
await new Promise((ok) => server.once("listening", ok));
// The token, like the address `start` prints: the server turns it into the page's cookie.
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/?token=${readFileSync(studioTokenPath(), "utf8")}`;

const p = `?project=${encodeURIComponent(REPO)}`;
const pages = [
	"#/overview",
	`#/overview${p}&view=cost`,
	"#/board",
	"#/runs",
	"#/run/implement-4?tab=summary",
	"#/run/implement-4?tab=logs",
	"#/run/implement-4?tab=outputs",
	"#/run/review-7",
	"#/run/triage-5",
	"#/agents",
	`#/agents/implementer${p}`,
	`#/workflow${p}`,
	`#/chat${p}`,
];

// Runs in dev-browser's sandbox (QuickJS, Playwright pages), not in Node.
const script = `
const pages = ${JSON.stringify(pages)};
const failures = [];
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
let current = "";
page.on("pageerror", (e) => failures.push(current + ": page error: " + e.message));
page.on("console", (m) => {
	if (m.type() === "error") failures.push(current + ": console: " + m.text());
});
for (const [i, hash] of pages.entries()) {
	current = hash;
	await page.goto("about:blank");
	await page.goto(${JSON.stringify(url)} + hash);
	try {
		await page.waitForSelector("h1", { timeout: 15000 });
		await page.waitForLoadState("networkidle");
	} catch {
		failures.push(hash + ": no heading");
	}
	const heading = await page.evaluate(() => document.querySelector("h1")?.textContent ?? "");
	const broken = await page.evaluate(() => document.body.innerText.includes("could not be shown"));
	if (broken) failures.push(hash + ": the page could not be shown");
	console.log((broken ? "FAIL " : "ok   ") + hash + "  h1: " + heading.trim().slice(0, 60));
	await saveScreenshot(await page.screenshot({ fullPage: true }), "smoke-" + String(i).padStart(2, "0") + ".png");
}
if (failures.length) throw new Error("\\n" + failures.join("\\n"));
console.log("All " + pages.length + " pages render.");
`;

// Not spawnSync: the server answers from this process.
const browser = spawn(
	"dev-browser",
	["--headless", "--browser", "openfabriq-smoke", "--timeout", "180"],
	{ stdio: ["pipe", "inherit", "inherit"] },
);
browser.stdin.end(script);
const status = await new Promise<number>((ok) => {
	browser.on("error", (error) => {
		console.error(`dev-browser: ${error.message}`);
		ok(1);
	});
	browser.on("close", (code) => ok(code ?? 1));
});
server.close();
process.exit(status);
