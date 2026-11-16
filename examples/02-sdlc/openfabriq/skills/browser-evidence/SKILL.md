---
name: browser-evidence
description: How to check a change in a real browser with agent-browser, and how to show screenshots as proof in a pull request. Use when a change is visible in the app (a page, a form, a style) or when you review one.
compatibility: "Needs agent-browser and Playwright's headless Chrome on the engine's machine: npm install -g agent-browser && npx playwright install chromium-headless-shell. On Linux, add --with-deps for Chrome's libraries and fonts. Then give agent-browser the headless Chrome's path, as executablePath in ~/.agent-browser/config.json, with \"args\": \"--single-process\" on macOS. The engine's Docker image has all of it."
---

# Browser evidence

A change people can see is proven in a browser, not only by tests. Use the `agent-browser` command, installed on the engine's machine with Playwright's headless Chrome. Run `agent-browser --help` once if you are unsure of a command: it is the reference.

## Start the browser

Drive the browser through this skill's script, `openfabriq/skills/browser-evidence/scripts/browse.sh`, one call per check. It starts the app, waits until its address answers, runs your steps with `agent-browser batch`, then closes the browser and stops the app:

```sh
sh openfabriq/skills/browser-evidence/scripts/browse.sh "pnpm dev" http://localhost:3000 "open http://localhost:3000/<path>" "snapshot -i" "screenshot --full evidence/<issue-number>/<name>.png"
```

Each step is one `agent-browser` command without its name: `open <url>`, `snapshot -i`, `set viewport 390 900`, `fill <ref> <text>`, `click <ref>`, `eval <js>`, `screenshot --full <path>`. Run `agent-browser --help` once if you are unsure of one. Your commands run in a sandbox that, on Linux (the engine in Docker included), stops the browser and the app when the command ends, and the next command cannot reach the app: never start them in one command to use them in the next. The script finds the headless Chrome in agent-browser's settings on the engine's machine and keeps its socket in the temporary folder. Never load settings with `.` or `source`: Claude Code asks for permission before such a command, nobody can answer during a run, and the command is refused.

If the browser does not start, on any system, stop the browser part there: say in your result that it could not run, with the error, and never present a criterion as checked.

## Check the change

1. Find the command that starts the app and its address, as the repository's README says (for example `pnpm dev`, at `http://localhost:3000`): they are the script's first two arguments.
2. Open the page the change is about: `agent-browser open http://localhost:3000/<path>`.
3. Read the page before acting: `agent-browser snapshot -i` lists the interactive elements with a reference (`@e1`, `@e2`…).
4. Walk the scenario of the issue: `agent-browser click @e3`, `agent-browser fill @e2 "text"`, then `snapshot -i` again to see the result.
5. Check what the issue promises, one acceptance criterion at a time. A criterion you could not check in the browser is said, never assumed.
6. The script closes the browser and stops the app at the end of each call.

## Screenshots as proof

- Take one screenshot per acceptance criterion that shows on screen, at the moment it is met: `agent-browser screenshot evidence/<issue-number>/<short-name>.png`. Add a phone width when the change touches the layout (`agent-browser set viewport 390 844`).
- If you deliver code (`create_pull_request` or `push_to_pull_request`): commit the screenshots with your change, in `evidence/<issue-number>/`. In the pull request description, show each one under the criterion it proves, linked by the commit that holds it, so the link never moves:
  `![Empty state](https://github.com/<owner>/<repo>/blob/<commit-sha>/evidence/<issue-number>/empty-state.png?raw=true)`
  The repository is the `repository` of the factory; the commit is `git rev-parse HEAD` after your commit.
- If you review (no push): do not commit anything. Run the same scenario yourself, compare what you see with the screenshots in the pull request, and say in your comment, criterion by criterion, whether the browser agrees. A screenshot that does not match what you see is a finding.

Never put a screenshot of a page that shows personal data, a token or a secret.
