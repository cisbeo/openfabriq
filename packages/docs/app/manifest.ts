import type { MetadataRoute } from "next";
import { HOME, SITE_NAME } from "@/lib/site";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
	return {
		name: SITE_NAME,
		short_name: SITE_NAME,
		description: HOME.description,
		start_url: "/",
		display: "browser",
		background_color: "#ffffff",
		theme_color: "#ffffff",
		icons: [
			{ src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
			{ src: "/apple-icon.png", type: "image/png", sizes: "180x180" },
		],
	};
}
