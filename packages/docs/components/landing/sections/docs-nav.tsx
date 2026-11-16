import { ArrowRight, BookOpen } from "lucide-react";
import Link from "next/link";

const DOCS = [
	{
		title: "Quickstart",
		href: "/getting-started/quickstart/",
		text: "A first factory with openfabriq init, and a first pull request.",
	},
	{
		title: "Build a factory",
		href: "/factory/overview/",
		text: "factory.yaml, agents, automations, skills and checks.",
	},
	{
		title: "Integrations",
		href: "/integrations/overview/",
		text: "Start work from Slack, Linear, Sentry or any signed webhook.",
	},
	{
		title: "Deployment",
		href: "/deployment/overview/",
		text: "Your computer, or Docker on an always-on server for a team.",
	},
	{
		title: "Studio",
		href: "/studio/overview/",
		text: "Runs, costs, the board, the workflow, the wiki and the chat.",
	},
	{
		title: "Security",
		href: "/reference/security/",
		text: "What agents can reach, and what only the engine can write.",
	},
] as const;

/** The documentation's main parts, at the foot of the page. */
export function DocsNav() {
	return (
		<nav
			aria-labelledby="docs"
			className="mx-auto mt-28 w-full max-w-7xl px-4 sm:px-6"
		>
			<h2
				id="docs"
				className="flex items-center gap-2 text-sm font-medium text-fd-muted-foreground"
			>
				<BookOpen className="size-4" aria-hidden />
				The documentation
			</h2>
			<ul className="mt-5 grid gap-x-10 border-t border-of-line sm:grid-cols-2 lg:grid-cols-3">
				{DOCS.map((d) => (
					<li key={d.href} className="border-b border-of-line">
						<Link
							href={d.href}
							className="group flex h-full flex-col gap-1 py-5"
						>
							<span className="flex items-center gap-1.5 font-medium">
								{d.title}
								<ArrowRight
									className="size-3.5 text-fd-primary transition-transform duration-300 group-hover:translate-x-0.5"
									aria-hidden
								/>
							</span>
							<span className="text-sm text-fd-muted-foreground">{d.text}</span>
						</Link>
					</li>
				))}
			</ul>
		</nav>
	);
}
