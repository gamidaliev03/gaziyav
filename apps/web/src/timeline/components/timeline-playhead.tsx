"use client";

import { useRef } from "react";
import { useContainerSize } from "@/hooks/use-container-size";
import {
	getCenteredLineLeft,
	TIMELINE_INDICATOR_LINE_WIDTH_PX,
	timelineTimeToSnappedPixels,
} from "@/timeline";
import { useScrollPosition } from "@/timeline/hooks/use-scroll-position";
import { useTimelinePlayhead } from "@/timeline/hooks/use-timeline-playhead";
import {
	addMediaTime,
	maxMediaTime,
	mediaTime,
	subMediaTime,
	TICKS_PER_SECOND,
	ZERO_MEDIA_TIME,
} from "@/wasm";
import { useEditor } from "@/editor/use-editor";
import { TIMELINE_SCROLLBAR_SIZE_PX } from "./layout";
import { TIMELINE_LAYERS } from "./layers";

interface TimelinePlayheadProps {
	zoomLevel: number;
	hasHorizontalScrollbar: boolean;
	rulerRef: React.RefObject<HTMLDivElement | null>;
	rulerScrollRef: React.RefObject<HTMLDivElement | null>;
	tracksScrollRef: React.RefObject<HTMLDivElement | null>;
	timelineRef: React.RefObject<HTMLDivElement | null>;
	playheadRef?: React.RefObject<HTMLDivElement | null>;
	isSnappingToPlayhead?: boolean;
}

export function TimelinePlayhead({
	zoomLevel,
	hasHorizontalScrollbar,
	rulerRef,
	rulerScrollRef,
	tracksScrollRef,
	timelineRef,
	playheadRef: externalPlayheadRef,
	isSnappingToPlayhead = false,
}: TimelinePlayheadProps) {
	const editor = useEditor();
	const duration = editor.timeline.getTotalDuration();
	const internalPlayheadRef = useRef<HTMLDivElement>(null);
	const playheadRef = externalPlayheadRef || internalPlayheadRef;

	const { handlePlayheadMouseDown } = useTimelinePlayhead({
		zoomLevel,
		rulerRef,
		rulerScrollRef,
		tracksScrollRef,
		playheadRef,
	});
	const { height: timelineHeight } = useContainerSize({ containerRef: timelineRef });
	const { height: tracksHeight } = useContainerSize({
		containerRef: tracksScrollRef,
	});
	const { scrollLeft } = useScrollPosition({ scrollRef: tracksScrollRef });

	const timelineContainerHeight =
		timelineHeight || tracksHeight || 400;
	const totalHeight = Math.max(
		0,
		timelineContainerHeight -
			(hasHorizontalScrollbar ? TIMELINE_SCROLLBAR_SIZE_PX - 5 : 0),
	);

	const currentTime = editor.playback.getCurrentTime();
	const centerPosition = timelineTimeToSnappedPixels({
		time: currentTime,
		zoomLevel,
	});
	const leftPosition =
		getCenteredLineLeft({ centerPixel: centerPosition }) - scrollLeft;

	const handlePlayheadKeyDown = (
		event: React.KeyboardEvent<HTMLButtonElement>,
	) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

		event.preventDefault();
		const fps = editor.project.getActive().settings.fps;
		const ticksPerFrame = mediaTime({
			ticks: Math.round(
				(TICKS_PER_SECOND * fps.denominator) / fps.numerator,
			),
		});
		const direction = event.key === "ArrowRight" ? 1 : -1;
		const now = editor.playback.getCurrentTime();
		const nextTime =
			direction > 0
				? addMediaTime({ a: now, b: ticksPerFrame })
				: subMediaTime({ a: now, b: ticksPerFrame });

		editor.playback.seek({
			time: maxMediaTime({
				a: ZERO_MEDIA_TIME,
				b: duration < nextTime ? duration : nextTime,
			}),
		});
	};

	return (
		// The line takes no pointer (clips under it stay clickable): the slider is its head below, the only part a mouse or
		// the keyboard reaches. With the role on the line, every layout walk found «Timeline playhead» covered by whatever
		// clip lay under its middle (check-flow, 07.11).
		<div
			ref={playheadRef}
			role="group"
			aria-label="Timeline playhead"
			className="pointer-events-none absolute"
			style={{
				// Positioned by transform (see PlayheadController.updatePlayheadLeft).
				left: 0,
				transform: `translate3d(${leftPosition}px, 0, 0)`,
				willChange: "transform",
				top: 0,
				height: `${totalHeight}px`,
				width: `${TIMELINE_INDICATOR_LINE_WIDTH_PX}px`,
				zIndex: TIMELINE_LAYERS.playhead,
			}}
		>
			<div className="bg-primary pointer-events-none absolute left-0 h-full w-0.5" />

			{/* CapCut's head: an upright rounded tab on the ruler, not a dot. ← → step a frame once it has focus. */}
			<button
				type="button"
				role="slider"
				aria-label="Drag playhead"
				aria-valuemin={0}
				aria-valuemax={duration}
				aria-valuenow={currentTime}
				onKeyDown={handlePlayheadKeyDown}
				className={`pointer-events-auto absolute top-0.5 left-1/2 h-3.5 w-2.5 -translate-x-1/2 transform cursor-col-resize rounded-[3px] border-2 shadow-xs ${isSnappingToPlayhead ? "bg-primary border-primary" : "bg-primary border-primary/50"}`}
				onMouseDown={handlePlayheadMouseDown}
			/>
		</div>
	);
}
