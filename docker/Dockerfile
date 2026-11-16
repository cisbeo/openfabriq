# The openfabriq engine on a server: Node, Python, git, gh, Claude Code, the Linux sandbox
# (bubblewrap, socat, ripgrep), a headless browser and the npm package openfabriq, run by a non-root
# user. Configured by environment variables only: see docker-compose.yml.
# Built from the repository's root: docker compose build.

# The npm package openfabriq, built from these sources. Once it is on npm, the image
# can install it from there instead.
FROM node:24.22.2-bookworm-slim AS package
WORKDIR /src
COPY . .
RUN corepack enable \
	&& pnpm install --frozen-lockfile --filter openfabriq --filter "@openfabriq/cli..." \
	&& pnpm package

FROM node:24.22.2-bookworm-slim

# Debian packages a factory's commands need, from OPENFABRIQ_APT_PACKAGES: "php-cli composer".
ARG APT_PACKAGES=""
# python3: agents reach for it to read or rewrite a file in a shell, and lose a try without it.
# gh from its own apt repository, as its install guide says (Debian's is years behind).
RUN apt-get update \
	&& apt-get install -y --no-install-recommends bubblewrap socat ripgrep git ca-certificates curl procps python3 $APT_PACKAGES \
	&& mkdir -p -m 755 /etc/apt/keyrings \
	&& curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
	&& chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
	&& echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends gh \
	&& rm -rf /var/lib/apt/lists/*

# The Claude Code version the sandbox was measured with (e2e/linux/Dockerfile), the one of the Agent SDK
# (packages/runner): an older one ignores settings the engine sets, such as blockReadsExemptPaths.
ARG CLAUDE_CODE_VERSION=2.1.318
# pnpm, pinned: the examples' setup and checks run it, and a run should not download it.
ARG PNPM_VERSION=10.15.1
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} pnpm@${PNPM_VERSION}

# A browser for the agents: agent-browser and Playwright's headless Chrome with its libraries and
# fonts, which the skill browser-evidence of the templates drives to screenshot the pages it builds.
ARG AGENT_BROWSER_VERSION=0.42.0
ARG PLAYWRIGHT_VERSION=1.65.0
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN npm install -g agent-browser@${AGENT_BROWSER_VERSION} \
	&& npx -y playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium-headless-shell \
	&& chmod -R a+rX /opt/ms-playwright \
	&& ln -s /opt/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell /usr/local/bin/chrome-headless-shell \
	&& rm -rf /var/lib/apt/lists/* /root/.npm
# agent-browser's own settings, which the agents' shell receives: the headless Chrome, and no check of
# Chrome's version, which calls a site off the factory's network.
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/local/bin/chrome-headless-shell \
	AGENT_BROWSER_NO_VERSION_CHECK=1

COPY --from=package /src/packages/cli/release/ /tmp/release/
RUN npm install -g /tmp/release/openfabriq-*.tgz \
	&& rm -rf /tmp/release /root/.npm
COPY docker/entrypoint.sh /usr/local/bin/openfabriq-entrypoint

RUN useradd --create-home --shell /bin/bash factory \
	&& mkdir /home/factory/.openfabriq \
	&& chown factory:factory /home/factory/.openfabriq
USER factory
WORKDIR /home/factory
ENTRYPOINT ["openfabriq-entrypoint"]
