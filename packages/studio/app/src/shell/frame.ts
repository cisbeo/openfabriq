import type { Theme } from "../hooks/use-theme.js";

/** What the menus show: the projects, the page, and the theme. */
export interface Frame {
	projects: string[] | undefined;
	project: string | undefined;
	/** The page of the address, and the one of the menu it belongs to. */
	page: string;
	menuPage: string;
	theme: Theme;
	nextTheme: () => void;
}
