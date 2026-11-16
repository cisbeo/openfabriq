import { describe, expect, it } from "vitest";
import { nextTabIndex } from "./tabs";

describe("nextTabIndex", () => {
	it("moves to the next tab with the right arrow, and the down arrow in a vertical list, and wraps around", () => {
		expect(nextTabIndex("ArrowRight", 0, 4)).toBe(1);
		expect(nextTabIndex("ArrowDown", 2, 4, "vertical")).toBe(3);
		expect(nextTabIndex("ArrowRight", 3, 4)).toBe(0);
	});

	it("moves to the previous tab with the left arrow, and the up arrow in a vertical list, and wraps around", () => {
		expect(nextTabIndex("ArrowLeft", 2, 4)).toBe(1);
		expect(nextTabIndex("ArrowUp", 1, 4, "vertical")).toBe(0);
		expect(nextTabIndex("ArrowLeft", 0, 4)).toBe(3);
	});

	it("leaves up and down to the page in a horizontal tablist", () => {
		expect(nextTabIndex("ArrowDown", 1, 4)).toBeUndefined();
		expect(nextTabIndex("ArrowUp", 1, 4)).toBeUndefined();
	});

	it("goes to the ends with Home and End", () => {
		expect(nextTabIndex("Home", 2, 8)).toBe(0);
		expect(nextTabIndex("End", 2, 8)).toBe(7);
	});

	it("leaves every other key to the page", () => {
		expect(nextTabIndex("Enter", 1, 4)).toBeUndefined();
		expect(nextTabIndex("a", 1, 4)).toBeUndefined();
	});
});
