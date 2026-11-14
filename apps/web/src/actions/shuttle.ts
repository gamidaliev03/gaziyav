/**
 * J / K / L shuttle (Kadr, CapCut, FCP): L plays forward and every extra L doubles the
 * speed (×1 → ×2 → ×4 → ×8); J does the same in reverse; K stops.
 *
 * ×1 forward is the normal player (with sound). Reverse and fast-forward step the
 * playhead frame by frame on animation frames (no sound), the way the competitive study
 * recommends for an engine without reverse decode. Any outside seek or a normal Play
 * takes over and ends the shuttle.
 */
export interface ShuttlePlayback {
	isPlaying: () => boolean;
	play: () => void;
	pause: () => void;
	/** Playhead in ticks. */
	getTime: () => number;
	/** Seeks to `ticks` (the playback rounds to frames). */
	seek: (ticks: number) => void;
	getDuration: () => number;
	ticksPerSecond: number;
	ticksPerFrame: () => number;
}

export interface ShuttleClock {
	now: () => number;
	requestFrame: (callback: () => void) => number;
	cancelFrame: (handle: number) => void;
}

/**
 * K held down (Premiere, Final Cut, Avid): J / L step one frame back / forward instead of playing — the way to find a
 * frame by ear and eye. The keyboard listener notes the K key's press and release (by its physical key).
 */
let stopKeyDown: string | null = null;
export const shuttleStopKey = {
	press: (code: string) => {
		stopKeyDown = code;
	},
	release: (code: string) => {
		if (stopKeyDown === code) stopKeyDown = null;
	},
	reset: () => {
		stopKeyDown = null;
	},
	isHeld: () => stopKeyDown !== null,
};

const MAX_RATE = 8;

const browserClock: ShuttleClock = {
	now: () => performance.now(),
	requestFrame: (callback) => requestAnimationFrame(() => callback()),
	cancelFrame: (handle) => cancelAnimationFrame(handle),
};

export class ShuttleController {
	/** Signed speed of the frame-stepping loop; 0 when the loop is idle. */
	private loopRate = 0;
	private frameHandle: number | null = null;
	private lastWallTime = 0;
	private position = 0;
	private lastSeek: number | null = null;

	constructor(
		private readonly playback: ShuttlePlayback,
		private readonly clock: ShuttleClock = browserClock,
	) {}

	/** Current signed rate: loop rate, 1 while the normal player runs, else 0. */
	getRate(): number {
		if (this.loopRate !== 0) return this.loopRate;
		return this.playback.isPlaying() ? 1 : 0;
	}

	isShuttling(): boolean {
		return this.loopRate !== 0;
	}

	forward(): void {
		const rate = this.getRate();
		const next = rate <= 0 ? 1 : Math.min(rate * 2, MAX_RATE);
		this.setRate(next);
	}

	backward(): void {
		const rate = this.getRate();
		const next = rate >= 0 ? -1 : Math.max(rate * 2, -MAX_RATE);
		this.setRate(next);
	}

	stop(): void {
		this.stopLoop();
		if (this.playback.isPlaying()) this.playback.pause();
	}

	dispose(): void {
		this.stopLoop();
	}

	private setRate(rate: number): void {
		if (rate === 1) {
			this.stopLoop();
			if (this.playback.getTime() >= this.playback.getDuration()) {
				this.playback.seek(0);
			}
			if (!this.playback.isPlaying()) this.playback.play();
			return;
		}
		if (this.playback.isPlaying()) this.playback.pause();
		const startLoop = this.loopRate === 0;
		this.loopRate = rate;
		if (startLoop) {
			this.position = this.playback.getTime();
			this.lastSeek = null;
			this.lastWallTime = this.clock.now();
			this.frameHandle = this.clock.requestFrame(this.tick);
		}
	}

	private stopLoop(): void {
		this.loopRate = 0;
		this.lastSeek = null;
		if (this.frameHandle !== null) {
			this.clock.cancelFrame(this.frameHandle);
			this.frameHandle = null;
		}
	}

	/** Advances the loop; exposed for tests through the injected clock. */
	private tick = (): void => {
		this.frameHandle = null;
		if (this.loopRate === 0) return;
		// Someone else moved the playhead or pressed Play: hand over.
		const current = this.playback.getTime();
		if (
			this.playback.isPlaying() ||
			(this.lastSeek !== null &&
				Math.abs(current - this.lastSeek) > this.playback.ticksPerFrame())
		) {
			this.stopLoop();
			return;
		}

		const now = this.clock.now();
		const elapsedSeconds = Math.min(0.25, (now - this.lastWallTime) / 1000);
		this.lastWallTime = now;
		const duration = this.playback.getDuration();
		this.position +=
			this.loopRate * elapsedSeconds * this.playback.ticksPerSecond;

		let reachedEdge = false;
		if (this.position <= 0) {
			this.position = 0;
			reachedEdge = true;
		} else if (this.position >= duration) {
			this.position = duration;
			reachedEdge = true;
		}

		const target = Math.round(this.position);
		this.playback.seek(target);
		this.lastSeek = this.playback.getTime();
		if (reachedEdge) {
			this.stopLoop();
			return;
		}
		this.frameHandle = this.clock.requestFrame(this.tick);
	};
}
