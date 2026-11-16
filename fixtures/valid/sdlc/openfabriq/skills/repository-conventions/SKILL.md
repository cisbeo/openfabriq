---
name: repository-conventions
description: Shared conventions for branches, commits, tests and pull requests in this repository. Use before creating commits or pull requests.
---

# Repository conventions

Every agent of the factory reads this skill. Keep it short and prescriptive.

- Stack: Next.js, TypeScript, `node:sqlite`, Vitest. Use npm.
- Commits: imperative subject line that references the issue.
- Tests: changed behavior requires a test in the same pull request.
- Pull requests: link the issue, describe what changed and how it was verified.
