import { llms } from "fumadocs-core/source";
import { source } from "@/lib/source";

// The documentation's index for agents (llmstxt.org); llms-full.txt has every page.
export const revalidate = false;

export function GET() {
	return new Response(llms(source).index(), {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
}
