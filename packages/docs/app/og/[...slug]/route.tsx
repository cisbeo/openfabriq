import { ImageResponse } from "next/og";
import { SITE_URL, sitePages } from "@/lib/site";

// Each page's card, drawn at export time: /og/<page>/image.png, 1200×630, the size every network shows.
export const dynamic = "force-static";

export function generateStaticParams() {
	return sitePages().map((p) => ({
		slug: [...p.path.split("/").filter(Boolean), "image.png"],
	}));
}

const INK = "#18181b";
const MUTED = "#52525b";
const ACCENT = "#1e59cd";

export async function GET(
	_: Request,
	{ params }: { params: Promise<{ slug: string[] }> },
) {
	const { slug } = await params;
	const path = `/${slug.slice(0, -1).join("/")}/`.replace("//", "/");
	const page = sitePages().find((p) => p.path === path);
	if (!page) return new Response(null, { status: 404 });
	// The home page's card says the promise, as its heading does; the others, their title.
	const title = path === "/" ? "Your software factory, as code." : page.title;
	const description =
		page.description.length > 160
			? `${page.description.slice(0, 157).replace(/\s+\S*$/, "")}…`
			: page.description;

	return new ImageResponse(
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: "100%",
				height: "100%",
				padding: "64px 72px",
				background: "#fafafa",
				color: INK,
				borderTop: `12px solid ${ACCENT}`,
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 18 }}>
				<svg width="56" height="56" viewBox="0 0 20 20" aria-hidden>
					<rect width="20" height="20" rx="5" fill={INK} />
					<path
						d="M4.5 14.5V8.6l3.6 2.3V8.6l3.6 2.3V5.5h3.8v9z"
						fill="#fafafa"
					/>
				</svg>
				<span style={{ fontSize: 38, letterSpacing: "-0.02em" }}>
					openfabriq
				</span>
				<span style={{ marginLeft: "auto", fontSize: 26, color: MUTED }}>
					{page.section}
				</span>
			</div>
			<div
				style={{
					display: "flex",
					marginTop: "auto",
					fontSize: title.length > 28 ? 64 : 80,
					lineHeight: 1.04,
					letterSpacing: "-0.03em",
				}}
			>
				{title}
			</div>
			<div
				style={{
					display: "flex",
					marginTop: 28,
					fontSize: 30,
					lineHeight: 1.4,
					color: MUTED,
				}}
			>
				{description}
			</div>
			<div
				style={{
					display: "flex",
					marginTop: 44,
					fontSize: 26,
					color: ACCENT,
				}}
			>
				{new URL(SITE_URL).host}
			</div>
		</div>,
		{ width: 1200, height: 630 },
	);
}
