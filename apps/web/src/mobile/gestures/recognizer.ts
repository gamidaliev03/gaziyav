// The touch gesture recogniser of the phone / tablet edition (mobile, 14.11). Pure: it is fed pointer samples (from
// pointer events, or from a test's synthetic stream) and a clock, and answers with gestures. It knows nothing of the
// DOM or the editor: what a gesture DOES is decided by the bridges (timeline-bridge.ts, player-gestures.ts), which turn
// every gesture into the SAME events the desktop already handles — so each one ends in the same command, one undo step.
//
//   one finger: tap · long-press (held still) · drag (moved past the slop; «afterLongPress» when it was held first)
//   two fingers: pan (both move the same way) and pinch (the distance changes) together, with a fling at the end
//   two-finger tap = undo, three-finger tap = redo (short, nearly still)
// A mouse never comes here (the bridges return early on pointerType "mouse"): the desktop paths stay untouched.

export interface PointerSample {
	id: number;
	x: number;
	y: number;
	/** Milliseconds (event.timeStamp, or the test's clock). */
	t: number;
}

export type Gesture =
	| { kind: "tap"; x: number; y: number }
	| { kind: "long-press"; x: number; y: number }
	| { kind: "drag-start"; x0: number; y0: number; x: number; y: number; afterLongPress: boolean }
	| { kind: "drag-move"; x: number; y: number }
	| { kind: "drag-end"; x: number; y: number; vx: number; vy: number }
	/** The one-finger gesture was given up (a second finger came, the system took the pointer). */
	| { kind: "drag-cancel" }
	| { kind: "two-start"; cx: number; cy: number }
	/** dx/dy: the midpoint's move since the last «two»; scale: the distance's ratio since the last one. */
	| { kind: "two"; cx: number; cy: number; dx: number; dy: number; scale: number }
	/** vx/vy in px per ms: the midpoint's speed at the end (the bridge glides by it). */
	| { kind: "two-end"; vx: number; vy: number }
	| { kind: "multi-tap"; fingers: 2 | 3 };

export interface RecognizerConfig {
	/** A finger moved more than this (px) is a drag, not a tap. Touch slop: wider than the mouse's 4 px. */
	slopPx: number;
	/** Held still this long (ms) = long-press. */
	longPressMs: number;
	/** A tap is shorter than this (ms). */
	tapMaxMs: number;
	/** Two / three fingers down and up within this (ms), each moved under the slop = a multi-finger tap. */
	multiTapMaxMs: number;
	/** The window (ms) the release speed is measured over. */
	velocityWindowMs: number;
}

export const DEFAULT_CONFIG: RecognizerConfig = {
	slopPx: 8,
	longPressMs: 450,
	tapMaxMs: 350,
	multiTapMaxMs: 300,
	velocityWindowMs: 100,
};

type Track = { id: number; x0: number; y0: number; x: number; y: number; t0: number; moved: number };

type State =
	| { kind: "idle" }
	| { kind: "pending"; id: number; longPressed: boolean }
	| { kind: "dragging"; id: number }
	| { kind: "two"; ids: [number, number]; cx: number; cy: number; dist: number; samples: Array<{ t: number; cx: number; cy: number }> }
	/** Fingers still down after a cancelled or finished multi-finger gesture: ignore until all are up. */
	| { kind: "drain" };

export class GestureRecognizer {
	private readonly cfg: RecognizerConfig;
	private readonly tracks = new Map<number, Track>();
	private state: State = { kind: "idle" };
	private history: Array<{ t: number; x: number; y: number }> = [];
	/** Multi-finger tap bookkeeping: the most fingers down at once in this touch, when the first went down, any moved. */
	private maxFingers = 0;
	private firstDownAt = 0;
	private anyMoved = false;

	constructor(config: Partial<RecognizerConfig> = {}) {
		this.cfg = { ...DEFAULT_CONFIG, ...config };
	}

	/** What the recogniser is doing (for the bridge: e.g. a long-press timer is only needed while «pending»). */
	phase(): State["kind"] {
		return this.state.kind;
	}

	down(p: PointerSample): Gesture[] {
		const out: Gesture[] = [];
		if (this.tracks.size === 0) {
			this.maxFingers = 0;
			this.firstDownAt = p.t;
			this.anyMoved = false;
		}
		this.tracks.set(p.id, { id: p.id, x0: p.x, y0: p.y, x: p.x, y: p.y, t0: p.t, moved: 0 });
		this.maxFingers = Math.max(this.maxFingers, this.tracks.size);

		if (this.tracks.size === 1) {
			this.state = { kind: "pending", id: p.id, longPressed: false };
			this.history = [{ t: p.t, x: p.x, y: p.y }];
			return out;
		}
		// a second finger: whatever one finger was doing is given up, the two-finger gesture starts
		if (this.state.kind === "dragging") out.push({ kind: "drag-cancel" });
		if (this.tracks.size === 2 && (this.state.kind === "pending" || this.state.kind === "dragging" || this.state.kind === "idle")) {
			const [a, b] = [...this.tracks.values()];
			const cx = (a.x + b.x) / 2;
			const cy = (a.y + b.y) / 2;
			this.state = { kind: "two", ids: [a.id, b.id], cx, cy, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), samples: [{ t: p.t, cx, cy }] };
			out.push({ kind: "two-start", cx, cy });
			return out;
		}
		// a third finger: the two-finger gesture ends where it is (no fling); only a three-finger tap can still come
		if (this.state.kind === "two") out.push({ kind: "two-end", vx: 0, vy: 0 });
		this.state = { kind: "drain" };
		return out;
	}

	move(p: PointerSample): Gesture[] {
		const track = this.tracks.get(p.id);
		if (!track) return [];
		track.x = p.x;
		track.y = p.y;
		track.moved = Math.max(track.moved, Math.hypot(p.x - track.x0, p.y - track.y0));
		if (track.moved > this.cfg.slopPx) this.anyMoved = true;

		const s = this.state;
		if (s.kind === "pending" && s.id === p.id) {
			this.pushHistory(p);
			if (track.moved <= this.cfg.slopPx) return [];
			this.state = { kind: "dragging", id: p.id };
			return [{ kind: "drag-start", x0: track.x0, y0: track.y0, x: p.x, y: p.y, afterLongPress: s.longPressed }];
		}
		if (s.kind === "dragging" && s.id === p.id) {
			this.pushHistory(p);
			return [{ kind: "drag-move", x: p.x, y: p.y }];
		}
		if (s.kind === "two" && s.ids.includes(p.id)) {
			const a = this.tracks.get(s.ids[0]);
			const b = this.tracks.get(s.ids[1]);
			if (!a || !b) return [];
			const cx = (a.x + b.x) / 2;
			const cy = (a.y + b.y) / 2;
			const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
			const g: Gesture = { kind: "two", cx, cy, dx: cx - s.cx, dy: cy - s.cy, scale: dist / s.dist };
			s.cx = cx;
			s.cy = cy;
			s.dist = dist;
			s.samples.push({ t: p.t, cx, cy });
			while (s.samples.length > 2 && p.t - s.samples[0].t > this.cfg.velocityWindowMs) s.samples.shift();
			return [g];
		}
		return [];
	}

	up(p: PointerSample): Gesture[] {
		const track = this.tracks.get(p.id);
		if (!track) return [];
		this.tracks.delete(p.id);
		const out: Gesture[] = [];
		const s = this.state;

		if (s.kind === "pending" && s.id === p.id) {
			// held then let go without moving: the long-press already answered; a quick still press is a tap
			if (!s.longPressed && p.t - track.t0 <= this.cfg.tapMaxMs) out.push({ kind: "tap", x: p.x, y: p.y });
			this.state = { kind: "idle" };
		} else if (s.kind === "dragging" && s.id === p.id) {
			this.pushHistory(p);
			const { vx, vy } = velocity(this.history, this.cfg.velocityWindowMs);
			out.push({ kind: "drag-end", x: p.x, y: p.y, vx, vy });
			this.state = { kind: "idle" };
		} else if (s.kind === "two" && s.ids.includes(p.id)) {
			const { vx, vy } = velocity(
				s.samples.map((x) => ({ t: x.t, x: x.cx, y: x.cy })),
				this.cfg.velocityWindowMs,
			);
			out.push({ kind: "two-end", vx, vy });
			this.state = this.tracks.size > 0 ? { kind: "drain" } : { kind: "idle" };
		}

		if (this.tracks.size === 0) {
			if (this.maxFingers >= 2 && !this.anyMoved && p.t - this.firstDownAt <= this.cfg.multiTapMaxMs) {
				// a two-finger tap also produced two-start / two-end with no movement: the bridge must treat a «two»
				// that never moved as nothing (it does: no wheel is sent for dx = dy = 0, scale = 1)
				out.push({ kind: "multi-tap", fingers: this.maxFingers >= 3 ? 3 : 2 });
			}
			this.state = { kind: "idle" };
		}
		return out;
	}

	/** The system took the pointer (pointercancel: a scroll, an OS gesture, a call). Everything stops, nothing commits. */
	cancel(p: PointerSample): Gesture[] {
		this.tracks.delete(p.id);
		const out: Gesture[] = [];
		if (this.state.kind === "dragging") out.push({ kind: "drag-cancel" });
		if (this.state.kind === "two") out.push({ kind: "two-end", vx: 0, vy: 0 });
		this.anyMoved = true; // never a multi-tap
		this.state = this.tracks.size > 0 ? { kind: "drain" } : { kind: "idle" };
		return out;
	}

	/** The clock: called by the bridge's timer (and by tests). Fires the long-press once. */
	tick(now: number): Gesture[] {
		const s = this.state;
		if (s.kind !== "pending" || s.longPressed) return [];
		const track = this.tracks.get(s.id);
		if (!track || now - track.t0 < this.cfg.longPressMs || track.moved > this.cfg.slopPx) return [];
		s.longPressed = true;
		return [{ kind: "long-press", x: track.x, y: track.y }];
	}

	private pushHistory(p: PointerSample): void {
		this.history.push({ t: p.t, x: p.x, y: p.y });
		while (this.history.length > 2 && p.t - this.history[0].t > this.cfg.velocityWindowMs) this.history.shift();
	}
}

/** px per ms over the last `windowMs` of samples (0 when the finger stopped before letting go). */
export function velocity(samples: ReadonlyArray<{ t: number; x: number; y: number }>, windowMs: number): { vx: number; vy: number } {
	if (samples.length < 2) return { vx: 0, vy: 0 };
	const last = samples[samples.length - 1];
	let first = samples[0];
	for (const s of samples) {
		if (last.t - s.t <= windowMs) {
			first = s;
			break;
		}
	}
	const dt = last.t - first.t;
	if (dt <= 0) return { vx: 0, vy: 0 };
	return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

/**
 * The glide after a fling: the per-frame moves (px) for a release speed (px/ms), slowing by `friction` every 16 ms
 * frame until under `minSpeed`. Pure, so the bridge only plays the list back and a test checks its sum.
 */
export function inertiaSteps(v: { vx: number; vy: number }, { friction = 0.95, minSpeed = 0.02, frameMs = 16, maxFrames = 180 } = {}): Array<{ dx: number; dy: number }> {
	const out: Array<{ dx: number; dy: number }> = [];
	let { vx, vy } = v;
	for (let i = 0; i < maxFrames && Math.hypot(vx, vy) >= minSpeed; i++) {
		out.push({ dx: vx * frameMs, dy: vy * frameMs });
		vx *= friction;
		vy *= friction;
	}
	return out;
}

/** A pinch's distance ratio as the desktop's ⌘-wheel delta: the timeline zooms by exp(-delta / 300) per frame. */
export function pinchToWheelDelta(scale: number): number {
	if (!(scale > 0) || scale === 1) return 0;
	return -300 * Math.log(scale);
}
