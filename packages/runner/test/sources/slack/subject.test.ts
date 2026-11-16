import { expect, it } from "vitest";
import { slackTitle } from "../../../src/sources/slack/subject.js";

it("titles a run with the mention's first line, without Slack's markup", () => {
	expect(
		slackTitle(
			"<@U0CEZEJ8C8L> dans le README, ajoute une ligne\nsur deux lignes",
		),
	).toBe("dans le README, ajoute une ligne");
	expect(
		slackTitle(
			"<@U0CEZEJ8C8L> see <#C123|general> and <https://example.com|the doc>, ask <@U42>",
		),
	).toBe("see #general and the doc, ask");
	expect(slackTitle("<https://example.com/a>")).toBe("https://example.com/a");
});
