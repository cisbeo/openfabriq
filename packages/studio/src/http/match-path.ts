/**
 * Whether `pathname` fits `pattern`, and its named parts. `:name` takes one segment that is not
 * empty; a final `*` takes whatever follows the slash before it, even nothing. Segments stay
 * as sent, still encoded.
 *
 *   matchPath("/api/chats/:id", "/api/chats/abc")   { id: "abc" }
 *   matchPath("/api/chats/*", "/api/chats/a/b")     {}
 *   matchPath("/api/chats/*", "/api/chats")         undefined
 */
export function matchPath(
	pattern: string,
	pathname: string,
): Record<string, string> | undefined {
	const wanted = pattern.split("/");
	const sent = pathname.split("/");
	const params: Record<string, string> = {};
	for (const [i, part] of wanted.entries()) {
		const value = sent[i];
		if (value === undefined) return undefined;
		if (part === "*") return params;
		if (part.startsWith(":")) {
			if (!value) return undefined;
			params[part.slice(1)] = value;
		} else if (part !== value) return undefined;
	}
	return sent.length === wanted.length ? params : undefined;
}
