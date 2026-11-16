#!/bin/sh
# Asks WPScan (https://wpscan.com) about every WordPress plugin and theme that Composer installed,
# and writes its answers to wpscan-report.json, in the run's checkout.
#
# Reads:  composer.lock: the wpackagist-plugin/* and wpackagist-theme/* packages
# Needs:  the secret WPSCAN_API_TOKEN of factory.yaml, php and curl
# Writes: wpscan-report.json, one line per plugin or theme: WPScan's answer as JSON,
#         or {"plugins/<slug>": "no answer from WPScan (…)"} when there is none
#
# WPSCAN_API_URL changes WPScan's address: the tests point it to a fake WPScan.
set -eu

: "${WPSCAN_API_TOKEN:?is not set: run openfabriq secret set WPSCAN_API_TOKEN}"
api="${WPSCAN_API_URL:-https://wpscan.com/api/v3}"

# The plugins and themes of composer.lock, one per line, as WPScan names them: plugins/akismet.
packages=$(php -r '
	$lock = json_decode(file_get_contents("composer.lock"));
	foreach ($lock->packages as $package)
		if (preg_match("#^wpackagist-(plugin|theme)/(.+)$#", $package->name, $m))
			echo $m[1], "s/", $m[2], "\n";
')

# One request per plugin or theme, the daily quota counts them; a failure does not stop the others.
: >wpscan-report.json
for path in $packages; do
	curl -sf -H "Authorization: Token token=$WPSCAN_API_TOKEN" "$api/$path" >>wpscan-report.json ||
		printf '{"%s": "no answer from WPScan (wrong token, quota, or unknown slug)"}' "$path" >>wpscan-report.json
	echo >>wpscan-report.json # curl writes no line end
done
