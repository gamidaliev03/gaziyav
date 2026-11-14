// pro-heavy 09.11: 2× with the pitch kept left the sound 160–200 ms behind the picture (SoundTouch's latency); the
// stretch must put each moment of the source where the clip shows it, at its own pitch.
import { describe, expect, test } from "bun:test";
import { renderRetimedBuffer } from "@/retime";

class FakeBuffer {
	readonly data: Float32Array[];
	constructor(
		readonly numberOfChannels: number,
		readonly length: number,
		readonly sampleRate: number,
	) {
		this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
	}
	getChannelData(c: number) {
		return this.data[c];
	}
}
const context = { sampleRate: 48000, createBuffer: (ch: number, len: number, rate: number) => new FakeBuffer(ch, len, rate) } as unknown as BaseAudioContext;

/** 4 s of a 1 kHz beep (60 ms) at every whole second of the source, silence between. */
function beeps(rate = 48000) {
	const b = new FakeBuffer(2, 4 * rate, rate);
	for (const d of b.data) for (let i = 0; i < d.length; i++) d[i] = (i / rate) % 1 < 0.06 ? 0.5 * Math.sin((2 * Math.PI * 1000 * i) / rate) : 0;
	return b as unknown as AudioBuffer;
}

const onsets = (d: Float32Array, rate: number) => {
	const out: number[] = [];
	let last = -1e9;
	for (let i = 0; i < d.length; i++) {
		if (Math.abs(d[i]) > 0.2) {
			if (i - last > 0.2 * rate) out.push(i / rate);
			last = i;
		}
	}
	return out;
};

describe("pitch-kept speed is in step with the picture", () => {
	for (const rate of [2, 1.5, 0.5]) {
		test(`${rate}×: each beep lands at source time ÷ ${rate}, still 1 kHz`, async () => {
			const out = await renderRetimedBuffer({ audioContext: context, sourceBuffer: beeps(), trimStart: 0, clipDuration: 3.9 / rate, retime: { rate, maintainPitch: true }, maintainPitch: true });
			const d = out.getChannelData(0);
			const got = onsets(d, out.sampleRate);
			const want = [0, 1, 2, 3].map((s) => s / rate).filter((t) => t < 3.9 / rate - 0.05);
			expect(got.length).toBe(want.length);
			for (let i = 0; i < want.length; i++) expect(Math.abs(got[i] - want[i])).toBeLessThan(0.015);
			// the pitch inside the second beep: zero crossings
			const from = Math.round((got[1] + 0.005) * out.sampleRate);
			let z = 0;
			const n = Math.round(0.02 * out.sampleRate);
			for (let i = from + 1; i < from + n; i++) if (d[i - 1] < 0 && d[i] >= 0) z++;
			expect(Math.abs(z / 0.02 - 1000)).toBeLessThan(80);
		});
	}
});
