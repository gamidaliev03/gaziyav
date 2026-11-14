// The reverb's impulse response (sounds/mix/fx.ts → the Reverb card), made from its settings by app/api/audio: pure,
// so it is unit-tested and the same settings always give the same reverb.
import type { ReverbPlan } from "./fx";

/**
 * The reverb's impulse response, made here from its settings (no files to ship): early reflections spaced by the room
 * size, then a dense tail of filtered noise that falls 60 dB over `decay` seconds and loses its highs as it goes
 * (damping). Seeded, so the same settings give the same reverb (and the same cached render). Unit energy, so Mix sets
 * how loud the room is next to the untouched dry sound.
 */
export function reverbIr(plan: ReverbPlan, rate: number, channels: number): Buffer {
	const decay = Math.max(0.1, plan.decay);
	const pre = Math.max(0, plan.predelay) / 1000;
	const length = Math.min(Math.round((pre + decay * 1.1 + 0.02) * rate), 8 * rate);
	const chans = Math.max(1, Math.min(2, channels));
	const data = Array.from({ length: chans }, () => new Float32Array(length));
	const spread = 0.5 + Math.max(0, Math.min(100, plan.size)) / 100;
	for (let c = 0; c < chans; c++) {
		let seed = 0x9e3779b9 ^ (c * 0x85ebca6b) ^ Math.round(decay * 1000) ^ (Math.round(plan.size) << 8);
		const random = () => {
			seed = (seed + 0x6d2b79f5) | 0;
			let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		const out = data[c];
		let y = 0;
		const damp = Math.max(0, Math.min(100, plan.damping)) / 100;
		for (let n = 0; n < length; n++) {
			const t = n / rate - pre;
			if (t < 0) continue;
			const a = 1 - damp * 0.92 * Math.min(1, t / decay);
			y += a * (random() * 2 - 1 - y);
			// the tail fades in over the first reflections' time, then decays
			const onset = Math.min(1, t / (0.012 * spread));
			out[n] = y * Math.exp((-6.9078 * t) / decay) * onset * 0.6;
		}
		[7, 11, 17, 23, 31, 41].forEach((ms, i) => {
			const at = Math.round((pre + (ms / 1000) * spread + c * 0.0007) * rate);
			if (at < length) out[at] += (0.7 - i * 0.09) * (random() < 0.5 ? -1 : 1);
		});
	}
	let energy = 0;
	for (const ch of data) for (const v of ch) energy += v * v;
	const scale = energy > 0 ? 1 / Math.sqrt(energy / chans) : 0;
	const buf = Buffer.alloc(44 + length * chans * 4);
	buf.write("RIFF", 0, "ascii");
	buf.writeUInt32LE(36 + length * chans * 4, 4);
	buf.write("WAVEfmt ", 8, "ascii");
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(3, 20);
	buf.writeUInt16LE(chans, 22);
	buf.writeUInt32LE(rate, 24);
	buf.writeUInt32LE(rate * chans * 4, 28);
	buf.writeUInt16LE(chans * 4, 32);
	buf.writeUInt16LE(32, 34);
	buf.write("data", 36, "ascii");
	buf.writeUInt32LE(length * chans * 4, 40);
	let o = 44;
	for (let n = 0; n < length; n++) for (let c = 0; c < chans; c++, o += 4) buf.writeFloatLE(data[c][n] * scale, o);
	return buf;
}

