#!/bin/sh
# Exports the CMS of a Webflow site through its Data API (v2), and downloads every file of Webflow's CDN
# the items point to, into webflow-export/ in the run's checkout. Those files stop answering once the
# Webflow plan ends: the migration keeps its own copy.
#
# Reads:  WEBFLOW_SITE_ID (env of factory.yaml) and the secret WEBFLOW_API_TOKEN (read scopes only)
# Needs:  curl and node
# Writes: webflow-export/collections.json         the site's collections
#         webflow-export/collections/<slug>.json  {"collection": its fields, "items": its published items}
#         webflow-export/assets/<path>            each file of Webflow's CDN the items point to, by its path
#         webflow-export/assets-missing.txt       the files that did not download, one URL per line
#
# WEBFLOW_API_URL changes the API's address, WEBFLOW_CDN the files' addresses (a regular expression):
# the tests point them to a fake Webflow.
set -eu

: "${WEBFLOW_API_TOKEN:?is not set: run openfabriq secret set WEBFLOW_API_TOKEN}"
: "${WEBFLOW_SITE_ID:?is not set: write it under env in factory.yaml}"
api="${WEBFLOW_API_URL:-https://api.webflow.com/v2}"
export WEBFLOW_CDN="${WEBFLOW_CDN:-https://(cdn\.prod\.website-files\.com|assets(-global)?\.website-files\.com|uploads-ssl\.webflow\.com)/}"
out=webflow-export
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# --retry waits and tries again on 429 (60 to 120 requests a minute, by plan) and on 5xx.
get() {
	curl -sSf --retry 5 -H "Authorization: Bearer $WEBFLOW_API_TOKEN" -H "accept: application/json" "$api/$1"
}
json() {
	script=$1
	shift
	node -e "const read = (f) => JSON.parse(require('fs').readFileSync(f, 'utf8')); $script" "$@"
}

rm -rf "$out"
mkdir -p "$out/collections" "$out/assets"
get "sites/$WEBFLOW_SITE_ID/collections" >"$out/collections.json"

# One line per collection: its id, and its slug made safe for a file name.
json 'for (const c of read(process.argv[1]).collections ?? [])
	console.log(c.id, String(c.slug).replace(/[^a-z0-9-]/gi, "-"))' "$out/collections.json" >"$tmp/collections"

while read -r id slug; do
	get "collections/$id" >"$tmp/collection.json"
	offset=0
	pages=""
	while :; do
		get "collections/$id/items/live?limit=100&offset=$offset" >"$tmp/items-$offset.json"
		pages="$pages $tmp/items-$offset.json"
		total=$(json 'console.log(read(process.argv[1]).pagination?.total ?? 0)' "$tmp/items-$offset.json")
		offset=$((offset + 100))
		[ "$offset" -lt "$total" ] || break
	done
	# $pages unquoted: one argument per page of items.
	# shellcheck disable=SC2086
	json 'const [collection, ...pages] = process.argv.slice(1).map(read);
	console.log(JSON.stringify({ collection, items: pages.flatMap((p) => p.items ?? []) }, null, 2))' \
		"$tmp/collection.json" $pages >"$out/collections/$slug.json"
done <"$tmp/collections"

# Every URL of Webflow's CDN in the items (images, files, images inside rich text), once,
# with the path it is saved under. A path that leaves assets/ is skipped.
: >"$tmp/assets"
[ -s "$tmp/collections" ] && json 'const cdn = new RegExp(process.env.WEBFLOW_CDN + "[^\\s\"\x27()<>,\\\\]+", "g");
	const urls = (v) => typeof v === "string" ? v.match(cdn) ?? []
		: v && typeof v === "object" ? Object.values(v).flatMap(urls) : [];
	for (const url of new Set(process.argv.slice(1).flatMap((f) => urls(read(f).items)))) {
		const path = new URL(url).pathname.slice(1);
		if (path && !path.split("/").includes("..")) console.log(url, path);
	}' "$out"/collections/*.json >"$tmp/assets"

: >"$out/assets-missing.txt"
while read -r url path; do
	curl -sSf --retry 5 --create-dirs -o "$out/assets/$path" "$url" || echo "$url" >>"$out/assets-missing.txt"
done <"$tmp/assets"

echo "Exported $(wc -l <"$tmp/collections" | tr -d ' ') collections and $(wc -l <"$tmp/assets" | tr -d ' ') files into $out/; $(wc -l <"$out/assets-missing.txt" | tr -d ' ') files missing."
