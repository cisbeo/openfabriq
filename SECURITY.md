# Security policy

openfabriq runs AI agents on your machine or your server, with access to your repositories, and writes to GitHub on their behalf. We take reports about its security seriously.

## Reporting a vulnerability

Please do not open a public issue, discussion or pull request for a security problem.

Report it privately through GitHub: on the [Security tab](https://github.com/openfabriq/openfabriq/security) of the repository, choose **Report a vulnerability** ([direct link](https://github.com/openfabriq/openfabriq/security/advisories/new)). Only the maintainers see the report.

Include what you can of:

- the version (`npm ls -g openfabriq`, `brew info openfabriq`) or the commit, and how you run it (local `start`, Docker, self-hosted or Cloudflare relay);
- what an attacker controls (an issue or pull request body, a Slack message, a webhook, a file in the repository…) and what they gain;
- the steps or the factory (`openfabriq/` folder) that reproduce it.

We aim to acknowledge a report within 5 working days and to keep you informed until it is fixed. Once a fix is released, we publish an advisory and credit you, unless you prefer otherwise.

## What counts

The engine's security model is that an agent never writes to GitHub itself: it proposes outputs, and the engine applies only those the factory allows (`can`). The content of an issue, a pull request, a Slack message or a webhook is data, never an instruction. Anything that breaks this is in scope, for example:

- an agent, or text it reads, that makes the engine write something `can` does not allow;
- an escape from the shell sandbox, or a way to read secrets the agent should not see;
- a webhook or relay request accepted without a valid signature, or replayed;
- access to the studio (the local app) without its token, cookie or password.

The [security page](packages/docs/content/docs/reference/security.mdx) of the documentation lists what openfabriq protects and its known limits. A known limit is still worth reporting if you find a way to make it worse.

Out of scope: what the factory itself allows (an automation whose `can` lists `push_to_pull_request` pushes commits to pull requests), and the security of Claude Code, `gh`, GitHub, Cloudflare or the other services openfabriq talks to, which you should report to them.

## Supported versions

Only the latest release receives security fixes.
