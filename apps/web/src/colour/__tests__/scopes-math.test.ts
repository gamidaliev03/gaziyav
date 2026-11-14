import { describe, expect, test } from "bun:test";
import { drawScope } from "../scopes/cpu";
import {
	barTargets,
	BINS_LENGTH,
	CHANNEL_B,
	CHANNEL_G,
	CHANNEL_R,
	CHANNEL_Y,
	chromaBin,
	chromaOfBin,
	histIndex,
	measureFrame,
	pixelBins,
	playbackStep,
	PLOT_MARGIN,
	readout,
	SKIN_TONE_ANGLE,
	TARGET_HALF,
	VEC_RADIUS,
	vecIndex,
	waveIndex,
	ycbcr,
} from "../scopes/math";

/** A frame of vertical bars, each one colour (8-bit R'G'B'). */
function bars(colours: Array<[number, number, number]>, width = 280, height = 40) {
	const pixels = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const c = colours[Math.min(colours.length - 1, Math.floor((x * colours.length) / width))];
			pixels.set([c[0], c[1], c[2], 255], (y * width + x) * 4);
		}
	}
	return { pixels, width, height };
}

describe("scope maths", () => {
	test("BT.709 luma and colour difference", () => {
		expect(ycbcr(1, 1, 1).y).toBeCloseTo(1, 12);
		expect(ycbcr(1, 1, 1).cb).toBeCloseTo(0, 12);
		expect(ycbcr(0, 0, 1).cb).toBeCloseTo(0.5, 12);
		expect(ycbcr(1, 0, 0).cr).toBeCloseTo(0.5, 12);
		// the 8-bit BT.709 codes of 75 % red in SMPTE RP 219 are Y 51, Cb 109, Cr 212: (51−16)/219, (109−128)/224, (212−128)/224
		const red = ycbcr(0.75, 0, 0);
		expect(red.y).toBeCloseTo((51 - 16) / 219, 2);
		expect(red.cb).toBeCloseTo((109 - 128) / 224, 2);
		expect(red.cr).toBeCloseTo((212 - 128) / 224, 2);
	});

	test("75 % bars sit where SMPTE RP 219 puts them", () => {
		// The 8-bit Y'CbCr codes of the 75 % HD bars in SMPTE RP 219-1 (the values ffmpeg's smptehdbars writes):
		// their angle on a vectorscope is atan2(Cr − 128, Cb − 128), their distance from the centre √(…)/224.
		const rp219: Record<string, [number, number]> = { Yl: [44, 136], Cy: [147, 44], G: [63, 52], Mg: [193, 204], R: [109, 212], B: [212, 120] };
		for (const target of barTargets(0.75)) {
			const [cb, cr] = rp219[target.id];
			const angle = ((Math.atan2(cr - 128, cb - 128) * 180) / Math.PI + 360) % 360;
			expect(Math.abs(target.angle - angle)).toBeLessThan(0.6);
			expect(Math.abs(Math.hypot(target.cb, target.cr) - Math.hypot(cb - 128, cr - 128) / 224)).toBeLessThan(0.004);
		}
		// BT.709 bars are not at the NTSC angles (red 103°, magenta 61°…): magenta is at 50°, blue at 355°
		expect(Math.round(barTargets(0.75).find((t) => t.id === "Mg")?.angle ?? Number.NaN)).toBe(50);
		expect(SKIN_TONE_ANGLE).toBe(123);
		// every 100 % bar is inside the rim
		for (const target of barTargets(1)) expect(Math.hypot(target.cb, target.cr)).toBeLessThan(VEC_RADIUS);
	});

	test("bars land in their target boxes, grey at the centre", () => {
		const frame = bars([
			[191, 191, 191],
			[191, 191, 0],
			[0, 191, 191],
			[0, 191, 0],
			[191, 0, 191],
			[191, 0, 0],
			[0, 0, 191],
		]);
		const bins = measureFrame(frame);
		expect(bins.samples).toBe(frame.width * frame.height);
		const perBar = bins.samples / 7;
		for (const target of barTargets(191 / 255)) {
			// all of the bar's pixels fall inside the box drawn around the 75 % target
			let inside = 0;
			for (let cr = 0; cr < 256; cr++) {
				for (let cb = 0; cb < 256; cb++) {
					if (Math.abs(chromaOfBin(cb) - target.cb) < TARGET_HALF && Math.abs(chromaOfBin(cr) - target.cr) < TARGET_HALF) inside += bins.counts[vecIndex(cb, cr)];
				}
			}
			expect(inside).toBe(perBar);
			const nominal = barTargets(0.75).find((t) => t.id === target.id);
			if (!nominal) throw new Error(`no nominal target ${target.id}`);
			expect(Math.abs(nominal.cb - target.cb)).toBeLessThan(0.003);
			expect(Math.abs(nominal.cr - target.cr)).toBeLessThan(0.003);
		}
		expect(bins.counts[vecIndex(chromaBin(0), chromaBin(0))]).toBe(perBar);
	});

	test("50 % grey sits at 50 % on the waveform, in every column", () => {
		const frame = bars([[128, 128, 128]], 256, 16);
		const bins = measureFrame({ ...frame, columns: 64 });
		for (let column = 0; column < 64; column++) {
			for (const channel of [CHANNEL_Y, CHANNEL_R, CHANNEL_G, CHANNEL_B]) expect(bins.counts[waveIndex(channel, column, 128)]).toBe(bins.perColumn);
		}
		const r = readout(bins);
		expect(r.median).toBeCloseTo(50.2, 1);
		expect(r.clipped).toBe(0);
		expect(r.crushed).toBe(0);
	});

	test("a ramp is a diagonal; the parade keeps the channels apart", () => {
		const width = 256;
		const pixels = new Uint8ClampedArray(width * 8 * 4);
		for (let y = 0; y < 8; y++) for (let x = 0; x < width; x++) pixels.set([x, 0, 255 - x, 255], (y * width + x) * 4);
		const bins = measureFrame({ pixels, width, height: 8, columns: 256 });
		for (const x of [0, 17, 128, 255]) {
			expect(bins.counts[waveIndex(CHANNEL_R, x, x)]).toBe(8);
			expect(bins.counts[waveIndex(CHANNEL_G, x, 0)]).toBe(8);
			expect(bins.counts[waveIndex(CHANNEL_B, x, 255 - x)]).toBe(8);
		}
		// the histogram counts every pixel once per channel
		for (const channel of [CHANNEL_Y, CHANNEL_R, CHANNEL_G, CHANNEL_B]) {
			let sum = 0;
			for (let level = 0; level < 256; level++) sum += bins.counts[histIndex(channel, level)];
			expect(sum).toBe(bins.samples);
		}
		expect(readout(bins).clipped).toBeCloseTo(1 / 256, 6);
	});

	test("whole-number bins agree with the definition on every colour tried", () => {
		// luma and colour difference rounded from their BT.709 definition, against the whole-number sums the GPU runs
		let checked = 0;
		for (let r = 0; r < 256; r += 5) {
			for (let g = 0; g < 256; g += 3) {
				for (let b = 0; b < 256; b += 7) {
					const bins = pixelBins(r, g, b);
					const { y, cb, cr } = ycbcr(r / 255, g / 255, b / 255);
					// an exact tie (…5) may round either way in floating point: allow the neighbour there only
					const near = (bin: number, value: number) => Math.abs(bin - value) <= 0.5 + 1e-9;
					expect(near(bins.y, y * 255)).toBe(true);
					expect(near(bins.cb, (cb + 0.5) * 255)).toBe(true);
					expect(near(bins.cr, (cr + 0.5) * 255)).toBe(true);
					checked++;
				}
			}
		}
		expect(checked).toBeGreaterThan(160000);
		expect(pixelBins(0, 0, 255)).toEqual({ y: 18, cb: 255, cr: 116 });
		expect(pixelBins(255, 255, 255)).toEqual({ y: 255, cb: 128, cr: 128 });
		expect(pixelBins(0, 0, 0)).toEqual({ y: 0, cb: 128, cr: 128 });
	});

	test("sampling step: about half a million samples while playing", () => {
		expect(playbackStep(1920, 1080)).toBe(2);
		expect(playbackStep(3840, 2160)).toBe(4);
		expect(playbackStep(1080, 1920)).toBe(4);
		expect(playbackStep(640, 360)).toBe(1);
		const frame = bars([[10, 20, 30]], 100, 60);
		const bins = measureFrame({ ...frame, stepX: 2, stepY: 2 });
		expect(bins.samples).toBe(50 * 30);
		expect(bins.counts.length).toBe(BINS_LENGTH);
	});

	test("the drawn waveform puts the trace on its level line", () => {
		const frame = bars([[128, 128, 128]], 64, 16);
		const bins = measureFrame({ ...frame, columns: 64 });
		const width = 64;
		const height = 200;
		const image = drawScope({ kind: "waveform", bins, width, height });
		// brightest row of the middle column
		let best = 0;
		let bestRow = -1;
		for (let y = 0; y < height; y++) {
			const v = image[(y * width + 32) * 4 + 1];
			if (v > best) {
				best = v;
				bestRow = y;
			}
		}
		const expected = (1 - PLOT_MARGIN - (128 / 255) * (1 - 2 * PLOT_MARGIN)) * height;
		expect(Math.abs(bestRow + 0.5 - expected)).toBeLessThan(1.5);
		expect(best).toBeGreaterThan(200);
	});

	test("the drawn vectorscope puts a red bar in the red box", () => {
		const frame = bars([[191, 0, 0]], 32, 32);
		const bins = measureFrame(frame);
		const size = 256;
		const image = drawScope({ kind: "vectorscope", bins, width: size, height: size, tinted: false });
		const red = barTargets(0.75)[0];
		const x = Math.round((0.5 + red.cb / VEC_RADIUS / 2) * size - 0.5);
		const y = Math.round((0.5 - red.cr / VEC_RADIUS / 2) * size - 0.5);
		expect(image[(y * size + x) * 4]).toBeGreaterThan(180);
		// and nothing at the mirrored place
		expect(image[((size - 1 - y) * size + (size - 1 - x)) * 4]).toBeLessThan(40);
	});
});
