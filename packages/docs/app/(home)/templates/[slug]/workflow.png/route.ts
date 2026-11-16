import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXAMPLES, templates } from "@/lib/templates";

// Each template's workflow image, read from examples/ at export time: the PNG has one home.
export const dynamic = "force-static";

export function generateStaticParams() {
	return templates()
		.filter((t) => t.workflowWidth !== null)
		.map((t) => ({ slug: t.slug }));
}

export async function GET(
	_: Request,
	{ params }: { params: Promise<{ slug: string }> },
) {
	const { slug } = await params;
	const t = templates().find((x) => x.slug === slug);
	if (!t || t.workflowWidth === null)
		return new Response(null, { status: 404 });
	return new Response(readFileSync(join(EXAMPLES, t.name, "workflow.png")), {
		headers: { "Content-Type": "image/png" },
	});
}
