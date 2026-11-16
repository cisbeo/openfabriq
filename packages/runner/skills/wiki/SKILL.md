---
name: wiki
description: Wiki of the repository, a map of the code in short Markdown pages. Use when the task is to generate the wiki or to update it after new commits.
---

# Wiki

The wiki is a **map** of the code for a newcomer, human or agent: where things are, how they connect, what the words mean. A map points at the code; the code stays the truth. Every claim on a page comes from a file you read, and the page lists that file under **Sources**.

The wiki folder is the one your instructions name. Its entry point is `index.md`. You write in that folder only, and propose your work as one pull request.

## Steps

1. **Find the starting point.** Read the header of `index.md`:

   ```markdown
   ---
   commit: 3f2a9c1
   ---
   ```

   No `index.md`, or a `commit` that `git cat-file -e <commit>` cannot find: this is a **first run**, go to step 2. Otherwise this is an **update**, go to step 3.

2. **First run: survey, then write.** List the repository with `git ls-files` and read, in this order: the README and existing docs, the manifests (`package.json`, `pyproject.toml`, `go.mod`…), the entry points (servers, routes, CLI commands, jobs), the data models and schemas, then each top-level folder. Group the code into **areas**: a domain of the product or a service, three to twelve of them, named with the words the code uses. Then write the pages of the plan below, in its order. Done when every page of the plan exists, or the ones you could not reach are listed under **Not written yet** at the bottom of `index.md`, so the next run starts there.

3. **Update: follow the changed files.** `git diff --name-status <commit>..HEAD`, wiki folder excluded. For each changed path, find the pages that cite it: `grep -rl -- '<path>' <wiki folder>`. Rewrite only the parts of those pages the change makes false or incomplete. A changed path no page cites belongs to an area: add it to that area's page, or start a new area page when it opens a new domain. A deleted file: remove its claims and its line under Sources. Done when every changed path is either cited by an up-to-date page or judged invisible to a newcomer (tests, formatting, lockfiles). Pages no change reaches stay byte-for-byte.

4. **Check, then hand over.**
   - every page is listed in `index.md`, and every page is reachable from it;
   - every relative link resolves to a file that exists;
   - every path under Sources is in `git ls-files`;
   - `commit` in the header of `index.md` is the short sha of `HEAD`.

   Then commit and propose one pull request titled `docs: wiki for <short sha>`. Its description lists the pages added, rewritten and removed, each with the changed files that caused it. When step 3 found nothing to change, the run ends there, with no pull request.

## Plan of the wiki

| File | Page | What it answers |
|---|---|---|
| `index.md` | Index | One line per page, in this order, and the `commit` header |
| `start-here.md` | Start here | What the project does, for whom, and the five files to read first |
| `how-it-fits-together.md` | How it fits together | The main pieces and how a request or a job travels through them, as a diagram |
| `built-with.md` | Built with | Languages, frameworks, services and storage, each with the file that declares it |
| `where-things-live.md` | Where things live | Each top-level folder in one line, then the folders of each area |
| `ways-in.md` | Ways in | Where the code starts: routes, CLI commands, scheduled jobs, event handlers, each with its file |
| `areas/<area>.md` | One page per area | What the area does, its main files, its data, the areas it calls and the ones that call it |
| `making-a-change.md` | Making a change | Install, run, test, ship: the commands as the repository declares them |
| `glossary.md` | Glossary | The words of the product and of the code, each with where it lives (a model, an enum, a table) |

The plan adapts to the repository: a library has no routes, so **Ways in** lists its public API; a small repository may have a single area. The pages your instructions add join the plan: write each one, list it in the index, and keep it on every update like the others.

## A page

- **Short**: under 150 lines. A page that grows past that splits into two pages, both in the index.
- **Pointing, never copying**: name a function and link its file instead of pasting its code, so a search through the repository finds the code once. A few lines of code only when the shape matters (a config block, a command).
- **Links**: relative Markdown links, to other pages (`[Payments](areas/payments.md)`) and to files of the repository (`[charge.ts](../src/payments/charge.ts)`, the path relative to the page).
- **Diagrams**: a Mermaid block where a flow or a set of links is clearer drawn, with at most fifteen nodes named as in the code. **How it fits together** always has one.
- **Sources**: the last section of every page, one repository path per line. It is how step 3 finds the pages a commit touches, so it lists every file a claim on the page comes from.
- **Plain words** for a newcomer: the domain's terms as the code names them, explained once in the Glossary and linked from the pages.
