import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { GITHUB } from "@/lib/layout.shared";

/**
 * The site's footer, on every page: what openfabriq is, who made it, and the way around.
 * `inline`: inside a docs page's column, under its previous and next links, on two lines
 * since the column is too narrow for one.
 */
export function SiteFooter({ inline = false }: { inline?: boolean }) {
	const brand = (
		<span className="flex items-center gap-2 font-medium text-fd-foreground">
			<LogoMark className="size-5" />
			openfabriq
		</span>
	);
	const license = <span>Open source under the Apache License 2.0.</span>;
	const credit = (
		<span>
			Made by{" "}
			<a
				href="https://guirlinger.com/en/"
				rel="author"
				className="text-fd-foreground underline decoration-of-line underline-offset-4 hover:decoration-current"
			>
				Matthieu Guirlinger
			</a>
			{" · "}
			<a
				href="https://www.linkedin.com/in/matthieu-guirlinger/"
				rel="me"
				className="hover:text-fd-foreground"
			>
				LinkedIn
			</a>
		</span>
	);
	const links = (
		<span className="flex gap-5">
			<Link
				href="/getting-started/what-is-openfabriq/"
				className="hover:text-fd-foreground"
			>
				Documentation
			</Link>
			<Link href="/templates/" className="hover:text-fd-foreground">
				Templates
			</Link>
			<Link href="/roadmap/" className="hover:text-fd-foreground">
				Roadmap
			</Link>
			<a href={GITHUB} className="hover:text-fd-foreground">
				GitHub
			</a>
		</span>
	);

	if (inline)
		return (
			<footer className="mt-10 flex flex-col gap-4 border-t border-of-line pt-6 text-sm text-fd-muted-foreground">
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
					{brand}
					{license}
				</div>
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
					{credit}
					{links}
				</div>
			</footer>
		);
	return (
		<footer className="border-t border-of-line bg-fd-background">
			<div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-fd-muted-foreground sm:flex-row sm:items-center sm:gap-6 sm:px-6">
				{brand}
				{license}
				{credit}
				<span className="sm:ml-auto">{links}</span>
			</div>
		</footer>
	);
}
