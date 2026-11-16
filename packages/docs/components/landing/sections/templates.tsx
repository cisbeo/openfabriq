import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { TemplateCard } from "@/components/templates/template-card";
import { cardOf, templates } from "@/lib/templates";
import { SectionHeading } from "./section-heading";

const FEATURED = [
	"05-code-review",
	"14-issue-triage",
	"06-ci-doctor",
	"23-sentry-autofix",
	"11-dependency-updates",
	"26-webflow-to-astro",
];

/** A few templates, and the way to all of them. */
export function Templates() {
	const all = templates();
	const featured = FEATURED.flatMap((name) =>
		all.filter((t) => t.name === name),
	);
	return (
		<section
			aria-labelledby="templates"
			className="border-t border-of-line bg-fd-background py-24 sm:py-32"
		>
			<div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
				<div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
					<SectionHeading
						id="templates"
						lead={`${all.length} factories ready to copy, from one advisory reviewer to a whole site migration. One command puts one in your repository.`}
					>
						Start from a template.
					</SectionHeading>
					<Link
						href="/templates/"
						className="group inline-flex h-11 shrink-0 items-center gap-2 self-start rounded-xl border border-of-line bg-of-panel px-5 text-[15px] font-medium shadow-of-1 transition-colors hover:border-fd-foreground/30 md:self-end"
					>
						Browse all {all.length} templates
						<ArrowRight
							className="size-4 transition-transform duration-300 group-hover:translate-x-0.5"
							aria-hidden
						/>
					</Link>
				</div>
				<div className="mt-12 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
					{featured.map((t) => (
						<TemplateCard key={t.name} t={cardOf(t)} />
					))}
				</div>
			</div>
		</section>
	);
}
