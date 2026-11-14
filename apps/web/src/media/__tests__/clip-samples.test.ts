// pro-heavy 09.11: a clip cut in two must tile the mix exactly — the old floor(start)/ceil(length) wrote the sample at
// every other cut twice (a click), at 30 fps as at 29.97.
import { describe, expect, test } from "bun:test";
import { clipSampleSpan, clipTimeAtSample } from "../clip-samples";

const TPS = 120000;

/** Clips back to back from frame-aligned cut points, as the timeline makes them. */
function pieces(cutsTicks: number[]) {
	const out: Array<{ startTime: number; duration: number }> = [];
	for (let i = 0; i + 1 < cutsTicks.length; i++) out.push({ startTime: cutsTicks[i] / TPS, duration: (cutsTicks[i + 1] - cutsTicks[i]) / TPS });
	return out;
}

describe("clipSampleSpan", () => {
	for (const [label, ticksPerFrame] of [["30 fps", 4000], ["29.97 fps", 4004], ["59.94 fps", 2002], ["23.976 fps", 5005], ["25 fps", 4800]] as const) {
		for (const rate of [48000, 44100]) {
			test(`pieces cut at ${label} frames tile a ${rate} Hz mix: no sample twice, none missing`, () => {
				const cuts = [0];
				for (let k = 1; k <= 400; k++) cuts.push(cuts[k - 1] + ((k * 37) % 61 + 1) * ticksPerFrame);
				const spans = pieces(cuts).map((p) => clipSampleSpan(p, rate));
				for (let i = 1; i < spans.length; i++) expect(spans[i].start).toBe(spans[i - 1].start + spans[i - 1].length);
				const whole = clipSampleSpan({ startTime: 0, duration: cuts[cuts.length - 1] / TPS }, rate);
				const last = spans[spans.length - 1];
				expect(last.start + last.length).toBe(whole.length);
			});
		}
	}

	test("the case that clicked: 772000 ticks (6.4333 s) is 308800 samples at 48 kHz, on both sides of the cut", () => {
		const a = clipSampleSpan({ startTime: 0, duration: 772000 / TPS }, 48000);
		const b = clipSampleSpan({ startTime: 772000 / TPS, duration: 2 }, 48000);
		expect(a).toEqual({ start: 0, length: 308800 });
		expect(b.start).toBe(308800);
	});

	test("the second half of a split goes on reading the source where the first stopped", () => {
		// a 29.97 cut at 1601.6 samples: the first output sample of the second half is source time 1602 / 48000
		const startTime = 4004 / TPS;
		const span = clipSampleSpan({ startTime, duration: 1 }, 48000);
		expect(span.start).toBe(1602);
		const t = clipTimeAtSample(span, startTime, 0, 48000);
		expect((startTime + t) * 48000).toBeCloseTo(1602, 6);
		expect(clipTimeAtSample({ start: 0 }, 0.00001, 0, 48000)).toBe(0);
	});
});
