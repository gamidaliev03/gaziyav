// The loudness of what is playing, live: momentary (400 ms), short-term (3 s), integrated since Play, true peak and
// range — the programme after the master, measured on the audio thread (sound/player.ts) for every sample.
//
// It runs only while something on screen wants it AND the film plays; paused, the numbers stay as they were.
// Play from where it stopped goes on with the same measure (a stretch heard in two goes is one measure); Play from
// anywhere else, or a jump while playing, starts it again.
import type { EditorCore } from "@/core";
import { TICKS_PER_SECOND } from "@/wasm";
import { core, summarise, toDb } from "./dsp/offline";
import type { LoudnessBlock, LoudnessTap } from "./player";

export interface LiveReading {
	/** LUFS; −Infinity when silent or not yet known. */
	momentary: number;
	shortTerm: number;
	integrated: number;
	/** The highest true peak since the measure started, dBTP. */
	truePeakDb: number;
	/** Loudness range, LU. */
	range: number;
	/** How much sound has been measured. */
	seconds: number;
	/** The film is playing and being measured now. */
	running: boolean;
	/** False when this device cannot measure live (no audio worklet). */
	available: boolean;
}

const NOTHING: LiveReading = { momentary: Number.NEGATIVE_INFINITY, shortTerm: Number.NEGATIVE_INFINITY, integrated: Number.NEGATIVE_INFINITY, truePeakDb: Number.NEGATIVE_INFINITY, range: 0, seconds: 0, running: false, available: true };

/** Resuming within this of where it stopped continues the measure. */
const SAME_PLACE_SECONDS = 0.08;

export class LiveLoudness {
	private energies: number[] = [];
	private truePeak = 0;
	private samplePeak = 0;
	private tap: LoudnessTap | null = null;
	private opening = false;
	private wanted = 0;
	private playing = false;
	private available = true;
	private stoppedAt: number | null = null;
	private listeners = new Set<() => void>();
	private cached: LiveReading | null = null;
	private unsubscribe: Array<() => void> = [];

	constructor(private editor: EditorCore) {}

	/** A view that shows the numbers; call the result when it goes away. */
	want(): () => void {
		this.wanted++;
		if (this.wanted === 1) {
			this.playing = this.editor.playback.getIsPlaying();
			this.unsubscribe.push(this.editor.playback.subscribe(this.onPlayback), this.editor.playback.onSeek(this.onSeek));
			this.sync();
		}
		let gone = false;
		return () => {
			if (gone) return;
			gone = true;
			this.wanted--;
			if (this.wanted > 0) return;
			for (const off of this.unsubscribe.splice(0)) off();
			this.close();
		};
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** The numbers now (the same object until something changes). */
	reading(): LiveReading {
		if (this.cached) return this.cached;
		const n = this.energies.length;
		if (n === 0) {
			this.cached = { ...NOTHING, running: this.playing && !!this.tap, available: this.available };
			return this.cached;
		}
		const all = summarise(this.energies, n, this.truePeak, this.samplePeak);
		this.cached = {
			momentary: core.windowLufs(this.energies, n - 1, 4),
			shortTerm: core.windowLufs(this.energies, n - 1, 30),
			integrated: all.integrated,
			truePeakDb: toDb(this.truePeak),
			range: all.range,
			seconds: n / 10,
			running: this.playing && !!this.tap,
			available: this.available,
		};
		return this.cached;
	}

	/** Starts the measure again from nothing. */
	reset(): void {
		this.energies = [];
		this.truePeak = 0;
		this.samplePeak = 0;
		this.tap?.reset();
		this.changed();
	}

	/** The proofs' ear (sound/diagnostics.ts): the programme's own samples while it plays. */
	capture(seconds: number) {
		return this.tap ? this.tap.capture(seconds) : Promise.reject(new Error("Nothing is playing."));
	}

	private changed(): void {
		this.cached = null;
		for (const listener of this.listeners) listener();
	}

	private onBlocks = (blocks: LoudnessBlock[]): void => {
		if (!this.playing) return;
		for (const block of blocks) {
			this.energies.push(block.energy);
			if (block.truePeak > this.truePeak) this.truePeak = block.truePeak;
			if (block.samplePeak > this.samplePeak) this.samplePeak = block.samplePeak;
		}
		this.changed();
	};

	private now(): number {
		return this.editor.playback.getCurrentTime() / TICKS_PER_SECOND;
	}

	private onPlayback = (): void => {
		const playing = this.editor.playback.getIsPlaying();
		if (playing === this.playing) return;
		this.playing = playing;
		if (playing) {
			const at = this.now();
			const resumed = this.stoppedAt !== null && Math.abs(at - this.stoppedAt) <= SAME_PLACE_SECONDS;
			if (!resumed) {
				this.energies = [];
				this.truePeak = 0;
				this.samplePeak = 0;
			}
		} else {
			this.stoppedAt = this.now();
		}
		this.sync();
		this.changed();
	};

	private onSeek = (): void => {
		// a jump while playing: what follows is another stretch
		if (this.playing && !this.editor.playback.getIsScrubbing()) this.reset();
	};

	/** The tap is open exactly while the film plays and somebody looks. */
	private sync(): void {
		const want = this.wanted > 0 && this.playing;
		if (want && !this.tap && !this.opening) {
			this.opening = true;
			void this.editor.audio
				.acquireLoudnessTap(this.onBlocks)
				.then((tap) => {
					this.opening = false;
					if (!tap) {
						this.available = false;
						this.changed();
						return;
					}
					this.available = true;
					if (this.wanted > 0 && this.playing) {
						this.tap = tap;
						this.changed();
					} else tap.release();
				})
				.catch(() => {
					this.opening = false;
				});
		} else if (!want && this.tap) {
			this.close();
		}
	}

	private close(): void {
		this.tap?.release();
		this.tap = null;
	}
}

const meters = new WeakMap<EditorCore, LiveLoudness>();

/** The editor's live loudness meter (one for every view that shows it). */
export function liveLoudness(editor: EditorCore): LiveLoudness {
	let meter = meters.get(editor);
	if (!meter) {
		meter = new LiveLoudness(editor);
		meters.set(editor, meter);
	}
	return meter;
}
