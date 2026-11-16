import type { Metadata } from "next";
import { JsonLd } from "@/components/json-ld";
import { Board } from "@/components/landing/sections/board";
import { Causes } from "@/components/landing/sections/causes";
import { DocsNav } from "@/components/landing/sections/docs-nav";
import { Hero } from "@/components/landing/sections/hero";
import { Install } from "@/components/landing/sections/install";
import { Plan } from "@/components/landing/sections/plan";
import { Run } from "@/components/landing/sections/run";
import { Studio } from "@/components/landing/sections/studio";
import { Templates } from "@/components/landing/sections/templates";
import { GITHUB } from "@/lib/layout.shared";
import { absolute, HOME, pageMetadata, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
	...pageMetadata({ ...HOME, path: "/" }),
	title: { absolute: HOME.title },
};

// What the site is and what it is about, for search engines: the site's name, and the software.
const STRUCTURED_DATA = {
	"@context": "https://schema.org",
	"@graph": [
		{
			"@type": "WebSite",
			"@id": `${absolute("/")}#website`,
			name: SITE_NAME,
			url: absolute("/"),
			description: HOME.description,
			inLanguage: "en",
		},
		{
			"@type": "SoftwareApplication",
			name: SITE_NAME,
			url: absolute("/"),
			description: HOME.description,
			applicationCategory: "DeveloperApplication",
			operatingSystem: "macOS, Linux",
			softwareRequirements: "Node.js 24 or later, Claude Code",
			license: "https://www.apache.org/licenses/LICENSE-2.0",
			isAccessibleForFree: true,
			offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
			downloadUrl: "https://www.npmjs.com/package/openfabriq",
			author: {
				"@type": "Person",
				name: "Matthieu Guirlinger",
				url: "https://guirlinger.com/en/",
			},
			sameAs: [GITHUB],
		},
	],
};

/** The home page: the promise, the factory at work, then how to start. */
export default function HomePage() {
	return (
		<main className="flex w-full flex-col bg-of-ground">
			<JsonLd data={STRUCTURED_DATA} />
			<Hero />
			<Plan />
			<Board />
			<Run />
			<Causes />
			<Studio />
			<Templates />
			<Install>
				<DocsNav />
			</Install>
		</main>
	);
}
