import { useEffect, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import { useCommittedRef } from "@/hooks/use-committed-ref";
import { useSnapSuspendKey } from "@/hooks/use-snap-suspend-key";
import { useEdgeAutoScroll } from "@/timeline/hooks/use-edge-auto-scroll";
import { timelineTimeToPixels } from "@/timeline";
import { useTimelineStore } from "@/timeline/timeline-store";
import {
	PlayheadController,
	type PlayheadConfig,
} from "@/timeline/controllers/playhead-controller";
import type { MediaTime } from "@/wasm";

interface UseTimelinePlayheadProps {
	zoomLevel: number;
	rulerRef: React.RefObject<HTMLDivElement | null>;
	rulerScrollRef: React.RefObject<HTMLDivElement | null>;
	tracksScrollRef: React.RefObject<HTMLDivElement | null>;
	playheadRef?: React.RefObject<HTMLDivElement | null>;
	/**
	 * Moves the playhead line on scroll and playback (and auto-scrolls during playback). The timeline mounts this hook
	 * twice (ruler clicks, the playhead handle): only one of them follows playback, or every frame did it twice.
	 */
	followPlayback?: boolean;
}

export function useTimelinePlayhead({
	zoomLevel,
	rulerRef,
	rulerScrollRef,
	tracksScrollRef,
	playheadRef,
	followPlayback = true,
}: UseTimelinePlayheadProps) {
	const editor = useEditor();
	const isShiftHeldRef = useSnapSuspendKey();
	// isScrubbing drives useEdgeAutoScroll — the controller sets it on the editor,
	// so this reactive read naturally reflects whether scrubbing is active.
	const isScrubbing = useEditor((e) => e.playback.getIsScrubbing());

	const config: PlayheadConfig = {
		zoomLevel,
		duration: editor.timeline.getTotalDuration(),
		getActiveProjectFps: () => editor.project.getActive()?.settings.fps ?? null,
		// Read live: the toggle can flip (S) while the playhead is being dragged.
		isSnappingEnabled: () => useTimelineStore.getState().snappingEnabled,
		isShiftHeld: () => isShiftHeldRef.current,
		getIsPlaying: () => editor.playback.getIsPlaying(),
		getRulerEl: () => rulerRef.current,
		getRulerScrollEl: () => rulerScrollRef.current,
		getTracksScrollEl: () => tracksScrollRef.current,
		getPlayheadEl: () => playheadRef?.current ?? null,
		getSceneTracks: () => editor.scenes.getActiveScene().tracks,
		getSceneBookmarks: () => editor.scenes.getActiveScene()?.bookmarks ?? [],
		seek: (time) => editor.playback.seek({ time }),
		setScrubbing: (scrubbing) => {
			// The owner, 17.11: a dragged playhead plays nothing until it is let go — the picture follows the pointer as
			// still frames (the preview already draws those), never as playback.
			if (scrubbing && editor.playback.getIsPlaying()) editor.playback.pause();
			editor.playback.setScrubbing({ isScrubbing: scrubbing });
		},
		setTimelineViewState: ({ zoomLevel, scrollLeft, playheadTime }) =>
			editor.project.setTimelineViewState({
				viewState: {
					zoomLevel,
					scrollLeft,
					playheadTime,
				},
			}),
	};
	const configRef = useCommittedRef(config);
	const [ctrl] = useState(() => new PlayheadController({ configRef }));

	// Scroll → keep playhead position in sync with scroll offset.
	useEffect(() => {
		const scrollEl = rulerScrollRef.current;
		if (!followPlayback || !scrollEl) return;
		const handler = () =>
			ctrl.updatePlayheadLeft(editor.playback.getCurrentTime());
		scrollEl.addEventListener("scroll", handler, { passive: true });
		return () => scrollEl.removeEventListener("scroll", handler);
	}, [ctrl, editor.playback, rulerScrollRef, followPlayback]);

	// Playback events → update playhead position and auto-scroll during playback.
	useEffect(() => {
		if (!followPlayback) return;
		const handler = (time: MediaTime) => ctrl.handlePlaybackUpdate(time);
		ctrl.updatePlayheadLeft(editor.playback.getCurrentTime());
		const unsubscribeUpdate = editor.playback.onUpdate(handler);
		const unsubscribeSeek = editor.playback.onSeek(handler);
		return () => {
			unsubscribeUpdate();
			unsubscribeSeek();
		};
	}, [ctrl, editor.playback, followPlayback]);

	useEdgeAutoScroll({
		// Only the instance whose drag this is: the other one has no pointer position (0 = "at the left edge") and
		// scrolled the view left for the whole scrub, even with the mouse in the middle of the timeline.
		isActive: isScrubbing && ctrl.isActive,
		getMouseClientX: () => ctrl.getLastMouseClientX(),
		rulerScrollRef,
		tracksScrollRef,
		contentWidth: timelineTimeToPixels({
			time: editor.timeline.getTotalDuration(),
			zoomLevel,
		}),
	});

	useEffect(() => () => ctrl.destroy(), [ctrl]);

	return {
		handlePlayheadMouseDown: ctrl.onPlayheadMouseDown,
		handleRulerMouseDown: ctrl.onRulerMouseDown,
	};
}
