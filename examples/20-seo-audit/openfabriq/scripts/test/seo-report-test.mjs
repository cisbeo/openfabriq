// Runs seo-report.mjs on a small fake built site, written in a temporary checkout.
// node --test 'openfabriq/scripts/test/*-test.mjs'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

const script = join(import.meta.dirname, "..", "seo-report.mjs");

const page = ({ title, description, body, head = "" }) => `<!doctype html>
<html lang="en"><head>
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="https://example.com/">
${head}
</head><body>${body}</body></html>`;

const good = (title, body = "<h1>Hello</h1>") =>
	page({
		title,
		description: `${title}: a description long enough for a search result snippet.`,
		body,
	});

/** A checkout with dist/ holding the given files, where the script runs. */
function checkout(files) {
	const dir = mkdtempSync(join(tmpdir(), "seo-report-"));
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, "dist", path)), { recursive: true });
		writeFileSync(join(dir, "dist", path), content);
	}
	return dir;
}

function run(files) {
	const dir = checkout(files);
	const output = execFileSync(script, ["dist"], { cwd: dir, encoding: "utf8" });
	const report = JSON.parse(readFileSync(join(dir, "seo-report.json"), "utf8"));
	return { output, ...report };
}

const sitemap = (...paths) =>
	`<urlset>${paths.map((p) => `<url><loc>https://example.com${p}</loc></url>`).join("")}</urlset>`;
const robots = "User-agent: *\nAllow: /\n";

test("finds nothing on a clean site", () => {
	const { pages, problems, output } = run({
		"index.html": good(
			"Home",
			'<h1>Home</h1><a href="/about/">About</a><a href="https://other.example">x</a>',
		),
		"about/index.html": good(
			"About",
			'<h1>About</h1><a href="../">Home</a><img src="/logo.png" alt="" width="10" height="10">',
		),
		"logo.png": "png",
		"404.html": page({ title: "", description: "", body: "" }),
		"sitemap.xml": sitemap("/", "/about"),
		"robots.txt": robots,
	});
	assert.deepEqual(pages.sort(), ["/", "/about/"]);
	assert.deepEqual(problems, []);
	assert.match(output, /^2 pages checked in dist\/, 0 problems/);
});

test("reports each missing or wrong basic, on the page it is on", () => {
	const { problems, output } = run({
		"index.html": good(
			"Home",
			'<h1>One</h1><h1>Two</h1><a href="/missing/">x</a><img src="/hero.jpg">',
		),
		"hero.jpg": "x".repeat(400 * 1024),
		"blog/post.html": page({
			title: "A title much too long to show in full in a search result, cut",
			description: "Too short",
			body: "<p>no heading</p>",
			head: '<script type="application/ld+json">{ "@type": "Article", }</script>',
		}),
		"copy.html": good("Home"),
		"hidden.html": page({
			title: "Hidden",
			description: "",
			body: "",
			head: '<meta name="robots" content="noindex">',
		}),
		"sitemap.xml": sitemap("/", "/blog/post", "/hidden", "/gone/"),
		"robots.txt": "User-agent: googlebot\nUser-agent: *\nDisallow: /\n",
	});
	const found = problems.map((p) => `${p.page} ${p.check}`).sort();
	assert.deepEqual(found, [
		"/ broken-link",
		"/ h1",
		"/ image-alt",
		"/ image-size",
		"/ image-weight",
		"/ robots",
		"/blog/post description",
		"/blog/post h1",
		"/blog/post structured-data",
		"/blog/post title",
		"/copy duplicate-description",
		"/copy duplicate-title",
		"/copy sitemap",
		"/gone/ sitemap",
		"/hidden sitemap",
	]);
	assert.match(output, /broken-link: 1/);
});

test("says when the site has no sitemap and no robots.txt", () => {
	const { problems } = run({ "index.html": good("Home") });
	assert.deepEqual(
		problems.map((p) => p.detail),
		["no sitemap.xml or sitemap-index.xml", "no robots.txt"],
	);
});

test("follows a sitemap index to the sitemaps it lists", () => {
	const { problems } = run({
		"index.html": good("Home"),
		"sitemap-index.xml":
			"<sitemapindex><sitemap><loc>https://example.com/sitemap-0.xml</loc></sitemap></sitemapindex>",
		"sitemap-0.xml": sitemap("/"),
		"robots.txt": robots,
	});
	assert.deepEqual(problems, []);
});

test("fails when the site is not built", () => {
	const dir = mkdtempSync(join(tmpdir(), "seo-report-"));
	assert.throws(
		() =>
			execFileSync(script, ["dist"], {
				cwd: dir,
				encoding: "utf8",
				stdio: "pipe",
			}),
		(error) => error.stderr.includes("run the build first"),
	);
});
