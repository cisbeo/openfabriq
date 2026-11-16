---
name: testing-standards
description: How the implementation agent proves a change works before opening a pull request. Use when writing or running tests.
---

# Testing standards

Only the implementer reads this skill: it lives under `agents/implementer/skills/`.

- A bug fix comes with a test that fails before the fix and passes after it.
- A feature comes with behavioral tests for the new path, through the public functions, not the internals.
- Run `npm test`, `npm run typecheck` and `npm run lint`, and paste the commands and their results in the pull request description.
