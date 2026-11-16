import { expect, it } from "vitest";
import { connectCommand } from "../../../src/commands/connect/index.js";

it("names the services it knows", async () => {
	expect(
		await connectCommand("notion", { ask: async () => "", print: () => {} }),
	).toEqual({
		code: 1,
		output:
			"Usage: openfabriq connect github [--org name] [--workflows] [--url u] | relay [--url <url>] | slack | linear | sentry | webhook <name> [--remove]",
	});
});
