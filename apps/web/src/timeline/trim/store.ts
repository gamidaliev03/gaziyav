// What the trim model shows on screen: the readout beside the pointer (or the selected edge), the edge or cut picked
// for the keys, the typed number. Not saved; the edits themselves are ordinary undo steps.
import { create } from "zustand";
import type { FrameRate } from "opencut-wasm";
import type { TrimKind, TrimLimit, TrimTarget } from "./types";

/** The change of the trim in progress, drawn beside the pointer. */
export interface TrimReadout {
	kind: TrimKind;
	/** Applied so far, in ticks. */
	delta: number;
	/** Ticks per frame and the project's rate (frames and timecode of the change). */
	frame: number;
	fps: FrameRate;
	limit: TrimLimit | null;
	/** Where to draw it (client pixels): the pointer, or the selected edge for a key. */
	x: number;
	y: number;
	/** A sentence instead of numbers: the trim cannot be made here. */
	note?: string;
}

/** An edge (a ripple) or a cut (a roll) picked for `,` `.` and typed numbers. */
export type TrimSelection = Extract<TrimTarget, { kind: "roll" | "ripple" }>;

/** The number being typed after + or −. */
export interface TrimEntry {
	/**
	 * What it will move: the picked edge or cut; the one selected clip (moved, slipped or slid); several selected clips
	 * (moved); with nothing selected, the playhead.
	 */
	subject: { type: "edit"; target: TrimSelection } | { type: "clip"; trackId: string; elementId: string } | { type: "clips" } | { type: "playhead" };
	/** For a clip: which of the three; for an edit its own kind. */
	mode: "move" | "slip" | "slide" | "roll" | "ripple" | "playhead";
	text: string;
	/** Set when the typed text reads as no number. */
	invalid: boolean;
}

/** One pane of the two frames shown over the player while a trim is in the hand (two-up.ts). */
export interface TwoUpPane {
	/** English key: Outgoing, Incoming, First frame, Last frame. */
	label: string;
	name: string;
	kind: "video" | "image" | "none";
	/** The frame's place in its file (a video). */
	timecode: string;
}

interface TrimUiState {
	readout: TrimReadout | null;
	twoUp: { left: TwoUpPane | null; right: TwoUpPane | null } | null;
	setTwoUp: (twoUp: { left: TwoUpPane | null; right: TwoUpPane | null } | null) => void;
	/** The time of the snap point the dragged edge sits on (a line is drawn there), or null. */
	snapTime: number | null;
	selection: TrimSelection | null;
	/** The picked edit is looping (loop.ts): the keys trim it while it plays. */
	looping: boolean;
	setLooping: (looping: boolean) => void;
	entry: TrimEntry | null;
	setReadout: (readout: TrimReadout | null) => void;
	setSnapTime: (time: number | null) => void;
	select: (selection: TrimSelection | null) => void;
	setEntry: (entry: TrimEntry | null) => void;
}

export const useTrimUi = create<TrimUiState>()((set, get) => ({
	readout: null,
	twoUp: null,
	setTwoUp: (twoUp) => {
		if (twoUp !== null || get().twoUp !== null) set({ twoUp });
	},
	snapTime: null,
	selection: null,
	looping: false,
	setLooping: (looping) => {
		if (get().looping !== looping) set({ looping });
	},
	entry: null,
	setReadout: (readout) => set({ readout }),
	setSnapTime: (snapTime) => {
		if (get().snapTime !== snapTime) set({ snapTime });
	},
	select: (selection) => set({ selection, ...(selection === null ? { entry: null } : {}) }),
	setEntry: (entry) => set({ entry }),
}));

export const sameSelection = (a: TrimSelection | null, b: TrimSelection | null): boolean =>
	a === b ||
	(!!a &&
		!!b &&
		a.kind === b.kind &&
		a.trackId === b.trackId &&
		(a.kind === "roll" && b.kind === "roll" ? a.leftId === b.leftId && a.rightId === b.rightId : a.kind === "ripple" && b.kind === "ripple" && a.elementId === b.elementId && a.side === b.side));
