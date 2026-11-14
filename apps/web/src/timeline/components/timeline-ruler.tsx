import { type JSX } from "react";
import { BASE_TIMELINE_PIXELS_PER_SECOND } from "@/timeline/scale";
import { mediaTimeToSeconds } from "opencut-wasm";
import { TICKS_PER_SECOND } from "@/wasm";
import { TIMELINE_RULER_HEIGHT_PX } from "./layout";
import { DEFAULT_FPS } from "@/fps/defaults";
import { useEditor } from "@/editor/use-editor";
import { getRulerConfig, shouldShowLabel } from "@/timeline/ruler-utils";
import {
	getScrollBucketSize,
	useScrollBucket,
} from "@/timeline/hooks/use-scroll-position";
import { TimelineTick } from "./timeline-tick";
import { InOutRangeOverlay } from "@/in-out/range-overlay";

interface TimelineRulerProps {
	zoomLevel: number;
	dynamicTimelineWidth: number;
	rulerRef: React.Ref<HTMLDivElement>;
	tracksScrollRef: React.RefObject<HTMLElement | null>;
	handleWheel: (e: React.WheelEvent) => void;
	handleTimelineContentClick: (e: React.MouseEvent) => void;
	handleRulerTrackingMouseDown: (e: React.MouseEvent) => void;
	handleRulerMouseDown: (e: React.MouseEvent) => void;
	/** The tracks' virtualization window (px): ticks cover the same range, a zoom step's too (use-render-window.ts). */
	tickWindow?: { startPx: number; endPx: number } | null;
}

export function TimelineRuler({
	zoomLevel,
	dynamicTimelineWidth,
	rulerRef,
	tracksScrollRef,
	handleWheel,
	handleTimelineContentClick,
	handleRulerTrackingMouseDown,
	handleRulerMouseDown,
	tickWindow = null,
}: TimelineRulerProps) {
	const durationTicks = useEditor((e) => e.timeline.getTotalDuration());
	const durationSeconds = mediaTimeToSeconds({ time: durationTicks });
	const pixelsPerSecond = BASE_TIMELINE_PIXELS_PER_SECOND * zoomLevel;
	const visibleDurationSeconds = dynamicTimelineWidth / pixelsPerSecond;
	const effectiveDurationSeconds = Math.max(
		durationSeconds,
		visibleDurationSeconds,
	);
	const fps =
		useEditor((e) => e.project.getActiveOrNull()?.settings.fps) ?? DEFAULT_FPS;
	const { labelIntervalSeconds, tickIntervalSeconds } = getRulerConfig({
		zoomLevel,
		fps,
	});
	const tickCount =
		Math.ceil(effectiveDurationSeconds / tickIntervalSeconds) + 1;

	// The ticks cover the scroll bucket (half a viewport) plus half a viewport on each side, so the ruler
	// re-renders when the scroll crosses a bucket, not on every scroll frame (~90 ticks each time). The
	// margin also covers zoom layout and scroll settling on different frames.
	const { viewportWidth, scrollBucket } = useScrollBucket({
		scrollRef: tracksScrollRef,
	});
	const bucketSize = getScrollBucketSize(viewportWidth);
	const bucketStartPx = scrollBucket * bucketSize;
	const bufferPx = Math.max(300, viewportWidth / 2);

	const visibleStartTimeSeconds = Math.max(
		0,
		(tickWindow ? tickWindow.startPx : bucketStartPx - bufferPx) / pixelsPerSecond,
	);
	const visibleEndTimeSeconds =
		(tickWindow ? tickWindow.endPx : bucketStartPx + bucketSize + viewportWidth + bufferPx) / pixelsPerSecond;

	const startTickIndex = Math.max(
		0,
		Math.floor(visibleStartTimeSeconds / tickIntervalSeconds),
	);
	const endTickIndex = Math.min(
		tickCount - 1,
		Math.ceil(visibleEndTimeSeconds / tickIntervalSeconds),
	);

	const timelineTicks: Array<JSX.Element> = [];
	for (
		let tickIndex = startTickIndex;
		tickIndex <= endTickIndex;
		tickIndex += 1
	) {
		const timeSeconds = tickIndex * tickIntervalSeconds;
		if (timeSeconds > effectiveDurationSeconds) break;

		const timeTicks = Math.round(timeSeconds * TICKS_PER_SECOND);
		const showLabel = shouldShowLabel({
			time: timeSeconds,
			labelIntervalSeconds,
		});
		timelineTicks.push(
			<TimelineTick
				key={tickIndex}
				time={timeTicks}
				timeInSeconds={timeSeconds}
				zoomLevel={zoomLevel}
				fps={fps}
				showLabel={showLabel}
			/>,
		);
	}

	return (
		<div
			role="slider"
			tabIndex={0}
			aria-label="Timeline ruler"
			aria-valuemin={0}
			aria-valuemax={effectiveDurationSeconds}
			aria-valuenow={0}
			className="relative flex-1 overflow-x-visible"
			style={{ height: TIMELINE_RULER_HEIGHT_PX }}
			onWheel={handleWheel}
			onClick={(event) => {
				// Ruler seek already happens on mousedown via playhead scrubbing.
				// Forwarding the follow-up click re-enters the selection-clearing path.
				if (event.target === event.currentTarget) {
					handleTimelineContentClick(event);
				}
			}}
			onMouseDown={handleRulerTrackingMouseDown}
			onKeyDown={() => {}}
		>
			<div
				role="none"
				ref={rulerRef}
				className="relative cursor-default select-none"
				style={{
					height: TIMELINE_RULER_HEIGHT_PX,
					width: `${dynamicTimelineWidth}px`,
				}}
				onMouseDown={handleRulerMouseDown}
			>
				{timelineTicks}
				<InOutRangeOverlay pixelsPerSecond={pixelsPerSecond} />
			</div>
		</div>
	);
}
