// The audio-thread side of the sound department: the live loudness meter and the player's limiter, both built from
// the same core the export runs (dsp/core.ts). The worklet is loaded from the TEXT of two functions — the core and
// `soundWorklet` below — so the same rules hold here as in core.ts: nothing outside a function's own body.
import { type SoundCore, soundCore } from "./core";

export const METER_PROCESSOR = "gz-loudness";
export const LIMITER_PROCESSOR = "gz-limiter";

/** What the meter's processor posts for every 100 ms of sound: [energy, truePeak, samplePeak, …the same per channel]. */
export type MeterMessage = { blocks: Float64Array } | { capture: Float32Array[]; frames: number };

// The worklet scope's own names (not in the DOM typings).
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare const AudioWorkletProcessor: { new (): { port: MessagePort }; prototype: object };

/** Runs inside the worklet. `core` is the result of soundCore() evaluated there. */
export function soundWorklet(core: SoundCore, meterName: string, limiterName: string): void {
	// Processors are plain constructor functions over AudioWorkletProcessor (no `class` for a compiler to rewrite), with
	// `process` on the prototype, where every Chromium looks for it.
	type MeterState = { meter: ReturnType<SoundCore["makeMeter"]>; silence: Float32Array[]; pending: number[]; on: boolean; capturing: number; onBlock: (e: number, t: number, s: number) => void };
	type LimiterState = { limiter: ReturnType<SoundCore["makeLimiter"]>; silence: Float32Array[]; alive: boolean; since: number };
	type Node<S> = { port: MessagePort; gz: S };

	function meterProcessor(this: unknown) {
		var self = Reflect.construct(AudioWorkletProcessor, [], new.target as never) as unknown as Node<MeterState>;
		var pending: number[] = [];
		var state: MeterState = {
			meter: core.makeMeter(sampleRate, 2),
			silence: [new Float32Array(128), new Float32Array(128)],
			pending: pending,
			on: true,
			capturing: 0,
			onBlock: function (energy: number, truePeak: number, samplePeak: number) {
				pending.push(energy, truePeak, samplePeak);
			},
		};
		self.gz = state;
		self.port.onmessage = function (event: MessageEvent) {
			var data = event.data;
			if (data === "reset") {
				state.meter.reset();
				pending.length = 0;
				// answered: blocks posted before this are of the measure that was reset
				self.port.postMessage({ reset: true });
			} else if (data === "on") state.on = true;
			else if (data === "off") state.on = false;
			else if (data && typeof data.capture === "number") state.capturing = data.capture;
		};
		return self;
	}
	meterProcessor.prototype = Object.create(AudioWorkletProcessor.prototype);
	meterProcessor.prototype.constructor = meterProcessor;
	meterProcessor.prototype.process = function (this: Node<MeterState>, inputs: Float32Array[][]) {
		var state = this.gz;
		if (!state.on) return true;
		var input = inputs[0];
		// a bus nothing plays into gives no channels: the meter's time still runs (silence between clips)
		var live = !!input && input.length > 0 && input[0].length > 0;
		var frames = live ? input[0].length : 128;
		if (!live && state.silence[0].length !== frames) state.silence = [new Float32Array(frames), new Float32Array(frames)];
		var channels = live ? input : state.silence;
		state.meter.push(channels, 0, frames, state.onBlock);
		if (state.pending.length > 0) {
			this.port.postMessage({ blocks: Float64Array.from(state.pending) });
			state.pending.length = 0;
		}
		if (state.capturing > 0) {
			// the proofs' ear: the samples themselves, a block at a time
			var left = channels[0].slice(0);
			var right = (channels.length > 1 ? channels[1] : channels[0]).slice(0);
			this.port.postMessage({ capture: [left, right], frames: frames }, [left.buffer, right.buffer]);
			state.capturing -= frames;
		}
		return true;
	};
	registerProcessor(meterName, meterProcessor);

	function limiterProcessor(this: unknown, options: { processorOptions?: { ceilingDb?: number; lookaheadMs?: number; releaseMs?: number } }) {
		var self = Reflect.construct(AudioWorkletProcessor, [], new.target as never) as unknown as Node<LimiterState>;
		var o = (options && options.processorOptions) || {};
		var ceilingDb = typeof o.ceilingDb === "number" ? o.ceilingDb : -1;
		var lookaheadMs = typeof o.lookaheadMs === "number" ? o.lookaheadMs : 5;
		var releaseMs = typeof o.releaseMs === "number" ? o.releaseMs : 60;
		var state: LimiterState = {
			limiter: core.makeLimiter(sampleRate, 2, ceilingDb, lookaheadMs, releaseMs),
			silence: [new Float32Array(128), new Float32Array(128)],
			alive: true,
			since: 0,
		};
		self.gz = state;
		self.port.onmessage = function (event: MessageEvent) {
			var data = event.data;
			if (data === "stop") state.alive = false;
			else if (data && typeof data.ceilingDb === "number" && data.ceilingDb !== ceilingDb) {
				ceilingDb = data.ceilingDb;
				state.limiter = core.makeLimiter(sampleRate, 2, ceilingDb, lookaheadMs, releaseMs);
			}
		};
		return self;
	}
	limiterProcessor.prototype = Object.create(AudioWorkletProcessor.prototype);
	limiterProcessor.prototype.constructor = limiterProcessor;
	limiterProcessor.prototype.process = function (this: Node<LimiterState>, inputs: Float32Array[][], outputs: Float32Array[][]) {
		var state = this.gz;
		var output = outputs[0];
		if (!output || output.length === 0) return state.alive;
		var input = inputs[0];
		var frames = output[0].length;
		var live = !!input && input.length > 0 && input[0].length > 0;
		if (!live && state.silence[0].length !== frames) state.silence = [new Float32Array(frames), new Float32Array(frames)];
		state.limiter.process(live ? input : state.silence, output, 0, frames, 0);
		state.since += frames;
		if (state.since >= sampleRate / 10) {
			state.since = 0;
			this.port.postMessage({ minGain: state.limiter.stats().minGain });
		}
		return state.alive;
	};
	registerProcessor(limiterName, limiterProcessor);
}

/** The module the audio thread loads: the two functions' own text, called once. */
export function workletSource(): string {
	return `(${soundWorklet.toString()})((${soundCore.toString()})(), ${JSON.stringify(METER_PROCESSOR)}, ${JSON.stringify(LIMITER_PROCESSOR)});\n`;
}

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();

/**
 * Loads the processors into a context, once. False when this device cannot (no worklets, the module refused): the
 * callers then go without — the bars keep working, the loudness numbers say they are not available.
 */
export function loadSoundWorklet(context: BaseAudioContext): Promise<boolean> {
	let pending = loaded.get(context);
	if (!pending) {
		pending = (async () => {
			if (!context.audioWorklet || typeof Blob === "undefined") return false;
			const url = URL.createObjectURL(new Blob([workletSource()], { type: "text/javascript" }));
			try {
				await context.audioWorklet.addModule(url);
				return true;
			} catch (error) {
				console.warn("Sound worklet failed to load:", error);
				return false;
			} finally {
				URL.revokeObjectURL(url);
			}
		})();
		loaded.set(context, pending);
	}
	return pending;
}
