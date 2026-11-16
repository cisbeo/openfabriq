---
version: 1
slug: "app-home-page-tsx"
primary_target: "app/(home)/page.tsx"
related_targets: ["app/(home)/templates"]
---

Scope: the product landing at `/` of the docs site (Persuade), plus `/templates/` and `/templates/<slug>/` (Persuade, catalog). Docs keep their URLs.

Audience: developers and tech leads on GitHub with Claude Code, deciding whether to let agents work on their repository. Action: install, then pick a template. Proof: real files, real plan output, the studio's real vocabulary; no invented numbers, logos or quotes. The sense of "production-ready" must come from the craft.

## Direction contract

THESIS: The `openfabriq/` folder opens the page. Under the headline, one window walks the format in four numbered tabs named after the format's parts (Factory, Agents, Automations, Skills) beside the folder's real tree, every file clickable and annotated; the plan follows as its own section, then the studio at work. Refuses the centred headline over a row of feature cards.

OWN-WORLD: The studio's world: near-white panels on a cool grey ground, zinc ink, the studio blue as the one accent, status hues only for states (blue working, amber needs you, green done, red failed). Mono for paths and commands, system sans for prose. Hairline borders, 12-14px radii, soft layered shadows, tabular numerals. Dark theme is the studio's dark.

STORY: One screen says what it is (a factory as files, run on your machine, writing only what you allowed) and how to install. The tabbed window walks factory.yaml, an agent, an automation and a skill; then the plan prints, the board loops, a run streaming its log until the engine applies the pull request. A cause-and-effect section shows four triggers and their effects. Templates close the page; the visitor copies an install command.

FIRST VIEWPORT: A very large one-line headline, one sentence, the primary "Get started" button beside a copyable `brew install` command; below, the tabbed window: tabs with a progress hairline, a one-sentence explanation, the tree on the left, an accordion explorer that starts closed (a folder opens on click and closes the other branches, a file opens on click, a tab opens only the path to its file), the file on the right with its key lines tinted and glossed in the margin.

FORM: Surface-scope candidate 6 ("the folder is the page"), seed b87ef6c7, with candidate 1 ("cause and effect") added lower as its own section at the user's request. The sticky tree was later replaced, at the user's request, by the tabbed window with its tree (variant "tabs on top, tree on the left"), and the plan moved out to its own section. Raises: tabular cost and duration digits that cross-fade (from the nixie counter); hierarchy by scale contrast alone (from the type specimen).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Signature interaction: the board loop (cards travel between columns with FLIP motion, timers tick) and the run that streams its log, started when scrolled into view, paused off-screen, static under reduced motion.
