import { exampleFactory } from "@/lib/example-code";
import { FactoryTabs } from "./landing/factory-tabs";

/** The real files of an example in the docs: the landing's tabs and tree, without its tour or margin notes. */
export async function FactoryExplorer({
	example = "00-at-a-glance",
}: {
	example?: string;
}) {
	return (
		<FactoryTabs
			files={await exampleFactory(example, { notes: false })}
			example={example}
			repository="acme/web-app"
			tour={false}
		/>
	);
}
