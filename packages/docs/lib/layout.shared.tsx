import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Logo } from "@/components/logo";

// Set by next.config.mjs from repository.mjs: the root package.json, or OPENFABRIQ_REPOSITORY.
export const GITHUB = process.env.OPENFABRIQ_GITHUB_URL ?? "";

export function baseOptions(): BaseLayoutProps {
	return {
		nav: { title: <Logo /> },
		githubUrl: GITHUB,
		links: [
			{
				text: "Documentation",
				url: "/getting-started/what-is-openfabriq/",
				active: "none",
			},
			{ text: "Templates", url: "/templates/", active: "nested-url" },
		],
	};
}
