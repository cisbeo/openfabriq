import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { Flow } from "./diagrams/flow";
import { Icon } from "./diagrams/icon";
import { Places } from "./diagrams/places";
import { FactoryExplorer } from "./factory-explorer";
import { CopyPrompt } from "./landing/copy-prompt";
import { ProductVideo } from "./product-video";

/** What a page can use without importing it. */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
	return {
		...defaultMdxComponents,
		Accordion,
		Accordions,
		CopyPrompt,
		Step,
		Steps,
		Tab,
		Tabs,
		FactoryExplorer,
		Flow,
		Icon,
		Places,
		ProductVideo,
		...components,
	};
}
