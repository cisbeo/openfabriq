import { expect, it } from "vitest";
import { parseJsonBody } from "../src/shared/http";

const body = (text: string) =>
	new TextEncoder().encode(text).buffer as ArrayBuffer;

it("parses a JSON body, and gives undefined for anything else", () => {
	expect(parseJsonBody(body('{"id":"a","n":[1]}'))).toEqual({
		id: "a",
		n: [1],
	});
	expect(parseJsonBody(body("null"))).toBeNull();
	expect(parseJsonBody(body("not json"))).toBeUndefined();
	expect(parseJsonBody(body('{"id":'))).toBeUndefined();
	expect(parseJsonBody(body(""))).toBeUndefined();
	expect(parseJsonBody(new ArrayBuffer(0))).toBeUndefined();
});
