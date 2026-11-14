// What a video scope measures, in one place: the GPU engine (wgsl.ts), the CPU fallback (cpu.ts) and the tests all
// read these numbers, so a point lands in the same bin whichever path drew it.
//
// The player's frame is gamma-encoded R'G'B' in 8 bits (Rec. 709 primaries). A scope plots that signal, not light:
// - luma  Y' = 0.2126 R' + 0.7152 G' + 0.0722 B'                      (ITU-R BT.709-6, item 3.2)
// - Cb = (B' − Y') / 1.8556,  Cr = (R' − Y') / 1.5748                  (BT.709-6, item 3.3), each −0.5 … +0.5
// Levels are shown 0–100 %: code 0 is 0 %, code 255 is 100 % (the browser has already expanded video range 16–235
// to 0–255 when it decoded the file, so what was super-white or sub-black in the file is not in the frame any more).

export const KR = 0.2126;
export const KG = 0.7152;
export const KB = 0.0722;
export const CB_DIV = 2 * (1 - KB); // 1.8556
export const CR_DIV = 2 * (1 - KR); // 1.5748

/** Columns of the waveform's table (the engine may use fewer: one per device pixel of its cell). */
export const WAVE_COLS = 512;
export const LEVELS = 256;
/** The vectorscope's table: one bin per 8-bit step of Cb and of Cr. */
export const VEC_SIZE = 256;

/** Table layout in one array of counts: waveform (Y', R', G', B' × columns × levels), vectorscope, histogram. */
export const WAVE_OFFSET = 0;
export const VEC_OFFSET = 4 * WAVE_COLS * LEVELS;
export const HIST_OFFSET = VEC_OFFSET + VEC_SIZE * VEC_SIZE;
export const BINS_LENGTH = HIST_OFFSET + 4 * LEVELS;

export const CHANNEL_Y = 0;
export const CHANNEL_R = 1;
export const CHANNEL_G = 2;
export const CHANNEL_B = 3;

export const waveIndex = (channel: number, column: number, level: number) => WAVE_OFFSET + (channel * WAVE_COLS + column) * LEVELS + level;
export const vecIndex = (cbBin: number, crBin: number) => VEC_OFFSET + crBin * VEC_SIZE + cbBin;
export const histIndex = (channel: number, level: number) => HIST_OFFSET + channel * LEVELS + level;

export interface YCbCr {
	y: number;
	cb: number;
	cr: number;
}

/** R'G'B' 0…1 → Y' 0…1, Cb and Cr −0.5…0.5. */
export function ycbcr(r: number, g: number, b: number): YCbCr {
	const y = KR * r + KG * g + KB * b;
	return { y, cb: (b - y) / CB_DIV, cr: (r - y) / CR_DIV };
}

/** Back to R'G'B' (for the trace's own colour on the vectorscope). */
export function rgbFromYCbCr(y: number, cb: number, cr: number): [number, number, number] {
	const r = y + cr * CR_DIV;
	const b = y + cb * CB_DIV;
	return [r, (y - KR * r - KB * b) / KG, b];
}

const clampBin = (v: number, n: number) => (v < 0 ? 0 : v > n - 1 ? n - 1 : v);
/** The level bin of a 0…1 value (round half up). */
export const levelBin = (v: number) => clampBin(Math.floor(v * 255 + 0.5), LEVELS);
/** The vectorscope bin of a colour-difference value −0.5…0.5. */
export const chromaBin = (c: number) => clampBin(Math.floor((c + 0.5) * 255 + 0.5), VEC_SIZE);
/** The centre of a vectorscope bin, back in −0.5…0.5. */
export const chromaOfBin = (bin: number) => bin / 255 - 0.5;

// A pixel's bins from its three 8-bit codes, in whole numbers only — the GPU (wgsl.ts) does the very same sums, so
// the two can never round a pixel into different bins:
//   luma code  = (2126 R + 7152 G + 722 B + 5000) div 10000                       (Y' × 255, rounded half up)
//   Cb bin     = (10000 B − (2126 R + 7152 G + 722 B) + 128 × 18556) div 18556    ((B' − Y') / 1.8556 × 255 + 127.5, rounded)
//   Cr bin     = (10000 R − (2126 R + 7152 G + 722 B) + 128 × 15748) div 15748
export const LUMA_WEIGHTS = [2126, 7152, 722] as const;
export const CB_SCALE = 18556;
export const CR_SCALE = 15748;
export function pixelBins(r8: number, g8: number, b8: number): { y: number; cb: number; cr: number } {
	const sum = LUMA_WEIGHTS[0] * r8 + LUMA_WEIGHTS[1] * g8 + LUMA_WEIGHTS[2] * b8;
	return {
		y: Math.min(255, Math.floor((sum + 5000) / 10000)),
		cb: Math.min(255, Math.floor((10000 * b8 - sum + 128 * CB_SCALE) / CB_SCALE)),
		cr: Math.min(255, Math.floor((10000 * r8 - sum + 128 * CR_SCALE) / CR_SCALE)),
	};
}

export interface ScopeBins {
	/** Counts, laid out by waveIndex / vecIndex / histIndex. */
	counts: Uint32Array;
	/** Waveform columns in use (≤ WAVE_COLS). */
	columns: number;
	/** Pixels measured. */
	samples: number;
	/** Pixels measured per waveform column, on average. */
	perColumn: number;
}

/**
 * The reference measurement: every `step`-th pixel of an RGBA frame into the tables. The GPU compute pass does the
 * same sums (wgsl.ts); a test compares the two on the same frame.
 */
export function measureFrame({
	pixels,
	width,
	height,
	columns = WAVE_COLS,
	stepX = 1,
	stepY = 1,
}: {
	pixels: Uint8ClampedArray | Uint8Array;
	width: number;
	height: number;
	columns?: number;
	stepX?: number;
	stepY?: number;
}): ScopeBins {
	const counts = new Uint32Array(BINS_LENGTH);
	const cols = Math.max(1, Math.min(WAVE_COLS, Math.round(columns)));
	const gridX = Math.max(1, Math.floor(width / stepX));
	const gridY = Math.max(1, Math.floor(height / stepY));
	let samples = 0;
	for (let gy = 0; gy < gridY; gy++) {
		const py = Math.min(height - 1, gy * stepY + (stepY >> 1));
		for (let gx = 0; gx < gridX; gx++) {
			const px = Math.min(width - 1, gx * stepX + (stepX >> 1));
			const i = (py * width + px) * 4;
			const r8 = pixels[i];
			const g8 = pixels[i + 1];
			const b8 = pixels[i + 2];
			const bins = pixelBins(r8, g8, b8);
			const yBin = bins.y;
			const column = Math.min(cols - 1, Math.floor((px * cols) / width));
			counts[waveIndex(CHANNEL_Y, column, yBin)]++;
			counts[waveIndex(CHANNEL_R, column, r8)]++;
			counts[waveIndex(CHANNEL_G, column, g8)]++;
			counts[waveIndex(CHANNEL_B, column, b8)]++;
			counts[vecIndex(bins.cb, bins.cr)]++;
			counts[histIndex(CHANNEL_Y, yBin)]++;
			counts[histIndex(CHANNEL_R, r8)]++;
			counts[histIndex(CHANNEL_G, g8)]++;
			counts[histIndex(CHANNEL_B, b8)]++;
			samples++;
		}
	}
	return { counts, columns: cols, samples, perColumn: samples / cols };
}

/**
 * How many source pixels apart the samples are while the film plays: about 520 000 samples a frame whatever the
 * size (1080p: every 2nd pixel each way; 4K: every 4th). A still frame is measured in full (step 1).
 */
export function playbackStep(width: number, height: number): number {
	return Math.max(1, Math.ceil(Math.max(width / 960, height / 540)));
}

export interface VectorTarget {
	id: "R" | "Mg" | "B" | "Cy" | "G" | "Yl";
	cb: number;
	cr: number;
	/** Degrees counter-clockwise from the +Cb axis, as a vectorscope is read. */
	angle: number;
}

const BAR_RGB: Array<[VectorTarget["id"], number, number, number]> = [
	["R", 1, 0, 0],
	["Mg", 1, 0, 1],
	["B", 0, 0, 1],
	["Cy", 0, 1, 1],
	["G", 0, 1, 0],
	["Yl", 1, 1, 0],
];

/** Where colour bars of this amplitude (0.75 for SMPTE bars, 1 for full bars) sit on the vectorscope. */
export function barTargets(amplitude = 0.75): VectorTarget[] {
	return BAR_RGB.map(([id, r, g, b]) => {
		const { cb, cr } = ycbcr(r * amplitude, g * amplitude, b * amplitude);
		return { id, cb, cr, angle: ((Math.atan2(cr, cb) * 180) / Math.PI + 360) % 360 };
	});
}

/**
 * The skin-tone line: the +I axis of a vectorscope, 123° counter-clockwise from +Cb (33° past the R−Y axis).
 * Skin of every complexion falls along it once the white balance is right.
 */
export const SKIN_TONE_ANGLE = 123;
export const skinToneDirection = (): { cb: number; cr: number } => ({
	cb: Math.cos((SKIN_TONE_ANGLE * Math.PI) / 180),
	cr: Math.sin((SKIN_TONE_ANGLE * Math.PI) / 180),
});

/** The colour-difference radius drawn at the vectorscope's rim: a little past full green / magenta (0.596). */
export const VEC_RADIUS = 0.62;
/** Half the side of a target box, in Cb / Cr units (± 2.5 % of full scale). */
export const TARGET_HALF = 0.025;
/** The share of a waveform's or histogram's height left empty above 100 % and under 0 %. */
export const PLOT_MARGIN = 0.06;

/** How bright a trace is drawn for `share` = this bin's count over the samples that could have fallen there. */
export const traceLevel = (share: number, gain: number) => 1 - Math.exp(-share * gain);
export const WAVE_GAIN = 60;
export const VEC_GAIN = 2600;

export interface ScopeReadout {
	/** Luma levels (percent) under which 1 %, 50 % and 99 % of the pixels fall. */
	low: number;
	median: number;
	high: number;
	/** Shares of pixels at code 0 and at code 255 in any channel (clipped). */
	crushed: number;
	clipped: number;
}

/** A few numbers a colourist reads off the histogram (shown under it; also what the tests assert). */
export function readout(bins: ScopeBins): ScopeReadout {
	const total = bins.samples || 1;
	const at = (q: number) => {
		let acc = 0;
		for (let level = 0; level < LEVELS; level++) {
			acc += bins.counts[histIndex(CHANNEL_Y, level)];
			if (acc >= total * q) return (level / 255) * 100;
		}
		return 100;
	};
	let crushed = 0;
	let clipped = 0;
	for (const channel of [CHANNEL_R, CHANNEL_G, CHANNEL_B]) {
		crushed = Math.max(crushed, bins.counts[histIndex(channel, 0)] / total);
		clipped = Math.max(clipped, bins.counts[histIndex(channel, 255)] / total);
	}
	return { low: at(0.01), median: at(0.5), high: at(0.99), crushed, clipped };
}
