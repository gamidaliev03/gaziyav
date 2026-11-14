// While the zoom moves, no clip gets its full body (speed, 11.11).
//
// A clip's full body — name, frames, waveform, handles — is ~20 nodes, two canvases and a dozen subscriptions: half a
// millisecond and more to mount. A wheel step that brought clips into the window, or made narrow ones wide, mounted
// all of them in that step's frame: the 75–130 ms frames of a zoom on a two-hour film. So while the zoom is moving a
// clip that is not whole yet is drawn light (timeline-track, LiteClip); what is whole stays whole. Once the zoom has
// stood still for SETTLE_MS the waiting clips become whole a few per frame, nearest the middle of the view first.
// At rest nothing here applies: a clip scrolled into view is whole at once.
//
// One state for the whole timeline (there is one zoom): each track reads it and reports how many of its clips still
// wait. Outside React so a tick costs one small synchronous render of the tracks, inside an animation frame.
import { useLayoutEffect, useSyncExternalStore } from "react";

/** A zoom gesture is over once no step has come for this long. */
export const RAMP_SETTLE_MS = 90;
/** Clips per track that become whole in one frame after the zoom stops. */
export const RAMP_CLIPS_PER_FRAME = 8;

type Phase = "rest" | "moving" | "ramp";

interface Clock {
	setTimeout: (fn: () => void, ms: number) => unknown;
	clearTimeout: (handle: unknown) => void;
	requestFrame: (fn: () => void) => unknown;
	cancelFrame: (handle: unknown) => void;
}

const browserClock: Clock = {
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	requestFrame: (fn) => requestAnimationFrame(fn),
	cancelFrame: (handle) => cancelAnimationFrame(handle as number),
};

export class ZoomRampStore {
	private zoom: number | null = null;
	private phase: Phase = "rest";
	private tick = 0;
	private settleTimer: unknown = null;
	private frame: unknown = null;
	private readonly listeners = new Set<() => void>();
	private readonly waiting = new Map<string, number>();

	constructor(private readonly clock: Clock = browserClock) {}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	/** The tracks drew at this zoom level (told after every commit; only a new level does anything). */
	noteZoom(zoomLevel: number): void {
		if (this.zoom === zoomLevel) return;
		const first = this.zoom === null;
		this.zoom = zoomLevel;
		// the first level is where the timeline opens: nothing moved
		if (first) return;
		this.phase = "moving";
		this.tick = 0;
		if (this.frame !== null) this.clock.cancelFrame(this.frame);
		this.frame = null;
		if (this.settleTimer !== null) this.clock.clearTimeout(this.settleTimer);
		this.settleTimer = this.clock.setTimeout(() => {
			this.settleTimer = null;
			this.phase = "ramp";
			this.tick = 1;
			this.emit();
			this.frame = this.clock.requestFrame(this.step);
		}, RAMP_SETTLE_MS);
		// no emit: the tracks already drew this step as «moving» (their zoom differed from the one known here)
	}

	/** 0 at rest, 1 while the zoom moves, 2 and up for each frame of the ramp after it stopped. */
	snapshotFor(zoomLevel: number): number {
		if (this.zoom === null) return 0;
		if (this.zoom !== zoomLevel) return 1;
		return this.phase === "rest" ? 0 : this.phase === "moving" ? 1 : 1 + this.tick;
	}

	/** A track says, after each of its commits, how many of its clips are still light though wide enough to be whole. */
	reportWaiting(trackId: string, count: number): void {
		this.waiting.set(trackId, count);
	}

	forget(trackId: string): void {
		this.waiting.delete(trackId);
	}

	state(): { zoom: number | null; phase: Phase; tick: number; waiting: number } {
		return { zoom: this.zoom, phase: this.phase, tick: this.tick, waiting: this.mostWaiting() };
	}

	private mostWaiting(): number {
		let most = 0;
		for (const count of this.waiting.values()) if (count > most) most = count;
		return most;
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}

	/** One frame of the ramp: the tracks have reported after the last one; go on while any clip still waits. */
	private step = (): void => {
		this.frame = null;
		if (this.phase !== "ramp") return;
		if (this.mostWaiting() === 0) {
			this.phase = "rest";
			this.tick = 0;
		} else this.tick++;
		this.emit();
		if (this.phase === "ramp") this.frame = this.clock.requestFrame(this.step);
	};
}

/** The timeline's ramp (one zoom, one state). */
export const zoomRamp = new ZoomRampStore();

export interface ZoomRamp {
	/** The zoom is moving or the clips that waited are still becoming whole: no clip becomes whole except by `ramping`. */
	moving: boolean;
	/** The zoom stopped: this frame the nearest RAMP_CLIPS_PER_FRAME waiting clips of each track become whole. */
	ramping: boolean;
}

/** The ramp's state for a track drawing at `zoomLevel`. */
export function useZoomRamp({ trackId, zoomLevel }: { trackId: string; zoomLevel: number }): ZoomRamp {
	const snapshot = useSyncExternalStore(
		zoomRamp.subscribe,
		() => zoomRamp.snapshotFor(zoomLevel),
		() => 0,
	);
	useLayoutEffect(() => {
		zoomRamp.noteZoom(zoomLevel);
	}, [zoomLevel]);
	useLayoutEffect(() => () => zoomRamp.forget(trackId), [trackId]);
	return { moving: snapshot > 0, ramping: snapshot > 1 };
}

/** A track says, after each of its commits, how many of its clips are still light though wide enough to be whole. */
export function reportWaitingClips(trackId: string, count: number): void {
	zoomRamp.reportWaiting(trackId, count);
}

// Tests read the ramp (test/ideal-longform.mjs waits for it to finish before it reads a view).
if (typeof globalThis !== "undefined") (globalThis as { __gzZoomRamp?: ZoomRampStore }).__gzZoomRamp = zoomRamp;
