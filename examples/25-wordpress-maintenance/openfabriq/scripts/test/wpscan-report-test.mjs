// Runs wpscan-report.sh on a fake composer.lock, against a fake WPScan on this machine.
// node --test 'openfabriq/scripts/test/*-test.mjs'
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const script = join(import.meta.dirname, "..", "wpscan-report.sh");
const hasPhp = (() => {
	try {
		execFileSync("php", ["--version"]);
		return true;
	} catch {
		return false;
	}
})();

/** A fake WPScan: it knows akismet and twentytwentyfour, and wants the token. */
async function fakeWpscan() {
	const asked = [];
	const server = createServer((request, response) => {
		asked.push(request.url);
		const slug = request.url?.split("/").pop() ?? "";
		const known = ["akismet", "twentytwentyfour"].includes(slug);
		const allowed = request.headers.authorization === "Token token=test-token";
		response.statusCode = !allowed ? 401 : known ? 200 : 404;
		response.end(JSON.stringify({ [slug]: { vulnerabilities: [] } }));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		url: `http://127.0.0.1:${server.address().port}/api/v3`,
		asked,
		server,
	};
}

/** A checkout with the fake composer.lock, where the script runs. */
function checkout() {
	const dir = mkdtempSync(join(tmpdir(), "wpscan-report-"));
	copyFileSync(
		join(import.meta.dirname, "composer.lock"),
		join(dir, "composer.lock"),
	);
	return dir;
}

const run = (dir, env) =>
	promisify(execFile)(script, {
		cwd: dir,
		env: { PATH: process.env.PATH, ...env },
	});

test("asks WPScan about each plugin and theme, and writes one answer per line", {
	skip: !hasPhp && "php is not installed",
}, async () => {
	const wpscan = await fakeWpscan();
	const dir = checkout();
	try {
		await run(dir, {
			WPSCAN_API_TOKEN: "test-token",
			WPSCAN_API_URL: wpscan.url,
		});
	} finally {
		wpscan.server.close();
	}
	assert.deepEqual(wpscan.asked, [
		"/api/v3/plugins/akismet",
		"/api/v3/plugins/not-on-wpscan",
		"/api/v3/themes/twentytwentyfour",
	]);
	const lines = readFileSync(join(dir, "wpscan-report.json"), "utf8")
		.trim()
		.split("\n");
	assert.deepEqual(
		lines.map((line) => JSON.parse(line)),
		[
			{ akismet: { vulnerabilities: [] } },
			{
				"plugins/not-on-wpscan":
					"no answer from WPScan (wrong token, quota, or unknown slug)",
			},
			{ twentytwentyfour: { vulnerabilities: [] } },
		],
	);
});

test("stops before asking anything when the token is not set", {
	skip: !hasPhp && "php is not installed",
}, async () => {
	await assert.rejects(run(checkout(), {}), /WPSCAN_API_TOKEN: is not set/);
});
