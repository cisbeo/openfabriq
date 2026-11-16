# @openfabriq/runner

The local engine: it watches GitHub and the relay, queues the runs a factory's automations ask for, gives each agent a worktree of the repository and a sandbox, and applies the outputs the factory allows. It drives the user's installed Claude Code through the Agent SDK, and GitHub through the logged-in `gh` CLI. How it behaves for the user is in the documentation: [running on your machine](../docs/content/docs/deployment/local.mdx) and [security](../docs/content/docs/reference/security.mdx).

It knows no particular agent: agents, automations and limits are data read from `openfabriq/` with `@openfabriq/core`. An agent never writes to GitHub itself: it proposes outputs, and the engine applies only those the factory's `can` allows. Agents load the project's settings only (`settingSources: ["project"]`), never the machine's `~/.claude/`. The engine's state lives in `~/.openfabriq` (or `$OPENFABRIQ_HOME`).

| Where | What |
| --- | --- |
| `src/engine/` | the loop: `engine.ts` wires the sources, the queue, the schedules and the manual runs asked with `openfabriq run` |
| `src/run/` | one run: the subject, the prompt, the harness, the agent's session, the record; `outputs/` applies what the agent proposed |
| `src/agent/` | the Agent SDK adapter: query options, the agent's environment, the guards and sandboxes, its MCP servers |
| `src/workspace/` | the engine's clone of each repository, the worktrees, the wiki |
| `src/github/` | the `gh` adapter: polling, timelines, checks, the markers that sign what the engine writes |
| `src/sources/` | the relay's WebSocket (`relay.ts`), and one folder per integration: `slack/`, `linear/`, `sentry/`, `webhook/` |
| `src/state/` | what stays on this machine: the run journal, the projects, the secrets |
| `src/chat/` | the studio's chat with Claude Code, and its read-only tools, also served over MCP |
| `skills/` | the engine's own skills (the wiki), shipped in the npm package |
| `spike/` | the first proof of the execution model, kept as a reference; not built nor tested |
| `test/` | the tests, one folder per area of `src/` |

## Develop

From the repository root:

```bash
pnpm exec vitest run packages/runner   # this package's tests, from the sources, no build needed
pnpm e2e                               # free: real relay (wrangler dev), built CLI, engine
pnpm e2e:agent                         # with real agents (haiku): a few cents
pnpm e2e:linux                         # the shell sandbox on Linux, in Docker
```

Run `pnpm e2e` when you touch the engine. Adding an integration touches a folder of its own here and in the relay and the CLI: the steps are in [CONTRIBUTING.md](../../CONTRIBUTING.md#adding-an-integration).
