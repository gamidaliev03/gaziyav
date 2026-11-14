// Where a fader stands for a level: a console's law — 0 dB at four fifths of the way up, a dB taking more room near
// the top where mixing happens, the quiet end squeezed. Pure.

/** Position (0 bottom … 1 top) and level (dB) pairs the law runs through, straight between them. */
const LAW: ReadonlyArray<readonly [number, number]> = [
	[0, -60],
	[0.1, -48],
	[0.2, -36],
	[0.35, -24],
	[0.55, -12],
	[0.675, -6],
	[0.8, 0],
	[0.9, 6],
	[1, 12],
];

export const FADER_MIN_DB = LAW[0][1];
export const FADER_MAX_DB = LAW[LAW.length - 1][1];
/** Marks beside a fader, top to bottom. */
export const FADER_TICKS_DB = [12, 6, 0, -6, -12, -24, -36, -60] as const;

export function faderPosition(db: number): number {
	if (!(db > FADER_MIN_DB)) return 0;
	if (db >= FADER_MAX_DB) return 1;
	for (let i = 1; i < LAW.length; i++) {
		const [p1, d1] = LAW[i];
		if (db <= d1) {
			const [p0, d0] = LAW[i - 1];
			return p0 + ((db - d0) / (d1 - d0)) * (p1 - p0);
		}
	}
	return 1;
}

export function faderDb(position: number): number {
	const p = Math.min(1, Math.max(0, position));
	for (let i = 1; i < LAW.length; i++) {
		const [p1, d1] = LAW[i];
		if (p <= p1) {
			const [p0, d0] = LAW[i - 1];
			return d0 + ((p - p0) / (p1 - p0)) * (d1 - d0);
		}
	}
	return FADER_MAX_DB;
}

/** A level as a fader stores it: tenths of a dB. */
export const tenth = (db: number) => Math.round(db * 10) / 10;

/** «−6.0», «+3.5», «0.0»: a real minus, one decimal. */
export function formatDb(db: number): string {
	const rounded = tenth(db);
	if (rounded === 0) return "0.0";
	return `${rounded < 0 ? "−" : "+"}${Math.abs(rounded).toFixed(1)}`;
}

/** A pan as the strip says it: «C», «L 30», «R 100». */
export function formatPan(pan: number): string {
	const rounded = Math.round(pan);
	if (rounded === 0) return "C";
	return `${rounded < 0 ? "L" : "R"} ${Math.abs(rounded)}`;
}
