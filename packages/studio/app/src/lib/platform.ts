/** A Mac, iPhone or iPad: ⌘ rather than Ctrl in the hints. */
export const MAC =
	typeof navigator !== "undefined" &&
	/Mac|iPhone|iPad/.test(navigator.platform);
