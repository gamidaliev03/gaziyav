import { create } from "zustand";
import type { TActionWithOptionalArgs } from "@/actions";
import { shuttleStopKey } from "@/actions/shuttle";
import { useSourceMarks } from "@/media/source-marks";

/**
 * The source preview (pro-editor "source monitor"), shown in the main player while a media item is loaded: its own
 * playhead, In/Out marks (see media/source-marks.ts). While the focus is in the Media panel or in the source preview,
 * Space, J/K/L, I/O, ←/→ act on the source; anywhere else they act on the timeline.
 */
interface SourceState {
	assetId: string | null;
	/** Source playhead (seconds) — updated a few times a second while playing. */
	time: number;
	playing: boolean;
	open: (assetId: string) => void;
	close: () => void;
	setTime: (time: number) => void;
	setPlaying: (playing: boolean) => void;
}

export const useSourceStore = create<SourceState>()((set) => ({
	assetId: null,
	time: 0,
	playing: false,
	open: (assetId) =>
		set((state) => {
			if (state.assetId === assetId) return state;
			// One playhead: an item opened with the pointer over its tile's hover line opens AT the line. It did so only
			// when the click came right after the pointer moved (the hover's own seek caught the open); a click after the
			// pointer rested opened at zero with the line standing in the middle of the tile.
			if (skim?.assetId === assetId && !openAt) openAt = { assetId, seconds: skim.seconds };
			return { assetId, time: 0, playing: false };
		}),
	close: () => set({ assetId: null, time: 0, playing: false }),
	setTime: (time) => set({ time }),
	setPlaying: (playing) => set({ playing }),
}));

export interface SourceControls {
	toggle: () => void;
	/** J / K / L: -1 reverse (repeat: faster), 0 stop, 1 forward (repeat: faster). */
	shuttle: (direction: -1 | 0 | 1) => void;
	step: (frames: number) => void;
	markIn: () => void;
	markOut: () => void;
	clearMarks: () => void;
	clearIn: () => void;
	clearOut: () => void;
	/** ⇧I / ⇧O: no-op when that mark is not set. */
	gotoIn: () => void;
	gotoOut: () => void;
	gotoStart: () => void;
	gotoEnd: () => void;
	/** To this second of the source (a tile's hover line moves the monitor's playhead with it). */
	seek: (seconds: number) => void;
	insert: () => void;
}

/** The mounted source preview registers itself here. */
export const sourceControls: { current: SourceControls | null } = { current: null };

export const SOURCE_SCOPE_ATTR = "data-source-scope";

/** Keys go to the source when a media item is loaded and the focus is in the Media panel. */
export function isSourceActive(): boolean {
	if (!sourceControls.current || !useSourceStore.getState().assetId) return false;
	const active = document.activeElement;
	return active instanceof HTMLElement && !!active.closest(`[${SOURCE_SCOPE_ATTR}]`);
}

// ---------- the tile's hover line and the monitor's playhead are ONE playhead ----------
// The owner, 14.11: the line stood in the middle of the thumbnail, I marked In at zero — the mark read the source
// monitor's playhead, which the hover never moved. Now: moving over a tile moves the monitor's playhead with it (when
// the monitor shows that item), the tile shows the monitor's playhead when the pointer is away, and I / O pressed with
// the pointer over a tile mark THAT item at the line (the item opens in the monitor there if it was not open).
interface Skim {
	assetId: string;
	seconds: number;
	duration: number;
	fps: number;
}
let skim: Skim | null = null;
let skimFrame = 0;
/** A hovered item that was not in the monitor and got a mark: the monitor opens at this second. */
let openAt: { assetId: string; seconds: number } | null = null;

/** The pointer moved over a media tile: the item and the second under the line. */
export function setSkim(next: { assetId: string; seconds: number; duration?: number; fps?: number }): void {
	skim = { assetId: next.assetId, seconds: Math.max(0, next.seconds), duration: next.duration ?? 0, fps: next.fps && next.fps > 0 ? next.fps : 30 };
	if (skimFrame || typeof requestAnimationFrame === "undefined") return;
	// once a frame at most: only the latest position matters
	skimFrame = requestAnimationFrame(() => {
		skimFrame = 0;
		const state = useSourceStore.getState();
		if (skim && state.assetId === skim.assetId && !state.playing) sourceControls.current?.seek(skim.seconds);
	});
}

/** The pointer left the tile. */
export function clearSkim(assetId: string): void {
	if (skim?.assetId === assetId) skim = null;
}

/** Is the pointer over a media tile's hover line? (I / O then belong to that item, wherever the focus is) */
export const skimActive = (): boolean => skim !== null;

/** The second the monitor should open this item at (set by a mark on a hovered item), taken once. */
export function takeOpenAt(assetId: string): number | null {
	if (openAt?.assetId !== assetId) return null;
	const seconds = openAt.seconds;
	openAt = null;
	return seconds;
}

/** I / O with the pointer over a tile: that item, at the line. False when no tile is hovered (or its item plays). */
function markSkim(which: "in" | "out"): boolean {
	if (!skim) return false;
	const { assetId, seconds, duration, fps } = skim;
	const state = useSourceStore.getState();
	const controls = sourceControls.current;
	if (state.assetId === assetId && controls) {
		// while the source plays, a mark is where it plays (the monitor's own rule)
		if (state.playing) return false;
		controls.seek(seconds);
		if (which === "in") controls.markIn();
		else controls.markOut();
		return true;
	}
	const marks = useSourceMarks.getState();
	if (which === "in") marks.setIn({ id: assetId, seconds });
	// the Out frame belongs to the range: the stored end is the edge after it, as the monitor's own O does
	else marks.setOut({ id: assetId, seconds: duration > 0 ? Math.min(duration, seconds + 1 / fps) : seconds + 1 / fps });
	openAt = { assetId, seconds };
	state.open(assetId);
	return true;
}

/** ⌫ / Delete in Media: the Media view puts here how its selected files are removed (false: none selected). */
export const mediaDelete: { current: (() => boolean) | null } = { current: null };

/**
 * ⌫ / Delete with files selected in Media and the focus in the Media panel: the files go, as the tile menu's «Delete»
 * does (the owner, 14.11: the key answered «Nothing selected» with a file plainly selected — it only knew clips).
 * True when the key was Media's.
 */
export function deleteSelectedMedia(): boolean {
	const active = document.activeElement;
	if (!(active instanceof HTMLElement) || !active.closest(`[${SOURCE_SCOPE_ATTR}]`)) return false;
	return mediaDelete.current ? mediaDelete.current() : false;
}

/** The keys that move the monitor's playhead by themselves. */
const MOVES_PLAYHEAD: ReadonlySet<string> = new Set([
	"toggle-play",
	"shuttle-backward",
	"shuttle-stop",
	"shuttle-forward",
	"goto-in",
	"goto-out",
	"goto-start",
	"goto-end",
	"frame-step-forward",
	"frame-step-backward",
	"frame-step-forward-large",
	"frame-step-backward-large",
]);

/** Runs a timeline action on the source instead; false when the source has no such action. */
export function routeSourceAction(action: TActionWithOptionalArgs): boolean {
	// the pointer over a tile's hover line: I / O mark that item there
	if (action === "mark-in" && markSkim("in")) return true;
	if (action === "mark-out" && markSkim("out")) return true;
	const controls = sourceControls.current;
	if (!controls) return false;
	// One playhead: a key moves it away from the line under a pointer that RESTS on the item's tile, so that line is
	// no longer where the playhead is. I / O after it mark at the playhead — they used to jump back to the resting
	// pointer (click a tile, step with the arrows to the frame, I: the mark landed in the middle of the clip; the
	// gate's «H», 15.11). The next move of the pointer over a tile makes its line the playhead again.
	if (typeof action === "string" && MOVES_PLAYHEAD.has(action) && skim && skim.assetId === useSourceStore.getState().assetId) skim = null;
	switch (action) {
		case "toggle-play":
			controls.toggle();
			return true;
		// K held + J / L: a frame back / forward (actions/shuttle.ts), in the source as on the timeline.
		case "shuttle-backward":
			if (shuttleStopKey.isHeld()) controls.step(-1);
			else controls.shuttle(-1);
			return true;
		case "shuttle-stop":
			controls.shuttle(0);
			return true;
		case "shuttle-forward":
			if (shuttleStopKey.isHeld()) controls.step(1);
			else controls.shuttle(1);
			return true;
		case "mark-in":
			controls.markIn();
			return true;
		case "mark-out":
			controls.markOut();
			return true;
		case "clear-in-out":
			controls.clearMarks();
			return true;
		case "clear-in":
			controls.clearIn();
			return true;
		case "clear-out":
			controls.clearOut();
			return true;
		case "goto-in":
			controls.gotoIn();
			return true;
		case "goto-out":
			controls.gotoOut();
			return true;
		case "frame-step-forward":
			controls.step(1);
			return true;
		case "frame-step-backward":
			controls.step(-1);
			return true;
		case "frame-step-forward-large":
			controls.step(10);
			return true;
		case "frame-step-backward-large":
			controls.step(-10);
			return true;
		case "goto-start":
			controls.gotoStart();
			return true;
		case "goto-end":
			controls.gotoEnd();
			return true;
		default:
			return false;
	}
}
