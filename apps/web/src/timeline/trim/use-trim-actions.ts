// The trim model from the keyboard: the Trim tool (T, held = for as long as it is held), picking the edge or the cut
// nearest the playhead, moving it by «,» «.» (⇧: the «many frames» step), slipping the selected clip, and opening the
// number entry (+ / −). Every edit is one undo step; a limit is said in the readout, never passed.
import { useEffect, useRef } from "react";
import { useActionHandler } from "@/actions/use-action-handler";
import { useKeybindingsStore } from "@/actions/keybindings-store";
import { nudgeElements } from "@/actions/timeline-edits";
import { TracksEditCommand } from "@/actions/tracks-edit-command";
import type { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { appPrefs } from "@/settings/app-prefs";
import { useTimelineStore } from "@/timeline/timeline-store";
import { useSelectionStepActions } from "@/timeline/hooks/use-selection-step-actions";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline/types";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";
import { ticksPerFrame } from "./core";
import { editTime, nearestEdit } from "./keys";
import { trimLoop } from "./loop";
import { trimOnce } from "./session";
import { type TrimEntry, type TrimSelection, useTrimUi } from "./store";
import type { TrimKind, TrimTarget } from "./types";

/** A tool key held longer than this is a hold: the tool is given back when the key is let go (Final Cut). */
const HOLD_MS = 350;
/** How long the readout of a key trim stays. */
const READOUT_MS = 1400;

const listTracks = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, tracks.main, ...tracks.audio];

interface TrimActionDeps {
	getScroller: () => HTMLElement | null;
	getPps: () => number;
}

let readoutTimer: ReturnType<typeof setTimeout> | null = null;

/** The change of a key or number trim, shown at the edge (or the clip) for a moment. */
export function flashReadout({
	deps,
	editor,
	kind,
	delta,
	limit,
	at,
	trackId,
	note,
}: {
	deps: TrimActionDeps;
	editor: EditorCore;
	kind: TrimKind;
	delta: number;
	limit: import("./types").TrimLimit | null;
	/** The timeline time to show it at. */
	at: number;
	trackId: string;
	note?: string;
}): void {
	const scroller = deps.getScroller();
	const fps = editor.project.getActiveOrNull()?.settings.fps;
	if (!scroller || !fps) return;
	const box = scroller.getBoundingClientRect();
	const row = scroller.querySelector<HTMLElement>(`[data-timeline-track-row="${CSS.escape(trackId)}"]`)?.getBoundingClientRect();
	const x = box.left + (at / TICKS_PER_SECOND) * deps.getPps() - scroller.scrollLeft;
	useTrimUi.getState().setReadout({
		kind,
		delta,
		frame: ticksPerFrame(fps),
		fps,
		limit,
		x: Math.min(box.right - 12, Math.max(box.left + 12, x)),
		y: Math.min(box.bottom, Math.max(box.top, row ? row.top + 6 : box.top + 6)),
		note,
	});
	if (readoutTimer) clearTimeout(readoutTimer);
	readoutTimer = setTimeout(() => {
		readoutTimer = null;
		useTrimUi.getState().setReadout(null);
	}, READOUT_MS);
}

/** The track the edge keys work on: the picked edge's, else the first selected clip's, else the main track. */
function keyTrack(editor: EditorCore, tracks: SceneTracks): string {
	const picked = useTrimUi.getState().selection;
	if (picked) return picked.trackId;
	const [first] = editor.selection.getSelectedElements();
	return first?.trackId ?? tracks.main.id;
}

/** Applies a trim of `frames` frames and shows what was applied; false when nothing could be trimmed. */
export function trimByFrames(editor: EditorCore, deps: TrimActionDeps, target: TrimTarget, frames: number): boolean {
	const fps = editor.project.getActiveOrNull()?.settings.fps;
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!fps || !tracks || frames === 0) return false;
	const result = trimOnce(editor, target, frames * ticksPerFrame(fps));
	const now = editor.scenes.getActiveScene().tracks;
	const where = (): { at: number; trackId: string } => {
		if (target.kind === "roll" || target.kind === "ripple") return { at: editTime(now, target) ?? 0, trackId: target.trackId };
		const element = (listTracks(now).find((t) => t.id === target.trackId)?.elements as TimelineElement[] | undefined)?.find((e) => e.id === target.elementId);
		return { at: element ? element.startTime + element.duration / 2 : 0, trackId: target.trackId };
	};
	if (!result) {
		if (target.kind === "slip") flashReadout({ deps, editor, kind: "slip", delta: 0, limit: null, ...where(), note: "This clip has no file to slip in" });
		return false;
	}
	flashReadout({ deps, editor, kind: target.kind, delta: result.delta, limit: result.limit, ...where() });
	return result.delta !== 0;
}

/** Moves the selected clips by frames (the «,» «.» nudge by a typed number): one undo step; false when they cannot move. */
export function moveSelectionByFrames(editor: EditorCore, frames: number): boolean {
	const fps = editor.project.getActiveOrNull()?.settings.fps;
	if (!fps || frames === 0) return false;
	const before = editor.scenes.getActiveScene().tracks;
	const selected = editor.selection.getSelectedElements();
	// With the magnet a main-track clip has no room to move (use-hotkey-actions.ts nudge).
	const movable = editor.command.isRippleEnabled ? selected.filter((ref) => ref.trackId !== before.main.id) : selected;
	if (movable.length === 0) return false;
	const after = nudgeElements({ tracks: before, elements: movable, delta: frames * ticksPerFrame(fps) });
	if (!after) return false;
	editor.command.execute({ command: new TracksEditCommand({ before, after, selection: selected }) });
	return true;
}

/**
 * The nudge of the selected clips (tlc2, register A4). Off the magnetic main track: moved by `frames` (one step). On it
 * the magnet keeps the row packed, so a clip has no place of its own to go: one selected main clip is SLID a frame (the
 * row's move — it moves, its neighbours give and take, the film's length stays), several are refused with one line. When
 * nothing can move (a clip in the way, the start of the film) the readout says why. Returns whether anything moved.
 */
export function nudgeSelection(editor: EditorCore, deps: TrimActionDeps, frames: number): boolean {
	const fps = editor.project.getActiveOrNull()?.settings.fps;
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	const selected = editor.selection.getSelectedElements();
	if (!fps || !tracks || frames === 0 || selected.length === 0) return false;
	const magnet = editor.command.isRippleEnabled;
	const onMain = magnet ? selected.filter((ref) => ref.trackId === tracks.main.id) : [];
	if (onMain.length === 1 && selected.length === 1) return trimByFrames(editor, deps, { kind: "slide", trackId: onMain[0].trackId, elementId: onMain[0].elementId }, frames);
	const movable = magnet ? selected.filter((ref) => ref.trackId !== tracks.main.id) : selected;
	const first = movable[0] ?? selected[0];
	const element = (listTracks(tracks).find((t) => t.id === first.trackId)?.elements as TimelineElement[] | undefined)?.find((e) => e.id === first.elementId);
	const at = element ? element.startTime + element.duration / 2 : 0;
	const after = movable.length > 0 ? nudgeElements({ tracks, elements: movable, delta: frames * ticksPerFrame(fps) }) : null;
	if (after) editor.command.execute({ command: new TracksEditCommand({ before: tracks, after, selection: selected }) });
	const note = onMain.length > 0 ? "The magnet keeps main-track clips in place: nudge one to slide it" : after ? undefined : frames < 0 && element && element.startTime === 0 ? "Already at the start" : "No room to move it there";
	if (note) flashReadout({ deps, editor, kind: "slide", delta: 0, limit: null, at, trackId: first.trackId, note });
	return !!after;
}

export function useTrimActions(deps: TrimActionDeps): void {
	const editor = useEditor();
	const depsRef = useRef(deps);
	depsRef.current = deps;
	// ⌘← / ⌘→ select the previous / next clip on the track (tlc2)
	useSelectionStepActions();

	// --- the Trim tool -------------------------------------------------------------------------------------------
	const held = useRef<{ at: number; back: "select" | "split" } | null>(null);
	useActionHandler(
		"tool-trim",
		(_args, trigger) => {
			const store = useTimelineStore.getState();
			if (trigger === "keypress" && store.tool !== "trim") held.current = { at: performance.now(), back: store.tool };
			store.setTool("trim");
		},
		undefined,
	);
	useEffect(() => {
		// The key let go after a hold gives the tool back; a tap keeps the Trim tool (A returns to Select).
		const up = (event: KeyboardEvent) => {
			const hold = held.current;
			if (!hold) return;
			const { keybindings, getKeybindingString } = useKeybindingsStore.getState();
			const key = getKeybindingString(event);
			if (!key || keybindings.get(key) !== "tool-trim") return;
			held.current = null;
			if (performance.now() - hold.at >= HOLD_MS && useTimelineStore.getState().tool === "trim") useTimelineStore.getState().setTool(hold.back);
		};
		const forget = () => {
			held.current = null;
		};
		// on the window, capturing: the editor's key listener (use-keybindings.ts, the document's capture phase) stops
		// the release of every key it handled
		window.addEventListener("keyup", up, { capture: true });
		window.addEventListener("blur", forget);
		return () => {
			window.removeEventListener("keyup", up, { capture: true });
			window.removeEventListener("blur", forget);
		};
	}, []);
	// Another tool chosen while T is held: nothing to give back.
	const letGo = () => {
		held.current = null;
	};
	useActionHandler("tool-select", letGo, undefined);
	useActionHandler("tool-split", letGo, undefined);

	// --- picking an edge or a cut ----------------------------------------------------------------------------------
	const pick = (which: "out" | "in" | "roll") => {
		const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
		if (!tracks) return;
		const trackId = keyTrack(editor, tracks);
		const found = nearestEdit({ tracks, trackId, time: editor.playback.getCurrentTime(), pick: which });
		if (!found) return;
		editor.selection.clearSelection();
		useTrimUi.getState().select(found);
	};
	useActionHandler("trim-select-out", () => pick("out"), undefined);
	useActionHandler("trim-select-in", () => pick("in"), undefined);
	useActionHandler("trim-select-roll", () => pick("roll"), undefined);

	// A clip selected: the picked edge lets go (one thing is selected at a time).
	useEffect(
		() =>
			editor.selection.subscribe(() => {
				if (useTrimUi.getState().selection && editor.selection.getSelectedElements().length > 0) useTrimUi.getState().select(null);
			}),
		[editor],
	);
	// Esc closes the number, else stops the loop, else lets go of the picked edge.
	useActionHandler(
		"cancel-interaction",
		() => {
			const ui = useTrimUi.getState();
			if (ui.entry) ui.setEntry(null);
			else if (trimLoop.on) trimLoop.stop(editor);
			else if (ui.selection) ui.select(null);
		},
		undefined,
	);

	// --- «,» «.»: the picked edge a frame earlier / later (the clip nudge's own keys: with a clip selected they move it) --
	// ONE handler for «,» «.» ⌥← ⌥→ (and ⇧ / ⌥⇧: ten) — tlc2, register A4: the picked edge, else the selected clips
	// (nudgeSelection: on the magnetic main track the row's own move, a slide; it says why when nothing can move).
	const nudgeEdit = (frames: number) => {
		const picked = useTrimUi.getState().selection;
		if (picked && editor.selection.getSelectedElements().length === 0) {
			trimByFrames(editor, depsRef.current, picked, frames);
			// while it plays: the loop goes on around the cut where it now is
			trimLoop.again(editor);
			return;
		}
		nudgeSelection(editor, depsRef.current, frames);
	};
	useActionHandler("nudge-left", () => nudgeEdit(-1), undefined);
	useActionHandler("nudge-right", () => nudgeEdit(1), undefined);
	useActionHandler("nudge-left-large", () => nudgeEdit(-appPrefs().stepFrames), undefined);
	useActionHandler("nudge-right-large", () => nudgeEdit(appPrefs().stepFrames), undefined);

	// --- trimming while it plays (loop.ts): ⇧/ loops the picked cut; J / L move it a frame like «,» «.»; K stops ------
	useActionHandler(
		"trim-play-around",
		() => {
			if (trimLoop.on) {
				trimLoop.stop(editor);
				return;
			}
			// nothing picked: the cut nearest the playhead, both sides
			if (!useTrimUi.getState().selection) pick("roll");
			if (useTrimUi.getState().selection) trimLoop.start(editor);
		},
		undefined,
	);
	useActionHandler("shuttle-forward", () => void (trimLoop.on && nudgeEdit(1)), undefined);
	useActionHandler("shuttle-backward", () => void (trimLoop.on && nudgeEdit(-1)), undefined);
	// (K pauses through the player's own handler; the loop ends with the pause and puts the playhead on the cut)
	useEffect(() => () => trimLoop.stop(editor), [editor]);

	// --- slip the selected clip ------------------------------------------------------------------------------------
	const slip = (frames: number) => {
		const target = oneSelectedClip(editor);
		if (!target) return;
		trimByFrames(editor, depsRef.current, { kind: "slip", ...target }, frames);
	};
	useActionHandler("slip-left", () => slip(-1), undefined);
	useActionHandler("slip-right", () => slip(1), undefined);
	useActionHandler("slip-left-large", () => slip(-appPrefs().stepFrames), undefined);
	useActionHandler("slip-right-large", () => slip(appPrefs().stepFrames), undefined);

	// --- + / −: type the number ------------------------------------------------------------------------------------
	const type = (sign: "+" | "-", slipIt: boolean) => {
		if (!editor.project.getActiveOrNull()) return;
		const picked: TrimSelection | null = useTrimUi.getState().selection;
		const clip = oneSelectedClip(editor);
		const several = editor.selection.getSelectedElements().length > 1;
		let entry: TrimEntry | null = null;
		if (picked && !slipIt) entry = { subject: { type: "edit", target: picked }, mode: picked.kind, text: sign, invalid: false };
		else if (clip) entry = { subject: { type: "clip", ...clip }, mode: slipIt ? "slip" : "move", text: sign, invalid: false };
		else if (slipIt) return;
		else if (several) entry = { subject: { type: "clips" }, mode: "move", text: sign, invalid: false };
		// nothing selected: the number moves the playhead (Final Cut's ⌃P)
		else entry = { subject: { type: "playhead" }, mode: "playhead", text: sign, invalid: false };
		useTrimUi.getState().setEntry(entry);
	};
	useActionHandler("trim-type-plus", () => type("+", false), undefined);
	useActionHandler("trim-type-minus", () => type("-", false), undefined);
	useActionHandler("slip-type-plus", () => type("+", true), undefined);
	useActionHandler("slip-type-minus", () => type("-", true), undefined);
}

/** Moves the playhead by frames, on a frame, inside the film. */
export function movePlayheadByFrames(editor: EditorCore, frames: number): void {
	const fps = editor.project.getActiveOrNull()?.settings.fps;
	if (!fps) return;
	const frame = ticksPerFrame(fps);
	const now = Math.round(editor.playback.getCurrentTime() / frame);
	const last = Math.max(0, Math.floor(editor.timeline.getTotalDuration() / frame));
	editor.playback.seek({ time: mediaTime({ ticks: Math.max(0, Math.min(last, now + frames)) * frame }) });
}

/** The one selected clip, or null (none, or several: a number or a slip goes to one clip). */
export function oneSelectedClip(editor: EditorCore): { trackId: string; elementId: string } | null {
	const selected = editor.selection.getSelectedElements();
	return selected.length === 1 ? { trackId: selected[0].trackId, elementId: selected[0].elementId } : null;
}
