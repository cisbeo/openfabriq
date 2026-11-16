# @openfabriq/cli

The `openfabriq` command: `init`, `validate`, `doctor`, `plan`, `apply`, `start`, `status`, `run`, `connect`, `secret`, `mcp` and `update`. Each command is a thin layer over `@openfabriq/core` (the format, the plan) and `@openfabriq/runner` (the engine, `gh`, the machine's state); `start` also serves the studio. What each command does for the user is in the documentation: [the CLI reference](../docs/content/docs/reference/cli.mdx).

No CLI framework: Node's `parseArgs`, `util.styleText`, and `@clack/prompts` for the questions. Commands return plain text, which the tests read; it is styled only when printed to a terminal (`src/ui.ts`).

This README is for contributors. The npm package `openfabriq` ships the repository's root `README.md` instead.

| Where | What |
| --- | --- |
| `src/index.ts` | the entry point: the usage text and the dispatch to the commands |
| `src/commands/` | one file per command; `connect/` has one file per service (`github`, `relay`, `slack`, `linear`, `sentry`, `webhook`) |
| `src/args.ts`, `src/ui.ts`, `src/paths.ts` | reading the command line, the terminal's look, where the examples and the relay's sources are |
| `plugin/` | the Claude Code plugin shipped in the npm package: the `setup` and `diagnose` skills |
| `scripts/package.ts` | builds the npm package `openfabriq` into `release/`, with core, runner and the studio bundled in |
| `test/` | the tests, one per command, with the factories of [`fixtures/`](../../fixtures) |

## Develop

From the repository root:

```bash
pnpm exec vitest run packages/cli   # this package's tests, from the sources, no build needed
pnpm build && pnpm openfabriq validate examples/01-quickstart   # the built CLI, from the sources
pnpm package                        # the npm package in packages/cli/release/
pnpm e2e                            # free: real relay (wrangler dev), built CLI, engine
```

To try it in another repository: `cd packages/cli && npm link`, then `openfabriq` there. Run `pnpm e2e` when you touch a command.
