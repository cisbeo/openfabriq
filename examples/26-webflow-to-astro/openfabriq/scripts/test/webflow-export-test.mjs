// Runs webflow-export.sh against a fake Webflow on this machine: its Data API and its CDN.
// node --test 'openfabriq/scripts/test/*-test.mjs'
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const script = join(import.meta.dirname, "..", "webflow-export.sh");

/**
 * A fake Webflow with two collections: 150 blog posts (two pages of items) that point to images
 * of its CDN, one of them missing, and an empty collection whose slug tries to leave the folder.
 */
async function fakeWebflow() {
	const asked = [];
	let cdn = "";
	const post = (i) => ({
		id: `post-${i}`,
		fieldData: {
			name: `Post ${i}`,
			slug: `post-${i}`,
			"main-image": { url: `${cdn}/site/photo-${i % 2}.png`, alt: "" },
			body: `<p>Hello</p><figure><img src="${cdn}/site/inline.png" alt=""></figure>`,
			...(i === 0 && { brochure: { url: `${cdn}/site/missing.pdf` } }),
		},
	});
	let routes = {};
	const server = createServer((request, response) => {
		asked.push(`${request.url} ${request.headers.authorization ?? "-"}`);
		if (
			request.url?.startsWith("/cdn/site/photo-") ||
			request.url === "/cdn/site/inline.png"
		) {
			response.end("image bytes");
			return;
		}
		const answer = routes[request.url ?? ""];
		const allowed = request.headers.authorization === "Bearer test-token";
		response.statusCode = !allowed ? 401 : answer ? 200 : 404;
		response.end(JSON.stringify(answer ?? {}));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const base = `http://127.0.0.1:${server.address().port}`;
	cdn = `${base}/cdn`;
	routes = {
		"/v2/sites/site-1/collections": {
			collections: [
				{ id: "blog", slug: "blog-posts" },
				{ id: "empty", slug: "../team" },
			],
		},
		"/v2/collections/blog": { id: "blog", fields: [{ slug: "main-image" }] },
		"/v2/collections/empty": { id: "empty", fields: [] },
		"/v2/collections/blog/items/live?limit=100&offset=0": {
			items: Array.from({ length: 100 }, (_, i) => post(i)),
			pagination: { limit: 100, offset: 0, total: 150 },
		},
		"/v2/collections/blog/items/live?limit=100&offset=100": {
			items: Array.from({ length: 50 }, (_, i) => post(100 + i)),
			pagination: { limit: 100, offset: 100, total: 150 },
		},
		"/v2/collections/empty/items/live?limit=100&offset=0": {
			items: [],
			pagination: { limit: 100, offset: 0, total: 0 },
		},
	};
	return {
		env: {
			WEBFLOW_API_URL: `${base}/v2`,
			WEBFLOW_CDN: `http://127\\.0\\.0\\.1:${server.address().port}/`,
		},
		asked,
		server,
	};
}

const run = (dir, env) =>
	promisify(execFile)(script, {
		cwd: dir,
		env: { PATH: process.env.PATH, ...env },
	});

test("exports every collection with all its published items, and downloads the files they point to", async () => {
	const webflow = await fakeWebflow();
	const dir = mkdtempSync(join(tmpdir(), "webflow-export-"));
	let output;
	try {
		output = await run(dir, {
			...webflow.env,
			WEBFLOW_API_TOKEN: "test-token",
			WEBFLOW_SITE_ID: "site-1",
		});
	} finally {
		webflow.server.close();
	}
	const out = join(dir, "webflow-export");
	const read = (path) => JSON.parse(readFileSync(join(out, path), "utf8"));

	const blog = read("collections/blog-posts.json");
	assert.equal(blog.collection.id, "blog");
	assert.equal(blog.items.length, 150);
	assert.equal(blog.items[149].id, "post-149");
	assert.deepEqual(read("collections/---team.json").items, []);

	assert.equal(
		readFileSync(join(out, "assets/cdn/site/photo-1.png"), "utf8"),
		"image bytes",
	);
	assert.ok(existsSync(join(out, "assets/cdn/site/inline.png")));
	assert.match(
		readFileSync(join(out, "assets-missing.txt"), "utf8"),
		/\/cdn\/site\/missing\.pdf\n$/,
	);

	// The API gets the token, the CDN never does; each file is asked for once.
	const api = webflow.asked.filter((line) => line.startsWith("/v2/"));
	assert.ok(api.every((line) => line.endsWith("Bearer test-token")));
	assert.ok(
		api.includes(
			"/v2/collections/blog/items/live?limit=100&offset=100 Bearer test-token",
		),
	);
	const files = webflow.asked.filter((line) => line.startsWith("/cdn/"));
	assert.deepEqual(files.sort(), [
		"/cdn/site/inline.png -",
		"/cdn/site/missing.pdf -",
		"/cdn/site/photo-0.png -",
		"/cdn/site/photo-1.png -",
	]);
	assert.match(
		output.stdout,
		/Exported 2 collections and 4 files .* 1 files missing/,
	);
});

test("stops before asking anything when the token is not set", async () => {
	const dir = mkdtempSync(join(tmpdir(), "webflow-export-"));
	await assert.rejects(
		run(dir, { WEBFLOW_SITE_ID: "site-1" }),
		/WEBFLOW_API_TOKEN: is not set/,
	);
});
