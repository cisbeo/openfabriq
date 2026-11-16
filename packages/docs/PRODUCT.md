# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers and tech leads of a team that keeps its code on GitHub and already uses Claude Code. They are evaluating whether to let AI agents work on their repository: triage issues, open pull requests, review, fix CI, migrate a site. They arrive on the site from GitHub or a link, read the home page in a few minutes, then pick a template to try.

## Product Purpose

openfabriq is an open source engine that runs a software factory described in an `openfabriq/` folder of the user's repository. Agents, the moments they start (automations) and what they may write to GitHub are readable Markdown and YAML files. The engine runs on the user's computer or the team's server, with their Claude Code subscription or an API key, and talks to GitHub through the logged-in `gh` CLI. Success for the site: a visitor understands the mechanism in one screen, trusts it enough to try it, and installs a template.

## Positioning

"The Terraform of software factories": the factory is code in the repository; `openfabriq plan` shows what will change, security changes first; `openfabriq apply` applies it. Agents never have write access to GitHub: they propose outputs, the engine applies only what the automation allows (`can`), after running the project's checks. A person always merges. Everything runs on the user's own machine.

## Operating Context

- Install: `brew install openfabriq/tap/openfabriq` or `npm install -g openfabriq` (publication imminent; the docs already show these).
- Flow: `openfabriq init` (a Claude Code session writes the folder), `plan`, `apply`, `start` (engine plus the studio on 127.0.0.1:4310).
- The studio: overview with costs, a board (Waiting, Working, Needs you, Done), runs read like a Claude Code session (log with tool calls, proposed outputs), workflow graph, wiki, read-only chat.
- Sources of work: GitHub labels, comments, reviews, failed checks, schedules, Slack mentions, Linear issues, Sentry errors, signed webhooks (the last four through a relay the user deploys).
- Templates: 23 example factories in `examples/`, each with a README and a `workflow.png`; `openfabriq init --example <name>` copies one.

## Capabilities and Constraints

- macOS and Linux; Node 24+; agents run with Claude Code only (Codex announced as coming soon).
- The site is Fumadocs on Next.js, exported as static files; it is in English.
- The maintainers' notes in `docs/` are never cited by the site.

## Brand Commitments

- Name written lowercase: openfabriq. The mark is the studio's factory roof in a rounded square (`components/logo.tsx`).
- The studio's blue is the accent shared by the site and the app's screenshots.
- Voice: plain, short sentences, concrete nouns; says what happens, no hype.

## Evidence on Hand

- Real studio screenshots in `public/screenshots/studio/` and CLI captures in `public/screenshots/cli/`.
- Real example factories in `../../examples/` with their `workflow.png`.
- No customer logos, testimonials, star counts or usage numbers: never invent them. The sense of a production-ready product must come from the quality of the presentation itself.

## Product Principles

1. Show the mechanism, not adjectives: real files, real plan output, real runs.
2. Control is the product: agents propose, the engine writes, a person merges.
3. Readable by anyone: a non-technical person should follow every file shown.
4. Local and owned: the user's machine, the user's subscription, the user's repository.

## Accessibility & Inclusion

WCAG AA contrast in light and dark themes (the site already tunes greys for 4.5:1). Motion respects `prefers-reduced-motion`.
