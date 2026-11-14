"use client";

import { Film01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { touchingEdges } from "@/timeline/trim/touching";
import { useLinkedItemIds } from "@/timeline/hooks/use-linked-items";
import { toast } from "sonner";
import { EditorCore } from "@/core";
import { t } from "@/i18n";
import { LiteClip, TimelineElement, isLiteClipWidth, moveShiftedClips } from "./timeline-element";
import type { TimelineTrack } from "@/timeline";
import type { TimelineElement as TimelineElementType } from "@/timeline";
import { TIMELINE_LAYERS } from "./layers";
import type { ElementDragView } from "@/timeline";
import type { MediaAsset } from "@/media/types";
import { addMediaTime, type MediaTime } from "@/wasm";
import { timelineTimeToPixels } from "@/timeline/pixel-utils";
import { TransitionCutMarkers } from "@/transitions/components/cut-markers";
import { cn } from "@/utils/ui";
import { AssembleEmptyHint } from "@/assemble/components/assemble";
import { RAMP_CLIPS_PER_FRAME, reportWaitingClips, useZoomRamp } from "@/timeline/zoom-ramp";
import { getLiveTimelineViewport } from "@/timeline/live-pps";
import { speedOff } from "@/timeline/speed-flags";
import { useTimelineStore } from "@/timeline/timeline-store";
import { getTimelineElementClassName } from "./theme";
import { DENSE_CLIP_PX, DENSE_MIN_CLIPS, type DenseRun, mergeDenseRuns } from "@/timeline/dense-runs";

type ElementHandler = (params: {
	event: React.MouseEvent;
	element: TimelineElementType;
}) => void;

type ResizeHandler = (params: {
	event: React.MouseEvent;
	element: TimelineElementType;
	track: TimelineTrack;
	side: "left" | "right";
}) => void;

/** Horizontal pixel window of the timeline that should have mounted elements. */
export interface TimelineRenderWindow {
	startPx: number;
	endPx: number;
}

interface TimelineTrackContentProps {
	track: TimelineTrack;
	zoomLevel: number;
	dragView: ElementDragView;
	/** Stable handlers (the element passes itself; the track is looked up). */
	onResizeStart: ResizeHandler;
	onElementMouseDown: ElementHandler;
	onElementClick: ElementHandler;
	onTrackMouseDown?: (event: React.MouseEvent) => void;
	onTrackMouseUp?: (event: React.MouseEvent) => void;
	shouldIgnoreClick?: () => boolean;
	targetElementId?: string | null;
	selectedElementIds: ReadonlySet<string>;
	mediaById: ReadonlyMap<string, MediaAsset>;
	renderWindow: TimelineRenderWindow | null;
	/** The main track: its lane is a shade lighter, as in CapCut. */
	isMain?: boolean;
}

function isElementInWindow({
	element,
	startTime = element.startTime,
	zoomLevel,
	renderWindow,
}: {
	element: TimelineElementType;
	/** Where the clip is drawn when that is not its own start (while it is dragged). */
	startTime?: number;
	zoomLevel: number;
	renderWindow: TimelineRenderWindow | null;
}): boolean {
	if (!renderWindow) return true;
	const left = timelineTimeToPixels({ time: startTime, zoomLevel });
	if (left > renderWindow.endPx) return false;
	const width = timelineTimeToPixels({ time: element.duration, zoomLevel });
	return left + width >= renderWindow.startPx;
}

function TimelineTrackContentImpl({
	track,
	zoomLevel,
	dragView,
	onResizeStart,
	onElementMouseDown,
	onElementClick,
	onTrackMouseDown,
	onTrackMouseUp,
	shouldIgnoreClick,
	targetElementId = null,
	selectedElementIds,
	mediaById,
	renderWindow,
	isMain = false,
}: TimelineTrackContentProps) {
	const dragging = dragView.kind === "dragging" ? dragView : null;
	// Clips a few pixels wide are drawn light (LiteClip, isLiteClipWidth); one that shrinks under that width becomes
	// light at once. While the zoom moves no clip becomes whole: one that is not whole yet — it was narrow, or it has
	// just come into the window — is drawn light until the zoom stops, then they become whole a few per frame
	// (zoom-ramp.ts). The clips drawn whole by the last commit, to know which those are:
	const ramp = useZoomRamp({ trackId: track.id, zoomLevel });
	const wholeIds = useRef<ReadonlySet<string> | null>(null);
	const liteOn = !speedOff("lite");
	const rampOn = liteOn && !speedOff("ramp");
	// Selected and dragged clips used to stay mounted wherever they were: ⌘A on a two-hour film mounted all 2 792
	// clips whole. A clip is mounted where it is drawn — a dragged one where the drag has it now.
	const keepOffscreen = speedOff("offscreen");
	const denseOn = !speedOff("dense");
	// An expanded clip (its keyframe lanes shown) is never drawn as part of a run.
	const expandedElementIds = useTimelineStore((s) => s.expandedElementIds);

	// The edges that lie on a cut: there the Select tool's trim zones meet at the cut (no strip of both, no roll).
	const touching = useMemo(() => touchingEdges(track.elements), [track.elements]);
	// What moves with the selected main clip (its sound, titles, captions): a quiet mark, not a second selection.
	const linkedIds = useLinkedItemIds();
	// Clips that only moved skipped their render (see moveShiftedClips): put them at their new start.
	// After the children's layout effects, so clips that did render already show it.
	useLayoutEffect(() => {
		moveShiftedClips(track.elements);
	}, [track.elements]);

	// What this row draws: the clips in the render window (a dragged one where the drag has it now), and the clips
	// too narrow to have a box together as runs of the track's colour (dense-runs.ts). A run takes no pointer events:
	// a press on it reaches the track (box select, deselect, seek), as a press on a clip that narrow always did; box
	// select works from the data, not the DOM.
	type Shown = { element: TimelineElementType; isSelected: boolean; dragTimeOffset: MediaTime | undefined; dragStartTime: MediaTime | undefined };
	let shown: Shown[] = [];
	for (const element of track.elements) {
		const isSelected = selectedElementIds.has(element.id);
		const dragTimeOffset = dragging?.memberTimeOffsets.get(element.id);
		const dragStartTime = dragging && dragTimeOffset !== undefined ? addMediaTime({ a: dragging.currentTime, b: dragTimeOffset }) : undefined;
		// Virtualization: off-screen elements are not mounted at all.
		if (!(keepOffscreen && (isSelected || dragTimeOffset !== undefined)) && !isElementInWindow({ element, startTime: dragStartTime, zoomLevel, renderWindow })) {
			continue;
		}
		shown.push({ element, isSelected, dragTimeOffset, dragStartTime });
	}
	// Clips too narrow to have a box (under DENSE_CLIP_PX) are drawn as runs of the track's colour, on any track: they
	// showed nothing at all (a two-hour film zoomed to fit was an empty main track with its transitions' chips on it).
	// On a crowded track they are not mounted either — there the selected ones are runs of the selection colour.
	let runs: DenseRun[] = [];
	let selectedRuns: DenseRun[] = [];
	if (denseOn) {
		const crowded = shown.length > DENSE_MIN_CLIPS;
		const mounted: Shown[] = [];
		const spans: Array<{ left: number; right: number }> = [];
		const selectedSpans: Array<{ left: number; right: number }> = [];
		for (const item of shown) {
			const { element } = item;
			const width = timelineTimeToPixels({ time: element.duration, zoomLevel });
			// a dragged clip floats with the pointer: it is drawn as itself
			if (width >= DENSE_CLIP_PX || item.dragTimeOffset !== undefined) {
				mounted.push(item);
				continue;
			}
			const left = timelineTimeToPixels({ time: element.startTime, zoomLevel });
			spans.push({ left, right: left + width });
			if (!crowded || element.id === targetElementId || expandedElementIds.has(element.id)) mounted.push(item);
			else if (item.isSelected) selectedSpans.push({ left, right: left + width });
		}
		if (spans.length > 0) {
			shown = mounted;
			runs = mergeDenseRuns(spans);
			selectedRuns = mergeDenseRuns(selectedSpans);
		}
	}

	// Which of the clips are drawn light. `wholeIds` is null on this track's first draw (a project or a timeline just
	// opened): everything wide enough is whole at once, as at rest.
	const lightIds = new Set<string>();
	let stillWaiting = 0;
	if (liteOn) {
		const holdBack = rampOn && ramp.moving && wholeIds.current !== null;
		const waitingClips: Shown[] = [];
		for (const item of shown) {
			const { element } = item;
			if (expandedElementIds.has(element.id)) continue; // its keyframe lanes show whatever its width
			if (isLiteClipWidth({ element, zoomLevel })) lightIds.add(element.id);
			else if (holdBack && item.dragTimeOffset === undefined && !wholeIds.current?.has(element.id)) waitingClips.push(item);
		}
		if (waitingClips.length > 0) {
			let allowed = 0;
			if (ramp.ramping) {
				// the nearest to the middle of the view first
				const { left, width } = getLiveTimelineViewport();
				const middle = left + width / 2;
				const distance = (item: Shown) =>
					Math.abs(timelineTimeToPixels({ time: item.element.startTime + item.element.duration / 2, zoomLevel }) - middle);
				waitingClips.sort((a, b) => distance(a) - distance(b));
				allowed = RAMP_CLIPS_PER_FRAME;
			}
			for (let index = allowed; index < waitingClips.length; index++) lightIds.add(waitingClips[index].element.id);
			stillWaiting = Math.max(0, waitingClips.length - allowed);
		}
	}
	// After every commit: which clips are whole now, and how many still wait (the ramp goes on while any track has some).
	useLayoutEffect(() => {
		const whole = new Set<string>();
		for (const item of shown) if (!lightIds.has(item.element.id)) whole.add(item.element.id);
		wholeIds.current = whole;
		reportWaitingClips(track.id, stillWaiting);
	});

	return (
		// Each row is a lane (design review 05.11: clips floated on one flat black): a faint band, the main one lighter, and
		// a hairline under it drawn as its own layer under the clips, so no clip loses a pixel of height to a border.
		<div className={cn("relative size-full", isMain ? "bg-foreground/[0.035]" : "bg-foreground/[0.015]")}>
			<div aria-hidden className="bg-foreground/5 pointer-events-none absolute inset-x-0 bottom-0 h-px" />
			{/* For the keyboard only (Tab reaches the track): the clips' layer above takes every pointer event, so the
			    pointer goes through this one instead of finding a button it can't press. */}
			<button
				type="button"
				className="pointer-events-none absolute inset-0 m-0 size-full appearance-none border-0 bg-transparent p-0"
				aria-label={`Select ${/track$/i.test(track.name) ? track.name : `${track.name} track`}`}
			/>
			{/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- spatial gesture surface; the wrapping <button> handles keyboard track selection, this <div> only forwards background clicks for box-select / deselect. */}
			<div
				className="relative h-full min-w-full"
				style={{ zIndex: TIMELINE_LAYERS.trackContent }}
				onMouseUp={(event) => {
					if (event.target !== event.currentTarget) return;
					if (shouldIgnoreClick?.()) return;
					onTrackMouseUp?.(event);
				}}
				onMouseDown={(event) => {
					if (event.target !== event.currentTarget) return;
					event.preventDefault();
					onTrackMouseDown?.(event);
				}}
			>
				{track.elements.length === 0 ? (
					// CapCut's empty main track: a dashed box, a film icon and its words, on the left.
					<div className="text-muted-foreground border-muted/40 pointer-events-none flex size-full items-center gap-2.5 rounded-sm border border-dashed px-7 text-xs">
						{/* the dashed box and its film icon say it (the owner, 12.11: nothing said twice — Media says «Drop files») */}
						<HugeiconsIcon icon={Film01Icon} className="size-4 shrink-0" aria-hidden />
						{isMain && <AssembleEmptyHint />}
					</div>
				) : (
					shown.map(({ element, isSelected, dragTimeOffset, dragStartTime }) => {
						const isBeingDragged = dragTimeOffset !== undefined;
						const dragOffsetY = dragging && isBeingDragged ? dragging.currentMouseY - dragging.startMouseY : undefined;
						if (lightIds.has(element.id)) {
							return (
								<LiteClip
									key={element.id}
									element={element}
									trackId={track.id}
									track={track}
									touch={touching.get(element.id)}
									linked={linkedIds.has(element.id)}
									onResizeStart={onResizeStart}
									isSelected={isSelected}
									onElementMouseDown={onElementMouseDown}
									onElementClick={onElementClick}
									dragStartTime={dragStartTime}
									dragOffsetY={dragOffsetY}
									isDropTarget={element.id === targetElementId}
								/>
							);
						}
						return (
							<TimelineElement
								key={element.id}
								element={element}
								track={track}
								touch={touching.get(element.id)}
								linked={linkedIds.has(element.id)}
								zoomLevel={zoomLevel}
								isSelected={isSelected}
								onResizeStart={onResizeStart}
								onElementMouseDown={onElementMouseDown}
								onElementClick={onElementClick}
								mediaAsset={
									"mediaId" in element && typeof element.mediaId === "string"
										? (mediaById.get(element.mediaId) ?? null)
										: null
								}
								dragStartTime={dragStartTime}
								dragOffsetY={dragOffsetY}
								isDropTarget={element.id === targetElementId}
							/>
						);
					})
				)}
				{runs.map((run, index) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: runs are redrawn whole on every change; a kept node only gets a new place
						key={`dense:${index}`}
						data-dense-clips={run.count}
						aria-hidden
						className={cn("pointer-events-none absolute inset-y-0 rounded-[1px]", getTimelineElementClassName({ type: track.type }))}
						style={{ left: run.left, width: Math.max(1, run.right - run.left) }}
					/>
				))}
				{selectedRuns.map((run, index) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: as the runs above
						key={`dense-selected:${index}`}
						data-dense-selected={run.count}
						aria-hidden
						// A selected clip that narrow showed as its 1.5 px ring on each side of no box: a 3 px bar of the ring's colour.
						className="bg-primary pointer-events-none absolute inset-y-0 rounded-[1px]"
						style={{ left: run.left, width: Math.max(3, run.right - run.left) }}
					/>
				))}
				{track.type === "video" && !dragging && (
					<TransitionCutMarkers track={track} zoomLevel={zoomLevel} />
				)}
				{/* 🔒 locked track (CapCut): hatched, and its clips take no clicks, drags or trims. */}
				{track.locked && (
					<div
						data-track-locked
						aria-hidden
						className="absolute inset-0 z-30 cursor-not-allowed rounded-sm bg-[repeating-linear-gradient(135deg,rgba(0,0,0,0.38)_0,rgba(0,0,0,0.38)_4px,transparent_4px,transparent_9px)]"
						onMouseDown={(event) => {
							event.preventDefault();
							event.stopPropagation();
							// blind3 F2: a click here selects nothing AND clears the selection, so Delete never removes a clip the
							// editor is not looking at; one quiet line says why.
							if (event.button !== 0) return;
							EditorCore.getInstance().selection.clearSelection();
							toast(t("Track locked"), { id: "track-locked", duration: 1400 });
						}}
						onClick={(event) => event.stopPropagation()}
						onDoubleClick={(event) => event.stopPropagation()}
					/>
				)}
			</div>
		</div>
	);
}

export const TimelineTrackContent = memo(TimelineTrackContentImpl);
