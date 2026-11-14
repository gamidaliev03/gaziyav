// The four trims by the mouse. One listener on the tracks, heard before the clips' own (capture): where zones.ts says a
// press is a roll, a ripple, a slip or a slide, it is taken here; every other press goes on to the timeline untouched,
// so with the feature unused nothing behaves differently.
//
// A drag shows the result live (session.ts), snaps the moving edge like every timeline drag (⇧ or ⌘ held: no snap),
// taps the trackpad at a snap and at a limit, shows the change beside the pointer, and is ONE undo step on release.
// Esc puts everything back. At most one update per animation frame, however fast the mouse reports.
import { getMarkerSnapPoints } from "@/assist/snap";
import type { EditorCore } from "@/core";
import { registerCanceller } from "@/editor/cancel-interaction";
import { hapticTimelineSnap, hapticTrimLimit } from "@/haptics";
import { getAnimationKeyframeSnapPointsForTimeline } from "@/timeline/animation-snap-points";
import { getTrackHeight } from "@/timeline/components/track-layout";
import { getElementEdgeSnapPoints } from "@/timeline/element-snap-source";
import { isOnFrame } from "@/timeline/frame-grid";
import type { SnapPoint } from "@/timeline/snapping";
import { useTimelineStore } from "@/timeline/timeline-store";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline/types";
import { clickSelect } from "@/timeline/hooks/element/use-element-selection";
import { selectCutUnder } from "@/transitions/components/cut-markers";
import { TICKS_PER_SECOND } from "@/wasm";
import { LIVE_LINKAGE_LOAD, TrimSession } from "./session";
import { useTrimUi } from "./store";
import { twoUpOf, type TwoUpTarget } from "./two-up";
import { twoUpPlayer } from "./two-up-player";
import type { TrimTarget } from "./types";
import { cursorFor, trimForPress, type TrimCursor, type TrimTool, zoneAt, type Zone, type ZoneClip } from "./zones";

/** A press that moves less than this is a click. */
const DRAG_THRESHOLD_PX = 3;
/** The timeline's snap distance (snapping/threshold.ts). */
const SNAP_PX = 10;
/** On a long film Linkage's followers (titles, captions) are shown when the hand has rested this long. */
const REST_MS = 90;

export interface TrimPointerDeps {
	editor: EditorCore;
	getScroller: () => HTMLElement | null;
	/** Pixels per second of the timeline now. */
	getPps: () => number;
}

interface Hit {
	target: TrimTarget;
	zone: Zone;
	/** The clip whose handle or body took the press (what a plain click there selects), and which of its edges. */
	pressed: { trackId: string; trackType: string; elementId: string; side: "left" | "right" } | null;
	/** The press landed on the cut's own «+»: its click is the marker's. */
	onMarker: boolean;
}

interface Gesture {
	hit: Hit;
	tool: TrimTool;
	/** Null: the trim cannot be made on this clip (the Trim tool on a title): the press is held, nothing moves. */
	session: TrimSession | null;
	startX: number;
	startScroll: number;
	x: number;
	y: number;
	noSnap: boolean;
	additive: boolean;
	/** ⇧ alone: a click extends the selection from the anchor. */
	range: boolean;
	moved: number;
	frame: number;
	/** The snap points, sorted by time (built at the first move that snaps). */
	points: SnapPoint[] | null;
	lastSnap: SnapPoint | null;
	/** Linkage's followers with every move (a small timeline), or when the hand rests (a long film). */
	liveLinkage: boolean;
	rest: ReturnType<typeof setTimeout> | null;
	stop: () => void;
}

/** The snap point nearest `time` within `reach`, in a list sorted by time. */
function nearestPoint(points: readonly SnapPoint[], time: number, reach: number): SnapPoint | null {
	let low = 0;
	let high = points.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (points[mid].time < time) low = mid + 1;
		else high = mid;
	}
	const after = points[low];
	const before = points[low - 1];
	const best = !before ? after : !after ? before : time - before.time <= after.time - time ? before : after;
	return best && Math.abs(best.time - time) <= reach ? best : null;
}

const listTracks = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, tracks.main, ...tracks.audio];
/** What the player shows the two frames of: a ripple is an edge whose neighbour closes up. */
export const twoUpTarget = (target: TrimTarget): TwoUpTarget => (target.kind === "ripple" ? { kind: "edge", trackId: target.trackId, elementId: target.elementId, side: target.side, closes: true } : target);
/** Seeing the cut never stands in a trim's way: a failure there is the player's old picture, nothing more. */
function quietly(fn: () => void): void {
	try {
		fn();
	} catch (error) {
		console.error("[trim] two-up", error);
	}
}
const hasFile = (element: TimelineElement) => (element.type === "video" || element.type === "audio") && element.sourceDuration != null;

export class TrimPointer {
	private gesture: Gesture | null = null;
	private hover: { x: number; y: number; target: EventTarget | null; alt: boolean; meta: boolean; shift: boolean } | null = null;
	private clips = new WeakMap<TimelineTrack, ZoneClip[]>();
	private dragListeners = new Set<() => void>();

	constructor(private readonly deps: TrimPointerDeps) {}

	/** Listens on the tracks; returns the undo. */
	attach(scroller: HTMLElement): () => void {
		const down = (event: MouseEvent) => this.onDown(event);
		const move = (event: MouseEvent) => this.onHover(event);
		const leave = () => this.setCursor(scroller, null);
		const key = (event: KeyboardEvent) => this.onModifier(event, scroller);
		scroller.addEventListener("mousedown", down, true);
		scroller.addEventListener("mousemove", move, { passive: true });
		scroller.addEventListener("mouseleave", leave);
		document.addEventListener("keydown", key);
		document.addEventListener("keyup", key);
		return () => {
			scroller.removeEventListener("mousedown", down, true);
			scroller.removeEventListener("mousemove", move);
			scroller.removeEventListener("mouseleave", leave);
			document.removeEventListener("keydown", key);
			document.removeEventListener("keyup", key);
			this.setCursor(scroller, null);
			this.cancel();
		};
	}

	get isDragging(): boolean {
		return this.gesture !== null;
	}

	/** The pointer's x of the trim in the hand (edge auto-scroll). */
	get pointerX(): number {
		return this.gesture?.x ?? 0;
	}

	/** Called when a trim starts or ends (an arrow: handed to useSyncExternalStore as it is). */
	onDragChange = (listener: () => void): (() => void) => {
		this.dragListeners.add(listener);
		return () => {
			this.dragListeners.delete(listener);
		};
	};

	/** Esc, or the timeline going away. */
	cancel(): void {
		const gesture = this.gesture;
		if (!gesture) return;
		gesture.session?.cancel();
		this.finish(gesture);
	}

	// --- zones -----------------------------------------------------------------------------------------------------

	private tool(): TrimTool | null {
		const tool = useTimelineStore.getState().tool;
		return tool === "trim" ? "trim" : tool === "select" ? "select" : null;
	}

	private clipsOf(track: TimelineTrack): ZoneClip[] {
		let list = this.clips.get(track);
		if (!list) {
			list = (track.elements as TimelineElement[]).map((element) => ({ id: element.id, start: element.startTime, end: element.startTime + element.duration })).sort((a, b) => a.start - b.start);
			this.clips.set(track, list);
		}
		return list;
	}

	/** The trim a press here would start, or null when the press is the timeline's own. */
	private hit(event: { target: EventTarget | null; clientX: number; clientY: number; altKey: boolean; metaKey: boolean; shiftKey: boolean }, tool: TrimTool): Hit | null {
		const scroller = this.deps.getScroller();
		const element = event.target instanceof HTMLElement || event.target instanceof SVGElement ? event.target : null;
		if (!scroller || !element) return null;
		const row = element.closest<HTMLElement>("[data-timeline-track-row]");
		const trackId = row?.dataset.timelineTrackRow;
		const tracks = this.deps.editor.scenes.getActiveSceneOrNull()?.tracks;
		if (!row || !trackId || !tracks) return null;
		const track = listTracks(tracks).find((t) => t.id === trackId);
		if (!track || track.locked) return null;
		// Controls of their own inside a clip: the fade dots, the keyframes, the volume line.
		if (element.closest("[data-fade-handle],[data-keyframe-refs],.cursor-ns-resize,[data-track-locked]")) return null;
		const rowBox = row.getBoundingClientRect();
		// Under an expanded clip lie its keyframe lanes: not the clip.
		if (event.clientY < rowBox.top || event.clientY > rowBox.top + getTrackHeight({ type: track.type })) return null;
		const pps = this.deps.getPps();
		const time = ((event.clientX - scroller.getBoundingClientRect().left + scroller.scrollLeft) / pps) * TICKS_PER_SECOND;
		const zone = zoneAt({ clips: this.clipsOf(track), time, pps, tool });
		const target = trimForPress({ zone, tool, keys: { alt: event.altKey, meta: event.metaKey, shift: event.shiftKey }, trackId });
		if (!zone || !target) return null;
		// What is under the pointer must be the clip's own edge or body (or the cut's «+»): a transition chip, an effect
		// badge and the rest keep their presses.
		const wrapper = element.closest<HTMLElement>("[data-timeline-element-id]");
		const marker = element.closest<HTMLElement>("[data-cut-marker]");
		const button = element.closest("button");
		const box = element.closest("[data-clip-box]");
		const isBody = !!button && !!box && button.parentElement === box;
		const isHandle = !!button && !box && !!wrapper && !button.hasAttribute("data-fade-handle");
		const isPlus = marker?.dataset.cutMarker === "add";
		if (tool === "select") {
			if (zone.at === "body" ? !isBody : !isHandle && !isPlus) return null;
		} else if (zone.at === "body") {
			if (!isBody) return null;
		} else {
			// the transition chip's own parts stay the chip's: its length handle and its two sides
			if (marker && element.closest('.cursor-ew-resize,[data-cut-chip-side="left"],[data-cut-chip-side="right"]')) return null;
			if (!isHandle && !isBody && !marker) return null;
		}
		const pressedId = wrapper?.dataset.timelineElementId ?? (zone.at === "cut" ? (zone.near === "left" ? zone.left.id : zone.right.id) : zone.clip.id);
		// the edge of that clip the press is at: at a cut the left clip's end or the right clip's start
		const side = zone.at === "cut" ? (pressedId === zone.left.id ? "right" : "left") : zone.at === "edge" ? zone.side : "left";
		return { target, zone, pressed: pressedId ? { trackId, trackType: track.type, elementId: pressedId, side } : null, onMarker: !!marker };
	}

	private setCursor(scroller: HTMLElement, cursor: TrimCursor | "none" | null): void {
		if (cursor === null) {
			if (scroller.dataset.trimCursor !== undefined) delete scroller.dataset.trimCursor;
		} else if (scroller.dataset.trimCursor !== cursor) scroller.dataset.trimCursor = cursor;
	}

	private showHover(): void {
		const scroller = this.deps.getScroller();
		const hover = this.hover;
		if (!scroller) return;
		const tool = this.tool();
		if (!hover || !tool || this.gesture) {
			this.setCursor(scroller, null);
			return;
		}
		const hit = this.hit({ target: hover.target, clientX: hover.x, clientY: hover.y, altKey: hover.alt, metaKey: hover.meta, shiftKey: hover.shift }, tool);
		if (!hit) {
			this.setCursor(scroller, null);
			return;
		}
		// The Trim tool over a clip with no file to slip in: the pointer says no.
		if (hit.target.kind === "slip" && !this.canSlip(hit.target)) {
			this.setCursor(scroller, "none");
			return;
		}
		this.setCursor(scroller, cursorFor(hit.target));
	}

	private canSlip(target: Extract<TrimTarget, { kind: "slip" }>): boolean {
		const tracks = this.deps.editor.scenes.getActiveSceneOrNull()?.tracks;
		const element = tracks ? (listTracks(tracks).find((t) => t.id === target.trackId)?.elements as TimelineElement[] | undefined)?.find((e) => e.id === target.elementId) : undefined;
		return !!element && hasFile(element);
	}

	private onHover(event: MouseEvent): void {
		if (event.buttons !== 0) return;
		this.hover = { x: event.clientX, y: event.clientY, target: event.target, alt: event.altKey, meta: event.metaKey, shift: event.shiftKey };
		this.showHover();
	}

	/** ⌥ ⌘ ⇧ pressed or let go while the pointer rests: the shape follows at once. */
	private onModifier(event: KeyboardEvent, scroller: HTMLElement): void {
		if (event.key !== "Alt" && event.key !== "Meta" && event.key !== "Shift") return;
		if (this.gesture) {
			this.gesture.noSnap = event.shiftKey || event.metaKey;
			return;
		}
		if (!this.hover || !scroller.matches(":hover")) return;
		this.hover = { ...this.hover, alt: event.altKey, meta: event.metaKey, shift: event.shiftKey };
		this.showHover();
	}

	// --- the drag --------------------------------------------------------------------------------------------------

	private onDown(event: MouseEvent): void {
		// ⌃-click is the Mac's right click
		if (event.button !== 0 || event.ctrlKey) return;
		const tool = this.tool();
		if (!tool) return;
		if (this.gesture) this.cancel();
		const hit = this.hit(event, tool);
		// Any press on the tracks lets go of the picked edge (the Trim tool picks the edge it is let go on again).
		if (useTrimUi.getState().selection) useTrimUi.getState().select(null);
		if (!hit) return;
		event.stopPropagation();
		event.preventDefault();
		const active = document.activeElement;
		if (active instanceof HTMLElement && active !== document.body) active.blur();
		const { editor } = this.deps;
		const scroller = this.deps.getScroller();
		const fps = editor.project.getActiveOrNull()?.settings.fps;
		if (!scroller || !fps) return;
		const session = TrimSession.start(editor, hit.target);
		const onMove = (e: MouseEvent) => this.onMove(e);
		const onUp = (e: MouseEvent) => this.onUp(e);
		const onScroll = () => this.schedule();
		let frameRequest = 0;
		const unregister = registerCanceller({ fn: () => this.cancel() });
		const gesture: Gesture = {
			hit,
			tool,
			session,
			startX: event.clientX,
			startScroll: scroller.scrollLeft,
			x: event.clientX,
			y: event.clientY,
			noSnap: event.shiftKey || event.metaKey,
			additive: event.metaKey || event.shiftKey,
			range: event.shiftKey && !event.metaKey,
			moved: 0,
			frame: session?.range.frame ?? Math.round((TICKS_PER_SECOND * fps.denominator) / fps.numerator),
			points: null,
			lastSnap: null,
			liveLinkage: !session || session.linkageLoad <= LIVE_LINKAGE_LOAD,
			rest: null,
			stop: () => {
				document.removeEventListener("mousemove", onMove, true);
				document.removeEventListener("mouseup", onUp, true);
				scroller.removeEventListener("scroll", onScroll);
				if (frameRequest) cancelAnimationFrame(frameRequest);
				if (gesture.rest) clearTimeout(gesture.rest);
				unregister();
			},
		};
		this.schedule = () => {
			if (frameRequest) return;
			frameRequest = requestAnimationFrame(() => {
				frameRequest = 0;
				this.tick();
			});
		};
		this.gesture = gesture;
		document.addEventListener("mousemove", onMove, true);
		document.addEventListener("mouseup", onUp, true);
		scroller.addEventListener("scroll", onScroll, { passive: true });
		if (session) {
			document.documentElement.dataset.trimDrag = cursorFor(hit.target);
			// the two frames of the cut: their decoders open at the press, the panes show with the drag
			quietly(() => {
				twoUpPlayer.begin(editor, "drag");
				twoUpPlayer.warm("drag", twoUpOf({ tracks: session.tracks, target: twoUpTarget(hit.target), frame: gesture.frame }));
			});
		}
		this.setCursor(scroller, null);
		for (const listener of this.dragListeners) listener();
	}

	private schedule: () => void = () => {};

	private onMove(event: MouseEvent): void {
		const gesture = this.gesture;
		if (!gesture) return;
		// The button was let go where no mouseup reached us (outside the window): the trim ends where it was last dragged
		// with the button down — never where the pointer comes back (nobody let go there; tlc C1c).
		if (event.buttons === 0) {
			this.onUp(event, true);
			return;
		}
		gesture.x = event.clientX;
		gesture.y = event.clientY;
		gesture.noSnap = event.shiftKey || event.metaKey;
		gesture.moved = Math.max(gesture.moved, Math.abs(event.clientX - gesture.startX));
		this.schedule();
	}

	/** The clips' edges, the playhead, markers and keyframes a moving edge snaps to — on frames only (rule 1). */
	private snapPoints(gesture: Gesture, session: TrimSession): SnapPoint[] {
		const { editor } = this.deps;
		const fps = editor.project.getActiveOrNull()?.settings.fps;
		const tracks = session.tracks;
		if (!fps) return [];
		const moving = new Set(session.range.ids);
		// What Linkage moves with the main track's clips is no fixed point either: the items that start over them.
		if (gesture.hit.target.trackId === tracks.main.id) {
			// (the clips a trim can change lie side by side: one stretch of the film, found in one pass)
			let from = Number.POSITIVE_INFINITY;
			let to = Number.NEGATIVE_INFINITY;
			for (const element of tracks.main.elements as TimelineElement[]) {
				if (!moving.has(element.id)) continue;
				from = Math.min(from, element.startTime);
				to = Math.max(to, element.startTime + element.duration);
			}
			for (const track of [...tracks.overlay, ...tracks.audio]) {
				for (const item of track.elements as TimelineElement[]) {
					if (item.startTime >= from && item.startTime < to) moving.add(item.id);
				}
			}
		}
		return [
			...getElementEdgeSnapPoints({ tracks, excludeElementIds: moving }),
			{ time: editor.playback.getCurrentTime(), type: "playhead" as const },
			...getMarkerSnapPoints(),
			...getAnimationKeyframeSnapPointsForTimeline({ tracks, excludeElementIds: moving }),
		]
			.filter((point) => isOnFrame(point.time, fps))
			.sort((a, b) => a.time - b.time);
	}

	/**
	 * One update of the trim in the hand. Speed tests read what it costs (test/ideal-pro-trim-perf.mjs sets
	 * `window.__trimStats = { ticks: [] }`): nothing is measured unless they ask.
	 */
	private tick(): void {
		const stats = (window as { __trimStats?: { ticks: number[] } }).__trimStats;
		if (!stats) {
			this.update();
			return;
		}
		const started = performance.now();
		this.update();
		stats.ticks.push(performance.now() - started);
	}

	private update(): void {
		const gesture = this.gesture;
		const scroller = this.deps.getScroller();
		if (!gesture || !scroller || gesture.moved < DRAG_THRESHOLD_PX) return;
		const { editor } = this.deps;
		const fps = editor.project.getActiveOrNull()?.settings.fps;
		const ui = useTrimUi.getState();
		const kind = gesture.hit.target.kind;
		if (!gesture.session || !fps) {
			if (fps) ui.setReadout({ kind, delta: 0, frame: gesture.frame, fps, limit: null, x: gesture.x, y: gesture.y, note: "This clip has no file to slip in" });
			return;
		}
		const pps = this.deps.getPps();
		const raw = Math.round(((gesture.x - gesture.startX + (scroller.scrollLeft - gesture.startScroll)) / pps) * TICKS_PER_SECOND);
		let delta = raw;
		let snap: SnapPoint | null = null;
		const anchors = gesture.session.range.anchors;
		if (anchors.length > 0 && !gesture.noSnap && useTimelineStore.getState().snappingEnabled) {
			gesture.points ??= this.snapPoints(gesture, gesture.session);
			const reach = (SNAP_PX / pps) * TICKS_PER_SECOND;
			let nearest = Number.POSITIVE_INFINITY;
			for (const anchor of anchors) {
				const point = nearestPoint(gesture.points, anchor + raw, reach);
				if (!point) continue;
				const distance = Math.abs(point.time - (anchor + raw));
				if (distance < nearest) {
					nearest = distance;
					delta = point.time - anchor;
					snap = point;
				}
			}
		}
		const session = gesture.session;
		const result = session.update(delta, { exact: snap !== null, linked: gesture.liveLinkage });
		if (!result) {
			this.cancel();
			return;
		}
		if (!gesture.liveLinkage) {
			// a long film: the titles and captions over the trimmed clips take their places when the hand rests
			if (gesture.rest) clearTimeout(gesture.rest);
			gesture.rest = setTimeout(() => {
				gesture.rest = null;
				if (this.gesture === gesture) session.settle();
			}, REST_MS);
		}
		// A snap point the limits do not allow is not reached: no line, no tap.
		if (snap && result.delta !== delta) snap = null;
		gesture.lastSnap = snap;
		ui.setSnapTime(snap ? snap.time : null);
		hapticTimelineSnap(snap);
		hapticTrimLimit(result.limit !== null);
		ui.setReadout({ kind, delta: result.delta, frame: gesture.frame, fps, limit: result.limit, x: gesture.x, y: gesture.y });
		quietly(() => twoUpPlayer.show("drag", twoUpOf({ tracks: result.tracks, target: twoUpTarget(gesture.hit.target), frame: gesture.frame }), fps));
	}

	/** `lost`: the release happened outside the window (a move came back with no button): the last dragged position counts. */
	private onUp(event: MouseEvent, lost = false): void {
		const gesture = this.gesture;
		if (!gesture) return;
		// The release commits from its own position, at once: no animation frame needs to have run since the press (a
		// busy Mac draws one every 200 ms; a short trim fits between two — tlc C1b).
		if (!lost) gesture.moved = Math.max(gesture.moved, Math.abs(event.clientX - gesture.startX));
		const dragged = gesture.moved >= DRAG_THRESHOLD_PX;
		if (lost && !dragged) {
			this.cancel();
			return;
		}
		if (dragged) {
			if (!lost) gesture.x = event.clientX || gesture.x;
			this.tick();
		}
		const ui = useTrimUi.getState();
		const { editor } = this.deps;
		const target = gesture.hit.target;
		if (dragged) {
			gesture.session?.commit();
			swallowNextClick();
			// With the Trim tool the edge stays picked: «,» «.» and typed numbers go on from where the hand left it.
			if (gesture.tool === "trim" && (target.kind === "roll" || target.kind === "ripple")) {
				editor.selection.clearSelection();
				ui.select(target);
			}
		} else {
			gesture.session?.cancel();
			if (gesture.tool === "trim" && (target.kind === "roll" || target.kind === "ripple")) {
				// a click on an edge or a cut picks it for the keys
				editor.selection.clearSelection();
				ui.select(target);
				swallowNextClick();
			} else if (gesture.tool === "select" && (target.kind === "roll" || target.kind === "ripple") && gesture.hit.pressed && !gesture.hit.onMarker) {
				// As a click on a clip's edge always did (resize-controller.ts, timeline-element.tsx ResizeHandle): on the
				// cut's marker — the transition chip or the «+» — it selects the cut; beside it, the clip (⌘ / ⇧ add it).
				const { trackId, elementId, side } = gesture.hit.pressed;
				if (!selectCutUnder(editor.timeline.getTrackById({ trackId }), elementId, side, event.clientX, event.clientY)) {
					clickSelect(editor, { trackId, elementId }, { range: gesture.range, toggle: gesture.additive && !gesture.range });
				}
			}
			// a click on a clip's body goes on to the clip (it selects it)
		}
		this.finish(gesture);
	}

	private finish(gesture: Gesture): void {
		gesture.stop();
		this.gesture = null;
		this.schedule = () => {};
		delete document.documentElement.dataset.trimDrag;
		hapticTrimLimit(false);
		hapticTimelineSnap(null);
		quietly(() => twoUpPlayer.end("drag"));
		const ui = useTrimUi.getState();
		ui.setSnapTime(null);
		ui.setReadout(null);
		for (const listener of this.dragListeners) listener();
	}
}

/** The click that ends a drag (or picks an edge) must not also select a clip or a cut's marker under the pointer. */
function swallowNextClick(): void {
	const swallow = (event: MouseEvent) => {
		event.stopPropagation();
		event.preventDefault();
		done();
	};
	const done = () => {
		window.removeEventListener("click", swallow, true);
		clearTimeout(timer);
	};
	window.addEventListener("click", swallow, true);
	const timer = setTimeout(done, 0);
}
