# The relay without Cloudflare: workerd runs the same Worker as on Cloudflare.
# Built from packages/relay: docker compose up -d (docker-compose.yml puts Caddy and HTTPS in front).
FROM node:24.22.2-bookworm-slim AS build
WORKDIR /relay
COPY package.json wrangler.jsonc ./
COPY src src
# The versions pinned in package.json; wrangler bundles the Worker, workerd comes with it.
RUN npm install --no-audit --no-fund --no-package-lock \
	wrangler@$(node -p "require('./package.json').devDependencies.wrangler") \
	workerd@$(node -p "require('./package.json').devDependencies.workerd") \
	&& npx wrangler deploy --dry-run --outdir dist \
	&& cp "$(node -p "require.resolve('@cloudflare/workerd-linux-' + (process.arch === 'arm64' ? 'arm64' : '64') + '/bin/workerd')")" /workerd

FROM debian:bookworm-slim
# ca-certificates: the relay calls Linear's and Sentry's APIs over HTTPS.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& useradd --system --create-home relay \
	&& mkdir -p /relay/data && chown relay /relay/data
COPY --from=build /workerd /usr/local/bin/workerd
COPY --from=build /relay/dist/index.js /relay/dist/index.js
COPY workerd.capnp /relay/workerd.capnp
USER relay
WORKDIR /relay
VOLUME /relay/data
EXPOSE 8080
CMD ["workerd", "serve", "workerd.capnp"]
