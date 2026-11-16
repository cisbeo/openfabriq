// The workflow image of each example, drawn by the studio's Workflow page, so it always matches
// the factory. Applies each examples/*/openfabriq/ to its own temporary OPENFABRIQ_HOME, serves the
// built studio, and captures the graph alone (light theme, twice the pixels) with dev-browser
// into examples/<name>/workflow.png, then sets the image's width in the README. The docs site
// serves that file on each template's page. Never reads ~/.openfabriq.
//
//   pnpm examples:workflows [05-code-review …]     then `dev-browser stop`

import { spawn } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "../../..");
const { readFactoryFolder, studioTokenPath, writeApplied } = await import(
	join(root, "packages/runner/dist/index.js")
);
const { startStudio } = await import(
	join(root, "packages/studio/dist/index.js")
);

const examples = join(root, "examples");
const asked = process.argv.slice(2);
const names = readdirSync(examples)
	.filter((n) => existsSync(join(examples, n, "openfabriq/factory.yaml")))
	.filter((n) => asked.length === 0 || asked.includes(n));
if (names.length === 0)
	throw new Error(`No example named ${asked.join(", ")}.`);
// Runs in dev-browser's sandbox (QuickJS, Playwright pages), not in Node.
const capture = (name, url) => `
const page = await browser.newPage();
await page.emulateMedia({ colorScheme: "light" });
await page.setViewportSize({ width: 3200, height: 1400 });
await page.goto(${JSON.stringify(url)} + "#/workflow?project=" + encodeURIComponent("examples/${name}"));
await page.waitForSelector(".react-flow__node");
// The graph at full size whatever its width, without the zoom buttons.
await page.addStyleTag({ content: ".mx-auto.w-full { max-width: none } .react-flow__controls { display: none }" });
await page.waitForTimeout(800);
const clip = await page.evaluate(() => {
	const parts = [...document.querySelectorAll(".react-flow__node, .react-flow__edge path, .react-flow__edgelabel-renderer > *")]
		.map((e) => e.getBoundingClientRect())
		.filter((r) => r.width || r.height);
	// Some room around the graph, inside its frame: the frame's border stays out of the image.
	const frame = document.querySelector(".flow-still").getBoundingClientRect();
	const x = Math.max(Math.min(...parts.map((r) => r.left)) - 24, frame.left + 1);
	const y = Math.max(Math.min(...parts.map((r) => r.top)) - 24, frame.top + 1);
	const right = Math.min(Math.max(...parts.map((r) => r.right)) + 24, frame.right - 1);
	const bottom = Math.min(Math.max(...parts.map((r) => r.bottom)) + 24, frame.bottom - 1);
	return { x: x + window.scrollX, y: y + window.scrollY, width: right - x, height: bottom - y };
});
// Twice the pixels, so the words stay sharp on any screen.
const cdp = await page.context().newCDPSession(page);
const { data } = await cdp.send("Page.captureScreenshot", {
	format: "png",
	captureBeyondViewport: true,
	clip: { ...clip, scale: 2 },
});
await cdp.detach();
await saveScreenshot(Buffer.from(data, "base64"), "workflow-${name}.png");
console.log("ok ${name} " + Math.round(clip.width) + "x" + Math.round(clip.height));
`;

// One engine home per example, as on a machine that runs this factory alone: the studio gives
// each agent of the machine its own color, and an example's agents are all there is.
let status = 0;
for (const name of names) {
	process.env.OPENFABRIQ_HOME = mkdtempSync(
		join(tmpdir(), "openfabriq-workflows-"),
	);
	writeApplied(
		`examples/${name}`,
		readFactoryFolder(join(examples, name, "openfabriq")),
	);
	const server = startStudio(0);
	await new Promise((ok) => server.once("listening", ok));
	const url = `http://127.0.0.1:${server.address().port}/?token=${readFileSync(studioTokenPath(), "utf8")}`;
	const browser = spawn(
		"dev-browser",
		["--headless", "--browser", "openfabriq-docs", "--timeout", "60"],
		{ stdio: ["pipe", "inherit", "inherit"] },
	);
	browser.stdin.end(capture(name, url));
	status = await new Promise((ok) => {
		browser.on("error", (error) => {
			console.error(`dev-browser: ${error.message}`);
			ok(1);
		});
		browser.on("close", (code) => ok(code ?? 1));
	});
	server.close();
	if (status !== 0) break;
}
if (status === 0) {
	for (const name of names) {
		const shot = join(homedir(), ".dev-browser/tmp", `workflow-${name}.png`);
		copyFileSync(shot, join(examples, name, "workflow.png"));
		// The README shows it at half its pixels, the graph's size in the studio.
		const readme = join(examples, name, "README.md");
		writeFileSync(
			readme,
			readFileSync(readme, "utf8").replace(
				/<img src="workflow.png" width="\d+"/,
				`<img src="workflow.png" width="${readFileSync(shot).readUInt32BE(16) / 2}"`,
			),
		);
	}
	console.log(
		`Saved ${names.length} workflow images in examples/*/workflow.png`,
	);
}
process.exit(status);
