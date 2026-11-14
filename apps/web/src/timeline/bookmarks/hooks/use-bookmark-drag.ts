import { useState, useCallback, useEffect, useRef, type RefObject } from "react";
import { useEditor } from "@/editor/use-editor";
import { useShiftKey } from "@/hooks/use-shift-key";
import { TIMELINE_DRAG_THRESHOLD_PX } from "@/timeline/components/interaction";
import { getMouseTimeFromClientX } from "@/timeline/drag-utils";
import {
	buildTimelineSnapPoints,
	getTimelineSnapThresholdInTicks,
	resolveTimelineSnap,
	type SnapPoint,
} from "@/timeline/snapping";
import { getElementEdgeSnapPoints } from "@/timeline/element-snap-source";
import { getPlayheadSnapPoints } from "@/timeline/playhead-snap-source";
import { getAnimationKeyframeSnapPointsForTimeline } from "@/timeline/animation-snap-points";
import type { Bookmark, SceneTracks } from "@/timeline";
import { roundFrameTime, type MediaTime, TICKS_PER_SECOND, ZERO_MEDIA_TIME } from "@/wasm";
import { resolveBookmarkDrop } from "../utils";

export interface BookmarkDragState {
	isDragging: boolean;
	bookmarkTime: MediaTime | null;
	currentTime: MediaTime;
}

const IDLE: BookmarkDragState = { isDragging: false, bookmarkTime: null, currentTime: ZERO_MEDIA_TIME };

/**
 * What a dragged marker snaps to: clip edges, the playhead and keyframes. Not the other markers:
 * snapping onto one put two markers on the same frame (drawn as one, M removed only one).
 */
export function getBookmarkDragSnapPoints({
	tracks,
	playheadTime,
}: {
	tracks: SceneTracks;
	playheadTime: MediaTime;
}): SnapPoint[] {
	return buildTimelineSnapPoints({
		sources: [
			() => getElementEdgeSnapPoints({ tracks }),
			() => getPlayheadSnapPoints({ playheadTime }),
			() => getAnimationKeyframeSnapPointsForTimeline({ tracks }),
		],
	});
}

interface UseBookmarkDragProps {
	zoomLevel: number;
	scrollRef: RefObject<HTMLElement | null>;
	snappingEnabled: boolean;
	onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
}

export function useBookmarkDrag({
	zoomLevel,
	scrollRef,
	snappingEnabled,
	onSnapPointChange,
}: UseBookmarkDragProps) {
	const editor = useEditor();
	const isShiftHeldRef = useShiftKey();
	const tracks = editor.scenes.getActiveScene().tracks;
	const playheadTime = editor.playback.getCurrentTime();
	const duration = editor.timeline.getTotalDuration();

	const [dragState, setDragState] = useState<BookmarkDragState>(IDLE);
	const lastMouseXRef = useRef(0);

	const getSnapResult = ({ rawTime }: { rawTime: MediaTime }): { snappedTime: MediaTime; snapPoint: SnapPoint | null } => {
		const shouldSnap = snappingEnabled && !isShiftHeldRef.current;
		if (!shouldSnap) {
			return { snappedTime: rawTime, snapPoint: null };
		}
		const result = resolveTimelineSnap({
			targetTime: rawTime,
			snapPoints: getBookmarkDragSnapPoints({ tracks, playheadTime }),
			maxSnapDistance: getTimelineSnapThresholdInTicks({ zoomLevel }),
		});
		return { snappedTime: result.snappedTime, snapPoint: result.snapPoint };
	};

	// The press adds its own listeners and they read the latest render from here. They used to be added by effects
	// after React re-rendered: a release that came before that (a quick flick, a busy page) was lost — the marker
	// didn't move, landed one move short, or stayed on the pointer after the button was up.
	const latestRef = useRef({ zoomLevel, duration, getSnapResult, onSnapPointChange });
	latestRef.current = { zoomLevel, duration, getSnapResult, onSnapPointChange };
	const endPressRef = useRef<(() => void) | null>(null);
	useEffect(() => () => endPressRef.current?.(), []);

	const timeAt = useCallback(
		(clientX: number) => {
			const scrollContainer = scrollRef.current;
			const activeProject = editor.project.getActive();
			if (!scrollContainer || !activeProject) return null;
			const latest = latestRef.current;
			const mouseTime = getMouseTimeFromClientX({
				clientX,
				containerRect: scrollContainer.getBoundingClientRect(),
				zoomLevel: latest.zoomLevel,
				scrollLeft: scrollContainer.scrollLeft,
			});
			const clampedTime = mouseTime > latest.duration ? latest.duration : mouseTime;
			return latest.getSnapResult({ rawTime: roundFrameTime({ time: clampedTime, fps: activeProject.settings.fps }) });
		},
		[editor, scrollRef],
	);

	const handleBookmarkMouseDown = useCallback(
		({ event, bookmark }: { event: React.MouseEvent; bookmark: Bookmark }) => {
			if (event.button !== 0) return;

			event.preventDefault();
			event.stopPropagation();
			endPressRef.current?.();

			const fromTime = bookmark.time;
			const startX = event.clientX;
			const startY = event.clientY;
			let dragging = false;
			let currentTime = fromTime;
			// A scene mark (src/chapters) never passes its neighbouring scene marks: it stays a frame inside them.
			const marks = bookmark.chapter ? editor.scenes.getActiveScene().bookmarks.filter((b) => b.chapter && b.time !== fromTime).map((b) => b.time as number) : [];
			const fpsNow = editor.project.getActiveOrNull()?.settings.fps;
			const frame = fpsNow ? Math.round((TICKS_PER_SECOND * fpsNow.denominator) / fpsNow.numerator) : 0;
			const lowest = Math.max(0, ...marks.filter((t) => t < fromTime)) + (marks.some((t) => t < fromTime) ? frame : 0);
			const highest = Math.min(Number.POSITIVE_INFINITY, ...marks.filter((t) => t > fromTime)) - frame;
			const keep = (t: MediaTime): MediaTime => (bookmark.chapter ? (Math.min(highest, Math.max(lowest, t)) as MediaTime) : t);

			const end = () => {
				document.removeEventListener("mousemove", onMove);
				document.removeEventListener("mouseup", onUp);
				endPressRef.current = null;
				setDragState(IDLE);
				latestRef.current.onSnapPointChange?.(null);
			};
			// Where the button came up (CapCut: the marker lands under the pointer), not the last move drawn.
			const finish = (clientX: number) => {
				const at = dragging ? (timeAt(clientX)?.snappedTime ?? currentTime) : null;
				const landed = at === null ? null : keep(at);
				end();
				if (landed === null) return;
				const latestDuration = latestRef.current.duration;
				const clampedTime = landed > latestDuration ? latestDuration : landed;
				const fps = editor.project.getActiveOrNull()?.settings.fps;
				// Back on its own frame (a nudge under a frame, or a snap back to the playhead): nothing
				// moved, so no undo step.
				const toTime = fps ? resolveBookmarkDrop({ fromTime, toTime: clampedTime, fps }) : clampedTime;
				if (toTime !== null) editor.scenes.moveBookmark({ fromTime, toTime });
			};
			const onMove = (moveEvent: MouseEvent) => {
				lastMouseXRef.current = moveEvent.clientX;
				// The button is no longer held (released outside the window): it ends here, as on a release.
				if ((moveEvent.buttons & 1) === 0) {
					finish(moveEvent.clientX);
					return;
				}
				if (
					!dragging &&
					Math.abs(moveEvent.clientX - startX) <= TIMELINE_DRAG_THRESHOLD_PX &&
					Math.abs(moveEvent.clientY - startY) <= TIMELINE_DRAG_THRESHOLD_PX
				) {
					return;
				}
				const snap = timeAt(moveEvent.clientX);
				if (!snap) return;
				dragging = true;
				currentTime = keep(snap.snappedTime);
				setDragState({ isDragging: true, bookmarkTime: fromTime, currentTime });
				latestRef.current.onSnapPointChange?.(snap.snapPoint);
			};
			const onUp = (upEvent: MouseEvent) => finish(upEvent.clientX);

			document.addEventListener("mousemove", onMove);
			document.addEventListener("mouseup", onUp);
			endPressRef.current = end;
		},
		[editor, timeAt],
	);

	return {
		dragState,
		handleBookmarkMouseDown,
		lastMouseXRef,
	};
}
