/**
 * Test-only switches that turn one speed-up off in a built app (localStorage `gz.longform.off`, a comma list), so
 * test/ideal-longform.mjs compares with and without it on the same bundle, alternately (`OFF=lite,index …`). Read once
 * per page. A switch goes away once its speed-up is proven.
 */
export type SpeedFlag =
	/** Clips a few pixels wide are drawn light: box, ring and press target (timeline-element LiteClip). */
	| "lite"
	/** Element lookups by an id index of the tracks (timeline/element-index). */
	| "index"
	/** The zoom step's render window comes from where the scroll lands (hooks/use-render-window). */
	| "window"
	/** Runs of sub-pixel clips on a crowded track are drawn as one box (timeline-track). */
	| "dense"
	/** Waveform summaries of media files are built in a worker (services/waveform-cache). */
	| "waveWorker"
	/** Waveform summaries are kept on disk between sessions (services/waveform-cache). */
	| "waveStore"
	/** Selected clips outside the render window are not mounted (timeline-track). */
	| "offscreen"
	/** A preview keeps the elements it does not change, and their clips do not render (timeline-manager, use-element-preview). */
	| "previewSame"
	/** Markers outside the render window are not mounted (bookmarks row). */
	| "marks"
	/** While the zoom moves no clip becomes whole; after it stops they do, a few per frame (timeline/zoom-ramp). */
	| "ramp"
	/** The Split tool's cursor is set on the element under the pointer, not by a class over every clip (hooks/use-split-cursor). */
	| "cursor";

/**
 * Off unless a test turns them on: speed-ups not yet proven on a built app (the zoom of a long film, the waveform
 * summaries' worker and store). Without the switch the app does what it did before them. The stick sets the switch
 * always (`OFF=` empty: everything on), so it measures them; nothing else does.
 */
const OFF_BY_DEFAULT: readonly SpeedFlag[] = ["window", "dense", "ramp", "marks", "waveWorker", "waveStore"];

let off: Set<string> | null = null;

export function speedOff(flag: SpeedFlag): boolean {
	if (!off) {
		try {
			const set = globalThis.localStorage?.getItem("gz.longform.off");
			off = new Set(set === null || set === undefined ? OFF_BY_DEFAULT : set.split(",").filter(Boolean));
		} catch {
			off = new Set(OFF_BY_DEFAULT);
		}
	}
	return off.has(flag);
}
