# @openfabriq/core

The `openfabriq/` format: reading and validating a factory's files, the plan that `openfabriq plan` shows, the cron schedules and the workflow graph. What the format means for the people who write it is in the documentation: [the factory](../docs/content/docs/factory/overview.mdx).

Core is pure: it depends on neither GitHub, Claude, nor the disk, and imports no Node module. It receives a factory's files as text and returns data; the runner and the CLI do the I/O. The studio's app imports parts of it in the browser.

| Where | What |
| --- | --- |
| `src/factory/` | loading a factory from its files (`load.ts`, `to-factory.ts`), the Zod schema, the rules (`when.ts`, `can.ts`, `agent-rules.ts`, `automation-rules.ts`, `factory-rules.ts`), the secrets, scripts and wiki it uses, what it needs on the machine, how a trigger and a permission are written (`text.ts`) |
| `src/plan/` | the plan: the changes `apply` would make, security first, one file per topic in `topics/`, and how they are written for people |
| `src/vocabulary.ts` | the closed lists of the format: events, sources, what an agent may write (`can`), tools |
| `src/cron/`, `src/graph.ts` | the schedules (reading a cron, when it runs, in words), and the workflow drawn from the files |
| `src/match.ts`, `src/paths.ts`, `src/tools.ts`, `src/words.ts` | which events an automation answers, `ignore_paths`, the output tools' names, words for people |
| `test/` | the tests, with the factories of [`fixtures/`](../../fixtures) |

## Develop

From the repository root:

```bash
pnpm exec vitest run packages/core   # this package's tests, from the sources, no build needed
pnpm mutation                        # Stryker on core, slower; not part of pnpm test
```

Tests come first for validation and the plan: add a valid or invalid factory to `fixtures/`, then the code. A new format key, a new event or a new permission needs a decision first, in an issue.
