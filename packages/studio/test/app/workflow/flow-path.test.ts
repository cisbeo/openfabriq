import { expect, it } from "vitest";
import {
	rightAngles,
	roundedPath,
} from "../../../app/src/features/workflow/flow-path.js";

it("turns a route into right angles that bend halfway between two points", () => {
	expect(
		rightAngles([
			{ x: 0, y: 0 },
			{ x: 100, y: 40 },
		]),
	).toEqual([
		{ x: 0, y: 0 },
		{ x: 0, y: 20 },
		{ x: 100, y: 20 },
		{ x: 100, y: 40 },
	]);
});

it("drops repeated points and points in the middle of a straight run", () => {
	expect(
		rightAngles([
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
			{ x: 0, y: 30 },
			{ x: 0, y: 60 },
		]),
	).toEqual([
		{ x: 0, y: 0 },
		{ x: 0, y: 60 },
	]);
});

it("rounds each corner, never by more than half a side", () => {
	expect(
		roundedPath(
			[
				{ x: 0, y: 0 },
				{ x: 0, y: 10 },
				{ x: 100, y: 10 },
			],
			8,
		),
	).toBe("M 0 0 L 0 5 Q 0 10 5 10 L 100 10");
	expect(roundedPath([], 8)).toBe("");
});
