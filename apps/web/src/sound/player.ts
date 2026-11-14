// The player's side of the sound department, as pieces the audio manager (core/managers/audio-manager.ts) puts into
// its graph:
//
//   clips → per-track bus → mix bus → MASTER (fader → limiter when on) → [meters tap here] → preview volume → out
//
// The master is the same fader and the same limiter arithmetic the export applies to its buffer (sound/master.ts,
// dsp/core.ts). With no master set the stage is two gains at exactly 1: the sound is the mix, bit for bit.
import { LIMITER_LOOKAHEAD_MS, LIMITER_RELEASE_MS, fromDb } from "./dsp/offline";
import { LIMITER_PROCESSOR, METER_PROCESSOR, loadSoundWorklet } from "./dsp/worklet";
import { type MasterMix, NO_MASTER, sameMaster } from "./master";

/** A fader moved while the sound plays glides this long (a jump is a click). */
const GLIDE_SECONDS = 0.03;

/**
 * A start time on the context's sample grid, so the buffer is read at whole samples — as the export reads it.
 * Started between two samples, Chromium reads the WHOLE buffer by linear interpolation: white noise came out 3.4 dB
 * quieter at half a sample, 2.3 dB at a quarter (this app's Chromium, 11.11), and every Play had its own fraction —
 * the player sounded duller than the export, pink noise read 0.95 LU low. `offset`: where in the buffer it starts
 * (seconds); the shift is at most half a sample (10 µs at 48 kHz).
 */
export const onSampleGrid = (when: number, rate: number, offset = 0) => offset + Math.round((when - offset) * rate) / rate;

export interface MasterStage {
	/** What the meters read: the programme as the export carries it. */
	readonly output: GainNode;
	/** Follows the timeline's master (called on every timeline change; nothing happens when it is the same). */
	set(master: MasterMix): void;
	/** A fader being dragged: heard at once, not stored (the release stores it as one step). */
	preview(gainDb: number | null): void;
	/** The limiter's deepest reduction since the last read, dB ≤ 0 (0 when it is off or idle). */
	takeReduction(): number;
	dispose(): void;
}

export function createMasterStage(context: AudioContext, input: AudioNode, destination: AudioNode): MasterStage {
	const fader = context.createGain();
	const output = context.createGain();
	input.connect(fader);
	fader.connect(output);
	output.connect(destination);
	let current: MasterMix = NO_MASTER;
	let previewing: number | null = null;
	let limiter: AudioWorkletNode | null = null;
	let wanted: number | undefined;
	let reduction = 1;
	let disposed = false;

	const glide = (db: number) => {
		const now = context.currentTime;
		fader.gain.cancelScheduledValues(now);
		if (context.state === "running") fader.gain.setTargetAtTime(fromDb(db), now, GLIDE_SECONDS / 3);
		else fader.gain.setValueAtTime(fromDb(db), now);
	};

	const dropLimiter = () => {
		if (!limiter) return;
		const node = limiter;
		limiter = null;
		try {
			fader.disconnect(node);
			node.disconnect();
			node.port.postMessage("stop");
		} catch {}
		fader.connect(output);
	};

	const wantLimiter = (ceilingDb: number | undefined) => {
		wanted = ceilingDb;
		if (ceilingDb === undefined) {
			dropLimiter();
			return;
		}
		if (limiter) {
			limiter.port.postMessage({ ceilingDb });
			return;
		}
		void loadSoundWorklet(context).then((ok) => {
			// the answer may come after the master changed again, or the limiter was made meanwhile
			if (!ok || disposed || limiter || wanted === undefined) return;
			try {
				const node = new AudioWorkletNode(context, LIMITER_PROCESSOR, {
					numberOfInputs: 1,
					numberOfOutputs: 1,
					outputChannelCount: [2],
					channelCount: 2,
					channelCountMode: "explicit",
					channelInterpretation: "speakers",
					processorOptions: { ceilingDb: wanted, lookaheadMs: LIMITER_LOOKAHEAD_MS, releaseMs: LIMITER_RELEASE_MS },
				});
				node.port.onmessage = (event: MessageEvent<{ minGain?: number }>) => {
					const g = event.data?.minGain;
					if (typeof g === "number" && g < reduction) reduction = g;
				};
				fader.disconnect(output);
				fader.connect(node);
				node.connect(output);
				limiter = node;
			} catch (error) {
				console.warn("The player's limiter could not start:", error);
			}
		});
	};

	return {
		output,
		set(master) {
			if (sameMaster(master, current)) return;
			const gainChanged = master.gainDb !== current.gainDb;
			const limiterChanged = master.ceilingDb !== current.ceilingDb;
			current = master;
			if (gainChanged && previewing === null) glide(master.gainDb);
			if (limiterChanged) wantLimiter(master.ceilingDb);
		},
		preview(gainDb) {
			previewing = gainDb;
			glide(gainDb ?? current.gainDb);
		},
		takeReduction() {
			const g = reduction;
			reduction = 1;
			return g < 1 ? 20 * Math.log10(g) : 0;
		},
		dispose() {
			disposed = true;
			dropLimiter();
			try {
				input.disconnect(fader);
				fader.disconnect();
				output.disconnect();
			} catch {}
		},
	};
}

/** What the loudness worklet reports for each finished 100 ms. */
export interface LoudnessBlock {
	energy: number;
	truePeak: number;
	samplePeak: number;
}

export interface LoudnessTap {
	/** Starts the measure again from nothing (filters, the current block). */
	reset(): void;
	/** The proofs' ear: the next `seconds` of the programme's own samples. */
	capture(seconds: number): Promise<{ sampleRate: number; channels: [Float32Array, Float32Array] }>;
	release(): void;
}

interface LoudnessNode {
	node: AudioWorkletNode;
	sink: GainNode;
	/** Resets asked and not yet answered: blocks that arrive meanwhile belong to the measure that was reset. */
	resetting: number;
	users: Set<(blocks: LoudnessBlock[]) => void>;
	captures: Array<{ left: Float32Array[]; right: Float32Array[]; need: number; got: number; done: (value: { sampleRate: number; channels: [Float32Array, Float32Array] }) => void }>;
}

const loudnessNodes = new WeakMap<AudioNode, LoudnessNode>();

/**
 * Loudness of what `source` carries, measured on the audio thread for every sample (an analyser only sees
 * snapshots). Null when this device has no worklets: the caller shows the numbers as not available.
 */
export async function acquireLoudnessTap(context: AudioContext, source: AudioNode, onBlocks: (blocks: LoudnessBlock[]) => void): Promise<LoudnessTap | null> {
	if (!(await loadSoundWorklet(context))) return null;
	let shared = loudnessNodes.get(source);
	if (!shared) {
		let node: AudioWorkletNode;
		try {
			node = new AudioWorkletNode(context, METER_PROCESSOR, {
				numberOfInputs: 1,
				numberOfOutputs: 1,
				outputChannelCount: [2],
				channelCount: 2,
				channelCountMode: "explicit",
				channelInterpretation: "speakers",
			});
		} catch (error) {
			console.warn("The loudness meter could not start:", error);
			return null;
		}
		// pulled by the output through a closed gain: it is processed every block, and adds nothing to the sound
		const sink = context.createGain();
		sink.gain.value = 0;
		node.connect(sink);
		sink.connect(context.destination);
		const made: LoudnessNode = { node, sink, resetting: 0, users: new Set(), captures: [] };
		node.port.onmessage = (event: MessageEvent<{ blocks?: Float64Array; capture?: Float32Array[]; frames?: number; reset?: boolean }>) => {
			const data = event.data;
			if (data.reset) {
				made.resetting = Math.max(0, made.resetting - 1);
			} else if (data.blocks) {
				if (made.resetting > 0) return;
				const blocks: LoudnessBlock[] = [];
				for (let i = 0; i + 2 < data.blocks.length; i += 3) blocks.push({ energy: data.blocks[i], truePeak: data.blocks[i + 1], samplePeak: data.blocks[i + 2] });
				for (const user of made.users) user(blocks);
			} else if (data.capture) {
				const job = made.captures[0];
				if (!job) return;
				job.left.push(data.capture[0]);
				job.right.push(data.capture[1]);
				job.got += data.frames ?? data.capture[0].length;
				if (job.got >= job.need) {
					made.captures.shift();
					const join = (parts: Float32Array[]) => {
						const out = new Float32Array(job.got);
						let at = 0;
						for (const part of parts) {
							out.set(part, at);
							at += part.length;
						}
						return out;
					};
					job.done({ sampleRate: context.sampleRate, channels: [join(job.left), join(job.right)] });
				}
			}
		};
		shared = made;
		loudnessNodes.set(source, made);
	}
	const node = shared;
	const user = (blocks: LoudnessBlock[]) => onBlocks(blocks);
	const reset = () => {
		node.resetting++;
		node.node.port.postMessage("reset");
	};
	if (node.users.size === 0) {
		source.connect(node.node);
		reset();
		node.node.port.postMessage("on");
	}
	node.users.add(user);
	let released = false;
	return {
		reset,
		capture: (seconds) =>
			new Promise((done) => {
				const need = Math.max(1, Math.round(seconds * context.sampleRate));
				node.captures.push({ left: [], right: [], need, got: 0, done });
				node.node.port.postMessage({ capture: need });
			}),
		release: () => {
			if (released) return;
			released = true;
			node.users.delete(user);
			if (node.users.size > 0) return;
			node.node.port.postMessage("off");
			try {
				source.disconnect(node.node);
			} catch {}
		},
	};
}
