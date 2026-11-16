/** Structured data for search engines, in the page; `<` is escaped so no text can close the script. */
export function JsonLd({ data }: { data: object }) {
	return (
		<script
			type="application/ld+json"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: JSON from the site's own data, with `<` escaped.
			dangerouslySetInnerHTML={{
				__html: JSON.stringify(data).replaceAll("<", "\\u003c"),
			}}
		/>
	);
}
