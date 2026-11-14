"use client";

import { memo } from "react";
import type { FrameRate } from "opencut-wasm";
import { timelineTimeToSnappedPixels } from "@/timeline";
import { formatRulerLabel } from "@/timeline/ruler-utils";

interface TimelineTickProps {
	time: number;
	timeInSeconds: number;
	zoomLevel: number;
	fps: FrameRate;
	showLabel: boolean;
}

/** Memoized: the ruler re-renders on zoom and scroll; ticks that keep their place skip it. */
export const TimelineTick = memo(function TimelineTick({
	time,
	timeInSeconds,
	zoomLevel,
	fps,
	showLabel,
}: TimelineTickProps) {
	const leftPosition = timelineTimeToSnappedPixels({ time, zoomLevel });

	if (showLabel) {
		const label = formatRulerLabel({ timeInSeconds, fps });
		// A taller tick with its label just after it: a label without its own tick read as belonging to the small tick
		// right after it («00:01|»).
		return (
			<>
				<div
					className="border-muted-foreground/45 absolute top-0.5 h-3 border-l"
					style={{ left: `${leftPosition}px` }}
				/>
				<span
					className="text-muted-foreground/85 absolute top-1 select-none text-[10px] leading-none"
					// «00:00» clears the playhead's cap (10 px wide, centred on 0) when the playhead rests at the start.
					style={{ left: `${leftPosition + (timeInSeconds === 0 ? 8 : 3)}px` }}
				>
					{label}
				</span>
			</>
		);
	}

	return (
		<div
			className="border-muted-foreground/25 absolute top-1.5 h-1.5 border-l"
			style={{ left: `${leftPosition}px` }}
		/>
	);
});
