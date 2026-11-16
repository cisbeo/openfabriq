// Five-field cron (minute hour day month weekday), in the machine's local time.

import { sentenceList } from "../words.js";

const FIELDS = [
	["minute", 0, 59],
	["hour", 0, 23],
	["day", 1, 31],
	["month", 1, 12],
	["weekday", 0, 7],
] as const;

export type Cron =
	| { fields: Set<number>[]; restricted: boolean[] }
	| { error: string };

export function parseCron(expression: string): Cron {
	const parts = expression.trim().split(/\s+/);
	if (parts.length !== 5)
		return {
			error: `needs 5 fields (minute hour day month weekday), got ${parts.length}`,
		};
	const fields: Set<number>[] = [];
	for (const [index, part] of parts.entries()) {
		const values = new Set<number>();
		for (const item of part.split(",")) {
			const read = parseItem(item, FIELDS[index] ?? FIELDS[0]);
			if ("error" in read) return read;
			for (const n of read.values) values.add(n);
		}
		fields.push(values);
	}
	// A field that starts with *, like */2, is not restricted: it only thins out every value.
	const restricted = parts.map((part) => !part.startsWith("*"));
	const [, , days = new Set<number>(), months = new Set<number>()] = fields;
	// Unless a restricted weekday can run it instead, the days alone decide whether it ever runs.
	const never = restricted[4] ? undefined : neverRuns(days, months);
	if (never) return { error: never };
	return { fields, restricted };
}

/** The values one item of a field runs at, like 5, 1-5 or 1-10/3, or what is wrong with it. */
function parseItem(
	item: string,
	[name, min, max]: (typeof FIELDS)[number],
): { values: number[] } | { error: string } {
	const [range = "", stepText, ...extra] = item.split("/");
	if (extra.length > 0)
		return { error: `${name}: "${item}" has more than one step` };
	if (stepText === "")
		return { error: `${name}: "${item}" has no step after /` };
	if (range.split("-").length > 2)
		return { error: `${name}: "${item}" is not a range` };
	const numbers = [
		...(range === "*" ? [] : range.split("-")),
		...(stepText ? [stepText] : []),
	];
	const bad = numbers.find((n) => !/^\d+$/.test(n));
	if (bad !== undefined) return { error: `${name}: "${bad}" is not a number` };
	const [first, last] =
		range === "*" ? [min, max] : range.split("-").map(Number);
	const from = first ?? min;
	const to = last ?? (stepText ? max : from);
	for (const n of [from, to])
		if (n < min || n > max)
			return {
				error: `${name} must be between ${min} and ${max}, got ${n}`,
			};
	const step = stepText ? Number(stepText) : 1;
	if (step < 1 || from > to) return { error: `${name}: "${item}" is empty` };
	const values: number[] = [];
	for (let n = from; n <= to; n += step)
		values.push(name === "weekday" && n === 7 ? 0 : n);
	return { values };
}

const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

/** Why the days never come in the months, 31 in a month of 30 (February counts 29); undefined when one does. */
function neverRuns(days: Set<number>, months: Set<number>): string | undefined {
	if (
		[...months].some((m) =>
			[...days].some((d) => d <= (MONTH_DAYS[m - 1] ?? 31)),
		)
	)
		return undefined;
	return `never runs: ${sentenceList([...months].map((m) => MONTH_NAMES[m - 1] ?? String(m)))} ${months.size > 1 ? "have" : "has"} no day ${sentenceList([...days].map(String), "or")}`;
}
