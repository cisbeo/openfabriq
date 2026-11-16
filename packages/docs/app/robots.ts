import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

/** Every crawler may read the site, except the studio demo the home page embeds and the search index. */
export default function robots(): MetadataRoute.Robots {
	return {
		rules: { userAgent: "*", allow: "/", disallow: ["/studio-demo/", "/api/"] },
		sitemap: `${SITE_URL}/sitemap.xml`,
	};
}
