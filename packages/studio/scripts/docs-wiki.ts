// Development only: the wiki of the made-up acme/web-app that docs-screenshots shows,
// written the way the engine's wiki skill writes one. Page path → Markdown.

export const WIKI: Record<string, string> = {
	"index.md": `---
commit: 4e1c9a7
---

# Web app

- [Start here](start-here.md): what the app does and the five files to read first
- [How it fits together](how-it-fits-together.md): the pieces, and the path of a request
- [Built with](built-with.md): languages, frameworks, services and storage
- [Where things live](where-things-live.md): each folder in one line
- [Ways in](ways-in.md): routes, background jobs and webhooks
- [Tasks](areas/tasks.md): tasks, tags, filters and search
- [Billing](areas/billing.md): plans, checkout and invoices
- [Exports](areas/exports.md): CSV exports of tasks and invoices
- [Accounts](areas/accounts.md): sign-in, SSO and trials
- [Making a change](making-a-change.md): install, run, test, ship
- [Glossary](glossary.md): the words of the product and of the code
`,
	"start-here.md": `# Start here

Web app is a task manager for small teams: tasks with tags and due dates, shared in an account, on a monthly plan.

Read these first:

1. [src/server.ts](../src/server.ts): the HTTP server and its routes
2. [src/tasks/model.ts](../src/tasks/model.ts): what a task is
3. [src/db/tasks.ts](../src/db/tasks.ts): how tasks are stored and read
4. [src/billing/invoices.ts](../src/billing/invoices.ts): how an account pays
5. [src/export/csv.ts](../src/export/csv.ts): the exports finance uses every week

## Sources

src/server.ts
src/tasks/model.ts
src/db/tasks.ts
src/billing/invoices.ts
src/export/csv.ts
`,
	"how-it-fits-together.md": `# How it fits together

The browser talks to one Node server. The server reads and writes Postgres, charges through Stripe, and hands long work to a job queue.

## A request

\`\`\`mermaid
flowchart TD
  Browser --> server["src/server.ts"]
  server --> tasks["src/tasks"]
  server --> billing["src/billing"]
  server -. export .-> queue["queue"]
  tasks --> db[("Postgres")]
  billing --> db
  billing --> stripe(["Stripe"])
\`\`\`

Every route checks the session first (\`requireAccount\`), then calls one [area](areas/tasks.md). Areas never call each other's tables: billing asks tasks through \`countTasks(accountId)\`.

## Background work

Exports and invoice e-mails run in the queue, out of the request. A job that fails is retried three times, then lands in \`jobs.failed\` for a person to look at.

## Sources

src/server.ts
src/tasks/model.ts
src/billing/invoices.ts
src/jobs/queue.ts
src/export/csv.ts
`,
	"built-with.md": `# Built with

| What | Version | Declared in |
|---|---|---|
| TypeScript, Node | Node 24 | [package.json](../package.json) |
| React, Vite | React 19 | [package.json](../package.json) |
| Postgres | 16 | [docker-compose.yml](../docker-compose.yml) |
| Stripe | API 2026-09 | [src/billing/stripe.ts](../src/billing/stripe.ts) |
| Vitest | 3 | [vitest.config.ts](../vitest.config.ts) |

## Sources

package.json
docker-compose.yml
src/billing/stripe.ts
vitest.config.ts
`,
	"where-things-live.md": `# Where things live

- \`src/server.ts\`: routes and the session check
- \`src/tasks/\`: tasks, tags, filters, search
- \`src/billing/\`: plans, checkout totals, invoices, Stripe
- \`src/export/\`: CSV exports
- \`src/account/\`: sign-in, SSO, trials
- \`src/jobs/\`: the job queue and its workers
- \`src/components/\`: the React components of the app

## Sources

src/server.ts
src/jobs/queue.ts
`,
	"ways-in.md": `# Ways in

| Way in | Where |
|---|---|
| \`GET /tasks\`, \`POST /tasks\` | [src/server.ts](../src/server.ts) |
| \`GET /exports/:id\` | [src/export/csv.ts](../src/export/csv.ts) |
| \`POST /webhooks/stripe\` | [src/billing/stripe.ts](../src/billing/stripe.ts) |
| Nightly job: invoice e-mails | [src/jobs/queue.ts](../src/jobs/queue.ts) |

## Sources

src/server.ts
src/export/csv.ts
src/billing/stripe.ts
src/jobs/queue.ts
`,
	"areas/tasks.md": `# Tasks

A task belongs to one account. It has a title, tags and an optional due date.

- [src/tasks/model.ts](../../src/tasks/model.ts): the \`Task\` type and its checks
- [src/tasks/search.ts](../../src/tasks/search.ts): search by words and by tag
- [src/tasks/filters.ts](../../src/tasks/filters.ts): \`all\`, \`open\`, \`done\`, \`due this week\`
- [src/db/tasks.ts](../../src/db/tasks.ts): reads in pages of 500, never the whole account

## Sources

src/tasks/model.ts
src/tasks/search.ts
src/tasks/filters.ts
src/db/tasks.ts
`,
	"areas/billing.md": `# Billing

An account is on a plan; a plan has a monthly price and a task limit.

\`\`\`mermaid
flowchart LR
  checkout["Checkout"] --> total["src/checkout/total.ts"]
  total --> stripe(["Stripe"])
  stripe -- webhook --> invoices["src/billing/invoices.ts"]
  invoices --> mail["Invoice e-mail"]
\`\`\`

- [src/account/plan.ts](../../src/account/plan.ts): plans and their limits
- [src/checkout/total.ts](../../src/checkout/total.ts): totals, taxes and coupons, in cents
- [src/billing/invoices.ts](../../src/billing/invoices.ts): \`listInvoices(accountId)\`, one invoice per paid month

## Sources

src/account/plan.ts
src/checkout/total.ts
src/billing/invoices.ts
src/billing/stripe.ts
`,
	"areas/exports.md": `# Exports

Finance downloads tasks and invoices as CSV every week. An export runs in the queue and streams its rows, so a large account never loads in memory.

- [src/export/csv.ts](../../src/export/csv.ts): \`exportCsv(accountId, res)\`, streamed by pages
- [src/export/csv.test.ts](../../src/export/csv.test.ts): an account of 5,000 tasks, and an empty one

## Sources

src/export/csv.ts
src/export/csv.test.ts
src/db/tasks.ts
`,
	"areas/accounts.md": `# Accounts

People sign in with an e-mail link or their company's SSO. A new account starts a 14-day trial.

- [src/account/sso.ts](../../src/account/sso.ts): SAML sign-in
- [src/components/TrialBadge.tsx](../../src/components/TrialBadge.tsx): the days left, in the header

## Sources

src/account/sso.ts
src/account/plan.ts
src/components/TrialBadge.tsx
`,
	"making-a-change.md": `# Making a change

\`\`\`sh
pnpm install
docker compose up -d   # Postgres
pnpm dev               # the app on http://localhost:5173
pnpm test              # Vitest
pnpm lint && pnpm typecheck
\`\`\`

A pull request runs the same checks in CI. Billing changes need a test in cents: \`total.test.ts\` shows how.

## Sources

package.json
docker-compose.yml
src/checkout/total.test.ts
`,
	"glossary.md": `# Glossary

- **Account**: a team; it owns tasks, a plan and invoices. \`accounts\` table.
- **Plan**: what an account pays each month and its task limit. [src/account/plan.ts](../src/account/plan.ts).
- **Invoice**: one paid month of a plan. [src/billing/invoices.ts](../src/billing/invoices.ts).
- **Export**: a CSV of tasks or invoices, built in the queue. [src/export/csv.ts](../src/export/csv.ts).
- **Trial**: the first 14 days of an account, free.

## Sources

src/account/plan.ts
src/billing/invoices.ts
src/export/csv.ts
`,
};
