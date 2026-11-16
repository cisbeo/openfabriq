// The terminal screenshots of the docs, from made-up data: a repository acme/web-app with the
// 02-sdlc example, a temporary OPENFABRIQ_HOME, a stand-in `gh` that answers without the network,
// and a few runs for `status`. Each command runs in a real terminal (`script`, macOS), so the CLI
// draws its colors; the output becomes a terminal window in HTML, which dev-browser captures.
// Never reads ~/.openfabriq.
//
//   pnpm build && node packages/docs/scripts/cli-screenshots.mjs     then `dev-browser stop`

import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "../../..");
const cli = join(root, "packages/cli/dist/index.js");
const out = join(root, "packages/docs/public/screenshots/cli");
const shots = join(homedir(), ".dev-browser/tmp");
const work = mkdtempSync(join(tmpdir(), "openfabriq-cli-shots-"));
const home = join(work, "home");
const repo = join(work, "web-app");
const bin = join(work, "bin");
mkdirSync(home);
mkdirSync(bin);
mkdirSync(out, { recursive: true });

// gh without the network: logged in, no label yet, every write accepted.
writeFileSync(
	join(bin, "gh"),
	`#!/bin/sh
case "$*" in
  "auth status"*) echo "Logged in to github.com as alice"; exit 0 ;;
  api\\ repos/*/labels*) echo "[[]]"; exit 0 ;;
  api\\ user*) echo '{"login":"alice"}'; exit 0 ;;
  api\\ repos/*) echo '{"default_branch":"main"}'; exit 0 ;;
esac
echo "[]"
exit 0
`,
);
chmodSync(join(bin, "gh"), 0o755);

/** A repository with an example's factory, for acme/<name> and its maintainer alice, committed. */
function repository(example, dir) {
	cpSync(
		join(root, `examples/${example}/openfabriq`),
		join(dir, "openfabriq"),
		{
			recursive: true,
		},
	);
	const factory = join(dir, "openfabriq/factory.yaml");
	writeFileSync(
		factory,
		readFileSync(factory, "utf8")
			.replace(/^repository: .*$/m, "repository: acme/web-app")
			// The Sentry project too, so the plan never names the template's task-app.
			.replace(/^(\s+project:) task-app$/m, "$1 web-app")
			.replace(/^maintainers: .*$/m, "maintainers: [alice]"),
	);
	const git = (...args) =>
		execFileSync(
			"git",
			["-c", "user.name=alice", "-c", "user.email=alice@example.com", ...args],
			{ cwd: dir, stdio: "ignore" },
		);
	git("init", "-q", "--initial-branch=main");
	git("add", "-A");
	git("commit", "-q", "-m", "A factory for the web app");
}
// The docs' factory: the 02-sdlc example.
repository("02-sdlc", repo);

const env = {
	...process.env,
	OPENFABRIQ_HOME: home,
	PATH: `${bin}:${process.env.PATH}`,
	TERM: "xterm-256color",
	COLORTERM: "truecolor",
	COLUMNS: "96",
	NO_COLOR: "",
};
delete env.NO_COLOR;

/**
 * The command's output in a real terminal (`script` gives it a tty), with its colors. A command
 * that keeps running, like `start`, is stopped after `forMs`.
 */
function terminal(args, forMs, cwd = repo) {
	const { stdout } = spawnSync(
		"script",
		["-q", "/dev/null", "node", cli, ...args],
		{
			cwd,
			env,
			encoding: "utf8",
			stdio: [openSync("/dev/null"), "pipe", "pipe"],
			...(forMs ? { timeout: forMs, killSignal: "SIGINT" } : {}),
		},
	);
	// biome-ignore lint/suspicious/noControlCharactersInRegex: the ^D and backspaces `script` echoes
	return stdout.replace(/\^D\x08\x08/g, "").replace(/\r/g, "");
}

// Colors as the CLI writes them: SGR codes, 24-bit for the brand's blue.
const COLORS = {
	31: "#f47067",
	32: "#57ab5a",
	33: "#c69026",
	34: "#539bf5",
	35: "#b083f0",
	36: "#39c5cf",
	37: "#adbac7",
	90: "#768390",
	91: "#ff938a",
	92: "#6bc46d",
	93: "#daaa3f",
	94: "#6cb6ff",
};
const escapeHtml = (s) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** ANSI text to HTML spans: bold, dim and foreground colors; cursor moves are dropped. */
function toHtml(text) {
	let style = { bold: false, dim: false, color: "" };
	let html = "";
	const parts = text
		// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes are the input
		.replace(/\x1b\[\?[0-9;]*[hl]|\x1b\[[0-9;]*[ABCDGJKH]/g, "")
		// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes are the input
		.split(/(\x1b\[[0-9;]*m)/);
	for (const part of parts) {
		// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes are the input
		const sgr = /^\x1b\[([0-9;]*)m$/.exec(part);
		if (!sgr) {
			if (!part) continue;
			const css = [
				style.bold ? "font-weight:600" : "",
				style.dim ? "opacity:.62" : "",
				style.color ? `color:${style.color}` : "",
			]
				.filter(Boolean)
				.join(";");
			html += css
				? `<span style="${css}">${escapeHtml(part)}</span>`
				: escapeHtml(part);
			continue;
		}
		const codes = (sgr[1] || "0").split(";").map(Number);
		for (let i = 0; i < codes.length; i++) {
			const c = codes[i];
			if (c === 0) style = { bold: false, dim: false, color: "" };
			else if (c === 1) style.bold = true;
			else if (c === 2) style.dim = true;
			else if (c === 22) style = { ...style, bold: false, dim: false };
			else if (c === 39) style.color = "";
			else if (c === 38 && codes[i + 1] === 2) {
				style.color = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
				i += 4;
			} else if (COLORS[c]) style.color = COLORS[c];
		}
	}
	return html;
}

function page(title, command, text, where = "~/web-app") {
	return `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:24px;background:#f6f8fa;font:14px/1.5 -apple-system,system-ui,sans-serif}
#term{display:inline-block;min-width:760px;border-radius:12px;background:#1c2128;box-shadow:0 1px 2px rgba(0,0,0,.12),0 8px 24px rgba(0,0,0,.18);overflow:hidden}
.bar{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#2d333b;color:#909dab;font-size:12px}
.dot{width:12px;height:12px;border-radius:50%}
pre{margin:0;padding:16px 20px 20px;color:#adbac7;font:13px/1.25 "SF Mono",Menlo,Consolas,monospace;white-space:pre}
.prompt{color:#768390}
</style><div id="term"><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span style="margin-left:8px">${escapeHtml(title)}</span></div><pre><span class="prompt">${escapeHtml(where)} $</span> ${escapeHtml(command)}
${toHtml(text.replace(/\s+$/, ""))}</pre></div>`;
}

const captures = [
	["usage", "openfabriq", []],
	["validate", "openfabriq validate", ["validate"]],
	["plan", "openfabriq plan", ["plan"]],
	["status", "openfabriq status", ["status"]],
	["start", "openfabriq start", ["start"]],
];
/** One capture: the command's output, in a terminal window, as an HTML page for dev-browser. */
const taken = [];
function capture([name, command, args]) {
	taken.push(name);
	// start runs from the home folder, as people run it: in the repository it would ask to apply first.
	const start = name === "start";
	let text = start ? terminal(args, 6000, work) : terminal(args);
	// The engine's activity after the block: its first lines are enough.
	if (name === "start") text = text.split("\n").slice(0, 18).join("\n");
	if (name === "plan")
		text = `${text.split("\n").slice(0, 22).join("\n")}\n  …`;
	writeFileSync(
		join(shots, `cli-${name}.html`),
		page(start ? "~" : "web-app", command, text, start ? "~" : "~/web-app"),
	);
}
// usage, validate and plan on a factory not applied yet: plan then shows what apply would change.
for (const c of captures.slice(0, 3)) capture(c);

// Some runs for `status`, once the factory is applied (labels "created" by the stand-in gh).
execFileSync("node", [cli, "apply", "--yes"], {
	cwd: repo,
	env,
	stdio: "ignore",
});
process.env.OPENFABRIQ_HOME = home;
const { appendRun } = await import(join(root, "packages/runner/dist/index.js"));
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const base = {
	repository: "acme/web-app",
	isPullRequest: false,
	model: "sonnet",
	outputs: [],
};
for (const r of [
	{
		id: "r1",
		automation: "triage-issues",
		agent: "triage",
		number: 41,
		status: "succeeded",
		queuedAt: minutesAgo(52),
		startedAt: minutesAgo(52),
		endedAt: minutesAgo(51),
		costUsd: 0.04,
	},
	{
		id: "r2",
		automation: "implement-ready-issues",
		agent: "implementer",
		number: 41,
		status: "succeeded",
		queuedAt: minutesAgo(50),
		startedAt: minutesAgo(50),
		endedAt: minutesAgo(38),
		costUsd: 1.12,
	},
	{
		id: "r3",
		automation: "resolve-conflicts",
		agent: "implementer",
		number: 58,
		isPullRequest: true,
		status: "failed",
		queuedAt: minutesAgo(37),
		startedAt: minutesAgo(37),
		endedAt: minutesAgo(33),
		costUsd: 0.31,
		error: 'the check "test" failed (pnpm test)',
	},
	{
		id: "r4",
		automation: "implement-ready-issues",
		agent: "implementer",
		number: 44,
		status: "running",
		queuedAt: minutesAgo(6),
		startedAt: minutesAgo(6),
	},
	{
		id: "r5",
		automation: "triage-issues",
		agent: "triage",
		number: 45,
		status: "queued",
		queuedAt: minutesAgo(1),
	},
])
	appendRun({ ...base, event: { event: "issue.labeled" }, ...r });

capture(captures[3]);
// start serves the studio on 127.0.0.1:4310: an engine already running there holds the port.
if (spawnSync("lsof", ["-nP", "-iTCP:4310", "-sTCP:LISTEN"]).stdout.length)
	console.log(
		"start skipped: 127.0.0.1:4310 is taken, stop openfabriq start first",
	);
else capture(captures[4]);

const shoot = join(work, "shoot.js");
writeFileSync(
	shoot,
	`const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.setViewportSize({ width: 1400, height: 900 });
for (const name of ${JSON.stringify(taken)}) {
	await page.setContent(await readFile(\`cli-\${name}.html\`));
	await saveScreenshot(await page.locator("#term").screenshot(), \`cli-\${name}.png\`);
}
console.log("done");
`,
);
execFileSync("dev-browser", ["--headless", "run", shoot], { stdio: "inherit" });
for (const name of taken)
	cpSync(join(shots, `cli-${name}.png`), join(out, `${name}.png`));
console.log(`Saved ${taken.length} screenshots in ${out}`);
