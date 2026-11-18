# 28: Risk-routed delivery, the review grows with the risk

A delivery factory that spends its review where the risk is. Intake decides whether a queued issue is worth building, cuts it to one pull request, and rates its risk and surfaces. A spec fixes the contract. A builder implements it test first. Then the change gets one cheap reviewer when it is small, and up to five specialized ones when it is risky or touches the interface or a sensitive surface. An approver reads the whole and says whether it would merge; a human merges.

It is the pipeline of [cisbeo/software-factory](https://github.com/cisbeo/software-factory), itself derived from ZazenCodes' Software Factory for Claude Code (v2), carried over to openfabriq's format: its one orchestrating session and its state scripts are replaced by the engine and GitHub labels. See [`CREDITS.md`](CREDITS.md): **this example is distributed under GPLv3**, unlike the rest of the repository.

## What this factory does

```
issue labeled `factory`
        │
        ▼
intake (opus) ───── NEEDS-INFO → asks on the issue, `needs-info`, waits for the answer
        │           REJECT     → explains on the issue, `rejected`
        ▼ ACCEPT, possibly rescoped; Risk and Surfaces in its comment, `needs-spec`
spec-writer (opus)  the spec as a comment, then `build:low` or `build:standard`
        ▼
builder (opus) ◄──────────────┐ on the machine, before the pull request exists:
        ▼                     │ the engine runs the checks, then one reviewer,
reviewer-code (haiku, low) ───┤ at most `review_rounds` times
reviewer-spec (sonnet, else) ─┘
        ▼ the pull request opens: `ready-to-merge` + `risk:…`, or `needs-human`
router (haiku)      reads Risk, Surfaces and the diff, adds `review:…` labels
        ▼
standards (sonnet)  medium and high risk      ┐ each one comments, then adds
ux (sonnet), ui (haiku)  interface changes    │ `passed:…` or requests changes;
security (opus)     sensitive surfaces        ┘ the builder reworks, they read again
        ▼ every `review:…` has its `passed:…` (or `no-extra-review`)
approver (opus) ─── APPROVE  → `approved`
                └── ESCALATE → `needs-human`, with the decision a person must make
```

Nothing chains through a foreman: each step ends by adding a label, and the label starts the next automation.

## Routing

| Intake says | Before the pull request opens | On the pull request |
| --- | --- | --- |
| Risk `low` | `reviewer-code` (haiku) | nothing more |
| Risk `medium` or `high` | `reviewer-spec` (sonnet) | `reviewer-standards` (sonnet) |
| Surface `ui` | | `reviewer-ux` (sonnet) and `reviewer-ui` (haiku) |
| Surface `security` | | `reviewer-security` (opus) |

The router can add a lens the diff calls for and intake did not foresee; it never removes one. To change who reviews what, edit the router's brief and the `model` of each reviewer.

## Tree

```
openfabriq/
├── factory.yaml                     repository, maintainers, the checks, limits
├── agents/
│   ├── intake/agent.md              ACCEPT, NEEDS-INFO or REJECT; scope, risk, surfaces
│   ├── spec-writer/agent.md         the spec, as a comment on the issue
│   ├── builder/agent.md             builds test first, opens the pull request
│   │   └── skills/diagnosing-bugs/  a diagnosis loop for the bugs that resist
│   ├── reviewer-code/agent.md       internal review of a low-risk change
│   ├── reviewer-spec/agent.md       internal review of fidelity to the spec
│   ├── router/agent.md              chooses the lenses of a pull request
│   ├── reviewer-standards/agent.md  lens: written standards, glossary, ADRs, smells
│   ├── reviewer-ux/agent.md         lens: flows, states, copy, accessibility
│   ├── reviewer-ui/agent.md         lens: visual consistency
│   ├── reviewer-security/agent.md   lens: what the change opens
│   └── approver/agent.md            final gate: APPROVE or ESCALATE
├── automations/
│   ├── intake-issues/               when: issue.labeled factory, issue.commented on needs-info
│   ├── write-specs/                 when: issue.labeled needs-spec
│   ├── build-low-risk/              when: issue.labeled build:low, reviewed by reviewer-code
│   ├── build-standard/              when: issue.labeled build:standard, reviewed by reviewer-spec
│   ├── route-reviews/               when: pull_request.opened by the builder
│   ├── review-standards/            when: pull_request.labeled review:standards, pull_request.updated
│   ├── review-ux/                   the same, with review:ux
│   ├── review-ui/                   the same, with review:ui
│   ├── review-security/             the same, with review:security
│   ├── rework-pull-requests/        when: pull_request.changes_requested, reviewed by reviewer-spec
│   ├── resolve-conflicts/           when: pull_request.conflicted
│   └── approve-pull-requests/       when: pull_request.labeled passed:… or no-extra-review
└── skills/
    ├── lens-review/SKILL.md         the protocol the four lenses share
    ├── test-driven-development/SKILL.md
    └── browser-evidence/SKILL.md
```

## Auto-merge

Off by default: the approver's `approved` is an opinion, and a person merges. To let the engine merge what the approver approved, uncomment the `merge_pull_request` line in `automations/approve-pull-requests/automation.md` and give it the paths that must always wait for a person. The engine's own conditions still apply: the checks pass again, CI is green, and nothing changed under `.github/workflows/` or `openfabriq/`.

## Limits to know

What the original factory enforces in scripts is partly a brief here, so an agent can get it wrong:

- **The routing is an agent's decision**, not a table read by a script. A wrong `Risk:` line in the description means a missing review; the spec reviewer checks the line against intake's comment.
- **The lens rounds are counted by the lenses themselves** (two requests for changes, then `needs-human`), where `review_rounds` bounds the internal review. `usd_per_day` is the hard stop.
- **Protected files are a rule of the briefs**: the builder must not touch `openfabriq/`, `.claude/`, `CLAUDE.md`, `AGENTS.md` or `.mcp.json`, and the reviewers and the approver send such a change to a person. Only `.github/workflows/` is refused by the engine itself.
- **Every lens automation starts on each new commit** and stops at once when the pull request does not carry its label: a run that proposes nothing, but still a run.
- **`approved` names a commit.** The lenses remove it when they read new commits; on a pull request that had no lens, check the sha in the approver's comment before you merge.

## Make it yours

1. Copy the `openfabriq/` folder to the root of your repository.
2. In `factory.yaml`, replace `repository` and `maintainers`, and the `setup` and `commands` with your project's own.
3. Put your stack, commands and conventions in your repository's `CLAUDE.md`, which every agent reads first. A `GLOSSARY.md`, a `CODING_STANDARDS.md` and ADRs in `docs/adr/` are read when they exist.
4. Tailor the approver's ESCALATE list to what a person must always see in your project, and the intake's idea of what belongs in it.
5. Nothing to see in a browser (an API, a library)? Delete `agents/reviewer-ux/`, `agents/reviewer-ui/`, their two automations and `skills/browser-evidence/`, and take `review:ux` and `review:ui` out of the router and of `route-reviews`.
6. Run `openfabriq plan`: it lists the labels it will create, then `openfabriq apply` and `openfabriq start`.
7. Label an issue `factory`.
