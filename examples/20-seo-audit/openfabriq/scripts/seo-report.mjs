#!/usr/bin/env node
// Checks the search basics of a built static site, page by page, without any outside service.
//
// Reads:  the built site, in the folder given as argument (dist by default): every .html file,
//         robots.txt, and sitemap.xml or sitemap-index.xml with the sitemaps it lists
// Writes: seo-report.json, in the run's checkout: { pages, problems: [{ page, check, detail }] }
// Prints: the number of problems per check. It exits 0 whatever it finds: it reports, it does not judge.
//
// shortcut: reads the HTML with regular expressions, which holds for the markup a site generator
// writes; a site whose pages need JavaScript to show their content needs a real browser instead.

import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, posix, relative, sep } from "node:path";

const site = process.argv[2] ?? "dist";
if (!existsSync(site)) {
	console.error(`${site}/ does not exist: run the build first.`);
	process.exit(1);
}

const HEAVY_IMAGE_KB = 300;
const files = new Set(
	readdirSync(site, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) =>
			relative(site, join(entry.parentPath, entry.name)).split(sep).join("/"),
		),
);
const problems = [];
const report = (page, check, detail) => problems.push({ page, check, detail });
const read = (file) => readFileSync(join(site, file), "utf8");
const decode = (path) => {
	try {
		return decodeURIComponent(path);
	} catch {
		return path;
	}
};

/** The address a file is served at: blog/post/index.html → /blog/post/, about.html → /about. */
const urlOf = (file) =>
	`/${file}`.replace(/index\.html$/, "").replace(/\.html$/, "");

/** The file served at an address of the site, or undefined when there is none. */
function fileFor(path) {
	const base = path.replace(/^\/|\/$/g, "");
	return [base, posix.join(base, "index.html"), `${base}.html`].find((file) =>
		files.has(file),
	);
}

/** Where a link of a page leads, as a path of the site: "../about?x#y" on /blog/post/ → /blog/about. */
const target = (page, href) =>
	decode(
		posix.resolve(
			page.endsWith("/") ? page : posix.dirname(page),
			href.split(/[?#]/)[0],
		),
	);

const attribute = (tag, name) =>
	tag
		.match(
			new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
		)
		?.slice(1)
		.find((value) => value !== undefined);
const tags = (html, name) =>
	html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];
const text = (html) =>
	html
		.replace(/<[^>]*>/g, "")
		.replace(/\s+/g, " ")
		.trim();

// The sitemap's addresses, as paths of the site: https://example.com/blog/ → /blog/.
const sitemapPaths = new Set();
const sitemaps = ["sitemap.xml", "sitemap-index.xml"].filter((file) =>
	files.has(file),
);
for (let i = 0; i < sitemaps.length; i++)
	for (const [, loc] of read(sitemaps[i]).matchAll(
		/<loc>\s*([^<\s]+)\s*<\/loc>/g,
	)) {
		const path = decode(new URL(loc, "https://site.invalid").pathname);
		const file = path.replace(/^\//, "");
		if (!file.endsWith(".xml")) sitemapPaths.add(path);
		else if (files.has(file) && !sitemaps.includes(file)) sitemaps.push(file);
	}
if (sitemaps.length === 0)
	report("/", "sitemap", "no sitemap.xml or sitemap-index.xml");
// The files the sitemap points to, so that /blog and /blog/ count as the same page.
const inSitemap = new Set([...sitemapPaths].map(fileFor));

if (!files.has("robots.txt")) report("/", "robots", "no robots.txt");
else {
	// A group of rules starts with one or more User-agent lines; "Disallow: /" for * blocks everything.
	let agents = [];
	let afterAgent = false;
	for (const line of read("robots.txt").split("\n")) {
		const [field, ...rest] = line.replace(/#.*/, "").split(":");
		const value = rest.join(":").trim();
		if (!field.trim()) continue;
		if (field.trim().toLowerCase() === "user-agent") {
			agents = afterAgent ? [...agents, value] : [value];
			afterAgent = true;
			continue;
		}
		afterAgent = false;
		if (
			field.trim().toLowerCase() === "disallow" &&
			value === "/" &&
			agents.includes("*")
		) {
			report(
				"/",
				"robots",
				"robots.txt blocks the whole site for every crawler",
			);
			break;
		}
	}
}

const seen = { title: new Map(), description: new Map() };
const pages = [];
for (const file of [...files].filter((f) => f.endsWith(".html")).sort()) {
	const page = urlOf(file);
	const html = read(file);
	const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
	const metas = tags(head, "meta");
	const meta = (name) =>
		metas.find((tag) => attribute(tag, "name")?.toLowerCase() === name) ?? "";
	// A 404 page and a page that asks not to be indexed are not meant for search.
	if (
		/^\/404\/?$/.test(page) ||
		/noindex/i.test(attribute(meta("robots"), "content") ?? "")
	) {
		if (inSitemap.has(file))
			report(page, "sitemap", "in the sitemap, but a 404 or noindex page");
		continue;
	}
	pages.push(page);

	if (!attribute(tags(html, "html")[0] ?? "", "lang"))
		report(page, "lang", "<html> has no lang");

	const title = text(
		head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "",
	);
	if (!title) report(page, "title", "no <title>");
	else if (title.length > 60)
		report(page, "title", `${title.length} characters, over 60: "${title}"`);
	const description = attribute(meta("description"), "content")?.trim() ?? "";
	if (!description) report(page, "description", "no meta description");
	else if (description.length < 50 || description.length > 160)
		report(
			page,
			"description",
			`${description.length} characters, outside 50 to 160`,
		);
	for (const [kind, value] of [
		["title", title],
		["description", description],
	])
		if (value) seen[kind].set(value, [...(seen[kind].get(value) ?? []), page]);

	const h1 = tags(html, "h1").length;
	if (h1 !== 1) report(page, "h1", `${h1} <h1>, one expected`);

	if (
		!tags(head, "link").some(
			(tag) => attribute(tag, "rel")?.toLowerCase() === "canonical",
		)
	)
		report(page, "canonical", "no canonical link");

	for (const [, json] of html.matchAll(
		/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
	))
		try {
			JSON.parse(json);
		} catch (error) {
			report(
				page,
				"structured-data",
				`JSON-LD that does not parse: ${error.message}`,
			);
		}

	for (const img of tags(html, "img")) {
		const src = attribute(img, "src") ?? "";
		if (attribute(img, "alt") === undefined)
			report(page, "image-alt", `no alt on ${src}`);
		if (!attribute(img, "width") || !attribute(img, "height"))
			report(
				page,
				"image-size",
				`no width or height on ${src}: the page moves as it loads`,
			);
		const local =
			!/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src) && fileFor(target(page, src));
		const kb = local ? Math.round(statSync(join(site, local)).size / 1024) : 0;
		if (kb > HEAVY_IMAGE_KB)
			report(
				page,
				"image-weight",
				`${src} weighs ${kb} KB, over ${HEAVY_IMAGE_KB}`,
			);
	}

	for (const a of tags(html, "a")) {
		const href = attribute(a, "href");
		if (!href || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) continue; // other sites, mail, anchors
		if (!fileFor(target(page, href)))
			report(page, "broken-link", `${href} leads to no page`);
	}

	if (sitemaps.length > 0 && !inSitemap.has(file))
		report(page, "sitemap", "not in the sitemap");
}

for (const [kind, values] of Object.entries(seen))
	for (const [value, on] of values)
		if (on.length > 1)
			report(
				on[0],
				`duplicate-${kind}`,
				`"${value}" is also on ${on.slice(1).join(", ")}`,
			);
for (const path of sitemapPaths)
	if (!fileFor(path))
		report(path, "sitemap", "in the sitemap, but no page has this address");

writeFileSync(
	"seo-report.json",
	`${JSON.stringify({ pages, problems }, null, "\t")}\n`,
);
console.log(
	`${pages.length} pages checked in ${site}/, ${problems.length} problems, in seo-report.json`,
);
for (const [check, list] of Object.entries(
	Object.groupBy(problems, (p) => p.check),
))
	console.log(`  ${check}: ${list.length}`);
