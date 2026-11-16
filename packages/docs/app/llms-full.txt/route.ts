import { source } from "@/lib/source";

// The whole documentation as one Markdown text, for an agent to read at once.
export const revalidate = false;

export async function GET() {
	const pages = await Promise.all(
		source
			.getPages()
			.map(
				async (p) =>
					`# ${p.data.title} (${p.url}/)\n\n${p.data.description ?? ""}\n\n${await p.data.getText("processed")}`,
			),
	);
	return new Response(pages.join("\n\n"), {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
}
