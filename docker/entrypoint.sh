#!/bin/sh
# The engine's start in Docker: the git identity, then each repository of
# OPENFABRIQ_REPOSITORIES cloned and its openfabriq/ applied, then `openfabriq start`.
set -eu

missing=""
# Claude: an API key or a subscription token from `claude setup-token`.
[ -n "${ANTHROPIC_API_KEY:-}${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || missing=" ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN)"
# GitHub: the team's GitHub App (it commits as its bot), or a token and the identity of its commits.
app=""
[ -n "${GITHUB_APP_ID:-}" ] && [ -n "${GITHUB_APP_PRIVATE_KEY:-}" ] && app=yes
needed="OPENFABRIQ_REPOSITORIES"
if [ -z "$app" ] && [ -z "${GH_TOKEN:-}" ]; then
	missing="$missing GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (or, without an app, GH_TOKEN, GIT_USER_NAME and GIT_USER_EMAIL)"
elif [ -z "$app" ]; then
	needed="GIT_USER_NAME GIT_USER_EMAIL $needed"
fi
for name in $needed; do
	eval "value=\${$name:-}"
	[ -n "$value" ] || missing="$missing $name"
done
if [ -n "$missing" ]; then
	echo "openfabriq: set$missing (see docker-compose.yml)." >&2
	exit 1
fi

[ -z "${GIT_USER_NAME:-}" ] || git config --global user.name "$GIT_USER_NAME"
[ -z "${GIT_USER_EMAIL:-}" ] || git config --global user.email "$GIT_USER_EMAIL"

# gh repo clone with GH_TOKEN, or with the app's token for this repository, printed by the CLI.
clone() {
	if [ -z "$app" ]; then
		gh repo clone "$1" "$2" -- --depth 1 --quiet
	elif token=$(openfabriq connect github token "$1"); then
		GH_TOKEN="$token" gh repo clone "$1" "$2" -- --depth 1 --quiet
	else
		echo "openfabriq: $token" >&2
		return 1
	fi
}

# The default branch of each repository, as it is now: apply what is merged.
for repository in $(printf '%s' "$OPENFABRIQ_REPOSITORIES" | tr ',' ' '); do
	checkout="$HOME/checkouts/$repository"
	rm -rf "$checkout"
	if clone "$repository" "$checkout" &&
		(cd "$checkout" && openfabriq apply --yes --project "$repository"); then
		# What the image lacks for this factory, in the logs; the engine starts anyway.
		(cd "$checkout" && openfabriq doctor) || true
	else
		echo "openfabriq: $repository was not applied; the engine runs the factory applied before, if any." >&2
	fi
done

# The studio listens on 127.0.0.1 inside the container: socat brings it to port 4311, published on
# the server's 127.0.0.1:4310 and reached by a proxy on OPENFABRIQ_STUDIO_URL. The studio accepts the
# Host 127.0.0.1:4310 and that address's; it also wants the cookie that the address
# printed by `start` or the password sets. `start` refuses a bad password or address.
socat TCP-LISTEN:4311,fork,reuseaddr TCP:127.0.0.1:4310 &

exec openfabriq start
