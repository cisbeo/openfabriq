# @openfabriq/relay

A Cloudflare Worker and one SQLite Durable Object that receive what comes from the Internet (webhooks, OAuth callbacks) and keep it for the local engine, which connects out to it over a WebSocket. Each user deploys it on their own Cloudflare account, or runs the same code on a machine of their own (below).

The relay runs no agent, chooses no automation and never writes to GitHub. The only thing it writes to Linear on its own is the fixed "received" thought below. It never writes to Slack. It reads Sentry, to find new issues, and never writes to it.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/openfabriq/openfabriq/tree/main/packages/relay)

The button asks for `ENGINE_TOKEN` (`openssl rand -hex 32`, see `.dev.vars.example`); give the same value to `openfabriq connect relay --url <address>`. From a terminal:

```sh
cd packages/relay
pnpm exec wrangler login
TOKEN=$(openssl rand -hex 32)
printf '{"ENGINE_TOKEN":"%s"}' "$TOKEN" > /tmp/relay-secrets.json
pnpm exec wrangler deploy --secrets-file /tmp/relay-secrets.json
rm /tmp/relay-secrets.json
```

Keep `$TOKEN`: the engine needs it. `openfabriq connect relay` does these steps for you; this is the manual way.

## Self-host

The same Worker runs in [workerd](https://github.com/cloudflare/workerd), the open-source runtime of Cloudflare Workers, in Docker, with Caddy in front for HTTPS. You need a domain name that points to the machine, and ports 80 and 443 open. In `packages/relay`, write a `.env` file:

```sh
RELAY_DOMAIN=relay.example.com
ENGINE_TOKEN=<openssl rand -hex 32>
```

Then:

```sh
docker compose up -d
openfabriq connect relay --url https://relay.example.com   # on the engine's machine; asks the token
```

The `relay-data` volume holds the queue and the secrets given to the relay (Linear, Slack, Sentry, webhooks): back it up and protect it like them. The relay is only up when this machine is: what a sender posts during an outage is lost, unless the sender retries.

Without Docker: `pnpm bundle` writes `dist/index.js`, then `ENGINE_TOKEN=... pnpm exec workerd serve workerd.capnp` listens on port 8080 and keeps its data in `./data` (`--socket-addr http=<ip:port>` and `--directory-path data=<dir>` change them). Put HTTPS in front, with a proxy that sets `X-Forwarded-Proto`.

`ENGINE_TOKEN` is the only Worker secret. Linear's, Slack's and Sentry's secrets, and the factory's webhooks' secrets, are given later through `POST /config/linear`, `POST /config/slack`, `POST /config/sentry` and `POST /config/webhook/<name>`, and live in the Durable Object's storage.

## Contract

Routes marked *engine* need `Authorization: Bearer <ENGINE_TOKEN>`, or they answer `401`. Any other path answers `404`.

### `GET /health`

`200 { "ok": true }`.

### `POST /config/linear` (engine)

Body `{ "webhookSecret": string, "clientId": string, "clientSecret": string }` (all non-empty, else `400`). Stores them, mints a new OAuth `state` (any older one stops working) and answers:

```json
{ "authorizeUrl": "https://linear.app/oauth/authorize?client_id=…&redirect_uri=<relay>/oauth/linear/callback&response_type=code&scope=read,write,app:assignable,app:mentionable&state=…&actor=app" }
```

### `GET /oauth/linear/callback?code=…&state=…`

Linear sends the installing admin here. An unknown or already used `state` answers `400`. A code Linear refuses answers `502` "Linear refused the code, run openfabriq connect linear again." (the `state` is used all the same). Otherwise the relay exchanges the code, asks Linear who the app is (`viewer { id organization { id name } }`), stores the organization's tokens, queues an `installed` event and answers a small HTML page: "openfabriq is installed in <name>. You can close this tab."

### `GET /tokens/linear` (engine)

```json
{ "organizations": [{ "organizationId": "…", "organizationName": "…", "appUserId": "…", "accessToken": "…", "expiresAt": 1762000000000 }] }
```

`expiresAt` is in epoch milliseconds. Linear access tokens last 24 hours. The relay refreshes any token expiring within 5 minutes before answering, and keeps the rotated refresh token. An organization whose refresh Linear refuses with `invalid_grant` (it uninstalled the app) is forgotten and left out; any other refusal leaves it out of that answer only. The engine never sees refresh tokens or client secrets: ask again when `expiresAt` comes close.

### `POST /hooks/linear`

Linear's webhook address. The relay answers:

- `401` when no webhook secret is configured or `Linear-Signature` is not the hex HMAC-SHA256 of the raw body;
- `400` when the body is not JSON, `Linear-Delivery` is missing, or the body's `webhookTimestamp` is more than 60 seconds away from now;
- `200` otherwise, at once. A `Linear-Delivery` already seen is not queued again.

For `AgentSessionEvent` / `created`, the relay then posts, with the organization's token, a `thought` activity to `agentSession.id` whose text is fixed in code: "Received: openfabriq takes it as soon as a run is free." A failure is logged and never fails the webhook.

### `POST /config/slack` (engine)

Body `{ "signingSecret": string }` (non-empty, else `400`): the Slack app's signing secret ("Basic Information", "App Credentials"). Stores it, replacing any older one, and answers `204`.

### `POST /hooks/slack`

The Slack app's Events API Request URL. The relay answers:

- `401` when no signing secret is configured, or `X-Slack-Signature` is not `v0=` and the hex HMAC-SHA256, keyed with the signing secret, of `v0:<X-Slack-Request-Timestamp>:<raw body>`;
- `400` when `X-Slack-Request-Timestamp` is more than 5 minutes away from now, or the body is not JSON;
- `200` with the `challenge`, as `text/plain`, for a `url_verification` (Slack signs it too: the signing secret must be configured before the URL is verified);
- `200` otherwise, at once. An `event_callback` whose event is a mention of the bot, or a person's reply in a thread (no `subtype`, no `bot_id`), is queued, unless its `event_id` was already seen (Slack retries with the same one). Other bodies and events are not kept.

### `POST /config/sentry` (engine)

Body `{ "token": string, "url": string }` (a non-empty token and an `http`/`https` URL, else `400`). `url` is the Sentry the token was tested against: `https://sentry.io`, or a self-hosted one. The relay keeps the token and the URL's origin, replacing any older ones, and answers `204`. It sends the token to that origin only: a link that points elsewhere (a `Link` header, for example) fails the search.

### `PUT /config/sentry/watches` (engine)

Body `{ "watches": [{ "organization": string, "project": string, "query"?: string }] }` (non-empty organization and project, `query` a string when present, else `400`). Replaces the list and answers `204`. A watch is known by its organization, project and query: one kept from the last list keeps where its search is; a new one starts now, so only issues first seen from now on come; a removed one is forgotten. `query` is Sentry's search syntax, passed on untouched.

While there is a Sentry configuration and at least one watch, the alarm fires every minute (within a minute of either route). For each watch it asks the numeric project id once (`GET <origin>/api/0/projects/<org>/<project>/`), then searches `GET <origin>/api/0/organizations/<org>/issues/?project=<id>&query=<query or is:unresolved> firstSeen:>…&sort=new&statsPeriod=14d&limit=100`, with `Authorization: Bearer <token>`, following `Link` for at most 5 pages. Each issue not queued before for that watch is queued. The next search starts 2 minutes before this one did, so an issue Sentry indexed late is not missed. A failed search keeps its starting point and queues an `error` event, once per new message: a broken token is said once, not every minute. One watch failing never stops the others. Without a configuration or a watch, the alarm only cleans up, daily.

### `POST /config/webhook/<name>` (engine), `DELETE /config/webhook/<name>` (engine)

A webhook of the factory. `<name>` is lowercase letters, digits and `-`. Body `{ "signature": "github" | "sentry" | "stripe" | "standard" | "none", "secret": string }` (else `400`): stores it, replacing any older one, and answers `204`. `DELETE` forgets it (`204`). `openfabriq connect webhook <name>` does both.

### `POST /hooks/custom/<name>`, and `POST /hooks/custom/<name>/<secret>` for `none`

The relay answers `401` for a webhook it does not know, or a request its sender did not sign; `400` for a timestamp more than 5 minutes away (Stripe and Standard Webhooks only); `413` for a body over 1 MB, or one that is not text and grows past 1.9 MB once read as text; `200` otherwise, at once. The checks follow each sender's documentation:

| `signature` | Signed | Header | Delivery id |
| --- | --- | --- | --- |
| `github` | the raw body | `X-Hub-Signature-256`: `sha256=` and the hex HMAC-SHA256 | none: `X-GitHub-Delivery` is not signed |
| `sentry` | the raw body | `Sentry-Hook-Signature`: the hex HMAC-SHA256, keyed with the integration's client secret | none: `Request-ID` is not signed |
| `stripe` | `<t>.` and the raw body | `Stripe-Signature`: `t=<seconds>`, one or more `v1=<hex>`; any `v1` may match | the body's `id` |
| `standard` | `<webhook-id>.<webhook-timestamp>.` and the raw body; the key is the base64 after `whsec_` | `webhook-signature`: space-separated `v1,<base64>`; any may match | `webhook-id` |
| `none` | nothing: the last part of the address is the secret | | |

Without a delivery id, the SHA-256 of the body stands in: a signed body captured and sent again with a new unsigned id is still one delivery. A delivery already seen in the last 7 days is answered `200` and not kept again.

While the queue holds 10,000 events or 100 MB the engine has not taken, every `POST /hooks/…` answers `503` with `Retry-After: 60`, before its delivery is taken as seen: the sender's retry is kept once the engine catches up.

### `GET /engine` (engine, WebSocket)

Without `Upgrade: websocket`: `426`. Without the token: `401`.

Every event has the shape `{ "id": string, "receivedAt": number, "service": string, "kind": string, … }`:

| `service` | `kind` | Other fields |
| --- | --- | --- |
| `linear` | `installed` | `organizationId`, `organizationName`, `appUserId` |
| `linear` | `webhook` | `delivery` (the `Linear-Delivery` header), `payload` (Linear's JSON body, untouched) |
| `slack` | `webhook` | `payload` (Slack's `event_callback` body, untouched) |
| `webhook` | `received` | `webhook` (its name), `delivery`, `payload` (the body, as text, untouched) |
| `sentry` | `issue` | `organization`, `project`, `query` (when the watch has one), `issue`: `{ id, shortId, permalink, firstSeen }` as Sentry gave them |
| `sentry` | `error` | `organization`, `project`, `query` (when the watch has one), `message` (for example `Sentry GET /api/0/projects/acme/web/: 401 Invalid token`) |

Frames:

- relay → engine, right after connecting: `{ "type": "events", "events": [ …every unacked event, oldest first ] }` (possibly empty);
- relay → engine, for each new event: `{ "type": "events", "events": [event] }`;
- engine → relay: `{ "type": "ack", "ids": [ … ] }`. Acked events are deleted. Unacked ones come back on the next connection, so the engine must handle an event it has already seen;
- engine → relay: the text `ping` gets the text `pong`, for keepalive.

Malformed frames are ignored. An event never acked is deleted after 7 days.

Node 22's global `WebSocket` can send the token: `new WebSocket(url, { headers: { Authorization: "Bearer …" } })`.

## Develop

```sh
pnpm test        # in the Workers runtime, through @cloudflare/vitest-plugin
pnpm typecheck   # wrangler types --check && tsc
```

After changing `wrangler.jsonc`, run `pnpm exec wrangler types` and commit `worker-configuration.d.ts`.
