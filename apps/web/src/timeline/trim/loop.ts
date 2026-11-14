// Trimming while it plays: the picked cut loops — two seconds before it, two after, round and round — and «,» «.»
// (⇧: ten) or J / L move it a frame while it plays; the loop goes on around the cut where it now is. K, Space or Esc
// stop it and the playhead rests on the cut. Every nudge is an ordinary trim: one undo step, the same limits.
import type { EditorCore } from "@/core";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";
import { ticksPerFrame } from "./core";
import { editTime } from "./keys";
import { useTrimUi } from "./store";

/** How much of the film plays before and after the cut (Final Cut's pre-roll and post-roll). */
export const LOOP_ROLL_SECONDS = 2;

class TrimLoop {
	private off: (() => void) | null = null;

	/** True while a picked cut is looping. */
	get on(): boolean {
		return this.off !== null;
	}

	/** The stretch that loops around the picked edit now, on frames; null when nothing is picked (or it is gone). */
	private range(editor: EditorCore): { from: number; to: number; cut: number } | null {
		const picked = useTrimUi.getState().selection;
		const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
		const fps = editor.project.getActiveOrNull()?.settings.fps;
		const cut = picked && tracks ? editTime(tracks, picked) : null;
		if (cut === null || !fps) return null;
		const frame = ticksPerFrame(fps);
		const roll = Math.round((LOOP_ROLL_SECONDS * TICKS_PER_SECOND) / frame) * frame;
		// (a frame short of the film's end: the player stops itself there, and the loop would end)
		const last = Math.max(0, Math.floor(editor.timeline.getTotalDuration() / frame) * frame - frame);
		return { cut, from: Math.max(0, cut - roll), to: Math.min(last, cut + roll) };
	}

	/** Starts looping the picked edit; false when there is nothing to loop. */
	start(editor: EditorCore): boolean {
		if (this.on) this.end(editor, { rest: false });
		const first = this.range(editor);
		if (!first || first.to <= first.from) return false;
		const frame = ticksPerFrame(editor.project.getActive().settings.fps);
		editor.playback.seek({ time: mediaTime({ ticks: first.from }) });
		editor.playback.play();
		const offUpdate = editor.playback.onUpdate((time) => {
			const range = this.range(editor);
			if (!range) this.end(editor, { rest: false });
			else if (time >= range.to || time < range.from - frame) editor.playback.seek({ time: mediaTime({ ticks: range.from }) });
		});
		// the user paused (K, Space, a click on the ruler's stop): the loop is over
		const offState = editor.playback.subscribe(() => {
			if (this.on && !editor.playback.getIsPlaying()) this.end(editor, { rest: true });
		});
		// the edge let go of (Esc, a click elsewhere, a clip selected): nothing to loop
		const offPick = useTrimUi.subscribe((state) => {
			if (this.on && !state.selection) this.end(editor, { rest: false, pause: true });
		});
		this.off = () => {
			offUpdate();
			offState();
			offPick();
		};
		useTrimUi.getState().setLooping(true);
		return true;
	}

	/** After a trim while it loops: once more from the top, around the cut where it now is. */
	again(editor: EditorCore): void {
		if (!this.on) return;
		const range = this.range(editor);
		if (!range) {
			this.end(editor, { rest: false, pause: true });
			return;
		}
		editor.playback.seek({ time: mediaTime({ ticks: range.from }) });
		if (!editor.playback.getIsPlaying()) editor.playback.play();
	}

	/** Stops the loop; the playhead rests on the cut. */
	stop(editor: EditorCore): void {
		if (this.on) this.end(editor, { rest: true, pause: true });
	}

	private end(editor: EditorCore, { rest, pause = false }: { rest: boolean; pause?: boolean }): void {
		const off = this.off;
		this.off = null;
		off?.();
		useTrimUi.getState().setLooping(false);
		if (pause && editor.playback.getIsPlaying()) editor.playback.pause();
		const range = rest ? this.range(editor) : null;
		if (range) editor.playback.seek({ time: mediaTime({ ticks: range.cut }) });
	}
}

export const trimLoop = new TrimLoop();
