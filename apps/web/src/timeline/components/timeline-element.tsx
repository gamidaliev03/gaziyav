"use client";

import { ClipProgress } from "@/jobs/components/clip-progress";
import { DEMO } from "@/demo/flag";
import { ClipLipsync } from "@/studio/components/clip-lipsync";
import { isMographKind } from "@/montage/mograph";
import { EditorCore } from "@/core";
import { openExportClips } from "@/components/editor/export-button";
import {
	createContext,
	memo,
	useContext,
	useLayoutEffect,
	useRef,
} from "react";
import { useEditor } from "@/editor/use-editor";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { AudioWaveform, WAVEFORM_GAIN_SAMPLE_COUNT } from "./audio-waveform";
import { TIMELINE_LAYERS } from "./layers";
import { VideoFilmstrip } from "@/timeline/filmstrip/video-filmstrip";
import { AudioVolumeLine } from "./audio-volume-line";
import { FadeHandles } from "./fade-handles";
import { useElementPreviewOverride } from "@/timeline/hooks/use-element-preview";
import {
	useKeyframeDrag,
	type KeyframeDragState,
} from "@/timeline/hooks/element/use-keyframe-drag";
import { useKeyframeSelection } from "@/timeline/hooks/element/use-keyframe-selection";
import { useKeyframeBoxSelect } from "@/timeline/hooks/element/use-keyframe-box-select";
import { SelectionBox } from "@/selection/selection-box";
import { getElementKeyframes } from "@/animation";
import {
	canElementHaveAudio,
	canElementBeHidden,
	hasElementEffects,
	hasMediaId,
	timelineTimeToPixels,
	timelineTimeToSnappedPixels,
} from "@/timeline";
import { getTrackHeight } from "./track-layout";
import {
	getTimelineElementClassName,
	TIMELINE_AUDIO_WAVEFORM_COLOR,
	TIMELINE_TRACK_THEME,
} from "./theme";
import { doesElementHaveEnabledAudio } from "@/timeline/audio-separation";
import { useDuckedGainSamples } from "@/sounds/mix/use-duck-gain";
import {
	ContextMenuItem,
	ContextMenuSeparator,
} from "@/components/ui/context-menu";
import type { SelectionBoxBounds } from "@/selection/types";
import type {
	TimelineElement as TimelineElementType,
	TimelineTrack,
	VideoElement,
	ImageElement,
	AudioElement,
} from "@/timeline";
import type { MediaAsset } from "@/media/types";
import { mediaSupportsAudio } from "@/media/media-utils";
import {
	canToggleSourceAudio,
	getSourceAudioActionLabel,
} from "@/timeline/audio-separation";
import {
	buildWaveformGainSamples,
	isElementMuted,
	resolveEffectiveAudioGain,
} from "@/timeline/audio-state";
import { getTimelinePixelsPerSecond } from "@/timeline";
import {
	getLivePixelsPerSecond,
	getLiveTimelineViewport,
	notifyClipsMoved,
} from "@/timeline/live-pps";
import { buildWaveformSourceKey } from "@/media/waveform-summary";
import { type MediaTime, roundFrameTicks, TICKS_PER_SECOND } from "@/wasm";
import { formatFrameTimecode } from "@/fps/timecode";
import { useAttributesClipboard } from "@/actions/attributes-clipboard";
import {
	isActionWithOptionalArgs,
	type TAction,
	type TActionWithOptionalArgs,
	invokeAction,
} from "@/actions";
import { getActionShortcutLabel } from "@/actions/keybindings-store";
import { actionName } from "@/actions/names";
import { useT } from "@/i18n";
import { useElementSelection } from "@/timeline/hooks/element/use-element-selection";
import { resolveStickerId } from "@/stickers";
import { buildGraphicPreviewUrl } from "@/graphics";
import Image from "next/image";
import {
	ScissorIcon,
	GroupItemsIcon,
	Layers01Icon,
	Delete02Icon,
	Download04Icon,
	Copy01Icon,
	ViewIcon,
	ViewOffSlashIcon,
	VolumeHighIcon,
	VolumeOffIcon,
	Search01Icon,
	KeyframeIcon,
	MagicWand05Icon,
	ArrowLeftRightIcon,
	AlignLeftIcon,
	AlignRightIcon,
	ScissorRectangleIcon,
	ClipboardIcon,
	Unlink02Icon,
	SilenceIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { removePausesInClip } from "@/silence/clip";
import { getTransitionDefinition } from "@/transitions/definitions";
import { selectCutUnder } from "@/transitions/components/cut-markers";
import { useMemo, type ComponentProps, type ReactNode } from "react";
import type { SelectedKeyframeRef, ElementKeyframe } from "@/animation/types";
import { cn } from "@/utils/ui";
import { AiBadge, CompositionElementMenuItem, handleCompositionDoubleClick } from "@/montage/components/timeline-menu";
import { elementKind } from "@/components/editor/panels/properties/registry";
import { MotionMenuItems } from "@/motion/components/menu-items";
import { SavePresetMenuItem } from "@/presets/components/save-preset-menu-item";
import { LipsyncMenuItem } from "@/studio/components/lipsync-menu-item";
import { AssistClipMenuItems } from "@/assist/components/assist-menu";
import { PartsMenuItems } from "@/hear/components/parts-menu";
import { SyncMenuItems } from "@/sound/sync/menu";
import { usePropertiesStore } from "@/components/editor/panels/properties/stores/properties-store";
import { getTrackTypeForElementType } from "@/timeline/placement/compatibility";
import { useTimelineStore } from "@/timeline/timeline-store";
import { MissingLibraryBadge } from "@/library/components/missing-badge";
import { OfflineMediaBadge } from "@/relink/offline-badge";
import { KEYFRAME_LANE_HEIGHT_PX } from "./layout";
import {
	getExpandedRows,
	getExpansionHeight,
	type ExpandedRow,
} from "./expanded-layout";


const KEYFRAME_INDICATOR_MIN_WIDTH_PX = 40;
const ELEMENT_RING_WIDTH_PX = 1.5;

const PixelsPerSecondContext = createContext<number | null>(null);
const THUMBNAIL_ASPECT_RATIO = 16 / 9;

interface KeyframeIndicator {
	time: MediaTime;
	offsetPx: number;
	keyframes: SelectedKeyframeRef[];
}

export function buildKeyframeIndicator({
	keyframe,
	trackId,
	elementId,
	displayedStartTime,
	zoomLevel,
	elementLeft,
}: {
	keyframe: ElementKeyframe;
	trackId: string;
	elementId: string;
	displayedStartTime: MediaTime;
	zoomLevel: number;
	elementLeft: number;
}): {
	time: MediaTime;
	offsetPx: number;
	keyframeRef: SelectedKeyframeRef;
} {
	const keyframeRef = {
		trackId,
		elementId,
		propertyPath: keyframe.propertyPath,
		keyframeId: keyframe.id,
	};
	const keyframeLeft = timelineTimeToSnappedPixels({
		time: displayedStartTime + keyframe.time,
		zoomLevel,
	});
	return {
		time: keyframe.time,
		offsetPx: keyframeLeft - elementLeft,
		keyframeRef,
	};
}

export function getKeyframeIndicators({
	keyframes,
	trackId,
	elementId,
	displayedStartTime,
	zoomLevel,
	elementLeft,
	elementWidth,
}: {
	keyframes: ElementKeyframe[];
	trackId: string;
	elementId: string;
	displayedStartTime: MediaTime;
	zoomLevel: number;
	elementLeft: number;
	elementWidth: number;
}): KeyframeIndicator[] {
	if (elementWidth < KEYFRAME_INDICATOR_MIN_WIDTH_PX) {
		return [];
	}

	const keyframesByTime = new Map<MediaTime, KeyframeIndicator>();
	for (const keyframe of keyframes) {
		const indicator = buildKeyframeIndicator({
			keyframe,
			trackId,
			elementId,
			displayedStartTime,
			zoomLevel,
			elementLeft,
		});
		const existingIndicator = keyframesByTime.get(indicator.time);
		if (!existingIndicator) {
			keyframesByTime.set(indicator.time, {
				time: indicator.time,
				offsetPx: indicator.offsetPx,
				keyframes: [indicator.keyframeRef],
			});
			continue;
		}

		existingIndicator.keyframes.push(indicator.keyframeRef);
	}

	return [...keyframesByTime.values()].sort((a, b) => a.time - b.time);
}

export function getDisplayShortcut({ action }: { action: TAction }) {
	return isActionWithOptionalArgs(action) ? getActionShortcutLabel({ action }) : "";
}

interface TimelineElementProps {
	element: TimelineElementType;
	track: TimelineTrack;
	/** Its edges that lie on a cut (trim/touching.ts): the trim zones there end at the cut. */
	touch?: string;
	/** It moves with the selected main clip (timeline/linked-items.ts): a quiet dashed mark. */
	linked?: boolean;
	zoomLevel: number;
	isSelected: boolean;
	onResizeStart: (params: {
		event: React.MouseEvent;
		element: TimelineElementType;
		track: TimelineTrack;
		side: "left" | "right";
	}) => void;
	onElementMouseDown: (params: {
		event: React.MouseEvent;
		element: TimelineElementType;
	}) => void;
	onElementClick: (params: {
		event: React.MouseEvent;
		element: TimelineElementType;
	}) => void;
	/** Media asset of this element (resolved once by the parent). */
	mediaAsset?: MediaAsset | null;
	/** Start time while this element is being dragged (undefined otherwise). */
	dragStartTime?: MediaTime;
	/** Vertical drag offset in px while this element is being dragged. */
	dragOffsetY?: number;
	isDropTarget?: boolean;
	/** The stretches of this clip that another clip shows too, and their colour (timeline/duplicate-sources.ts). */
	duplicate?: { color: string; segments: Array<{ from: number; to: number }> };
}

/** Narrower than this a video clip shows its colour only (the filmstrip's MIN_STRIP_WIDTH_PX: `data-narrow`). */
const LITE_VIDEO_MAX_PX = 24;
/** Narrower than this any other clip has nothing to show or to grab: its trim handles would be under 1.2 px wide. */
const LITE_OTHER_MAX_PX = 6;

/**
 * A clip this narrow on screen is drawn as a box of its colour: mounted whole it was ~20 DOM nodes, two canvases and a
 * dozen subscriptions that CSS then hid (`data-narrow`). Selecting 324 such clips on a two-hour film and pressing ⌫
 * (then ⌘Z, ⇧⌘Z) mounted and unmounted them all: 110–130 ms of React and a 75–90 ms forced layout per step.
 */
export function isLiteClipWidth({ element, zoomLevel }: { element: TimelineElementType; zoomLevel: number }): boolean {
	const width = timelineTimeToPixels({ time: element.duration, zoomLevel });
	return width < (element.type === "video" ? LITE_VIDEO_MAX_PX : LITE_OTHER_MAX_PX);
}

/**
 * Clips that only moved (a ripple after a delete, an undo, a redo: same clip, new start) are not
 * re-rendered: on a 260-clip timeline that was ~230 clip renders per edit. Each mounted plain clip
 * registers a positioner here; the track content calls it after every render with the clip's committed
 * start (moveShiftedClips), and it sets the wrapper's `left` exactly as a render would.
 */
/** Returns the start it moved the clip from, or null when it did not move it. */
type ClipPositioner = (startTime: MediaTime) => MediaTime | null;
const clipPositioners = new Map<string, Set<ClipPositioner>>();

export function moveShiftedClips(elements: readonly TimelineElementType[]): void {
	const pps = getLivePixelsPerSecond();
	const { left, width } = getLiveTimelineViewport();
	const right = left + width;
	// How much of [start, start + duration] is on screen: none, part or all.
	const visibility = (startTime: MediaTime, duration: MediaTime) => {
		const x0 = (startTime / TICKS_PER_SECOND) * pps;
		const x1 = x0 + (duration / TICKS_PER_SECOND) * pps;
		if (x1 <= left || x0 >= right) return 0;
		return x0 >= left && x1 <= right ? 2 : 1;
	};
	const redraw: string[] = [];
	for (const element of elements) {
		const positioners = clipPositioners.get(element.id);
		if (!positioners) continue;
		for (const position of positioners) {
			const previousStart = position(element.startTime);
			if (previousStart === null) continue;
			// A clip that slid into view, out of it, or across an edge draws its waveform's visible part again.
			const before = visibility(previousStart, element.duration);
			const after = visibility(element.startTime, element.duration);
			if (!(pps > 0 && width > 0) || before === 1 || after === 1 || before !== after) {
				redraw.push(element.id);
			}
		}
	}
	if (redraw.length > 0) notifyClipsMoved(redraw);
}

/**
 * A clip is placed by a translation, not by `left`: moving it (a ripple shifts ~230 clips) then only
 * changes its transform, and the browser reuses the clip's painted content instead of repainting every
 * thumbnail and waveform (the frame after a delete spent ~14 ms in Paint). Not rounded: the clip sits
 * exactly where `left` put it (drag ghost and drop positions are compared to the pointer to ½ frame).
 */
function clipTransformStyle(startTime: MediaTime, offsetY?: number): string {
	const x = `calc(${startTime / TICKS_PER_SECOND} * var(--timeline-pps) * 1px)`;
	return offsetY === undefined ? `translateX(${x})` : `translate3d(${x}, ${offsetY}px, 0)`;
}

/** Same clip, only its start differs (a ripple shift). */
function isShiftOnly(
	prev: TimelineElementProps,
	next: TimelineElementProps,
): boolean {
	return (
		prev.element !== next.element &&
		!prev.isSelected &&
		!next.isSelected &&
		prev.dragStartTime === undefined &&
		next.dragStartTime === undefined &&
		!useTimelineStore.getState().expandedElementIds.has(next.element.id) &&
		isSameElementIgnoringStart(prev.element, next.element)
	);
}

function areTimelineElementPropsEqual(
	prev: TimelineElementProps,
	next: TimelineElementProps,
): boolean {
	// The track object changes on every edit; elements only read its id/type.
	// Zoom: left/width come from the --timeline-pps CSS variable, so a plain clip
	// doesn't re-render on zoom; waveforms redraw from the live zoom (live-pps.ts).
	// Selected (keyframes) and expanded (keyframe lanes) clips draw zoom-dependent
	// content and do.
	const zoomMatters =
		next.isSelected ||
		useTimelineStore.getState().expandedElementIds.has(next.element.id);
	return (
		(prev.element === next.element || isShiftOnly(prev, next)) &&
		prev.track.id === next.track.id &&
		prev.track.type === next.track.type &&
		prev.touch === next.touch &&
		prev.linked === next.linked &&
		(!zoomMatters || prev.zoomLevel === next.zoomLevel) &&
		prev.isSelected === next.isSelected &&
		prev.onResizeStart === next.onResizeStart &&
		prev.onElementMouseDown === next.onElementMouseDown &&
		prev.onElementClick === next.onElementClick &&
		prev.mediaAsset === next.mediaAsset &&
		prev.dragStartTime === next.dragStartTime &&
		prev.dragOffsetY === next.dragOffsetY &&
		prev.isDropTarget === next.isDropTarget &&
		prev.duplicate === next.duplicate
	);
}

/** Moves with the selected main clip: a dashed hairline inside the clip, under the selection's ring and the handles. */
const LINKED_MARK_CLASS = "pointer-events-none absolute inset-0 z-[1] rounded-sm outline-dashed outline-1 -outline-offset-1 outline-primary/70";
const CLIP_BODY_STYLE = { display: "contents", "--timeline-pps": "0" } as React.CSSProperties;
const LITE_BOX_STYLE = { left: `${ELEMENT_RING_WIDTH_PX}px`, right: `${ELEMENT_RING_WIDTH_PX}px`, "--timeline-pps": "0" } as React.CSSProperties;
const LITE_BOX_SELECTED_STYLE: React.CSSProperties = { ...LITE_BOX_STYLE, boxShadow: `0 0 0 ${ELEMENT_RING_WIDTH_PX}px var(--primary)` };

export const TimelineElement = memo(
	TimelineElementImpl,
	areTimelineElementPropsEqual,
);

/**
 * The positioned wrapper of a clip. It is the only part that re-renders when a
 * ripple edit shifts the clip (a few cheap hooks); the body below is skipped.
 */
function TimelineElementImpl({
	element,
	track,
	touch,
	linked = false,
	zoomLevel,
	isSelected,
	onResizeStart,
	onElementMouseDown,
	onElementClick,
	mediaAsset = null,
	dragStartTime,
	dragOffsetY = 0,
	isDropTarget = false,
	duplicate,
}: TimelineElementProps) {
	const renderElement =
		useElementPreviewOverride<TimelineElementType>({
			trackId: track.id,
			elementId: element.id,
		}) ?? element;

	const isBeingDragged = dragStartTime !== undefined;
	// The start the positioner last put this clip at (moveShiftedClips). A shift-only change skips this component's
	// render and leaves React holding the old element: a render for another reason (a preview of some other clip,
	// the text typed in the inspector) then drew the clip back at its old place, until the project was reopened
	// (blind test 05.11). A new element from the parent wins again.
	const lastElement = useRef(element);
	const committedStart = useRef<MediaTime | null>(null);
	if (lastElement.current !== element) {
		lastElement.current = element;
		committedStart.current = null;
	}
	const displayedStartTime = isBeingDragged
		? dragStartTime
		: renderElement === element && committedStart.current !== null
			? committedStart.current
			: renderElement.startTime;
	const displayedDuration = renderElement.duration;
	const timelinePixelsPerSecond = getTimelinePixelsPerSecond({ zoomLevel });

	const isExpanded = useTimelineStore((s) =>
		s.expandedElementIds.has(element.id),
	);
	const expandedRows = useMemo(
		() =>
			isExpanded ? getExpandedRows({ animations: element.animations }) : [],
		[isExpanded, element.animations],
	);
	const expansionHeight = getExpansionHeight({ rows: expandedRows });
	const baseTrackHeight = getTrackHeight({ type: track.type });

	// See moveShiftedClips: this clip's `left` as last written (by a render or by the positioner), and
	// whether it follows the committed start (not while dragged or while a preview moves it).
	const wrapperRef = useRef<HTMLDivElement>(null);
	const positionRef = useRef({
		shownStart: displayedStartTime,
		followsCommitted: !isBeingDragged && renderElement === element,
	});
	useLayoutEffect(() => {
		positionRef.current = {
			shownStart: displayedStartTime,
			followsCommitted: !isBeingDragged && renderElement === element,
		};
	});
	useLayoutEffect(() => {
		const position: ClipPositioner = (startTime) => {
			const node = wrapperRef.current;
			const state = positionRef.current;
			if (state.followsCommitted) committedStart.current = startTime;
			if (!node || !state.followsCommitted || state.shownStart === startTime) {
				return null;
			}
			const previousStart = state.shownStart;
			state.shownStart = startTime;
			node.style.transform = clipTransformStyle(startTime);
			return previousStart;
		};
		let positioners = clipPositioners.get(element.id);
		if (!positioners) {
			positioners = new Set();
			clipPositioners.set(element.id, positioners);
		}
		positioners.add(position);
		return () => {
			const current = clipPositioners.get(element.id);
			current?.delete(position);
			if (current?.size === 0) clipPositioners.delete(element.id);
		};
	}, [element.id]);

	return (
		<PixelsPerSecondContext.Provider value={timelinePixelsPerSecond}>
			<div
				ref={wrapperRef}
				className="group/clip absolute top-0 select-none"
				onDoubleClick={(event) => handleCompositionDoubleClick(element, event)}
				data-timeline-element-id={element.id}
				data-timeline-track-id={track.id}
				data-group-id={element.groupId}
				data-touch={touch}
				data-linked={linked ? "" : undefined}
				style={{
					// Zoom-independent positioning (see areTimelineElementPropsEqual):
					// seconds × --timeline-pps, set once on the tracks container.
					left: 0,
					width: `calc(${displayedDuration / TICKS_PER_SECOND} * var(--timeline-pps) * 1px)`,
					height:
						expandedRows.length > 0
							? `${baseTrackHeight + expansionHeight}px`
							: "100%",
					transform: clipTransformStyle(
						displayedStartTime,
						isBeingDragged ? dragOffsetY : undefined,
					),
					// Dragged over other rows it stays on top — over their clips, names, handles and cut markers (it
					// passed under the clips of the rows below, drawn after it).
					zIndex: isBeingDragged ? TIMELINE_LAYERS.dragLine : undefined,
					// The floating clip is see-through: the dashed ghost under it (MoveLanding) is where it lands.
					opacity: isBeingDragged ? 0.62 : undefined,
				}}
			>
				{/* A fixed --timeline-pps for everything inside the clip: zoom changes the variable on the track,
				    and without this stop every node of every clip (filmstrip, waveform, labels) re-ran style on each
				    zoom step (~20 ms with 300 clips). Only this wrapper and the clip box itself recalc now. */}
				<div style={CLIP_BODY_STYLE}>
					<TimelineElementBody
						element={element}
						renderElement={renderElement}
						track={track}
						zoomLevel={zoomLevel}
						isSelected={isSelected}
						expandedRows={expandedRows}
						baseTrackHeight={baseTrackHeight}
						displayedStartTime={displayedStartTime}
						displayedDuration={displayedDuration}
						onResizeStart={onResizeStart}
						onElementMouseDown={onElementMouseDown}
						onElementClick={onElementClick}
						mediaAsset={mediaAsset}
						isDropTarget={isDropTarget}
						duplicate={duplicate}
					/>
					{/* Beat marks (⌘J), as CapCut's yellow dots along the bottom of the clip. */}
					{element.beats && element.beats.length > 0 && element.duration > 0
						? element.beats
								.filter((beat) => beat >= 0 && beat <= element.duration)
								.map((beat) => (
									<span
										key={beat}
										data-beat-mark=""
										className="pointer-events-none absolute bottom-0.5 z-[2] size-1.5 -translate-x-1/2 rounded-full bg-yellow-400 ring-1 ring-black/40"
										style={{ left: `${(beat / element.duration) * 100}%` }}
									/>
								))
						: null}
					{linked && <span aria-hidden data-linked-mark="" className={LINKED_MARK_CLASS} />}
					{/* A grouped clip (⌘G) carries the group mark at its top right. */}
					{element.groupId && (
						<span
							data-group-badge
							className="pointer-events-none absolute right-1 top-0.5 z-[2] flex size-3.5 items-center justify-center rounded-[3px] bg-black/55 text-white"
						>
							<HugeiconsIcon icon={GroupItemsIcon} className="size-2.5" />
						</span>
					)}
				</div>
			</div>
		</PixelsPerSecondContext.Provider>
	);
}

interface LiteClipProps {
	element: TimelineElementType;
	trackId: string;
	/** Its track and the trim's start: a clip a few pixels wide keeps its edges (trim never disappears, tlfix A2). */
	track?: TimelineTrack;
	touch?: string;
	linked?: boolean;
	onResizeStart?: TimelineElementProps["onResizeStart"];
	isSelected: boolean;
	onElementMouseDown: TimelineElementProps["onElementMouseDown"];
	onElementClick: TimelineElementProps["onElementClick"];
	/** Start time while this clip is being dragged (undefined otherwise). */
	dragStartTime?: MediaTime;
	dragOffsetY?: number;
	isDropTarget?: boolean;
	/** The stretches of this clip that another clip shows too (timeline/duplicate-sources.ts). */
	duplicate?: { color: string; segments: Array<{ from: number; to: number }> };
}

/**
 * A clip a few pixels wide (isLiteClipWidth, decided by the track): the box of its colour, the selection ring and the
 * press target — what the full clip shows at that width once CSS has hidden the rest (`data-narrow`). Three nodes and
 * one subscription (a preview that moves or changes it), where the full clip is ~20 nodes, two canvases and a dozen
 * subscriptions: selecting 324 such clips on a two-hour film and pressing ⌫ (then ⌘Z, ⇧⌘Z) cost 110–130 ms of React
 * and a 75–90 ms forced layout a step. A moved clip renders again (one style write), so it needs no positioner.
 */
export const LiteClip = memo(function LiteClip({
	element,
	trackId,
	track,
	touch,
	linked = false,
	onResizeStart,
	isSelected,
	onElementMouseDown,
	onElementClick,
	dragStartTime,
	dragOffsetY = 0,
	isDropTarget = false,
	duplicate,
}: LiteClipProps) {
	const shown = useElementPreviewOverride<TimelineElementType>({ trackId, elementId: element.id }) ?? element;
	const isBeingDragged = dragStartTime !== undefined;
	const isVideo = element.type === "video";
	// Hidden or a drop target: the body is drawn at half strength (a narrow video clip never showed it).
	const dimmed = !isVideo && ((canElementBeHidden(shown) && !!shown.hidden) || isDropTarget);
	return (
		<div
			className="group/clip absolute top-0 select-none"
			onDoubleClick={(event) => handleCompositionDoubleClick(element, event)}
			data-timeline-element-id={element.id}
			data-timeline-track-id={trackId}
			data-group-id={element.groupId}
			data-lite=""
			data-touch={touch}
			data-linked={linked ? "" : undefined}
			// a narrow video clip carries the mark its filmstrip gave it
			data-narrow={isVideo ? "" : undefined}
			style={{
				left: 0,
				width: `calc(${shown.duration / TICKS_PER_SECOND} * var(--timeline-pps) * 1px)`,
				height: "100%",
				transform: clipTransformStyle(isBeingDragged ? dragStartTime : shown.startTime, isBeingDragged ? dragOffsetY : undefined),
				zIndex: isBeingDragged ? TIMELINE_LAYERS.dragLine : undefined,
				opacity: isBeingDragged ? 0.62 : undefined,
			}}
		>
			<div
				data-clip-box=""
				className={cn("absolute inset-y-0 overflow-hidden rounded-sm", isVideo && "bg-[#33404d]")}
				style={isSelected ? LITE_BOX_SELECTED_STYLE : LITE_BOX_STYLE}
			>
				<button
					type="button"
					tabIndex={-1}
					className={cn(
						"flex size-full flex-col",
						!isVideo && getTimelineElementClassName({ type: getTrackTypeForElementType({ elementType: element.type }) }),
						dimmed && "opacity-50",
					)}
					onClick={(event) => onElementClick({ event, element })}
					onMouseDown={(event) => onElementMouseDown({ event, element })}
				/>
				{duplicate && <span aria-hidden data-duplicate-line={duplicate.color} className="pointer-events-none absolute inset-x-0 bottom-0 z-[3]" style={{ height: 2, backgroundColor: duplicate.color, opacity: 0.95 }} />}
			</div>
			{linked && <span aria-hidden data-linked-mark="" className={LINKED_MARK_CLASS} />}
			{track && onResizeStart && (
				<>
					<ResizeHandle side="left" element={element} track={track} isSelected={isSelected} onResizeStart={onResizeStart} />
					<ResizeHandle side="right" element={element} track={track} isSelected={isSelected} onResizeStart={onResizeStart} />
				</>
			)}
			{/* Beat marks and the group mark, as on the full clip. */}
			{element.beats && element.beats.length > 0 && element.duration > 0
				? element.beats
						.filter((beat) => beat >= 0 && beat <= element.duration)
						.map((beat) => (
							<span
								key={beat}
								data-beat-mark=""
								className="pointer-events-none absolute bottom-0.5 z-[2] size-1.5 -translate-x-1/2 rounded-full bg-yellow-400 ring-1 ring-black/40"
								style={{ left: `${(beat / element.duration) * 100}%` }}
							/>
						))
				: null}
			{element.groupId && (
				<span
					data-group-badge
					className="pointer-events-none absolute right-1 top-0.5 z-[2] flex size-3.5 items-center justify-center rounded-[3px] bg-black/55 text-white"
				>
					<HugeiconsIcon icon={GroupItemsIcon} className="size-2.5" />
				</span>
			)}
		</div>
	);
});

interface TimelineElementBodyProps {
	element: TimelineElementType;
	renderElement: TimelineElementType;
	track: TimelineTrack;
	zoomLevel: number;
	isSelected: boolean;
	expandedRows: ExpandedRow[];
	baseTrackHeight: number;
	displayedStartTime: MediaTime;
	displayedDuration: MediaTime;
	onResizeStart: TimelineElementProps["onResizeStart"];
	onElementMouseDown: TimelineElementProps["onElementMouseDown"];
	onElementClick: TimelineElementProps["onElementClick"];
	mediaAsset: MediaAsset | null;
	isDropTarget: boolean;
	duplicate?: { color: string; segments: Array<{ from: number; to: number }> };
}

function areBodyPropsEqual(
	prev: TimelineElementBodyProps,
	next: TimelineElementBodyProps,
): boolean {
	// Keyframe indicators / lanes (selected or expanded clips) are positioned from
	// the start time and the zoom level; a plain clip's body depends on neither.
	const isExpanded = next.expandedRows.length > 0;
	const positionMatters = next.isSelected || isExpanded;
	if (positionMatters) {
		if (
			prev.element !== next.element ||
			prev.renderElement !== next.renderElement ||
			prev.displayedStartTime !== next.displayedStartTime ||
			prev.zoomLevel !== next.zoomLevel
		) {
			return false;
		}
	} else if (
		!isSameElementIgnoringStart(prev.element, next.element) ||
		!isSameElementIgnoringStart(prev.renderElement, next.renderElement)
	) {
		return false;
	}
	return (
		prev.track.id === next.track.id &&
		prev.track.type === next.track.type &&
		prev.isSelected === next.isSelected &&
		(prev.expandedRows.length > 0) === isExpanded &&
		prev.baseTrackHeight === next.baseTrackHeight &&
		prev.displayedDuration === next.displayedDuration &&
		prev.onResizeStart === next.onResizeStart &&
		prev.onElementMouseDown === next.onElementMouseDown &&
		prev.onElementClick === next.onElementClick &&
		prev.mediaAsset === next.mediaAsset &&
		prev.isDropTarget === next.isDropTarget &&
		prev.duplicate === next.duplicate
	);
}

const TimelineElementBody = memo(TimelineElementBodyImpl, areBodyPropsEqual);

/** Everything inside the positioned wrapper: clip body, keyframe indicators and lanes. */
function TimelineElementBodyImpl({
	element,
	renderElement,
	track,
	zoomLevel,
	isSelected,
	expandedRows,
	baseTrackHeight,
	displayedStartTime,
	displayedDuration,
	onResizeStart,
	onElementMouseDown,
	onElementClick,
	mediaAsset,
	isDropTarget,
	duplicate,
}: TimelineElementBodyProps) {
	const elementWidth = timelineTimeToPixels({
		time: displayedDuration,
		zoomLevel,
	});
	const elementLeft = timelineTimeToSnappedPixels({
		time: displayedStartTime,
		zoomLevel,
	});
	const keyframeIndicators = isSelected
		? getKeyframeIndicators({
				keyframes: getElementKeyframes({ animations: element.animations }),
				trackId: track.id,
				elementId: element.id,
				displayedStartTime,
				zoomLevel,
				elementLeft,
				elementWidth,
			})
		: [];

	const {
		keyframeDragState,
		handleKeyframeMouseDown,
		handleKeyframeClick,
		getVisualOffsetPx,
	} = useKeyframeDrag({
		zoomLevel,
		element,
		displayedStartTime,
		// Keyframes are drawn only on a selected or expanded clip.
		active: isSelected || expandedRows.length > 0,
	});

	const elementKeyframes = getElementKeyframes({
		animations: element.animations,
	});

	const {
		containerRef: expandedLanesRef,
		selectionBox: keyframeSelectionBox,
		isBoxSelecting: isKeyframeBoxSelecting,
		handleExpandedAreaMouseDown,
		handleExpandedAreaClick,
	} = useKeyframeBoxSelect({
		trackId: track.id,
		elementId: element.id,
		rows: expandedRows,
		keyframes: elementKeyframes,
		displayedStartTime,
		zoomLevel,
		elementLeft,
		active: expandedRows.length > 0,
	});

	const expandedContent =
		expandedRows.length > 0 ? (
			<ExpandedKeyframeLanes
				rows={expandedRows}
				keyframes={elementKeyframes}
				trackId={track.id}
				elementId={element.id}
				displayedStartTime={displayedStartTime}
				zoomLevel={zoomLevel}
				elementLeft={elementLeft}
				keyframeDragState={keyframeDragState}
				onKeyframeMouseDown={handleKeyframeMouseDown}
				onKeyframeClick={handleKeyframeClick}
				getVisualOffsetPx={getVisualOffsetPx}
				containerRef={expandedLanesRef}
				onLaneMouseDown={handleExpandedAreaMouseDown}
				onLaneClick={handleExpandedAreaClick}
				selectionBox={keyframeSelectionBox}
				isBoxSelecting={isKeyframeBoxSelecting}
			/>
		) : null;

	return (
		<>
			{/* The reuse mark: a hairline along the clip's bottom edge, ONLY over the stretch another clip shows too. */}
			{duplicate && duplicate.segments.length > 0 && (
				<span aria-hidden data-duplicate-line={duplicate.color} className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] block" style={{ height: 2 }}>
					{duplicate.segments.map((segment, index) => (
						<span
							key={`${segment.from}:${index}`}
							data-duplicate-segment={`${segment.from.toFixed(4)}:${segment.to.toFixed(4)}`}
							className="absolute top-0 bottom-0 rounded-[1px]"
							style={{ left: `${segment.from * 100}%`, width: `${Math.max(0.4, (segment.to - segment.from) * 100)}%`, backgroundColor: duplicate.color, opacity: 0.95 }}
						/>
					))}
				</span>
			)}
			<ElementInner
				element={element}
				displayElement={renderElement}
				track={track}
				isSelected={isSelected}
				isExpanded={expandedRows.length > 0}
				baseTrackHeight={baseTrackHeight}
				expandedContent={expandedContent}
				onElementClick={onElementClick}
				onElementMouseDown={onElementMouseDown}
				onResizeStart={onResizeStart}
				isDropTarget={isDropTarget}
				mediaAsset={mediaAsset}
			/>
			{isSelected && (
				<div
					className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden"
					style={{ height: `${baseTrackHeight}px` }}
				>
					<KeyframeIndicators
						indicators={keyframeIndicators}
						dragState={keyframeDragState}
						displayedStartTime={displayedStartTime}
						elementLeft={elementLeft}
						onKeyframeMouseDown={handleKeyframeMouseDown}
						onKeyframeClick={handleKeyframeClick}
						getVisualOffsetPx={getVisualOffsetPx}
					/>
				</div>
			)}
		</>
	);
}

/**
 * Context menu of a timeline element. The timeline mounts ONE menu for all
 * elements and renders this content only while it is open, so the hundreds of
 * elements don't each carry a Radix menu tree.
 */
export function TimelineElementContextMenuContent({
	trackId,
	elementId,
}: {
	trackId: string;
	elementId: string;
}) {
	const attributesCopied = useAttributesClipboard((s) => !!s.source);
	const element = useEditor(
		(e) =>
			e.timeline
				.getTrackById({ trackId })
				?.elements.find((candidate) => candidate.id === elementId) ?? null,
		["timeline", "scenes"],
	);
	const mediaAsset = useEditor(
		(e) =>
			element && hasMediaId(element)
				? (e.media.getAssets().find((asset) => asset.id === element.mediaId) ??
					null)
				: null,
		["media"],
	);
	const { selectedElements } = useElementSelection();
	const requestRevealMedia = useAssetsPanelStore((s) => s.requestRevealMedia);
	const isExpanded = useTimelineStore((s) => s.expandedElementIds.has(elementId));
	const toggleElementExpanded = useTimelineStore(
		(s) => s.toggleElementExpanded,
	);
	if (!element) return null;

	const hasAudio = mediaSupportsAudio({ media: mediaAsset });
	const isCurrentElementSelected = selectedElements.some(
		(selected) =>
			selected.elementId === element.id && selected.trackId === trackId,
	);
	const handleRevealInMedia = ({ event }: { event: React.MouseEvent }) => {
		event.stopPropagation();
		if (hasMediaId(element)) {
			requestRevealMedia(element.mediaId);
		} else if (element.type === "audio" && element.sourceType === "library") {
			const copy = EditorCore.getInstance().media.getAssets().find((a) => a.librarySourceUrl === element.sourceUrl);
			if (copy) requestRevealMedia(copy.id);
		}
	};
	const isMuted = canElementHaveAudio(element) && isElementMuted({ element });
	const canToggleCurrentSourceAudio =
		selectedElements.length === 1 &&
		isCurrentElementSelected &&
		canToggleSourceAudio(element, mediaAsset);
	const sourceAudioLabel =
		element.type === "video"
			? getSourceAudioActionLabel({ element })
			: "Extract audio";
	const hasKeyframes =
		getElementKeyframes({ animations: element.animations }).length > 0;

	// CapCut 9.5's clip menu, in its order (docs/capcut/compare/clip-menu-capcut.jpg): the assistant on top (EditPilot),
	// then Copy, Cut, Copy / Paste attributes, Delete; the clip's own edits; compound clip, preset, group; Deactivate.
	// Only what works here is listed: no greyed «coming soon» rows.
	return (
		<>
			<AssistClipMenuItems trackId={trackId} element={element} />
			<LipsyncMenuItem trackId={trackId} element={element} />
			<PartsMenuItems trackId={trackId} element={element} />
			<SyncMenuItems trackId={trackId} element={element} />
			<CompositionElementMenuItem trackId={trackId} element={element} />
			<ContextMenuSeparator />
			<CopyMenuItem />
			<ActionMenuItem action="cut-selected" icon={<HugeiconsIcon icon={ScissorRectangleIcon} />} />
			<ActionMenuItem action="copy-attributes" icon={<HugeiconsIcon icon={Copy01Icon} />} />
			{/* Nothing to paste before something was copied (it was clickable and did nothing — targeted test 05.11). */}
			<ActionMenuItem action="paste-attributes" icon={<HugeiconsIcon icon={ClipboardIcon} />} disabled={!attributesCopied} />
			{/* groups of at most seven, the frequent first (register C4, DESIGN E2): the clipboard, the deletes, the cuts */}
			<ContextMenuSeparator />
			<DeleteMenuItem />
			{/* Delete left / right (Q / W) and Ripple delete: a narrow toolbar steps them aside, the menu keeps them at every
			    width. Like Split, they cut where the clip was right-clicked when the playhead is not over it. */}
			<ContextMenuItem
				icon={<HugeiconsIcon icon={AlignLeftIcon} />}
				textRight={getDisplayShortcut({ action: "split-left" })}
				data-clip-menu="delete-left"
				onClick={(event: React.MouseEvent) => {
					event.stopPropagation();
					selectMenuClip();
					seekIntoClipIfOutside(element);
					invokeAction("split-left");
				}}
			>
				{actionName("split-left")}
			</ContextMenuItem>
			<ContextMenuItem
				icon={<HugeiconsIcon icon={AlignRightIcon} />}
				textRight={getDisplayShortcut({ action: "split-right" })}
				data-clip-menu="delete-right"
				onClick={(event: React.MouseEvent) => {
					event.stopPropagation();
					selectMenuClip();
					seekIntoClipIfOutside(element);
					invokeAction("split-right");
				}}
			>
				{actionName("split-right")}
			</ContextMenuItem>
			<ActionMenuItem action="ripple-delete" icon={<HugeiconsIcon icon={Delete02Icon} />} data-clip-menu="ripple-delete" />
			<ContextMenuSeparator />
			<ContextMenuItem
				icon={<HugeiconsIcon icon={ScissorIcon} />}
				textRight={getDisplayShortcut({ action: "split" })}
				onClick={(event: React.MouseEvent) => {
					event.stopPropagation();
					splitAtPlayheadOrClick(element);
				}}
			>
				{actionName("split")}
			</ContextMenuItem>
			{selectedElements.length === 1 && (
				<ActionMenuItem action="duplicate-selected" icon={<HugeiconsIcon icon={Copy01Icon} />} />
			)}
			{canToggleCurrentSourceAudio && (
				<ContextMenuItem
					icon={<HugeiconsIcon icon={Unlink02Icon} />}
					textRight={getDisplayShortcut({ action: "toggle-source-audio" })}
					onClick={(event: React.MouseEvent) => {
						event.stopPropagation();
						invokeAction("toggle-source-audio");
					}}
				>
					{sourceAudioLabel}
				</ContextMenuItem>
			)}
			<ContextMenuSeparator />
			{canElementHaveAudio(element) && hasAudio && (
				<MuteMenuItem
					isMultipleSelected={selectedElements.length > 1}
					isCurrentElementSelected={isCurrentElementSelected}
					isMuted={isMuted}
				/>
			)}
			{canElementHaveAudio(element) && hasAudio && selectedElements.length <= 1 && (
				<ContextMenuItem
					icon={<HugeiconsIcon icon={SilenceIcon} />}
					onClick={(event: React.MouseEvent) => {
						event.stopPropagation();
						void removePausesInClip({ trackId, elementId: element.id });
					}}
				>
					Remove pauses
				</ContextMenuItem>
			)}
			{hasKeyframes && (
				<ContextMenuItem
					icon={<HugeiconsIcon icon={KeyframeIcon} />}
					onClick={(event: React.MouseEvent) => {
						event.stopPropagation();
						toggleElementExpanded(element.id);
					}}
				>
					{isExpanded ? "Collapse keyframes" : "Expand keyframes"}
				</ContextMenuItem>
			)}
			<MotionMenuItems trackId={trackId} element={element} />
			<ContextMenuSeparator />
			{/* CapCut: Create compound clip (subproject) ⌥G, Save preset, Group ⌘G, Ungroup ⇧⌘G. */}
			<ActionMenuItem action="create-compound" icon={<HugeiconsIcon icon={Layers01Icon} />} />
			{element.type === "graphic" && element.params.compound === true && (
				<ActionMenuItem action="dismiss-compound" icon={<HugeiconsIcon icon={Layers01Icon} />} />
			)}
			<SavePresetMenuItem trackId={trackId} element={element} />
			{selectedElements.length > 1 && (
				<ActionMenuItem action="group-selected" icon={<HugeiconsIcon icon={GroupItemsIcon} />} />
			)}
			{element.groupId && (
				<ActionMenuItem action="ungroup-selected" icon={<HugeiconsIcon icon={GroupItemsIcon} />} />
			)}
			<ContextMenuSeparator />
			{/* CapCut: Export selected clips (each clip its own file), Deactivate clip V. */}
			{/* the browser edition exports the whole film from its own Export menu (no clips window) */}
			{!DEMO && (
			<ContextMenuItem
				icon={<HugeiconsIcon icon={Download04Icon} />}
				onClick={(event: React.MouseEvent) => {
					event.stopPropagation();
					if (!isCurrentElementSelected) {
						EditorCore.getInstance().selection.setSelectedElements({ elements: [{ trackId, elementId: element.id }] });
					}
					openExportClips();
				}}
			>
				Export selected clips
			</ContextMenuItem>
			)}
			{canElementBeHidden(element) && (
				<VisibilityMenuItem
					element={element}
					isMultipleSelected={selectedElements.length > 1}
					isCurrentElementSelected={isCurrentElementSelected}
				/>
			)}
			{selectedElements.length === 1 && hasMediaId(element) && (
				<ContextMenuItem
					icon={<HugeiconsIcon icon={Search01Icon} />}
					onClick={(event: React.MouseEvent) => handleRevealInMedia({ event })}
				>
					{actionName("match-frame")}
				</ContextMenuItem>
			)}
		</>
	);
}

/** Shallow-equal two elements ignoring startTime (a ripple shift only moves the clip). */
function isSameElementIgnoringStart(
	a: TimelineElementType | undefined,
	b: TimelineElementType | undefined,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	const left = a as unknown as Record<string, unknown>;
	const right = b as unknown as Record<string, unknown>;
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const key of keys) {
		if (key === "startTime") continue;
		if (!Object.is(left[key], right[key])) return false;
	}
	return true;
}

type ElementInnerProps = Parameters<typeof ElementInnerImpl>[0];

/**
 * The clip body (thumbnails, waveform, handles) doesn't depend on where the clip
 * starts: a ripple delete/undo moves ~half the clips and used to re-render all
 * of their bodies. Only the cheap positioned wrapper re-renders now.
 */
const ElementInner = memo(
	ElementInnerImpl,
	(prev: ElementInnerProps, next: ElementInnerProps) => {
		for (const key of Object.keys(next) as Array<keyof ElementInnerProps>) {
			if (key === "element" || key === "displayElement") {
				if (!isSameElementIgnoringStart(prev[key], next[key])) return false;
			} else if (key === "track") {
				if (prev.track.id !== next.track.id || prev.track.type !== next.track.type) {
					return false;
				}
			} else if (!Object.is(prev[key], next[key])) {
				return false;
			}
		}
		return true;
	},
);

function ElementInnerImpl({
	element,
	displayElement,
	track,
	isSelected,
	isExpanded,
	baseTrackHeight,
	expandedContent,
	onElementClick,
	onElementMouseDown,
	onResizeStart,
	isDropTarget = false,
	mediaAsset,
}: {
	mediaAsset: MediaAsset | null;
	element: TimelineElementType;
	displayElement?: TimelineElementType;
	track: TimelineTrack;
	isSelected: boolean;
	isExpanded: boolean;
	baseTrackHeight: number;
	expandedContent: React.ReactNode;
	onElementClick: (params: {
		event: React.MouseEvent;
		element: TimelineElementType;
	}) => void;
	onElementMouseDown: (params: {
		event: React.MouseEvent;
		element: TimelineElementType;
	}) => void;
	onResizeStart: (params: {
		event: React.MouseEvent;
		element: TimelineElementType;
		track: TimelineTrack;
		side: "left" | "right";
	}) => void;
	isDropTarget?: boolean;
}) {
	const visibleElement = displayElement ?? element;
	const isReducedOpacity =
		(canElementBeHidden(visibleElement) && visibleElement.hidden) ||
		isDropTarget;
	// Flat on purpose: every positioned box is a paint layer that each frame paints, hit-tests and layerizes,
	// for every clip on screen. The ring, the clip's rounded box and the inset are one box (it used to be
	// three nested ones); the button and the content inside it are in normal flow; the trim handles sit on
	// the clip wrapper (2.5 px outside the clip, at most 40 % of the inset box, as before).
	return (
		<>
			{/* data-narrow on the clip (set by its filmstrip while zooming, no React render): a clip a few pixels wide is
			    drawn as its colour only (theme.ts video) — 300 clips zoomed to fit laid out their names, frames, sound and
			    handles on every step. */}
			<div
				data-clip-box=""
				className={cn(
					"absolute inset-y-0 overflow-hidden rounded-sm group-data-[narrow]/clip:bg-[#33404d]",
					isExpanded && "bg-background",
				)}
				style={{
					left: `${ELEMENT_RING_WIDTH_PX}px`,
					right: `${ELEMENT_RING_WIDTH_PX}px`,
					boxShadow: isSelected
						? `0 0 0 ${ELEMENT_RING_WIDTH_PX}px var(--primary)`
						: undefined,
				}}
			>
				<button
					type="button"
					tabIndex={-1}
					className="flex size-full flex-col"
					onClick={(event) => onElementClick({ event, element })}
					onMouseDown={(event) => onElementMouseDown({ event, element })}
				>
					<div
						className={cn(
							"flex shrink-0 items-center overflow-hidden group-data-[narrow]/clip:hidden",
							getTimelineElementClassName({
								type: getTrackTypeForElementType({
									elementType: element.type,
								}),
							}),
							isReducedOpacity && "opacity-50",
						)}
						style={{ height: `${baseTrackHeight}px` }}
					>
						<div className="flex flex-1 min-h-0 h-full items-center overflow-hidden">
							<ElementContent
								element={visibleElement}
								track={track}
								mediaAsset={mediaAsset}
							/>
						</div>
					</div>
					{expandedContent}
				</button>
				<ClipProgress elementId={element.id} />
				<ClipLipsync trackId={track.id} elementId={element.id} />
			</div>

			{/* Edge trim works on hover for any clip (CapCut); the resize controller trims
			    the selection when this clip is selected, otherwise just this clip. */}
			<ResizeHandle
				side="left"
				element={element}
				track={track}
				isSelected={isSelected}
				onResizeStart={onResizeStart}
			/>
			<ResizeHandle
				side="right"
				element={element}
				track={track}
				isSelected={isSelected}
				onResizeStart={onResizeStart}
			/>
			{(visibleElement.type === "video" || visibleElement.type === "audio" || visibleElement.type === "image") && (
				<FadeHandles element={visibleElement} trackId={track.id} />
			)}
		</>
	);
}

function ResizeHandle({
	side,
	element,
	track,
	isSelected = false,
	onResizeStart,
}: {
	side: "left" | "right";
	element: TimelineElementType;
	track: TimelineTrack;
	isSelected?: boolean;
	onResizeStart: (params: {
		event: React.MouseEvent;
		element: TimelineElementType;
		track: TimelineTrack;
		side: "left" | "right";
	}) => void;
}) {
	const isLeft = side === "left";
	// Where the press landed: a click that did not move and lies on the cut's marker at this edge (the transition chip or
	// the "+") selects the cut (the markers leave the handles' strip to the handles — cut-markers TRIM_REACH_PX).
	const pressX = useRef<number | null>(null);
	// Its zone and its bar (globals.css .tl-trim): at every width, 9.5 px inside at most (a third of the clip), 2.5–6 px
	// outside; at a cut between two clips each edge keeps its own strip beside the transition "+". The bar lights on a
	// selected clip, under the pointer and while the edge is dragged (data-dragging until the button is let go).
	return (
		<>
			<button
				type="button"
				data-trim-handle={side}
				className="tl-trim"
				onMouseDown={(event) => {
					pressX.current = event.button === 0 ? event.clientX : null;
					if (event.button === 0) {
						const handle = event.currentTarget;
						handle.setAttribute("data-dragging", "");
						window.addEventListener("mouseup", () => handle.removeAttribute("data-dragging"), { once: true, capture: true });
					}
					onResizeStart({ event, element, track, side });
				}}
				onClick={(event) => {
					event.stopPropagation();
					const pressedAt = pressX.current;
					pressX.current = null;
					if (pressedAt === null || Math.abs(event.clientX - pressedAt) >= 3) return;
					selectCutUnder(track, element.id, side, event.clientX, event.clientY);
				}}
				aria-label={`${isLeft ? "Left" : "Right"} resize handle`}
			></button>
			<span aria-hidden data-trim-bar={side} data-selected={isSelected ? "" : undefined} className="tl-trim-bar" />
		</>
	);
}

function KeyframeIndicators({
	indicators,
	dragState,
	displayedStartTime,
	elementLeft,
	onKeyframeMouseDown,
	onKeyframeClick,
	getVisualOffsetPx,
}: {
	indicators: KeyframeIndicator[];
	dragState: KeyframeDragState;
	displayedStartTime: MediaTime;
	elementLeft: number;
	onKeyframeMouseDown: (params: {
		event: React.MouseEvent;
		keyframes: SelectedKeyframeRef[];
	}) => void;
	onKeyframeClick: (params: {
		event: React.MouseEvent;
		keyframes: SelectedKeyframeRef[];
		orderedKeyframes: SelectedKeyframeRef[];
		indicatorTime: MediaTime;
	}) => void;
	getVisualOffsetPx: (params: {
		indicatorTime: MediaTime;
		indicatorOffsetPx: number;
		isBeingDragged: boolean;
		displayedStartTime: MediaTime;
		elementLeft: number;
	}) => number;
}) {
	const { isKeyframeSelected } = useKeyframeSelection();
	const orderedKeyframes = indicators.flatMap(
		(indicator) => indicator.keyframes,
	);

	return indicators.map((indicator) => {
		const isIndicatorSelected = indicator.keyframes.some((keyframe) =>
			isKeyframeSelected({ keyframe }),
		);
		const isBeingDragged = indicator.keyframes.some((keyframe) =>
			dragState.draggingKeyframeIds.has(keyframe.keyframeId),
		);
		const visualOffsetPx = getVisualOffsetPx({
			indicatorTime: indicator.time,
			indicatorOffsetPx: indicator.offsetPx,
			isBeingDragged,
			displayedStartTime,
			elementLeft,
		});

		return (
			<button
				key={indicator.time}
				type="button"
				className="pointer-events-auto absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-grab mr-0.5"
				style={{ left: visualOffsetPx }}
				data-keyframe-refs={JSON.stringify(indicator.keyframes)}
				onMouseDown={(event) =>
					onKeyframeMouseDown({ event, keyframes: indicator.keyframes })
				}
				onClick={(event) =>
					onKeyframeClick({
						event,
						keyframes: indicator.keyframes,
						orderedKeyframes,
						indicatorTime: indicator.time,
					})
				}
				aria-label="Select keyframe"
			>
				<HugeiconsIcon
					icon={KeyframeIcon}
					className={cn(
						"size-3.5 text-black",
						isIndicatorSelected ? "fill-primary" : "fill-white",
					)}
					strokeWidth={1.5}
				/>
			</button>
		);
	});
}

function ExpandedKeyframeLanes({
	rows,
	keyframes,
	trackId,
	elementId,
	displayedStartTime,
	zoomLevel,
	elementLeft,
	keyframeDragState,
	onKeyframeMouseDown,
	onKeyframeClick,
	getVisualOffsetPx,
	containerRef,
	onLaneMouseDown,
	onLaneClick,
	selectionBox,
	isBoxSelecting,
}: {
	rows: ExpandedRow[];
	keyframes: ElementKeyframe[];
	trackId: string;
	elementId: string;
	displayedStartTime: MediaTime;
	zoomLevel: number;
	elementLeft: number;
	keyframeDragState: KeyframeDragState;
	onKeyframeMouseDown: (params: {
		event: React.MouseEvent;
		keyframes: SelectedKeyframeRef[];
	}) => void;
	containerRef: React.RefObject<HTMLDivElement | null>;
	onLaneMouseDown: (event: React.MouseEvent) => void;
	onLaneClick: (event: React.MouseEvent) => void;
	selectionBox: {
		bounds: SelectionBoxBounds;
	} | null;
	isBoxSelecting: boolean;
	onKeyframeClick: (params: {
		event: React.MouseEvent;
		keyframes: SelectedKeyframeRef[];
		orderedKeyframes: SelectedKeyframeRef[];
		indicatorTime: MediaTime;
	}) => void;
	getVisualOffsetPx: (params: {
		indicatorTime: MediaTime;
		indicatorOffsetPx: number;
		isBeingDragged: boolean;
		displayedStartTime: MediaTime;
		elementLeft: number;
	}) => number;
}) {
	const { isKeyframeSelected } = useKeyframeSelection();

	const orderedKeyframes = useMemo(
		() =>
			[...keyframes]
				.sort(
					(a, b) =>
						a.time - b.time || a.propertyPath.localeCompare(b.propertyPath),
				)
				.map((kf) => ({
					trackId,
					elementId,
					propertyPath: kf.propertyPath,
					keyframeId: kf.id,
				})),
		[keyframes, trackId, elementId],
	);

	return (
		// eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- spatial gesture surface (keyframe lanes); keyboard control over keyframes is via global timeline shortcuts, not per-element focus.
		<div
			ref={containerRef}
			className="relative flex flex-col"
			onMouseDown={onLaneMouseDown}
			onClick={onLaneClick}
		>
			{rows.map((row) => {
				const laneKeyframes = keyframes.filter(
					(kf) => kf.propertyPath === row.propertyPath,
				);
				return (
					<div
						key={row.propertyPath}
						className={cn("relative flex items-center bg-muted/50")}
						style={{ height: `${KEYFRAME_LANE_HEIGHT_PX}px` }}
					>
						{laneKeyframes.map((kf) => {
							const keyframeRef: SelectedKeyframeRef = {
								trackId,
								elementId,
								propertyPath: row.propertyPath,
								keyframeId: kf.id,
							};
							const isBeingDragged = keyframeDragState.draggingKeyframeIds.has(
								kf.id,
							);
							const kfLeft = timelineTimeToSnappedPixels({
								time: displayedStartTime + kf.time,
								zoomLevel,
							});
							const offsetPx = kfLeft - elementLeft;
							const visualOffset = getVisualOffsetPx({
								indicatorTime: kf.time,
								indicatorOffsetPx: offsetPx,
								isBeingDragged,
								displayedStartTime,
								elementLeft,
							});
							const isSelected = isKeyframeSelected({
								keyframe: keyframeRef,
							});

							return (
								<button
									key={kf.id}
									type="button"
									className={cn(
										"pointer-events-auto absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-grab",
										isBoxSelecting && "pointer-events-none",
									)}
									style={{ left: visualOffset }}
									data-keyframe-refs={JSON.stringify([keyframeRef])}
									onMouseDown={(event) => {
										event.stopPropagation();
										onKeyframeMouseDown({
											event,
											keyframes: [keyframeRef],
										});
									}}
									onClick={(event) => {
										event.stopPropagation();
										onKeyframeClick({
											event,
											keyframes: [keyframeRef],
											orderedKeyframes,
											indicatorTime: kf.time,
										});
									}}
									aria-label="Select keyframe"
								>
									<HugeiconsIcon
										icon={KeyframeIcon}
										className={cn(
											"size-3.5 text-black mr-1",
											isSelected ? "fill-primary" : "fill-white",
										)}
										strokeWidth={1.5}
									/>
								</button>
							);
						})}
					</div>
				);
			})}
			{selectionBox && <SelectionBox bounds={selectionBox.bounds} />}
		</div>
	);
}

interface ElementContentProps {
	element: TimelineElementType;
	track: TimelineTrack;
	mediaAsset: MediaAsset | null;
}

function TextElementContent({
	element,
}: {
	element: Extract<TimelineElementType, { type: "text" }>;
}) {
	return (
		<div className="flex size-full items-center justify-start pl-2">
			<span className="truncate text-xs text-white">
				{typeof element.params.content === "string" ? element.params.content : ""}
			</span>
		</div>
	);
}

function EffectElementContent({
	element,
}: {
	element: Extract<TimelineElementType, { type: "effect" }>;
}) {
	return (
		<div className="flex size-full items-center justify-start gap-1 pl-2">
			<HugeiconsIcon
				icon={MagicWand05Icon}
				className="size-4 shrink-0 text-white"
			/>
			<span className="truncate text-xs text-white">{element.name}</span>
			{element.transition && <LayerTransitionBadge type={element.transition.type} />}
		</div>
	);
}

/** The transition on an adjustment layer (transitions/layer.ts), as a clip transition's chip: its name. */
function LayerTransitionBadge({ type }: { type: string }) {
	const name = getTransitionDefinition(type)?.name ?? type;
	return (
		<span
			data-layer-transition-badge={type}
			title={name}
			className="ml-auto mr-1 flex max-w-[60%] shrink items-center gap-1 overflow-hidden rounded-sm border border-white/60 bg-black/55 px-1 text-[10px] font-medium leading-4 text-white"
		>
			<HugeiconsIcon icon={ArrowLeftRightIcon} className="size-2.5 shrink-0" aria-hidden />
			<span className="truncate">{name}</span>
		</span>
	);
}

function StickerElementContent({
	element,
}: {
	element: Extract<TimelineElementType, { type: "sticker" }>;
}) {
	return (
		<div className="flex size-full items-center gap-2 pl-2">
			<Image
				src={resolveStickerId({
					stickerId: element.stickerId,
					options: { width: 20, height: 20 },
				})}
				alt={element.name}
				className="size-4 shrink-0"
				width={20}
				height={20}
				unoptimized
			/>
			<span className="truncate text-xs text-white">{element.name}</span>
		</div>
	);
}

function GraphicElementContent({
	element,
}: {
	element: Extract<TimelineElementType, { type: "graphic" }>;
}) {
	// A compound clip is an ordinary nest: the layers icon and its name, no AI artwork or badge on it.
	const compound = element.params.compound === true;
	return (
		<div className="flex size-full items-center gap-2 pl-2">
			{!compound && (
				<Image
					src={buildGraphicPreviewUrl({
						definitionId: element.definitionId,
						params: element.params,
						size: 20,
					})}
					alt={element.name}
					className="size-4 shrink-0"
					width={20}
					height={20}
					unoptimized
				/>
			)}
			{compound ? (
				<HugeiconsIcon icon={Layers01Icon} className="size-3.5 shrink-0 text-white" aria-label="Compound clip" />
			) : (
				// A ready-made motion graphic is our own code, not AI: its tile already says «MG», no second badge on the clip.
				element.definitionId.startsWith("ai.") && !isMographKind(element.definitionId.slice("ai.".length)) && <AiBadge />
			)}
			<span className="truncate text-xs text-white">{element.name}</span>
		</div>
	);
}

function AudioElementContent({
	element,
	trackId,
	mediaAsset: resolvedMediaAsset,
}: {
	element: AudioElement;
	trackId: string;
	mediaAsset: MediaAsset | null;
}) {
	const pixelsPerSecond = useContext(PixelsPerSecondContext);
	if (pixelsPerSecond === null) {
		throw new Error(
			"AudioElementContent must be rendered inside PixelsPerSecondContext.Provider",
		);
	}
	const mediaAsset =
		element.sourceType === "upload" ? resolvedMediaAsset : null;

	const audioBuffer =
		element.sourceType === "library" ? element.buffer : undefined;
	const audioUrl =
		element.sourceType === "library" ? element.sourceUrl : mediaAsset?.url;
	const sourceFile =
		element.sourceType === "upload" ? mediaAsset?.file : undefined;
	const sourceKey =
		element.sourceType === "upload"
			? buildWaveformSourceKey({ kind: "media", id: element.mediaId })
			: buildWaveformSourceKey({ kind: "library", id: element.sourceUrl });
	const mediaLabel = mediaAsset?.name ?? element.name;
	const baseGainSamples = useMemo(
		() =>
			buildWaveformGainSamples({
				element,
				count: WAVEFORM_GAIN_SAMPLE_COUNT,
			}),
		[element],
	);
	const gainSamples = useDuckedGainSamples(element, baseGainSamples);
	if (audioBuffer || audioUrl || sourceFile) {
		return (
			<div className="group/audio relative size-full">
				<MediaElementHeader name={mediaLabel} />
				<MissingLibraryBadge element={element} trackId={trackId} />
				<div className="absolute inset-x-0 bottom-0 overflow-hidden" style={{ top: CLIP_NAME_BAR_PX }}>
					<AudioWaveform
						clipId={element.id}
						sourceKey={sourceKey}
						sourceFile={sourceFile}
						audioBuffer={audioBuffer}
						audioUrl={audioUrl}
						gainSamples={gainSamples}
						pixelsPerSecond={pixelsPerSecond}
						clipDurationSec={element.duration / TICKS_PER_SECOND}
						retime={element.retime}
						sourceStartSec={element.trimStart / TICKS_PER_SECOND}
						color={TIMELINE_TRACK_THEME.audio.waveformColor}
					/>
					{/* One line: the volume, bent by the fades and dips (it was a straight line plus a second curve). */}
					<AudioVolumeLine
						element={element}
						trackId={trackId}
						samples={gainSamples}
						baseGain={resolveEffectiveAudioGain({ element, localTime: 0 })}
					/>
				</div>
			</div>
		);
	}

	return (
		<div className="group/audio relative size-full">
			<div className="flex size-full items-center pl-2">
				<span className="text-foreground/80 truncate text-xs">
					{element.name}
				</span>
			</div>
			<AudioVolumeLine element={element} trackId={trackId} />
		</div>
	);
}

function EffectsButton({
	element,
	track,
}: {
	element: VideoElement | ImageElement;
	track: TimelineTrack;
}) {
	const editor = useEditor();
	const setActiveTab = usePropertiesStore((s) => s.setActiveTab);

	const handleClick = (event: React.MouseEvent) => {
		event.stopPropagation();
		editor.selection.setSelectedElements({
			elements: [{ trackId: track.id, elementId: element.id }],
		});
		// the tab is kept per kind (a shape's is «shape», not «graphic»)
		setActiveTab({ elementType: elementKind(element), tabId: "effects" });
	};

	return (
		<button
			type="button"
			className="flex shrink-0 justify-center text-white cursor-pointer"
			onMouseDown={(event) => event.stopPropagation()}
			onClick={handleClick}
		>
			<HugeiconsIcon icon={MagicWand05Icon} size={12} />
		</button>
	);
}

function TiledMediaContent({
	element,
	track,
	mediaAsset,
}: {
	element: VideoElement | ImageElement;
	track: TimelineTrack;
	mediaAsset: MediaAsset | null;
}) {
	useTimelineStore((s) => s.trackHeight);
	const waveformSize = useTimelineStore((s) => s.waveformSize);
	const imageUrl =
		element.type === "video"
			? mediaAsset?.thumbnailUrl
			: (mediaAsset?.thumbnailUrl ?? mediaAsset?.url);

	if (!imageUrl) {
		return (
			<span className="text-foreground/80 truncate text-xs">
				{element.name}
			</span>
		);
	}

	// CapCut: the name bar on top, the frames under it, the sound bar along the bottom (the main track's ⋯ sets the
	// track's height and the sound bar's size).
	const soundBar = element.type === "video" && hasSoundBar({ element, mediaAsset });
	const trackHeight = getTrackHeight({ type: track.type });
	const framesHeight =
		trackHeight - CLIP_NAME_BAR_PX - (soundBar ? soundBarHeight({ trackHeight, waveformSize }) : 0);
	const tileWidth = framesHeight * THUMBNAIL_ASPECT_RATIO;

	return (
		<>
			<div
				data-clip-frames=""
				className="pointer-events-none absolute inset-x-0 overflow-hidden"
				style={{ top: CLIP_NAME_BAR_PX, height: framesHeight }}
			>
				{/* The poster repeated: shows until the filmstrip's frames arrive (and for images). */}
				<div
					className="absolute inset-0"
					style={{
						backgroundColor: "var(--muted)",
						backgroundImage: `url(${imageUrl})`,
						backgroundRepeat: "repeat-x",
						backgroundSize: `${tileWidth}px ${framesHeight}px`,
						backgroundPosition: "left center",
					}}
				/>
				{element.type === "video" && mediaAsset?.file && (
					<VideoFilmstrip
						clipId={element.id}
						mediaId={mediaAsset.id}
						file={mediaAsset.file}
						aspect={
							mediaAsset.width && mediaAsset.height
								? mediaAsset.width / mediaAsset.height
								: THUMBNAIL_ASPECT_RATIO
						}
						trackHeight={framesHeight}
						clipDurationSec={element.duration / TICKS_PER_SECOND}
						trimStartSec={element.trimStart / TICKS_PER_SECOND}
						retime={element.retime}
						mediaDurationSec={mediaAsset.duration}
					/>
				)}
			</div>
			<MediaElementHeader
				name={mediaAsset?.name}
				duration={element.duration}
				leading={
					hasElementEffects({ element }) ? (
						<EffectsButton element={element} track={track} />
					) : null
				}
			/>
			{element.type === "video" && mediaAsset && (
				<VideoAudioStrip
					element={element}
					trackId={track.id}
					mediaAsset={mediaAsset}
				/>
			)}
		</>
	);
}

/** CapCut's media clip: the name and length on a bar over the frames, the clip's own sound on a bar under them. */
const CLIP_NAME_BAR_PX = 14;
/** Audio waveform size 30 % / 60 % / 100 % (CapCut): the sound bar's share of the clip under its name bar. */
function soundBarHeight({ trackHeight, waveformSize }: { trackHeight: number; waveformSize: number }): number {
	const share = waveformSize >= 100 ? 0.75 : waveformSize >= 60 ? 0.5 : 0.3;
	return Math.round((trackHeight - CLIP_NAME_BAR_PX) * share);
}

function hasSoundBar({
	element,
	mediaAsset,
}: {
	element: VideoElement;
	mediaAsset: MediaAsset | null;
}): boolean {
	return (
		mediaAsset !== null &&
		doesElementHaveEnabledAudio({ element, mediaAsset }) &&
		!isElementMuted({ element })
	);
}

/** The clip's own sound, drawn along the bottom of the video thumbnails (CapCut-style). */
function VideoAudioStrip({
	element,
	trackId,
	mediaAsset,
}: {
	element: VideoElement;
	trackId: string;
	mediaAsset: MediaAsset;
}) {
	const pixelsPerSecond = useContext(PixelsPerSecondContext);
	useTimelineStore((s) => s.trackHeight);
	const waveformSize = useTimelineStore((s) => s.waveformSize);
	const gainSamples = useMemo(
		() =>
			buildWaveformGainSamples({
				element,
				count: WAVEFORM_GAIN_SAMPLE_COUNT,
			}),
		[element],
	);
	if (pixelsPerSecond === null || !hasSoundBar({ element, mediaAsset })) {
		return null;
	}
	return (
		<div
			className="group/audio pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden"
			style={{ height: soundBarHeight({ trackHeight: getTrackHeight({ type: "video" }), waveformSize }) }}
		>
			<AudioWaveform
				clipId={element.id}
				sourceKey={buildWaveformSourceKey({ kind: "media", id: mediaAsset.id })}
				sourceFile={mediaAsset.file}
				gainSamples={gainSamples}
				pixelsPerSecond={pixelsPerSecond}
				clipDurationSec={element.duration / TICKS_PER_SECOND}
				retime={element.retime}
				sourceStartSec={element.trimStart / TICKS_PER_SECOND}
				color={TIMELINE_AUDIO_WAVEFORM_COLOR}
			/>
			{/* The clip's volume, draggable like on audio clips. */}
			<AudioVolumeLine
				element={element}
				trackId={trackId}
				hitAreaPx={10}
				samples={gainSamples}
				baseGain={resolveEffectiveAudioGain({ element, localTime: 0 })}
			/>
		</div>
	);
}

function MediaElementHeader({
	name,
	duration,
	leading,
}: {
	name?: string | null;
	/** The clip's length, shown after its name as CapCut does (00:00:13:00). */
	duration?: number;
	leading?: ReactNode;
}) {
	const fps = useEditor((e) => e.project.getActiveOrNull()?.settings.fps ?? null, ["project"]);
	if (!name && !leading) {
		return null;
	}

	return (
		<div
			data-clip-name-bar=""
			className="absolute top-0 left-0 flex w-full items-center"
			style={{ height: CLIP_NAME_BAR_PX }}
		>
			{leading && <div className="flex pl-1">{leading}</div>}
			{/* CapCut: the name and the length are two small tags on the bar. */}
			{name && (
				<span className="ml-0.5 min-w-0 truncate rounded-[3px] bg-white/12 px-1 text-[0.6rem] leading-[12px] text-white/90">
					{name}
				</span>
			)}
			{name && duration !== undefined && fps ? (
				// the name only; the length shows while the pointer is over the clip (the owner, 12.11)
				<span
					data-clip-duration=""
					className="ml-1 shrink-0 rounded-[3px] bg-white/12 px-1 text-[0.6rem] leading-[12px] tabular-nums text-white/80 opacity-0 transition-opacity duration-150 [[data-timeline-element-id]:hover_&]:opacity-100"
				>
					{formatFrameTimecode({ time: duration, fps })}
				</span>
			) : null}
		</div>
	);
}

function ElementContent({ element, track, mediaAsset }: ElementContentProps) {
	switch (element.type) {
		case "text":
			return <TextElementContent element={element} />;
		case "effect":
			return <EffectElementContent element={element} />;
		case "sticker":
			return <StickerElementContent element={element} />;
		case "graphic":
			return <GraphicElementContent element={element} />;
		case "audio":
			return (
				<>
					<AudioElementContent
						element={element}
						trackId={track.id}
						mediaAsset={mediaAsset}
					/>
					{/* a clip whose media file is lost says so (relink/offline.ts) */}
					<OfflineMediaBadge element={element} />
				</>
			);
		case "video":
		case "image":
			return (
				<>
					<TiledMediaContent
						element={element}
						track={track}
						mediaAsset={mediaAsset}
					/>
					<OfflineMediaBadge element={element} />
				</>
			);
	}
}

function CopyMenuItem() {
	return (
		<ActionMenuItem
			action="copy-selected"
			icon={<HugeiconsIcon icon={Copy01Icon} />}
		>
			Copy
		</ActionMenuItem>
	);
}

function MuteMenuItem({
	isMultipleSelected,
	isCurrentElementSelected,
	isMuted,
}: {
	isMultipleSelected: boolean;
	isCurrentElementSelected: boolean;
	isMuted: boolean;
}) {
	const getIcon = () => {
		if (isMultipleSelected && isCurrentElementSelected) {
			return <HugeiconsIcon icon={VolumeOffIcon} />;
		}
		return isMuted ? (
			<HugeiconsIcon icon={VolumeOffIcon} />
		) : (
			<HugeiconsIcon icon={VolumeHighIcon} />
		);
	};

	return (
		<ActionMenuItem action="toggle-elements-muted-selected" icon={getIcon()}>
			{isMuted ? "Unmute" : "Mute"}
		</ActionMenuItem>
	);
}

function VisibilityMenuItem({
	element,
	isMultipleSelected,
	isCurrentElementSelected,
}: {
	element: TimelineElementType;
	isMultipleSelected: boolean;
	isCurrentElementSelected: boolean;
}) {
	const isHidden = canElementBeHidden(element) && element.hidden;

	const getIcon = () => {
		if (isMultipleSelected && isCurrentElementSelected) {
			return <HugeiconsIcon icon={ViewOffSlashIcon} />;
		}
		return isHidden ? (
			<HugeiconsIcon icon={ViewIcon} />
		) : (
			<HugeiconsIcon icon={ViewOffSlashIcon} />
		);
	};

	return (
		<ActionMenuItem
			action="toggle-elements-visibility-selected"
			icon={getIcon()}
		>
			{isHidden ? "Activate clip" : "Deactivate clip"}
		</ActionMenuItem>
	);
}

/** One name for ⌫ everywhere («Удалить»): the menu, the shortcuts table and ⌘K say the same (register B1). */
function DeleteMenuItem() {
	return (
		<ActionMenuItem
			action="delete-selected"
			variant="destructive"
			icon={<HugeiconsIcon icon={Delete02Icon} />}
		>
			{actionName("delete-selected")}
		</ActionMenuItem>
	);
}

// Where the clip was right-clicked: Split cuts there when the playhead isn't over the clip (never a silent no-op).
let lastContextClientX = 0;
if (typeof window !== "undefined") {
	window.addEventListener(
		"contextmenu",
		(event) => {
			lastContextClientX = event.clientX;
			const node = (event.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-timeline-element-id]");
			menuClip = node?.dataset.timelineElementId && node.dataset.timelineTrackId ? { trackId: node.dataset.timelineTrackId, elementId: node.dataset.timelineElementId } : null;
		},
		true,
	);
}

/** The clip right-clicked last: its menu's commands act on it, so it is selected first unless it already is. */
let menuClip: { trackId: string; elementId: string } | null = null;
function selectMenuClip() {
	if (!menuClip) return;
	const selection = EditorCore.getInstance().selection;
	const clip = menuClip;
	if (!selection.getSelectedElements().some((ref) => ref.elementId === clip.elementId)) selection.setSelectedElements({ elements: [clip] });
}

function splitAtPlayheadOrClick(element: TimelineElementType) {
	seekIntoClipIfOutside(element);
	invokeAction("split");
}

/** The playhead inside the right-clicked clip, at the click, when it was somewhere else (Split, Delete left / right). */
function seekIntoClipIfOutside(element: TimelineElementType) {
	const editor = EditorCore.getInstance();
	const now = editor.playback.getCurrentTime() as number;
	const start = element.startTime as number;
	const end = start + (element.duration as number);
	if (!(now > start && now < end)) {
		const rect = document.querySelector(`[data-timeline-element-id="${element.id}"]`)?.getBoundingClientRect();
		if (rect && rect.width > 0) {
			const at = start + ((lastContextClientX - rect.left) / rect.width) * (element.duration as number);
			// On a frame, like every other cut: a cut between frames left both halves' edges off the frame grid.
			const fps = editor.project.getActive()?.settings.fps;
			const onFrame = fps ? roundFrameTicks({ ticks: Math.round(at), fps }) : Math.round(at);
			const frame = fps ? (TICKS_PER_SECOND * fps.denominator) / fps.numerator : 1;
			const inside =
				onFrame > start && onFrame < end
					? onFrame
					: Math.round(Math.min(end - 1, Math.max(start + 1, onFrame + (onFrame <= start ? frame : -frame))));
			editor.playback.seek({ time: inside as never });
		}
	}
}

function ActionMenuItem({
	action,
	children,
	...props
}: Omit<ComponentProps<typeof ContextMenuItem>, "onClick" | "textRight"> & {
	action: TActionWithOptionalArgs;
	/** The row's text; by default the action's one name (actions/names.ts). */
	children?: ReactNode;
}) {
	useT();
	return (
		<ContextMenuItem
			onClick={(event: React.MouseEvent) => {
				event.stopPropagation();
				selectMenuClip();
				invokeAction(action);
			}}
			textRight={getDisplayShortcut({ action })}
			{...props}
		>
			{children ?? actionName(action)}
		</ContextMenuItem>
	);
}
