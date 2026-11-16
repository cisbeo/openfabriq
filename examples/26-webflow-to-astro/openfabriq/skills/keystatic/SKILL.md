---
name: keystatic
description: How the site's content is set up for Keystatic, an editing UI on the content files of the repository. Use only when migration/decisions.md chooses Keystatic for editing, to plan, build or review it.
---

# Keystatic

[Keystatic](https://keystatic.com/docs/installation-astro) is an admin UI, at `/keystatic`, that edits the content files of the repository: an editor writes in a form, and Keystatic commits the file. The content stays files, read by Astro's content collections as before; Keystatic only adds a way to edit them without Git. Follow this skill only when `migration/decisions.md` chooses it for editing; otherwise the content is plain Markdown and nothing below applies.

## In the plan
- The editing decision says who edits after the switch, and how: with a GitHub account each (Keystatic's GitHub mode, free, through a GitHub App of the team) or without one (Keystatic Cloud, a paid account past 3 editors). The choice of the two is a person's: put it under `Still open`, and the switch waits for it.
- The hosting decision accounts for it: the pages stay static, but `/keystatic` and `/api/keystatic` run on a server, so the host must run Node (or the adapter's runtime). A host that only serves files does not fit.
- T01 sets Keystatic up; each `content-type` ticket declares its collection; the `switch` lists what a person does to turn it on, below.

## In the build
- Packages: `pnpm astro add react markdoc`, then `pnpm add @keystatic/core @keystatic/astro`; `astro.config.mjs` adds `keystatic()` to `integrations`, after `react()` and `markdoc()`.
- An adapter for the host of the hosting decision (`@astrojs/node` in `standalone` mode when it runs Node). The output stays `static`: every page is prerendered, and only Keystatic's routes run on the server. With an adapter, the prerendered pages land in `dist/client/`: `pnpm parity` serves that folder.
- `keystatic.config.ts`, at the root, with `storage: { kind: 'local' }` until the switch. One `collection` per collection of `src/content.config.ts`, with the same fields: `path: 'src/content/<collection>/*'`, `slugField` on the field that gives the URL, `format: { contentField: 'content' }`, the body as `fields.markdoc`, images as `fields.image` stored where `astro:assets` reads them. The entries are `.mdoc` files, and the collection's loader in `src/content.config.ts` reads `**/*.mdoc`.
- The mappers write what Keystatic writes: the same frontmatter keys, in the same order and format, and a body in Markdoc (Markdown, no raw HTML). Opening an imported entry in `/keystatic` and saving it unchanged leaves `git diff` empty.
- A test reads every imported entry through Keystatic's reader (`createReader` from `@keystatic/core/reader`, with `keystatic.config.ts`), so an entry the admin UI could not open fails the build, not an editor.
- Until the switch, editors still write in Webflow and the weekly sync overwrites the entries: nobody edits them in `/keystatic` yet.

## At the switch, what a person does
- GitHub mode: set `storage` to `{ kind: 'github', repo: '<owner>/<name>' }`, run `pnpm dev`, open `http://127.0.0.1:4321/keystatic` and create the GitHub App it offers, installed on this repository only. It writes `KEYSTATIC_GITHUB_CLIENT_ID`, `KEYSTATIC_GITHUB_CLIENT_SECRET`, `KEYSTATIC_SECRET` and `PUBLIC_KEYSTATIC_GITHUB_APP_SLUG` into `.env`: copy them to the host, never to the repository, and add the production address's callback URL to the GitHub App. Each editor needs write access to the repository.
- Or Keystatic Cloud: `storage: { kind: 'cloud' }` and `cloud: { project: '<team>/<project>' }`, from the project's settings on keystatic.cloud.
- Stop the weekly sync, then remove the migration's factory: each save in `/keystatic` is a commit on the default branch, and would start the planner for nothing.
