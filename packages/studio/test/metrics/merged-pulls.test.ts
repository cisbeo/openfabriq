import { expect, it } from "vitest";
import {
	cachedMergedPulls,
	type MergedPull,
} from "../../src/metrics/merged-pulls.js";

it("keeps a repository's merged pull requests, and asks again after a failure", async () => {
	const pulls: MergedPull[] = [
		{ url: "https://github.com/acme/shop/pull/1", mergedAt: "", commits: [] },
	];
	let asked = 0;
	let fail = true;
	const merged = cachedMergedPulls(async () => {
		asked++;
		if (fail) throw new Error("gh timed out");
		return pulls;
	});
	expect(await merged("acme/shop")).toEqual([]);
	fail = false;
	expect(await merged("acme/shop")).toEqual(pulls);
	expect(await merged("acme/shop")).toEqual(pulls);
	expect(asked).toBe(2);
});
