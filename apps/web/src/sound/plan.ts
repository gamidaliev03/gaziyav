// The arithmetic of «Bring to target», apart from the editor (sound/bring.ts runs it on the open timeline).
import type { MeasureResult } from "./dsp/offline";
import { type MasterMix, MASTER_DB_MAX, MASTER_DB_MIN } from "./master";

/** The loudness a limiter may take off the peaks on the way to a target (LU). Past it, it would be heard working. */
export const MAX_LIMITER_LOSS_LU = 1;
const hundredth = (db: number) => Math.round(db * 100) / 100;
const clampGain = (db: number) => Math.min(MASTER_DB_MAX, Math.max(MASTER_DB_MIN, hundredth(db)));

/**
 * The master that brings a mix to `target`: a gain, and the limiter only when that gain puts the true peak over the
 * ceiling. `through(gain)` measures the mix through that gain and the limiter (one pass of the whole sound).
 */
export async function planMaster({
	dry,
	target,
	ceilingDb,
	through,
}: {
	dry: { integrated: number; truePeakDb: number };
	target: number;
	ceilingDb: number;
	through: (gainDb: number) => Promise<MeasureResult>;
}): Promise<{ master: MasterMix; out: MeasureResult | null; reached: boolean }> {
	const plain = clampGain(target - dry.integrated);
	if (dry.truePeakDb + plain <= ceilingDb) return { master: { gainDb: plain }, out: null, reached: Math.abs(dry.integrated + plain - target) <= 0.1 };

	// The limiter is needed. It takes a little loudness away: the fader gives that back, while the loss stays small.
	type Pass = { gain: number; out: MeasureResult; loss: number };
	const run = async (gain: number): Promise<Pass> => {
		const g = clampGain(gain);
		const out = await through(g);
		return { gain: g, out, loss: dry.integrated + g - out.integrated };
	};
	const passes: Pass[] = [await run(plain)];
	for (let i = 0; i < 2; i++) {
		const last = passes[passes.length - 1];
		const off = target - last.out.integrated;
		if (last.loss <= MAX_LIMITER_LOSS_LU && Math.abs(off) <= 0.05) break;
		if (last.loss > MAX_LIMITER_LOSS_LU) {
			// too deep: back off, further than the excess (less gain also means less loss)
			passes.push(await run(last.gain - (last.loss - MAX_LIMITER_LOSS_LU) * 1.6 - 0.2));
		} else if (off > 0) {
			// a little short: the lost loudness back, and a bit for what the extra gain will lose
			passes.push(await run(last.gain + off * 1.25));
		} else {
			passes.push(await run(last.gain + off));
		}
	}
	// the pass nearest the target among those the limiter did not work too hard in; if none, the gentlest
	const gentle = passes.filter((p) => p.loss <= MAX_LIMITER_LOSS_LU + 0.05);
	const best = gentle.length
		? gentle.reduce((a, b) => (Math.abs(target - b.out.integrated) < Math.abs(target - a.out.integrated) ? b : a))
		: passes.reduce((a, b) => (b.loss < a.loss ? b : a));
	return { master: { gainDb: best.gain, ceilingDb }, out: best.out, reached: Math.abs(best.out.integrated - target) <= 0.1 };
}

