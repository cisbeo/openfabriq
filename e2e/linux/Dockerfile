# A Linux machine for the sandboxes: bubblewrap, socat and ripgrep, the
# Claude Code the host runs, curl and agent-browser as in the engine's image, and a non-root user, as on a developer's machine. The repository is
# mounted read-only at /repo. The user's home, with Claude's login, lives in the volume
# openfabriq-e2e-home (`pnpm e2e:linux:login`, once). bubblewrap needs seccomp, AppArmor
# and the system paths unconfined, not --privileged.
FROM node:24.22.2-bookworm-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends bubblewrap socat ripgrep git ca-certificates curl procps \
	&& rm -rf /var/lib/apt/lists/*
ARG CLAUDE_CODE_VERSION=2.1.318
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}
# agent-browser and Playwright's headless Chrome, as the engine's image has them; outside the home
# folder, which is a volume here.
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
RUN useradd --create-home --shell /bin/bash dev
USER dev
WORKDIR /home/dev
