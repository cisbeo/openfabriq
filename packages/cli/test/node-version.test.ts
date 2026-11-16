import { expect, it } from "vitest";
import { nodeTooOld } from "../src/node-version.js";

it("refuses a Node older than 24, and says how to get a newer one", () => {
	expect(nodeTooOld("22.15.1")).toBe(
		"openfabriq needs Node 24 or later, and this is Node 22.15.1. Install it from https://nodejs.org, or with nvm: nvm install 24",
	);
	expect(nodeTooOld("24.0.0")).toBeUndefined();
	expect(nodeTooOld("26.1.0")).toBeUndefined();
});
