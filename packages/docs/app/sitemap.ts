import type { MetadataRoute } from "next";
import { absolute, sitePages } from "@/lib/site";

export const dynamic = "force-static";

/** Every page, at the address it is served from; a documentation page also says when it last changed. */
export default function sitemap(): MetadataRoute.Sitemap {
	return sitePages().map((p) => ({
		url: absolute(p.path),
		lastModified: p.lastModified,
	}));
}
