import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TemplateGrid } from "@/components/templates/template-grid";
import { pageMetadata, TEMPLATES_DESCRIPTION } from "@/lib/site";
import { CATEGORIES, cardOf, templates } from "@/lib/templates";

export const metadata: Metadata = pageMetadata({
	title: "Templates",
	description: TEMPLATES_DESCRIPTION,
	path: "/templates/",
});

const c = (text: string) => (
	<code className="font-mono text-[0.88em] text-fd-foreground">{text}</code>
);

// What the templates share: practices to keep in a factory of your own.
const PATTERNS: { title: string; text: ReactNode }[] = [
	{
		title: "Least privilege",
		text: (
			<>
				A reviewer cannot push, a triager has {c("tools: [read]")}, and labels
				are restricted ({c("add_labels: [ready-to-merge]")}).
			</>
		),
	},
	{
		title: "Stop and ask",
		text: (
			<>
				Every agent that might otherwise guess has a step that says: when
				something is unclear, ask, add {c("needs-info")}, and stop.
			</>
		),
	},
	{
		title: "Ready, and how risky",
		text: (
			<>
				A reviewer that finds nothing blocking adds {c("ready-to-merge")} and
				one of {c("risk:low")}, {c("risk:medium")}, {c("risk:high")}, with a{" "}
				{c("Risk:")} line that says what to look at. {c("needs-human")} keeps
				one meaning: the engine gave up, and a person takes over.
			</>
		),
	},
	{
		title: "A different model for review",
		text: (
			<>
				Reviewers run on {c("opus")} when the factory runs on {c("sonnet")}: a
				different model does not share the author's blind spots.
			</>
		),
	},
	{
		title: "Proof in the pull request",
		text: (
			<>
				The engine runs the checks, and the {c("browser-evidence")} skill covers
				what shows on screen.
			</>
		),
	},
	{
		title: "No duplicates without GitHub access",
		text: (
			<>
				Agents cannot search other issues or pull requests. Templates that run
				on a schedule say so in their prompts, and avoid duplicates with a file
				in the repository or a stable fingerprint in titles.
			</>
		),
	},
];

export default function TemplatesPage() {
	const all = templates().map(cardOf);
	return (
		<main className="w-full bg-of-ground pb-28">
			<div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
				<header className="pt-16 pb-10 sm:pt-24">
					<h1 className="max-w-3xl text-5xl leading-[1] font-semibold tracking-[-0.04em] text-balance sm:text-7xl">
						Templates
					</h1>
					<p className="mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-fd-muted-foreground sm:text-xl">
						{all.length} complete factories, each teaching one idea. Copy one
						into your repository with its command: your repository and GitHub
						login are filled in from{" "}
						<code className="font-mono text-[0.85em] text-fd-foreground">
							gh
						</code>
						. Then read the plan, and apply. Templates combine: take agents and
						automations from several.
					</p>
				</header>
				<TemplateGrid templates={all} categories={CATEGORIES} />

				<section
					aria-labelledby="patterns"
					className="mt-28 grid gap-10 border-t border-of-line pt-16 lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-16"
				>
					<div>
						<h2
							id="patterns"
							className="text-3xl font-semibold tracking-[-0.03em] text-balance"
						>
							What the templates share
						</h2>
						<p className="mt-4 leading-relaxed text-fd-muted-foreground">
							A few practices worth keeping in a factory of your own.
						</p>
					</div>
					<dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
						{PATTERNS.map((p) => (
							<div key={p.title}>
								<dt className="font-medium">{p.title}</dt>
								<dd className="mt-1.5 text-sm leading-relaxed text-pretty text-fd-muted-foreground">
									{p.text}
								</dd>
							</div>
						))}
					</dl>
				</section>
			</div>
		</main>
	);
}
