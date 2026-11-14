// Preview side of a clip's Pan (sounds/mix/pan.ts): the clip's trim, made stereo (a mono clip as L = R), into a
// 2×2 matrix of gains — the same matrix the export mixes with.
import { type PanMatrix, panMatrix } from "./pan";

export interface PanStage {
	ll: GainNode;
	lr: GainNode;
	rl: GainNode;
	rr: GainNode;
	/** What the stage was last set from (pan + its keys): an unchanged clip is not rescheduled. */
	key: string;
	dispose: () => void;
}

/** `input` → matrix → `output`. The input is set to two channels, up-mixed by the speaker rules (mono → L = R). */
export function createPanStage(ctx: BaseAudioContext, input: AudioNode, output: AudioNode): PanStage {
	input.channelCount = 2;
	input.channelCountMode = "explicit";
	input.channelInterpretation = "speakers";
	const splitter = ctx.createChannelSplitter(2);
	const merger = ctx.createChannelMerger(2);
	const gain = (from: number, to: number, value: number) => {
		const g = ctx.createGain();
		g.gain.value = value;
		splitter.connect(g, from);
		g.connect(merger, 0, to);
		return g;
	};
	const stage = {
		ll: gain(0, 0, 1),
		lr: gain(1, 0, 0),
		rl: gain(0, 1, 0),
		rr: gain(1, 1, 1),
		key: "",
		dispose: () => {
			input.disconnect();
			splitter.disconnect();
			for (const g of [stage.ll, stage.lr, stage.rl, stage.rr]) g.disconnect();
			merger.disconnect();
		},
	};
	input.connect(splitter);
	merger.connect(output);
	return stage;
}

const params = (stage: PanStage) => [stage.ll.gain, stage.lr.gain, stage.rl.gain, stage.rr.gain] as const;
const values = (m: PanMatrix) => [m.ll, m.lr, m.rl, m.rr] as const;

/** A fixed pan from `at`: set before the clip sounds, glided (a jump clicks) while it does. */
export function setPanStage(stage: PanStage, pan: number, at: number, glideSeconds = 0): void {
	const v = values(panMatrix(pan));
	params(stage).forEach((p, i) => {
		p.cancelScheduledValues(at);
		if (glideSeconds > 0) p.setTargetAtTime(v[i], at, glideSeconds / 3);
		else p.setValueAtTime(v[i], at);
	});
}

/** A keyframed pan: `points` in context time, held from the first, ramped between them. */
export function schedulePanStage(stage: PanStage, points: ReadonlyArray<{ at: number; pan: number }>, now: number): void {
	const ps = params(stage);
	for (const p of ps) p.cancelScheduledValues(now);
	if (points.length === 0) return;
	const first = values(panMatrix(points[0].pan));
	const start = Math.max(now, points[0].at);
	ps.forEach((p, i) => p.setValueAtTime(first[i], start));
	for (const point of points.slice(1)) {
		if (point.at <= start) continue;
		const v = values(panMatrix(point.pan));
		ps.forEach((p, i) => p.linearRampToValueAtTime(v[i], point.at));
	}
}
