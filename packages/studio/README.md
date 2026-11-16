# @openfabriq/studio

The studio: openfabriq's local app, which shows what the factories do, what they cost and where people stepped in. `openfabriq start` serves it on `http://127.0.0.1:4310`, behind a token. What it shows, page by page, is in the documentation: [the studio](../docs/content/docs/studio/overview.mdx).

It only reads `~/.openfabriq` (or `$OPENFABRIQ_HOME`). The chat is the exception: it writes the conversations, behind the token.

| Where | What |
| --- | --- |
| `src/` | the JSON server: `server.ts` wires and listens, `routes.ts` lists every route of the API, `access/` says who gets in, `http/` reads requests and writes answers, `subjects/` asks GitHub, Linear and Sentry whether a subject is done, and one folder per page's data (`runs/`, `board/`, `chat/`, `wiki/`…) |
| `app/src/` | the Vite + React + Tailwind app: `shell/`, `lib/`, `components/`, and `features/<page>/` with each page's decisions in a pure `.ts` file beside its components |
| `test/` | the server's tests and, in `test/app/`, the app's logic, without a browser |
| `scripts/` | development tools: `serve`, `smoke`, and from the made-up data of `docs-seed.ts`, `docs-screenshots` and `docs-demo` (the answers the docs' demo build reads, see `app/src/lib/demo.ts`) |

## Develop

From the repository root, `pnpm build` first: the server serves the app built into `dist/app`.

```bash
pnpm --filter @openfabriq/studio serve               # the app and its API without the engine; prints the address with the token
PORT=4399 pnpm --filter @openfabriq/studio serve --fake-chat   # a chat that answers a canned stream, spends nothing
pnpm --filter @openfabriq/studio dev                 # Vite with hot reload on :5173, /api sent to a running serve or start
pnpm --filter @openfabriq/studio smoke               # opens every page in a browser (dev-browser), then `dev-browser stop`
```

`serve` never polls GitHub nor starts an agent; never use `openfabriq start` to work on the app. With `--fake-chat` it still stores the conversations: point `OPENFABRIQ_HOME` at a copy to keep yours clean.

The CLI imports this package, and the npm package `openfabriq` bundles its built app (`packages/cli/scripts/package.ts`).
