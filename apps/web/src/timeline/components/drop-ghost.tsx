import type { DropTarget, TimelineTrack } from "@/timeline";
import type { DropCut, DropGhost as DropGhostData } from "@/timeline/controllers/drag-drop-controller";
import type { DragLanding } from "@/timeline/types";
import { getTrackHeight } from "./track-layout";
import { BASE_TIMELINE_PIXELS_PER_SECOND } from "@/timeline/scale";
import { TICKS_PER_SECOND } from "@/wasm";
import { TIMELINE_LAYERS } from "./layers";

/** A transition's target: a bar this wide over the cut. */
const CUT_BAR_PX = 6;
/** Height of the ghost on the line where a new track opens. */
const NEW_TRACK_GHOST_PX = 18;

/**
 * Where a drag from Media, Finder or a panel lands: a see-through clip of the dropped length on its track, or a
 * thin one on the line where a new track opens. Several files show their total length and a count.
 */
export function DropGhost({
	dropTarget,
	ghost,
	tracks,
	zoomLevel,
	rowTop,
	cut,
}: {
	dropTarget: DropTarget | null;
	ghost: DropGhostData | null;
	/** A transition dragged near a cut: the cut it goes on. */
	cut: DropCut | null;
	tracks: TimelineTrack[];
	zoomLevel: number;
	/** Top of the track row at an index (content px), the same as the rows use. */
	rowTop: (trackIndex: number) => number;
}) {
	const pixelsPerSecond = BASE_TIMELINE_PIXELS_PER_SECOND * zoomLevel;
	if (cut?.layer) {
		const track = tracks[cut.trackIndex];
		if (!track) return null;
		// The whole adjustment layer lights up: the transition goes on it.
		return (
			<div
				data-drop-layer={cut.layer.elementId}
				className="border-primary bg-primary/20 ring-primary/40 pointer-events-none absolute rounded-sm border-2 ring-2"
				style={{
					left: (cut.time / TICKS_PER_SECOND) * pixelsPerSecond,
					top: rowTop(cut.trackIndex),
					width: Math.max(4, (cut.layer.duration / TICKS_PER_SECOND) * pixelsPerSecond),
					height: getTrackHeight({ type: track.type }),
					zIndex: TIMELINE_LAYERS.dragLine,
				}}
			/>
		);
	}
	if (cut) {
		const track = tracks[cut.trackIndex];
		if (!track) return null;
		return (
			<div
				data-drop-cut=""
				className="bg-primary ring-primary/40 pointer-events-none absolute rounded-sm ring-4"
				style={{
					left: (cut.time / TICKS_PER_SECOND) * pixelsPerSecond - CUT_BAR_PX / 2,
					top: rowTop(cut.trackIndex),
					width: CUT_BAR_PX,
					height: getTrackHeight({ type: track.type }),
					zIndex: TIMELINE_LAYERS.dragLine,
				}}
			/>
		);
	}
	if (dropTarget?.targetElement) {
		// An effect / a filter / a mask over a clip: the clip it goes on gets the accent outline, the same language as
		// the layer and cut marks (place-B: a slightly darker clip was too weak to read).
		const { trackId, elementId } = dropTarget.targetElement;
		const index = tracks.findIndex((track) => track.id === trackId);
		const track = tracks[index];
		const element = track?.elements.find((item) => item.id === elementId);
		if (!track || !element) return null;
		return (
			<div
				data-drop-target={elementId}
				className="border-primary bg-primary/15 ring-primary/40 pointer-events-none absolute rounded-sm border-2 ring-2"
				style={{
					left: (element.startTime / TICKS_PER_SECOND) * pixelsPerSecond,
					top: rowTop(index),
					width: Math.max(4, (element.duration / TICKS_PER_SECOND) * pixelsPerSecond),
					height: getTrackHeight({ type: track.type }),
					zIndex: TIMELINE_LAYERS.dragLine,
				}}
			/>
		);
	}
	if (!dropTarget || !ghost) return null;
	const left = (dropTarget.xPosition / TICKS_PER_SECOND) * pixelsPerSecond;
	const width = Math.max(4, (ghost.duration / TICKS_PER_SECOND) * pixelsPerSecond);
	const index = Math.max(0, Math.min(dropTarget.trackIndex, tracks.length));
	const track = tracks[index];
	const onNewTrack = dropTarget.isNewTrack || !track;
	const height = onNewTrack ? NEW_TRACK_GHOST_PX : getTrackHeight({ type: track.type });
	const top = onNewTrack ? rowTop(index) - NEW_TRACK_GHOST_PX / 2 : rowTop(index);
	// height, and the clip's length beside it — the row moves on by that much.
	const insert = dropTarget.insertOnMain && !onNewTrack;
	return (
		<>
		{insert && (
			<div
				data-drop-insert=""
				className="bg-primary ring-primary/40 pointer-events-none absolute rounded-sm ring-2"
				style={{ left: left - CUT_BAR_PX / 2, top: top - 3, width: CUT_BAR_PX, height: height + 6, zIndex: TIMELINE_LAYERS.dragLine + 1 }}
			/>
		)}
		<div
			data-drop-ghost=""
			className="border-primary bg-primary/25 pointer-events-none absolute rounded-sm border-2"
			style={{ left, top, width, height, zIndex: TIMELINE_LAYERS.dragLine }}
		>
			{ghost.count > 1 && (
				<span className="bg-primary text-primary-foreground absolute top-0.5 left-0.5 rounded-sm px-1 text-[10px] leading-4 font-semibold">
					{ghost.count}
				</span>
			)}
		</div>
		</>
	);
}

/**
 * A clip dragged along the timeline: where it lands on release, drawn under the floating clip — on its row, at its
 * start, at its length (the reorder's cut on the main track, the planned move elsewhere), or thin on the line where its
 * new track opens. The same plans the drop commits, so what is shown is where it goes.
 */
export function MoveLanding({
	landing,
	tracks,
	zoomLevel,
	rowTop,
}: {
	landing: readonly DragLanding[];
	tracks: TimelineTrack[];
	zoomLevel: number;
	rowTop: (trackIndex: number) => number;
}) {
	const pixelsPerSecond = BASE_TIMELINE_PIXELS_PER_SECOND * zoomLevel;
	return (
		<>
			{landing.map((spot) => {
				const onNewTrack = spot.newTrackAt !== undefined;
				const index = onNewTrack
					? Math.max(0, Math.min(spot.newTrackAt ?? 0, tracks.length))
					: tracks.findIndex((track) => track.id === spot.trackId);
				const track = tracks[index];
				if (!onNewTrack && !track) return null;
				return (
					<div
						key={spot.elementId}
						data-move-landing={spot.elementId}
						data-move-landing-new-track={onNewTrack ? "" : undefined}
						className="border-primary bg-primary/20 pointer-events-none absolute rounded-sm border-2 border-dashed"
						style={{
							left: (spot.startTime / TICKS_PER_SECOND) * pixelsPerSecond,
							top: onNewTrack ? rowTop(index) - NEW_TRACK_GHOST_PX / 2 : rowTop(index),
							width: Math.max(4, (spot.duration / TICKS_PER_SECOND) * pixelsPerSecond),
							height: onNewTrack || !track ? NEW_TRACK_GHOST_PX : getTrackHeight({ type: track.type }),
							zIndex: TIMELINE_LAYERS.dragLine - 1,
						}}
					/>
				);
			})}
		</>
	);
}
