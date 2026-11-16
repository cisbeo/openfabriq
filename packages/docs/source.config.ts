import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";
import { remarkRepository } from "./repository.mjs";

// The processed Markdown feeds llms-full.txt, the whole documentation as one text for agents.
export const docs = defineDocs({
	dir: "content/docs",
	docs: { postprocess: { includeProcessedMarkdown: true } },
});

// GitHub's "default" themes: their syntax colors keep 4.5:1, unlike the older github-light.
export default defineConfig({
	// Each page's last commit, for the sitemap: the build needs the full history (fetch-depth: 0).
	plugins: [lastModified()],
	mdxOptions: {
		remarkPlugins: [remarkRepository],
		rehypeCodeOptions: {
			themes: { light: "github-light-default", dark: "github-dark-default" },
		},
	},
});
