/**
 * Ballistics and scale of the master level meter (timeline, right edge). Pure, so the
 * numbers the user sees are unit-tested; the drawing lives in timeline/components/level-meter.tsx.
 *
 * Sample-peak meter: a −6 dBFS sine reads −6 dBFS. Instant attack, ~300 ms release,
 * 1.5 s peak hold, and a latched clip light above −0.1 dBFS.
 */

export const METER_FLOOR_DB = -60;
export const METER_CLIP_DB = -0.1;
export const METER_RELEASE_MS = 300;
export const METER_PEAK_HOLD_MS = 1500;
/** Tick marks, loud to quiet. */
export const METER_TICKS_DB = [0, -6, -12, -18, -24, -36, -48, -60] as const;

const CLIP_AMPLITUDE = 10 ** (METER_CLIP_DB / 20);
const FLOOR_AMPLITUDE = 10 ** (METER_FLOOR_DB / 20);

export function amplitudeToDb(amplitude: number): number {
	return amplitude > 0 ? 20 * Math.log10(amplitude) : Number.NEGATIVE_INFINITY;
}

/**
 * Height fraction (0 = floor, 1 = 0 dBFS) for a level. IEC 60268-18 deflection: more room for
 * the top 20 dB where mixing happens, the quiet tail compressed. Overs stay at the top.
 */
export function meterFraction(db: number): number {
	if (!(db > METER_FLOOR_DB)) return 0;
	let iec: number;
	if (db < -50) iec = (db + 60) * 0.5 + 2.5;
	else if (db < -40) iec = (db + 50) * 0.75 + 7.5;
	else if (db < -30) iec = (db + 40) * 1.5 + 15;
	else if (db < -20) iec = (db + 30) * 2 + 30;
	else iec = (db + 20) * 2.5 + 50;
	return Math.min(1, Math.max(0, (iec - 2.5) / 97.5));
}

/** Largest |sample| of one analyser read. */
export function samplePeak(samples: Float32Array): number {
	let peak = 0;
	for (let index = 0; index < samples.length; index++) {
		const value = samples[index];
		const magnitude = value < 0 ? -value : value;
		if (magnitude > peak) peak = magnitude;
	}
	return peak;
}

export interface MeterChannel {
	/** Displayed level, linear amplitude. */
	level: number;
	/** Peak-hold mark, linear amplitude. */
	hold: number;
	/** performance.now() until which the hold mark stays put. */
	holdUntil: number;
}

export interface MeterState {
	channels: [MeterChannel, MeterChannel];
	/** Latched until the user clicks the light. */
	clipped: boolean;
	/** Loudest sample since the last reset (for the readout while clipped). */
	maxSinceReset: number;
}

export function createMeterState(): MeterState {
	const channel = (): MeterChannel => ({ level: 0, hold: 0, holdUntil: 0 });
	return { channels: [channel(), channel()], clipped: false, maxSinceReset: 0 };
}

/** One frame: `peaks` are this frame's sample peaks (L, R), `dtMs` the time since the last frame. */
export function stepMeter({
	state,
	peaks,
	now,
	dtMs,
}: {
	state: MeterState;
	peaks: readonly [number, number];
	now: number;
	dtMs: number;
}): void {
	const release = Math.exp(-Math.max(0, dtMs) / METER_RELEASE_MS);
	for (let index = 0; index < 2; index++) {
		const channel = state.channels[index];
		const peak = peaks[index];
		// Fast attack, exponential release.
		channel.level = Math.max(peak, channel.level * release);
		if (channel.level < FLOOR_AMPLITUDE * 0.5) channel.level = 0;
		if (peak >= channel.hold || now >= channel.holdUntil) {
			if (peak >= channel.hold) {
				channel.hold = peak;
				channel.holdUntil = now + METER_PEAK_HOLD_MS;
			} else {
				// Hold expired: the mark falls with the bar.
				channel.hold = channel.level;
			}
		}
		if (peak > state.maxSinceReset) state.maxSinceReset = peak;
		if (peak > CLIP_AMPLITUDE) state.clipped = true;
	}
}

export function resetMeterClip(state: MeterState): void {
	state.clipped = false;
	state.maxSinceReset = Math.max(state.channels[0].hold, state.channels[1].hold);
}

/** True once bars and holds are all at rest, so the frame loop can stop. */
export function isMeterAtRest(state: MeterState): boolean {
	return state.channels.every((channel) => channel.level === 0 && channel.hold < FLOOR_AMPLITUDE);
}

/** "−6.0", "+1.2", "" at rest. A real minus sign, one decimal. */
export function formatMeterDb(amplitude: number): string {
	const db = amplitudeToDb(amplitude);
	if (!(db > METER_FLOOR_DB)) return "";
	const rounded = Math.round(db * 10) / 10;
	if (rounded === 0) return "0.0";
	return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(1)}`;
}
