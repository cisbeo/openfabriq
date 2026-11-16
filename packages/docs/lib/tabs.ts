/**
 * The tab a key moves to, in a tablist of `count` tabs where `index` is selected: the arrows go to
 * the next or the previous tab and wrap around, Home and End go to the first and the last.
 * A horizontal tablist takes only the left and right arrows: up and down still scroll the page.
 * undefined for any other key, which the tablist leaves to the page.
 */
export function nextTabIndex(
	key: string,
	index: number,
	count: number,
	orientation: "horizontal" | "vertical" = "horizontal",
): number | undefined {
	const vertical = orientation === "vertical";
	switch (key) {
		case "ArrowDown":
			if (!vertical) return undefined;
			return (index + 1) % count;
		case "ArrowRight":
			return (index + 1) % count;
		case "ArrowUp":
			if (!vertical) return undefined;
			return (index - 1 + count) % count;
		case "ArrowLeft":
			return (index - 1 + count) % count;
		case "Home":
			return 0;
		case "End":
			return count - 1;
		default:
			return undefined;
	}
}
