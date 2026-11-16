import { type Cron, parseCron } from "./parse.js";

// When a cron runs: the next run after a moment, and the run a schedule owes since the last check.

/** A moment's calendar fields in a time zone, or in the machine's when there is none. */
interface Parts {
	year: number;
	minute: number;
	hour: number;
	day: number;
	month: number;
	weekday: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function zonedParts(date: Date, timeZone?: string): Parts {
	if (!timeZone)
		return {
			year: date.getFullYear(),
			minute: date.getMinutes(),
			hour: date.getHours(),
			day: date.getDate(),
			month: date.getMonth() + 1,
			weekday: date.getDay(),
		};
	let format = formats.get(timeZone);
	if (!format) {
		format = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			minute: "numeric",
			hour: "numeric",
			day: "numeric",
			month: "numeric",
			weekday: "short",
		});
		formats.set(timeZone, format);
	}
	const parts: Record<string, string> = {};
	for (const p of format.formatToParts(date)) parts[p.type] = p.value;
	return {
		year: Number(parts.year),
		minute: Number(parts.minute),
		hour: Number(parts.hour),
		day: Number(parts.day),
		month: Number(parts.month),
		weekday: WEEKDAYS.indexOf(parts.weekday ?? ""),
	};
}

/** Whether a name is a time zone the machine knows, like Europe/Paris or UTC. */
export function isTimeZone(name: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: name });
		return true;
	} catch {
		return false;
	}
}

function matcher(cron: Exclude<Cron, { error: string }>) {
	const [minute, hour, day, month, weekday] = cron.fields;
	return {
		calendar: (p: Parts) => {
			const dayOk = day?.has(p.day) ?? false;
			const weekdayOk = weekday?.has(p.weekday) ?? false;
			// As in Vixie cron: when both day and weekday are restricted (neither starts with *),
			// either one matches; otherwise both must.
			const either =
				cron.restricted[2] && cron.restricted[4]
					? dayOk || weekdayOk
					: dayOk && weekdayOk;
			return either && (month?.has(p.month) ?? false);
		},
		hour: (p: Parts) => hour?.has(p.hour) ?? false,
		minute: (p: Parts) => minute?.has(p.minute) ?? false,
	};
}

const MINUTE = 60_000;

const sameWallTime = (a: Parts, b: Parts) =>
	a.day === b.day && a.hour === b.hour && a.minute === b.minute;

/** Whether the clock already showed this time when it went back: by 2 hours (Troll), an hour, or 30 minutes (Lord Howe). */
const repeated = (t: number, p: Parts, timeZone?: string) =>
	[120, 60, 30].some((minutes) =>
		sameWallTime(p, zonedParts(new Date(t - minutes * MINUTE), timeZone)),
	);

/**
 * The first minute strictly after `after` when the cron runs, in a time zone; undefined
 * when the expression does not parse (parseCron says why).
 */
export function nextRun(
	expression: string,
	after: Date,
	timeZone?: string,
): Date | undefined {
	const cron = parseCron(expression);
	return "error" in cron ? undefined : next(matcher(cron), after, timeZone);
}

/** The time a clock shows, as milliseconds, so that the minutes it skips can be counted. */
const wallTime = (p: Parts) =>
	Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);

/** Whether the cron runs at one of the times a clock showing `from`, then `to`, skipped. */
function skippedRun(
	m: ReturnType<typeof matcher>,
	from: number,
	to: number,
): boolean {
	for (let wall = from; wall < to; wall += MINUTE) {
		const d = new Date(wall);
		const p: Parts = {
			year: d.getUTCFullYear(),
			minute: d.getUTCMinutes(),
			hour: d.getUTCHours(),
			day: d.getUTCDate(),
			month: d.getUTCMonth() + 1,
			weekday: d.getUTCDay(),
		};
		if (m.calendar(p) && m.hour(p) && m.minute(p)) return true;
	}
	return false;
}

function next(
	m: ReturnType<typeof matcher>,
	after: Date,
	timeZone?: string,
): Date | undefined {
	let t = Math.floor(after.getTime() / MINUTE) * MINUTE + MINUTE;
	// The time the clock shows at t unless it jumps forward.
	let expected = wallTime(zonedParts(new Date(t - MINUTE), timeZone)) + MINUTE;
	// Skips whole hours that cannot match (not whole days: a daylight-saving day has 23 or 25 hours).
	for (let i = 0; i < 200_000; i++) {
		const p = zonedParts(new Date(t), timeZone);
		const wall = wallTime(p);
		// The spring night skips a time: the cron runs once, at the first minute after the gap.
		if (wall > expected && skippedRun(m, expected, wall)) return new Date(t);
		// The autumn night repeats a time: the cron ran the first time.
		if (m.calendar(p) && m.hour(p) && m.minute(p) && !repeated(t, p, timeZone))
			return new Date(t);
		const step = m.calendar(p) && m.hour(p) ? MINUTE : (60 - p.minute) * MINUTE;
		t += step;
		expected = wall + step;
	}
	return undefined;
}

/**
 * The run a schedule owes between the last check (excluded) and now (included): only the
 * latest of the times it was due, so a missed night runs once, never three times. Undefined
 * when nothing is due, or when the expression does not parse (parseCron says why).
 */
export function dueRun(
	expression: string,
	since: Date,
	now: Date,
	timeZone?: string,
): Date | undefined {
	const cron = parseCron(expression);
	if ("error" in cron) return undefined;
	const m = matcher(cron);
	// Looks back from now in growing windows, so an old `since` never walks every run since then.
	for (const minutes of [
		60,
		1_440,
		46_080,
		576_000,
		Number.POSITIVE_INFINITY,
	]) {
		const from = Math.max(since.getTime(), now.getTime() - minutes * MINUTE);
		let due: Date | undefined;
		let run = next(m, new Date(from), timeZone);
		for (; run && run <= now; run = next(m, run, timeZone)) due = run;
		if (due || from === since.getTime()) return due;
	}
	return undefined;
}
