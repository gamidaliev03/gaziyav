import { create } from "zustand";
import type { TActionWithOptionalArgs } from "@/actions";
import { shuttleStopKey } from "@/actions/shuttle";

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
	open: (assetId) => set((state) => (state.assetId === assetId ? state : { assetId, time: 0, playing: false })),
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

/** Runs a timeline action on the source instead; false when the source has no such action. */
export function routeSourceAction(action: TActionWithOptionalArgs): boolean {
	const controls = sourceControls.current;
	if (!controls) return false;
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
