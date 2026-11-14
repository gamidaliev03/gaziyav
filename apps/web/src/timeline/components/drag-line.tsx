import { getDropLineY } from "./drop-target";
import type { TimelineTrack, DropTarget } from "@/timeline";
import { TIMELINE_LAYERS } from "./layers";
import { getTracksTopOffset } from "@/timeline/tracks-offset";

interface DragLineProps {
	dropTarget: DropTarget | null;
	tracks: TimelineTrack[];
	isVisible: boolean;
	headerHeight?: number;
}

export function DragLine({
	dropTarget,
	tracks,
	isVisible,
	headerHeight = 0,
}: DragLineProps) {
	if (!isVisible || !dropTarget) return null;

	const y = getDropLineY({ dropTarget, tracks });
	// The stack of tracks may sit lower than the ruler (centred, timeline/tracks-offset.ts).
	const lineTop = y + headerHeight + getTracksTopOffset();

	return (
		<div
			data-drag-line=""
			className="bg-primary pointer-events-none absolute right-0 left-0 h-0.5"
			style={{ top: `${lineTop}px`, zIndex: TIMELINE_LAYERS.dragLine }}
		/>
	);
}
