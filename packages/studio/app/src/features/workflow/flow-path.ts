export interface Point {
	x: number;
	y: number;
}

/**
 * The same route with right angles only: from one point to the next, the line goes down
 * (or up) to halfway, across, then on. Points in the middle of a straight run are dropped.
 */
export function rightAngles(points: Point[]): Point[] {
	const out: Point[] = [];
	for (const p of points) {
		const last = out.at(-1);
		if (last && last.x !== p.x && last.y !== p.y) {
			const mid = (last.y + p.y) / 2;
			out.push({ x: last.x, y: mid }, { x: p.x, y: mid });
		}
		if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
	}
	return out.filter((p, i) => {
		const a = out[i - 1];
		const b = out[i + 1];
		return (
			!a ||
			!b ||
			!((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y))
		);
	});
}

const toward = (from: Point, to: Point, by: number): Point => {
	const d = Math.hypot(to.x - from.x, to.y - from.y) || 1;
	return {
		x: from.x + ((to.x - from.x) * by) / d,
		y: from.y + ((to.y - from.y) * by) / d,
	};
};

/** An SVG path through the points, each corner rounded by at most `radius`. */
export function roundedPath(points: Point[], radius: number): string {
	const [first, ...rest] = points;
	if (!first) return "";
	let d = `M ${first.x} ${first.y}`;
	for (let i = 1; i < points.length - 1; i++) {
		const p = points[i - 1] as Point;
		const c = points[i] as Point;
		const n = points[i + 1] as Point;
		const r = Math.min(
			radius,
			Math.hypot(c.x - p.x, c.y - p.y) / 2,
			Math.hypot(n.x - c.x, n.y - c.y) / 2,
		);
		const a = toward(c, p, r);
		const b = toward(c, n, r);
		d += ` L ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
	}
	const last = rest.at(-1) ?? first;
	return `${d} L ${last.x} ${last.y}`;
}
