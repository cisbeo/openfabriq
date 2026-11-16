import { describe, expect, it } from "vitest";
import { advance, type Card, initialCards, STAGES } from "./simulation";

/** The board as ids per column: "waiting 4,5 | working 3 | needs 2 | done 1,0". */
const columns = (cards: Card[]) =>
	STAGES.map(
		(stage) =>
			`${stage} ${cards
				.filter((c) => c.stage === stage)
				.map((c) => c.id)
				.join(",")}`,
	).join(" | ");

describe("the board demo's simulation", () => {
	it("plays its first 30 ticks as it always has", () => {
		// Recorded from the board before its simulation left the component.
		const expected = [
			"waiting 4,5 | working 3 | needs 2 | done 1,0",
			"waiting 5 | working 3,4 | needs 2 | done 1,0",
			"waiting 5 | working 4 | needs 2 | done 3,1,0",
			"waiting 5,106 | working 4 | needs 2 | done 3,1,0",
			"waiting 106 | working 5,4 | needs 2 | done 3,1,0",
			"waiting 106 | working 4 | needs 5,2 | done 3,1,0",
			"waiting 106,107 | working 4 | needs 5,2 | done 3,1,0",
			"waiting 107 | working 106,4 | needs 5,2 | done 3,1,0",
			"waiting 107 | working 4 | needs 5,2 | done 106,3,1",
			"waiting 107,108 | working 4 | needs 5,2 | done 106,3,1",
			"waiting 108 | working 107,4 | needs 5,2 | done 106,3,1",
			"waiting 108 | working 4 | needs 5,2 | done 107,106,3",
			"waiting 108,109 | working 4 | needs 5,2 | done 107,106,3",
			"waiting 109 | working 108,4 | needs 5,2 | done 107,106,3",
			"waiting 109 | working 4 | needs 5,2 | done 108,107,106",
			"waiting 109,110 | working 4 | needs 5,2 | done 108,107,106",
			"waiting 110 | working 109,4 | needs 5,2 | done 108,107,106",
			"waiting 110 | working 4 | needs 5,2 | done 109,108,107",
			"waiting 110,111 | working 4 | needs 5,2 | done 109,108,107",
			"waiting 111 | working 110,4 | needs 5,2 | done 109,108,107",
			"waiting 111 | working 4 | needs 110,5 | done 109,108,107",
			"waiting 111,112 | working 4 | needs 110,5 | done 109,108,107",
			"waiting 112 | working 111,4 | needs 110,5 | done 109,108,107",
			"waiting 112 | working 4 | needs 110,5 | done 111,109,108",
			"waiting 112,113 | working 4 | needs 110,5 | done 111,109,108",
			"waiting 113 | working 112,4 | needs 110,5 | done 111,109,108",
			"waiting 113 | working 4 | needs 110,5 | done 112,111,109",
			"waiting 113,114 | working 4 | needs 110,5 | done 112,111,109",
			"waiting 114 | working 113,4 | needs 110,5 | done 112,111,109",
			"waiting 114 | working 4 | needs 113,110 | done 112,111,109",
			"waiting 114,116 | working 4 | needs 113,110 | done 112,111,109",
		];
		let cards = initialCards();
		let nextSubject = 6;
		const played = [columns(cards)];
		for (let tick = 1; tick <= 30; tick++) {
			({ cards, nextSubject } = advance(cards, tick, tick, nextSubject));
			played.push(columns(cards));
		}
		expect(played).toEqual(expected);
		expect(cards.map((c) => `${c.id} ${c.label} · ${c.title}`)).toEqual([
			"114 Issue #72 · Keyboard shortcut to add a task",
			"116 Issue #74 · Remember the last filter between visits",
			"4 Deploy · Deploy of 9c2e417 failed: the build cannot find @acme/ui",
			"113 Issue #71 · Login fails with SSO accounts",
			"110 Issue #68 · Dark mode for the settings page",
			"112 Sentry · TypeError: Cannot read properties of undefined (reading 'total')",
			"111 Issue #69 · Typo on the pricing page",
			"109 Deploy · Deploy of 4f81ac0 failed: migration 0042 timed out",
		]);
	});

	it("changes nothing it is given, so playing a tick twice gives the same board", () => {
		const cards = initialCards();
		const before = JSON.stringify(cards);
		const once = advance(cards, 3, 0, 6);
		expect(advance(cards, 3, 0, 6)).toEqual(once);
		expect(JSON.stringify(cards)).toBe(before);
		expect(once.nextSubject).toBe(7);
	});
});
