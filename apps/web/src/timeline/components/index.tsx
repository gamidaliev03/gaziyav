"use client";

import { centeredTracksOffset, setTracksTopOffset } from "@/timeline/tracks-offset";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	MagicWand05Icon,
	MusicNote01Icon,
	TextIcon,
	ViewIcon,
	ViewOffSlashIcon,
	VolumeHighIcon,
	VolumeOffIcon,
	MoreHorizontalIcon,
	SquareLock02Icon,
	SquareUnlock02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@/components/ui/icon";
import { OcShapesIcon, OcVideoIcon } from "@/components/icons";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { closeAllGaps, closeGapAt, closeTrackGapAt, closeTrackGaps } from "@/timeline/gaps";
import { getLivePixelsPerSecond } from "@/timeline/live-pps";
import { useTimelineZoom } from "@/timeline/hooks/use-timeline-zoom";
import { fitZoomFor, useTimelineZoomActions } from "@/actions/use-timeline-zoom-actions";
import {
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
	useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { useContainerSize } from "@/hooks/use-container-size";
import { useToastsAboveTimeline } from "@/timeline/hooks/use-toasts-above-timeline";
import { flushTimelineDraws } from "@/timeline/draw-batch";
import { type MediaTime, mediaTime, roundFrameTime, TICKS_PER_SECOND } from "@/wasm";
import { BASE_TIMELINE_PIXELS_PER_SECOND } from "@/timeline/scale";
import type {
	ElementDragView,
	DropTarget,
	TimelineElement as TimelineElementType,
} from "@/timeline";
import { duplicateMarks as duplicateMarksOf } from "@/timeline/duplicate-sources";
import {
	TimelineTrackContent,
	type TimelineRenderWindow,
} from "./timeline-track";
import { getDisplayShortcut, TimelineElementContextMenuContent } from "./timeline-element";
import { KeyframeContextMenuItems } from "./keyframe-context-menu";
import type { SelectedKeyframeRef } from "@/animation/types";
import type { MediaAsset } from "@/media/types";
import { useCommittedRef } from "@/hooks/use-committed-ref";
import { TimelinePlayhead } from "./timeline-playhead";
import { SelectionBox } from "@/selection/selection-box";
import { useBoxSelect } from "@/selection/hooks/use-box-select";
import { SnapIndicator } from "./snap-indicator";
import { hapticTimelineSnap } from "@/haptics";
import { LevelMeter } from "./level-meter";
import type { SnapPoint } from "@/timeline/snapping";
import type { TimelineTrack } from "@/timeline";
import {
	TIMELINE_SCROLLBAR_SIZE_PX,
	TIMELINE_CONTENT_TOP_PADDING_PX,
	TIMELINE_TRACK_GAP_PX,
	TIMELINE_TRACK_LABELS_COLUMN_WIDTH_PX,
	KEYFRAME_LANE_HEIGHT_PX,
} from "./layout";
import { useElementInteraction } from "@/timeline/hooks/element/use-element-interaction";
import {
	canTrackHaveAudio,
	canTrackBeHidden,
	getTimelineZoomMin,
	getTimelinePaddingPx,
	getTimelinePixelsPerSecond,
} from "@/timeline";
import { timelineTimeToPixels } from "@/timeline/pixel-utils";
import {
	getTrackHeight,
	getCumulativeHeightBefore,
	getTotalTracksHeight,
} from "./track-layout";
import { SELECTED_TRACK_ROW_CLASS } from "./theme";
import {
	computeTrackExpansionHeight,
	getTrackExpandedRows,
	getPropertyLabel,
	type ExpandedRow,
} from "./expanded-layout";
import { TIMELINE_HORIZONTAL_WHEEL_STEP_PX } from "./interaction";
import { TimelineToolbar } from "./timeline-toolbar";
import {
	useElementSelection,
	useElementSelectionActions,
} from "@/timeline/hooks/element/use-element-selection";
import { useTimelineSeek } from "@/timeline/hooks/use-timeline-seek";
import { useTimelineDragDrop } from "@/timeline/hooks/use-timeline-drag-drop";
import { TimelineRuler as TimelineRulerImpl } from "./timeline-ruler";
import {
	TimelineBookmarksRow as TimelineBookmarksRowImpl,
	useBookmarkDrag,
} from "@/timeline/bookmarks/index";

// The ruler and bookmark row only change with zoom/width/drag state; memoized
// (with stable handlers below) they skip the re-render on every timeline edit.
const TimelineRuler = memo(TimelineRulerImpl);
const TimelineBookmarksRow = memo(TimelineBookmarksRowImpl);
// Same for parts that watch their own state: they skip the timeline's re-render on every zoom step / edit.
const MemoLevelMeter = memo(LevelMeter);

function useStableCallback<Args extends unknown[], R>(
	fn: (...args: Args) => R,
): (...args: Args) => R {
	const ref = useCommittedRef(fn);
	return useCallback((...args: Args) => ref.current(...args), [ref]);
}
import { useEdgeAutoScroll } from "@/timeline/hooks/use-edge-auto-scroll";
import { useInitialScrollBottom } from "@/timeline/hooks/use-initial-scroll-bottom";
import { useTimelineResize } from "@/timeline/hooks/use-timeline-resize";
import { type TrackHeightChoice, useTimelineStore, type WaveformSizeChoice } from "@/timeline/timeline-store";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toggleTrackLock, useLockedTrackSelectionGuard } from "@/timeline/track-lock";
import { useEditor } from "@/editor/use-editor";
import { useScrollBucket } from "@/timeline/hooks/use-scroll-position";
import { useRenderWindow } from "@/timeline/hooks/use-render-window";
import { useTimelinePlayhead } from "@/timeline/hooks/use-timeline-playhead";
import { DragLine } from "./drag-line";
import { DropGhost, MoveLanding } from "./drop-ghost";
import { HoverAxis } from "./hover-axis";
import { TrimLayer } from "@/timeline/trim/components/trim-layer";
import { speedOff } from "@/timeline/speed-flags";
import { useSplitCursor } from "@/timeline/hooks/use-split-cursor";
import { PasteAttributesDialog } from "@/actions/components/paste-attributes-dialog";
import { invokeAction } from "@/actions";
import { resolveTimelineElementIntersections } from "./selection-hit-testing";
import { cn } from "@/utils/ui";

const TRACKS_CONTAINER_MAX_HEIGHT = 800;
const FALLBACK_CONTAINER_WIDTH = 1000;
const TRACKS_CONTAINER_HEIGHT = { min: 0, max: TRACKS_CONTAINER_MAX_HEIGHT };
const TRACK_LABELS: Record<TimelineTrack["type"], string> = {
	video: "Video",
	text: "Text",
	audio: "Audio",
	graphic: "Graphic",
	effect: "Effect",
};
const TRACK_ICONS: Record<TimelineTrack["type"], ReactNode> = {
	video: <OcVideoIcon className="text-muted-foreground size-4 shrink-0" />,
	text: (
		<HugeiconsIcon
			icon={TextIcon}
			className="text-muted-foreground size-4 shrink-0"
		/>
	),
	audio: (
		<HugeiconsIcon
			icon={MusicNote01Icon}
			className="text-muted-foreground size-4 shrink-0"
		/>
	),
	graphic: <OcShapesIcon className="text-muted-foreground size-4 shrink-0" />,
	effect: (
		<HugeiconsIcon
			icon={MagicWand05Icon}
			className="text-muted-foreground size-4 shrink-0"
		/>
	),
};

export function Timeline() {
	const snappingEnabled = useTimelineStore((s) => s.snappingEnabled);
	const timelineTool = useTimelineStore((s) => s.tool);
	const splitCursorOff = speedOff("cursor");
	// Actions only: the timeline shell must not re-render on every click. The rows, the track
	// labels and the toolbar subscribe to the selection themselves.
	const {
		getSelectedElements,
		clearElementSelection,
		setElementSelection,
		mergeElementsIntoSelection,
	} = useElementSelectionActions();
	const editor = useEditor();
	const timeline = editor.timeline;
	useLockedTrackSelectionGuard(editor);
	const scene = useEditor(
		(currentEditor) => currentEditor.scenes.getActiveSceneOrNull(),
		["scenes", "timeline"],
	);
	const tracks = useMemo<TimelineTrack[]>(
		() =>
			scene
				? [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]
				: [],
		[scene],
	);
	const seek = (time: MediaTime) => editor.playback.seek({ time });

	const sectionRef = useRef<HTMLElement>(null);
	useToastsAboveTimeline(sectionRef);
	const timelineRef = useRef<HTMLDivElement>(null);
	const timelineHeaderRef = useRef<HTMLDivElement>(null);
	const rulerRef = useRef<HTMLDivElement>(null);
	const rulerScrollRef = useRef<HTMLDivElement>(null);
	const tracksContainerRef = useRef<HTMLDivElement>(null);
	useSplitCursor(tracksContainerRef, timelineTool === "split" && !splitCursorOff);
	const tracksScrollRef = useRef<HTMLDivElement>(null);
	const trackLabelsRef = useRef<HTMLDivElement>(null);
	const playheadRef = useRef<HTMLDivElement>(null);
	const trackLabelsScrollRef = useRef<HTMLDivElement>(null);

	const [currentSnapPoint, setCurrentSnapPoint] = useState<SnapPoint | null>(
		null,
	);
	const { width: tracksContainerWidth } = useContainerSize({
		containerRef: tracksContainerRef,
	});
	const { height: timelineHeaderHeightValue } = useContainerSize({
		containerRef: timelineHeaderRef,
	});
	const { viewportWidth: tracksViewportWidth, scrollBucket } =
		useScrollBucket({
			scrollRef: tracksScrollRef,
			publishViewport: true,
		});

	// Drags report a snap point on every pointer move (a new object each time): keep the old one when it
	// is the same point, so the timeline doesn't re-render on every move while snapped.
	const handleSnapPointChange = useCallback((snapPoint: SnapPoint | null) => {
		hapticTimelineSnap(snapPoint); // a tap as the snap engages (haptics)
		setCurrentSnapPoint((previous) =>
			previous === snapPoint ||
			(previous !== null &&
				snapPoint !== null &&
				previous.time === snapPoint.time &&
				previous.type === snapPoint.type &&
				previous.elementId === snapPoint.elementId &&
				previous.trackId === snapPoint.trackId)
				? previous
				: snapPoint,
		);
	}, []);

	const timelineDuration = timeline.getTotalDuration() || 0;
	const containerWidth = tracksContainerWidth || FALLBACK_CONTAINER_WIDTH;
	// A clip dragged over an empty timeline counts as its length already: the minimum zoom of an empty timeline
	// (1 s) would not let the ghost be drawn at the zoom the clip gets on the drop (see ghostTicksOnEmpty below).
	const [emptyGhostTicks, setEmptyGhostTicks] = useState(0);
	const minZoomLevel = getTimelineZoomMin({
		duration: Math.max(timelineDuration, emptyGhostTicks),
		containerWidth,
	});

	const savedViewState = editor.project.getTimelineViewState();

	const { zoomLevel, setZoomLevel, zoomAt, handleWheel, saveScrollPosition, projectScrollLeft } =
		useTimelineZoom({
			containerRef: timelineRef,
			minZoom: minZoomLevel,
			initialZoom: savedViewState?.zoomLevel,
			initialScrollLeft: savedViewState?.scrollLeft,
			initialPlayheadTime: savedViewState?.playheadTime,
			tracksScrollRef,
			rulerScrollRef,
		});
	useTimelineZoomActions({
		setZoomLevel,
		minZoom: minZoomLevel,
		zoomLevel,
		tracksScrollRef,
		rulerScrollRef,
	});
	const setZoomLevelForToolbarRef = useCommittedRef(setZoomLevel);
	const zoomLevelRef = useCommittedRef(zoomLevel);
	const setToolbarZoom = useCallback(
		({ zoom }: { zoom: number }) => setZoomLevelForToolbarRef.current(zoom),
		[setZoomLevelForToolbarRef],
	);
	const { isResizing, handleResizeStart, getResizePointerX } = useTimelineResize({
		zoomLevel,
		tracksScrollRef,
		onSnapPointChange: handleSnapPointChange,
	});

	const expandedElementIds = useTimelineStore((s) => s.expandedElementIds);

	const getTrackExpansionHeight = useCallback(
		(trackIndex: number) => {
			const track = tracks[trackIndex];
			if (!track) return 0;
			return computeTrackExpansionHeight({ track, expandedElementIds });
		},
		[tracks, expandedElementIds],
	);

	// The main track's ⋯ → Track height lays every row out again.
	useTimelineStore((s) => s.trackHeight);
	// CapCut: a short stack of tracks sits in the middle of the timeline, not under the ruler.
	const { height: tracksViewportHeight } = useContainerSize({ containerRef: tracksScrollRef });
	const tracksTopOffset = centeredTracksOffset({
		viewportHeight: tracksViewportHeight - TIMELINE_CONTENT_TOP_PADDING_PX,
		stackHeight: getTotalTracksHeight({ tracks, getExtraHeight: getTrackExpansionHeight }),
	});
	setTracksTopOffset(tracksTopOffset);

	// Stable refs so the wheel listener never goes stale
	const zoomAtRef = useRef(zoomAt);
	useEffect(() => {
		zoomAtRef.current = zoomAt;
	}, [zoomAt]);

	const saveScrollPositionRef = useRef(saveScrollPosition);
	useEffect(() => {
		saveScrollPositionRef.current = saveScrollPosition;
	}, [saveScrollPosition]);

	const minZoomLevelRef = useRef(minZoomLevel);
	useEffect(() => {
		minZoomLevelRef.current = minZoomLevel;
	}, [minZoomLevel]);

	// CapCut: each timeline (a tab, a compound clip opened) keeps its own zoom and scroll, and one not shown before
	// opens fitted. The project keeps a single view state: an empty timeline's zoom used to carry over, and back on
	// Timeline 01 its clips were off screen.
	const shownSceneId = scene?.id ?? null;
	// the memory lives in the scenes manager (one per project, cleared with its scenes): a compound clip left by any
	// way (Back, Esc, the breadcrumb) finds its parent's zoom and scroll there, level by level (compositions.ts)
	const lastSceneIdRef = useRef(shownSceneId);
	// The scroll as the user last left it, kept on every scroll (syncFollowers): read off the scroller at the switch it
	// was already the next timeline's — a shorter one (a compound clip) is narrower and the browser had clamped it to 0.
	const shownScrollLeftRef = useRef(0);
	useLayoutEffect(() => {
		const previous = lastSceneIdRef.current;
		if (previous === shownSceneId) return;
		lastSceneIdRef.current = shownSceneId;
		if (previous) {
			editor.scenes.rememberView(previous, { zoom: zoomLevelRef.current, scrollLeft: shownScrollLeftRef.current });
		}
		const saved = shownSceneId ? editor.scenes.viewOf(shownSceneId) : undefined;
		setZoomLevel(saved?.zoom ?? minZoomLevel);
		const scrollLeft = saved?.scrollLeft ?? 0;
		shownScrollLeftRef.current = scrollLeft;
		requestAnimationFrame(() => {
			if (tracksScrollRef.current) tracksScrollRef.current.scrollLeft = scrollLeft;
		});
	}, [shownSceneId, minZoomLevel, setZoomLevel, zoomLevelRef, editor]);

	// Pushes tracks scroll position to the two overflow:hidden followers
	// (ruler and track labels). Called from the wheel handler (before paint,
	// zero lag) and from onScroll on the tracks area (covers scrollbar drag).
	const syncFollowers = useCallback(() => {
		const tracks = tracksScrollRef.current;
		if (!tracks) return;
		shownScrollLeftRef.current = tracks.scrollLeft;
		if (rulerScrollRef.current) {
			rulerScrollRef.current.scrollLeft = tracks.scrollLeft;
		}
		if (trackLabelsScrollRef.current) {
			trackLabelsScrollRef.current.scrollTop = tracks.scrollTop;
		}
	}, []);

	// Single non-passive capture listener owns all wheel input. Prevents any
	// native scroll or browser zoom from firing inside the timeline.
	useEffect(() => {
		const container = timelineRef.current;
		if (!container) return;

		let pendingZoomDelta = 0;
		let pendingZoomClientX = 0;
		let zoomRafId: ReturnType<typeof requestAnimationFrame> | null = null;

		const onWheel = (e: WheelEvent) => {
			// CapCut: ⌘+wheel zooms (a trackpad pinch arrives as ctrlKey), ⌥+wheel scrolls the time, the wheel scrolls tracks.
			const isZoom = e.ctrlKey || e.metaKey;

			if (isZoom) {
				e.preventDefault();
				// This listener is the only zoom. The ruler and the marker strip also pass their wheel
				// to the zoom controller, which zoomed a second time: over them ⌘-wheel / pinch zoomed
				// twice as fast as over the tracks.
				e.stopPropagation();
				const normalizedDelta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
				pendingZoomDelta += normalizedDelta;
				pendingZoomClientX = e.clientX;

				if (zoomRafId === null) {
					zoomRafId = requestAnimationFrame(() => {
						const frameRawDelta = pendingZoomDelta;
						const cappedDelta =
							Math.sign(frameRawDelta) * Math.min(Math.abs(frameRawDelta), 30);
						const zoomFactor = Math.exp(-cappedDelta / 300);
						pendingZoomDelta = 0;
						zoomRafId = null;
						// Render the new zoom inside this animation frame, so this frame already shows it.
						// Set from here, the update was rendered in a task after the frame and appeared one
						// frame (~16 ms) later; the waveforms and filmstrips then took one more frame.
						// Around the pointer: the moment under the mouse stays under it.
						flushSync(() => {
							zoomAtRef.current({
								zoomLevel: (prev) => prev * zoomFactor,
								clientX: pendingZoomClientX,
							});
						});
						flushTimelineDraws();
					});
				}
				return;
			}

			const tracks = tracksScrollRef.current;
			if (!tracks) return;

			e.preventDefault();

			// Two-finger trackpad scrolls both axes; ⌥+wheel (CapCut) and ⇧+wheel scroll horizontally. Only a mouse wheel
			// turned sideways goes in steps: the trackpad's own deltaX (its fling, macOS's inertia) is taken whole — capped,
			// a quick swipe stopped short and the glide died early.
			const sideways = (e.altKey || e.shiftKey) && !e.deltaX;
			const dx = sideways ? Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), TIMELINE_HORIZONTAL_WHEEL_STEP_PX) : e.deltaX;
			const dy = sideways ? 0 : e.deltaY;
			tracks.scrollLeft = Math.max(0, tracks.scrollLeft + dx);
			tracks.scrollTop = Math.max(0, tracks.scrollTop + dy);

			syncFollowers();
			saveScrollPositionRef.current();
		};

		container.addEventListener("wheel", onWheel, {
			passive: false,
			capture: true,
		});
		return () => {
			container.removeEventListener("wheel", onWheel, { capture: true });
			if (zoomRafId !== null) cancelAnimationFrame(zoomRafId);
		};
	}, [syncFollowers]);

	const saveScrollPositionStable = useCallback(
		() => saveScrollPositionRef.current(),
		[],
	);
	useInitialScrollBottom({
		tracksScrollRef,
		trackLabelsScrollRef,
		// Stable: an inline arrow re-ran this hook's layout effect (a forced
		// layout of the whole timeline) on every Timeline render while the
		// tracks don't overflow vertically.
		onAfterScroll: saveScrollPositionStable,
		isReady: tracks.length > 0,
	});

	// Re-renders this shell only when a drag starts or ends; each pointer move re-renders just the rows
	// and the drop line (they read the controller's view).
	const {
		dragController,
		isDragging: isElementDragging,
		handleElementMouseDown,
		handleElementClick,
	} = useElementInteraction({
		zoomLevel,
		tracksContainerRef,
		tracksScrollRef,
		snappingEnabled,
		onSnapPointChange: handleSnapPointChange,
	});

	// Stable element handlers: memoized elements must not re-render because the
	// parent re-rendered. The element passes itself; the live track is looked up.
	const elementHandlersRef = useCommittedRef({
		handleElementMouseDown,
		handleElementClick,
		handleResizeStart,
	});
	// The live element + its track. Memoized clip content may hold a stale
	// element object (e.g. an old startTime after a ripple shift), so handlers
	// always re-resolve it from the scene.
	const findLiveElement = useCallback(
		(
			elementId: string,
		): { track: TimelineTrack; element: TimelineElementType } | null => {
			const sceneTracks = editor.scenes.getActiveSceneOrNull()?.tracks;
			if (!sceneTracks) return null;
			for (const track of [
				sceneTracks.main,
				...sceneTracks.overlay,
				...sceneTracks.audio,
			]) {
				const element = track.elements.find(
					(candidate) => candidate.id === elementId,
				);
				if (element) return { track, element };
			}
			return null;
		},
		[editor],
	);
	const findTrackOfElement = useCallback(
		(elementId: string): TimelineTrack | null =>
			findLiveElement(elementId)?.track ?? null,
		[findLiveElement],
	);
	const onElementMouseDown = useCallback(
		({
			event,
			element,
		}: {
			event: React.MouseEvent;
			element: TimelineElementType;
		}) => {
			const live = findLiveElement(element.id);
			if (!live) return;
			// Split tool (B): a press on a clip cuts it under the pointer (on the frame grid); no select, no drag.
			if (useTimelineStore.getState().tool === "split" && event.button === 0) {
				event.preventDefault();
				event.stopPropagation();
				const scroller = tracksScrollRef.current;
				if (!scroller) return;
				const x = event.clientX - scroller.getBoundingClientRect().left + scroller.scrollLeft;
				const zoom = zoomLevelRef.current;
				const raw = mediaTime({ ticks: Math.round((x / (BASE_TIMELINE_PIXELS_PER_SECOND * zoom)) * TICKS_PER_SECOND) });
				const fps = editor.project.getActiveOrNull()?.settings.fps;
				const splitTime = fps ? roundFrameTime({ time: raw, fps }) : raw;
				if (splitTime > live.element.startTime && splitTime < live.element.startTime + live.element.duration) {
					editor.timeline.splitElements({ elements: [{ trackId: live.track.id, elementId: live.element.id }], splitTime });
				}
				return;
			}
			elementHandlersRef.current.handleElementMouseDown({
				event,
				element: live.element,
				track: live.track,
			});
		},
		[findLiveElement, elementHandlersRef, editor, zoomLevelRef],
	);
	const onElementClick = useCallback(
		({
			event,
			element,
		}: {
			event: React.MouseEvent;
			element: TimelineElementType;
		}) => {
			const live = findLiveElement(element.id);
			if (!live) return;
			if (useTimelineStore.getState().tool === "split") return;
			elementHandlersRef.current.handleElementClick({
				event,
				element: live.element,
				track: live.track,
			});
		},
		[findLiveElement, elementHandlersRef],
	);
	const onResizeStart = useCallback(
		({
			event,
			element,
			track,
			side,
		}: {
			event: React.MouseEvent;
			element: TimelineElementType;
			track: TimelineTrack;
			side: "left" | "right";
		}) => {
			const live = findLiveElement(element.id);
			elementHandlersRef.current.handleResizeStart({
				event,
				element: live?.element ?? element,
				track: live?.track ?? track,
				side,
			});
		},
		[findLiveElement, elementHandlersRef],
	);

	// Virtualization window (hooks/use-render-window.ts): the screen plus half a screen on each side, snapped to
	// quarter-screen buckets; a zoom step's window is where its scroll lands.
	const renderWindow = useRenderWindow({
		viewportWidth: tracksViewportWidth,
		scrollBucket,
		zoomLevel,
		projectedScrollLeft: projectScrollLeft(zoomLevel, tracksViewportWidth),
	});

	const {
		dragState: bookmarkDragState,
		handleBookmarkMouseDown,
		lastMouseXRef: bookmarkLastMouseXRef,
	} = useBookmarkDrag({
		zoomLevel,
		scrollRef: tracksScrollRef,
		snappingEnabled,
		onSnapPointChange: handleSnapPointChange,
	});

	const { handleRulerMouseDown: handlePlayheadRulerMouseDown } =
		useTimelinePlayhead({
			zoomLevel,
			rulerRef,
			rulerScrollRef,
			tracksScrollRef,
			playheadRef,
			followPlayback: false,
		});

	const { isDragOver, dropTarget, dropGhost, dropCut, isDropForbidden, dragProps } = useTimelineDragDrop({
		containerRef: tracksContainerRef,
		tracksScrollRef,
		zoomLevel,
		onSnapPointChange: handleSnapPointChange,
	});
	// A clip dragged over an empty timeline: the zoom becomes the one the first clip gets on the drop (⇧Z), so the
	// ghost is drawn where the clip lands — drawn at the old zoom it was 2–4× wider and ran off the right edge.
	const ghostTicksOnEmpty = timelineDuration <= 0 && dropGhost ? dropGhost.duration : 0;
	useEffect(() => setEmptyGhostTicks(ghostTicksOnEmpty), [ghostTicksOnEmpty]);
	useEffect(() => {
		if (ghostTicksOnEmpty <= 0) return;
		const viewport = tracksScrollRef.current?.clientWidth ?? 0;
		if (viewport <= 0) return;
		setZoomLevel(fitZoomFor({ viewport, seconds: ghostTicksOnEmpty / TICKS_PER_SECOND, minZoom: minZoomLevel }));
	}, [ghostTicksOnEmpty, minZoomLevel, setZoomLevel]);

	const {
		selectionBox,
		handleMouseDown: handleSelectionMouseDown,
		isSelecting,
		shouldIgnoreClick,
	} = useBoxSelect({
		containerRef: tracksContainerRef,
		selectedIds: getSelectedElements,
		anchorId: null,
		getIsAdditiveSelection: (event) =>
			event.shiftKey || event.ctrlKey || event.metaKey,
		resolveIntersections: ({ startPos, currentPos }) => {
			if (!tracksContainerRef.current) {
				return [];
			}

			return resolveTimelineElementIntersections({
				container: tracksContainerRef.current,
				scrollContainer: tracksScrollRef.current,
				tracks,
				zoomLevel,
				startPos,
				currentPos,
			});
		},
		onSelectionChange: ({ intersectedIds, isAdditive }) => {
			if (isAdditive) {
				mergeElementsIntoSelection({ elements: intersectedIds });
			} else {
				setElementSelection({ elements: intersectedIds });
			}
		},
	});

	const contentWidth = timelineTimeToPixels({
		time: timelineDuration,
		zoomLevel,
	});
	const paddingPx = getTimelinePaddingPx({
		containerWidth,
		zoomLevel,
		minZoom: minZoomLevel,
	});
	const dynamicTimelineWidth = Math.max(
		contentWidth + paddingPx,
		containerWidth,
	);
	const hasHorizontalScrollbar =
		dynamicTimelineWidth > (tracksViewportWidth || containerWidth);

	useEdgeAutoScroll({
		isActive: bookmarkDragState.isDragging,
		getMouseClientX: () => bookmarkLastMouseXRef.current,
		rulerScrollRef,
		tracksScrollRef,
		contentWidth: dynamicTimelineWidth,
	});

	useEdgeAutoScroll({
		isActive: isElementDragging,
		getMouseClientX: () => {
			const view = dragController.view;
			return view.kind === "dragging" ? view.currentMouseX : 0;
		},
		rulerScrollRef,
		tracksScrollRef,
		contentWidth: dynamicTimelineWidth,
	});

	// Trimming an edge past the visible part scrolls the timeline, like dragging a clip does.
	useEdgeAutoScroll({
		isActive: isResizing,
		getMouseClientX: getResizePointerX,
		rulerScrollRef,
		tracksScrollRef,
		contentWidth: dynamicTimelineWidth,
	});

	const showSnapIndicator =
		snappingEnabled &&
		currentSnapPoint !== null &&
		(isElementDragging || bookmarkDragState.isDragging || isResizing || isDragOver);

	const {
		handleTracksMouseDown,
		handleTracksClick,
		handleRulerMouseDown,
		handleRulerClick,
	} = useTimelineSeek({
		playheadRef,
		trackLabelsRef,
		rulerScrollRef,
		tracksScrollRef,
		zoomLevel,
		duration: timeline.getTotalDuration(),
		isSelecting,
		clearSelectedElements: clearElementSelection,
		seek,
	});

	const timelineHeaderHeight =
		timelineHeaderHeightValue + TIMELINE_CONTENT_TOP_PADDING_PX;

	const stableHandleWheel = useStableCallback(handleWheel);
	const stableHandleRulerClick = useStableCallback(handleRulerClick);
	const stableHandleRulerMouseDown = useStableCallback(handleRulerMouseDown);
	const stableHandlePlayheadRulerMouseDown = useStableCallback(
		handlePlayheadRulerMouseDown,
	);
	const stableHandleBookmarkMouseDown = useStableCallback(
		handleBookmarkMouseDown,
	);

	const trackHandlersRef = useCommittedRef({
		handleSelectionMouseDown,
		handleTracksMouseDown,
		handleTracksClick,
		shouldIgnoreClick,
	});
	const onTrackMouseDown = useCallback(
		(event: React.MouseEvent) => {
			trackHandlersRef.current.handleSelectionMouseDown(event);
			trackHandlersRef.current.handleTracksMouseDown(event);
		},
		[trackHandlersRef],
	);
	const onTrackMouseUp = useCallback(
		(event: React.MouseEvent) => {
			trackHandlersRef.current.handleTracksClick(event);
		},
		[trackHandlersRef],
	);
	const shouldIgnoreTrackClick = useCallback(
		() => trackHandlersRef.current.shouldIgnoreClick(),
		[trackHandlersRef],
	);

	// One context menu for every element and track (instead of a Radix menu
	// tree per element). The right-clicked target is kept in state.
	const [contextTarget, setContextTarget] = useState<
		| { kind: "keyframe"; refs: SelectedKeyframeRef[] }
		| { kind: "element"; trackId: string; elementId: string }
		| { kind: "track"; trackId: string; time: number }
		| { kind: "empty" }
		| null
	>(null);
	const handleTracksContextMenu = useCallback((event: React.MouseEvent) => {
		const target = event.target as HTMLElement | null;
		// A ◆ first: its own menu (delete it, its parameter's keys, the clip's keys).
		const diamond = target?.closest<HTMLElement>("[data-keyframe-refs]");
		if (diamond?.dataset.keyframeRefs) {
			setContextTarget({ kind: "keyframe", refs: JSON.parse(diamond.dataset.keyframeRefs) as SelectedKeyframeRef[] });
			return;
		}
		const elementNode = target?.closest<HTMLElement>(
			"[data-timeline-element-id]",
		);
		if (elementNode?.dataset.timelineElementId && elementNode.dataset.timelineTrackId) {
			setContextTarget({
				kind: "element",
				trackId: elementNode.dataset.timelineTrackId,
				elementId: elementNode.dataset.timelineElementId,
			});
			return;
		}
		const trackNode = target?.closest<HTMLElement>("[data-timeline-track-row]");
		if (trackNode?.dataset.timelineTrackRow) {
			// Where on the track (CapCut's «Close gap» closes the gap under the pointer).
			const rect = trackNode.getBoundingClientRect();
			const pps = getLivePixelsPerSecond();
			setContextTarget({
				kind: "track",
				trackId: trackNode.dataset.timelineTrackRow,
				time: pps > 0 ? ((event.clientX - rect.left) / pps) * TICKS_PER_SECOND : -1,
			});
			return;
		}
		// Empty area: only "New Remotion AI Composition".
		setContextTarget({ kind: "empty" });
	}, []);

	return (
		<section
			className={
				"panel bg-background relative flex h-full flex-col overflow-hidden rounded-sm border"
			}
			{...dragProps}
			ref={sectionRef}
			aria-label="Timeline"
		>
			<TimelineToolbar
				zoomLevel={zoomLevel}
				minZoom={minZoomLevel}
				setZoomLevel={setToolbarZoom}
			/>

			<div className="relative flex flex-1 overflow-hidden" ref={timelineRef}>
				<TrackLabelsPanel
					trackLabelsRef={trackLabelsRef}
					trackLabelsScrollRef={trackLabelsScrollRef}
					timelineHeaderHeight={timelineHeaderHeight}
					hasHorizontalScrollbar={hasHorizontalScrollbar}
					getTrackExpansionHeight={getTrackExpansionHeight}
					tracksTopOffset={tracksTopOffset}
				/>

				<div
					className={cn(
						"relative isolate flex flex-1 flex-col overflow-hidden",
						// Split tool (B): the blade cursor over the clips — on the element under the pointer (useSplitCursor);
						// the old class restyled every element under the tracks on B and A (switch `cursor`).
						timelineTool === "split" && splitCursorOff && "[&_*]:cursor-crosshair!",
					)}
					ref={tracksContainerRef}
					data-timeline-tool={timelineTool}
				>
					<SelectionBox
						bounds={selectionBox?.bounds ?? null}
					/>
					<DragLine
						dropTarget={dropTarget}
						tracks={tracks}
						isVisible={isDragOver && !dropTarget?.targetElement}
						headerHeight={timelineHeaderHeight}
					/>
					{isElementDragging && (
						<ElementDragLine
							controller={dragController}
							tracks={tracks}
							headerHeight={timelineHeaderHeight}
						/>
					)}

					{/* Composited scroller: following the tracks' scrollLeft is then a
					    compositor-only change instead of a repaint every scroll frame. */}
					<div
						ref={rulerScrollRef}
						className="shrink-0 overflow-hidden"
						style={{ willChange: "scroll-position" }}
					>
						<div
							ref={timelineHeaderRef}
							className="flex flex-col"
							style={{ width: `${dynamicTimelineWidth}px` }}
						>
							<TimelineRuler
								zoomLevel={zoomLevel}
								dynamicTimelineWidth={dynamicTimelineWidth}
								rulerRef={rulerRef}
								tracksScrollRef={rulerScrollRef}
								handleWheel={stableHandleWheel}
								handleTimelineContentClick={stableHandleRulerClick}
								handleRulerTrackingMouseDown={stableHandleRulerMouseDown}
								handleRulerMouseDown={stableHandlePlayheadRulerMouseDown}
								tickWindow={renderWindow}
							/>
							<TimelineBookmarksRow
								zoomLevel={zoomLevel}
								dynamicTimelineWidth={dynamicTimelineWidth}
								dragState={bookmarkDragState}
								onBookmarkMouseDown={stableHandleBookmarkMouseDown}
								handleWheel={stableHandleWheel}
								handleRulerMouseDown={stableHandlePlayheadRulerMouseDown}
								renderWindow={renderWindow}
							/>
						</div>
					</div>

					<ScrollArea
						className="flex-1"
						data-timeline-tracks-scroll=""
						data-drop-effect={isDragOver ? (isDropForbidden ? "none" : "copy") : undefined}
						ref={tracksScrollRef}
						onScroll={() => {
							syncFollowers();
							saveScrollPosition();
						}}
					>
						<div
							className="flex min-h-full flex-col"
							style={{ width: `${dynamicTimelineWidth}px` }}
						>
							<ContextMenu>
							<ContextMenuTrigger asChild onContextMenu={handleTracksContextMenu}>
							{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- spatial gesture surface (tracks container background); direct-target clicks here originate box-select or clear selection. Keyboard control is global timeline shortcuts. */}
							<div
								className="relative shrink-0"
								style={{
									height: `${
										Math.max(
											TRACKS_CONTAINER_HEIGHT.min,
											Math.min(
												TRACKS_CONTAINER_HEIGHT.max,
												getTotalTracksHeight({
													tracks,
													getExtraHeight: getTrackExpansionHeight,
												}),
											),
										) + TIMELINE_CONTENT_TOP_PADDING_PX + tracksTopOffset
									}px`,
								}}
								onMouseDown={(event) => {
									const isDirectTarget = event.target === event.currentTarget;
									if (!isDirectTarget) return;
									event.stopPropagation();
									handleTracksMouseDown(event);
									handleSelectionMouseDown(event);
								}}
								onClick={(event) => {
									const isDirectTarget = event.target === event.currentTarget;
									if (!isDirectTarget) return;
									event.stopPropagation();
									handleTracksClick(event);
								}}
							>
								{tracks.length > 0 && (
									<TimelineTrackRows
										zoomLevel={zoomLevel}
										dragController={dragController}
										onResizeStart={onResizeStart}
										onElementMouseDown={onElementMouseDown}
										onElementClick={onElementClick}
										onTrackMouseDown={onTrackMouseDown}
										onTrackMouseUp={onTrackMouseUp}
										shouldIgnoreClick={shouldIgnoreTrackClick}
										isDragOver={isDragOver}
										dropTarget={dropTarget}
										renderWindow={renderWindow}
										tracksTopOffset={tracksTopOffset}
									/>
								)}
								<HoverAxis scrollRef={tracksScrollRef} zoomLevel={zoomLevel} />
								<TrimLayer tracksScrollRef={tracksScrollRef} rulerScrollRef={rulerScrollRef} zoomLevel={zoomLevel} contentWidth={dynamicTimelineWidth} />
								{isElementDragging && (
									<ElementMoveLanding
										controller={dragController}
										tracks={tracks}
										zoomLevel={zoomLevel}
										rowTop={(trackIndex) =>
											TIMELINE_CONTENT_TOP_PADDING_PX +
											tracksTopOffset +
											getCumulativeHeightBefore({ tracks, trackIndex, getExtraHeight: getTrackExpansionHeight })
										}
									/>
								)}
								{isDragOver && (
									<DropGhost
										dropTarget={dropTarget}
										ghost={dropGhost}
										cut={dropCut}
										tracks={tracks}
										zoomLevel={zoomLevel}
										rowTop={(trackIndex) =>
											TIMELINE_CONTENT_TOP_PADDING_PX +
											tracksTopOffset +
											getCumulativeHeightBefore({ tracks, trackIndex, getExtraHeight: getTrackExpansionHeight })
										}
									/>
								)}
							</div>
							</ContextMenuTrigger>
							{contextTarget?.kind === "keyframe" && (
								<ContextMenuContent className="w-64">
									<KeyframeContextMenuItems refs={contextTarget.refs} />
								</ContextMenuContent>
							)}
							{contextTarget?.kind === "element" && (
								<ContextMenuContent className="w-64">
									<TimelineElementContextMenuContent
										trackId={contextTarget.trackId}
										elementId={contextTarget.elementId}
									/>
								</ContextMenuContent>
							)}
							{contextTarget?.kind === "track" && (
								<ContextMenuContent className="w-64">
									<TrackGapMenuItems trackId={contextTarget.trackId} time={contextTarget.time} />
								</ContextMenuContent>
							)}
							{/* CapCut: a right-click on empty space opens nothing. */}
							</ContextMenu>
							{/* Empty space below the tracks (CapCut: no menu there). */}
							<div className="flex flex-1 flex-col">
								<TimelineGutter
									onMouseDown={(event) => {
										handleTracksMouseDown(event);
										handleSelectionMouseDown(event);
									}}
									onClick={handleTracksClick}
								/>
							</div>
						</div>
					</ScrollArea>

					<TimelinePlayhead
						zoomLevel={zoomLevel}
						hasHorizontalScrollbar={hasHorizontalScrollbar}
						rulerRef={rulerRef}
						rulerScrollRef={rulerScrollRef}
						tracksScrollRef={tracksScrollRef}
						timelineRef={timelineRef}
						playheadRef={playheadRef}
						isSnappingToPlayhead={
							showSnapIndicator && currentSnapPoint?.type === "playhead"
						}
					/>
				</div>
				<MemoLevelMeter headerHeight={timelineHeaderHeight} />
				<PasteAttributesDialog />
				<SnapIndicator
					snapPoint={currentSnapPoint}
					zoomLevel={zoomLevel}
					timelineRef={timelineRef}
					tracksScrollRef={tracksScrollRef}
					isVisible={showSnapIndicator}
				/>
			</div>
		</section>
	);
}

/** Memoized: it watches the scene and the selection itself; on a zoom step its props don't change. */
const TrackLabelsPanel = memo(function TrackLabelsPanel({
	trackLabelsRef,
	trackLabelsScrollRef,
	timelineHeaderHeight,
	hasHorizontalScrollbar,
	getTrackExpansionHeight,
	tracksTopOffset,
}: {
	trackLabelsRef: React.RefObject<HTMLDivElement | null>;
	trackLabelsScrollRef: React.RefObject<HTMLDivElement | null>;
	timelineHeaderHeight: number;
	hasHorizontalScrollbar: boolean;
	getTrackExpansionHeight: (trackIndex: number) => number;
	tracksTopOffset: number;
}) {
	// The main track's ⋯ → Track height: the rows take their new heights.
	useTimelineStore((s) => s.trackHeight);
	const editor = useEditor();
	const scene = useEditor((e) => e.scenes.getActiveSceneOrNull());
	const tracks = useMemo<TimelineTrack[]>(
		() =>
			scene
				? [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]
				: [],
		[scene],
	);
	const { selectedElements } = useElementSelection();
	const tracksWithSelection = useMemo(
		() => new Set(selectedElements.map((el) => el.trackId)),
		[selectedElements],
	);
	// "Main", "Video 2", "Audio": the headers showed only icons, so which row is which was a guess.
	const trackLabels = useMemo(() => {
		const total = new Map<string, number>();
		for (const track of tracks) {
			if (track.id !== scene?.tracks.main.id) total.set(track.type, (total.get(track.type) ?? 0) + 1);
		}
		const seen = new Map<string, number>();
		return tracks.map((track) => {
			if (track.id === scene?.tracks.main.id) return "Main";
			const n = (seen.get(track.type) ?? 0) + 1;
			seen.set(track.type, n);
			const name = TRACK_LABELS[track.type];
			return (total.get(track.type) ?? 0) > 1 ? `${name} ${n}` : name;
		});
	}, [tracks, scene]);

	const expandedElementIds = useTimelineStore((s) => s.expandedElementIds);
	const trackExpandedRowsMap = useMemo(
		() =>
			tracks.map((track) =>
				getTrackExpandedRows({ track, expandedElementIds }),
			),
		[tracks, expandedElementIds],
	);

	return (
		<div
			className="flex shrink-0 flex-col border-r"
			data-timeline-headers
			style={{ width: `${TIMELINE_TRACK_LABELS_COLUMN_WIDTH_PX}px` }}
		>
			<div
				className="shrink-0"
				style={{ height: timelineHeaderHeight || 48 }}
			/>
			<div ref={trackLabelsRef} className="flex-1 overflow-hidden">
				<div
					ref={trackLabelsScrollRef}
					className="size-full overflow-hidden"
					style={{ willChange: "scroll-position" }}
				>
					{tracks.length > 0 && (
						<div
							className="flex flex-col"
							style={{ gap: `${TIMELINE_TRACK_GAP_PX}px`, paddingTop: tracksTopOffset }}
						>
							{tracks.map((track, index) => {
								const expandedRows = trackExpandedRowsMap[index];
								const baseHeight = getTrackHeight({ type: track.type });

								return (
									<div
										key={track.id}
										data-track-label={track.id}
										className={cn(
											"group flex flex-col",
											tracksWithSelection.has(track.id) &&
												SELECTED_TRACK_ROW_CLASS,
										)}
										style={{
											height: `${baseHeight + getTrackExpansionHeight(index)}px`,
										}}
									>
										{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- track header: a click selects the track's clips (⌘/⇧ adds them); ⌘A selects all from the keyboard */}
										{/* biome-ignore lint/a11y/noStaticElementInteractions: a click on the header selects the track's clips; ⌘A does it from the keyboard */}
										{/* biome-ignore lint/a11y/useKeyWithClickEvents: as above */}
										<div
											data-track-header={track.id}
											className="flex shrink-0 cursor-default items-center gap-1 px-2"
											style={{ height: `${baseHeight}px` }}
											title={`${trackLabels[index]} — click to select its clips, ⌘-click to add them`}
											onClick={(event) => {
												if ((event.target as HTMLElement).closest("button")) return;
												const own = track.elements.map((element) => ({ trackId: track.id, elementId: element.id }));
												const additive = event.metaKey || event.ctrlKey || event.shiftKey;
												const current = additive ? editor.selection.getSelectedElements() : [];
												const seen = new Set(current.map((ref) => ref.elementId));
												editor.selection.setSelectedElements({
													elements: [...current, ...own.filter((ref) => !seen.has(ref.elementId))],
												});
											}}
										>
											{/* CapCut's track header: type, lock, eye, sound, ⋯ (and Cover on the main track). */}
											<span className="text-muted-foreground flex size-5 shrink-0 items-center justify-center [&_svg]:size-4">
												<TrackIcon track={track} />
											</span>
											<TrackHeaderButton
												label={track.locked ? "Unlock track" : "Lock track"}
												icon={track.locked ? SquareLock02Icon : SquareUnlock02Icon}
												isOff={track.locked === true}
												onClick={() => toggleTrackLock(editor, track.id)}
											/>
											{canTrackBeHidden(track) ? (
												<TrackHeaderButton
													label={track.hidden ? "Show track" : "Hide track"}
													icon={track.hidden ? ViewOffSlashIcon : ViewIcon}
													isOff={track.hidden}
													onClick={() => editor.timeline.toggleTrackVisibility({ trackId: track.id })}
												/>
											) : (
												<span className="size-5 shrink-0" />
											)}
											{canTrackHaveAudio(track) ? (
												<TrackHeaderButton
													label={track.muted ? "Unmute track" : "Mute track"}
													icon={track.muted ? VolumeOffIcon : VolumeHighIcon}
													isOff={track.muted}
													onClick={() => editor.timeline.toggleTrackMute({ trackId: track.id })}
												/>
											) : (
												<span className="size-5 shrink-0" />
											)}
											{/* CapCut: ⋯ only on the main track's header (overlay and sticker tracks end with the eye). */}
											{track.id === scene?.tracks.main.id && <TrackOptionsMenu />}
										</div>
										{expandedRows.length > 0 && (
											<PropertyTree rows={expandedRows} />
										)}
									</div>
								);
							})}
						</div>
					)}
					{/* The labels follow the tracks' scrollTop. Their own content is shorter
					    (no top padding / gutter): without this spacer they stop scrolling
					    early and drift above their rows. */}
					<div aria-hidden className="h-full shrink-0" />
				</div>
			</div>
			<div
				className="bg-background shrink-0"
				style={{
					height: hasHorizontalScrollbar ? TIMELINE_SCROLLBAR_SIZE_PX : 0,
				}}
			/>
		</div>
	);
});

type ElementDragController = ReturnType<
	typeof useElementInteraction
>["dragController"];

function useElementDragView(controller: ElementDragController): ElementDragView {
	return useSyncExternalStore(
		controller.subscribe,
		() => controller.view,
		() => controller.view,
	);
}

/** The ghost of where the dragged clips land (its own subscription, as ElementDragLine). */
function ElementMoveLanding({
	controller,
	tracks,
	zoomLevel,
	rowTop,
}: {
	controller: ElementDragController;
	tracks: TimelineTrack[];
	zoomLevel: number;
	rowTop: (trackIndex: number) => number;
}) {
	const dragView = useElementDragView(controller);
	if (dragView.kind !== "dragging") return null;
	return <MoveLanding landing={dragView.landing} tracks={tracks} zoomLevel={zoomLevel} rowTop={rowTop} />;
}

/** Where a dragged clip will land (its own subscription: moves don't re-render the timeline shell). */
function ElementDragLine({
	controller,
	tracks,
	headerHeight,
}: {
	controller: ElementDragController;
	tracks: TimelineTrack[];
	headerHeight: number;
}) {
	const dragView = useElementDragView(controller);
	const isDragging = dragView.kind === "dragging";
	return (
		<DragLine
			dropTarget={isDragging ? dragView.dropTarget : null}
			tracks={tracks}
			isVisible={isDragging}
			headerHeight={headerHeight}
		/>
	);
}

const TimelineTrackRows = memo(function TimelineTrackRows({
	zoomLevel,
	dragController,
	onResizeStart,
	onElementMouseDown,
	onElementClick,
	onTrackMouseDown,
	onTrackMouseUp,
	shouldIgnoreClick,
	isDragOver,
	dropTarget,
	renderWindow,
	tracksTopOffset,
}: {
	zoomLevel: number;
	dragController: ElementDragController;
	onResizeStart: React.ComponentProps<
		typeof TimelineTrackContent
	>["onResizeStart"];
	onElementMouseDown: React.ComponentProps<
		typeof TimelineTrackContent
	>["onElementMouseDown"];
	onElementClick: React.ComponentProps<
		typeof TimelineTrackContent
	>["onElementClick"];
	onTrackMouseDown: (event: React.MouseEvent) => void;
	onTrackMouseUp: (event: React.MouseEvent) => void;
	shouldIgnoreClick: () => boolean;
	isDragOver: boolean;
	dropTarget: DropTarget | null;
	renderWindow: TimelineRenderWindow | null;
	tracksTopOffset: number;
}) {
	// The main track's ⋯ → Track height: the rows take their new heights.
	useTimelineStore((s) => s.trackHeight);
	const dragView = useElementDragView(dragController);
	const scene = useEditor(
		(e) => e.scenes.getActiveSceneOrNull(),
		["scenes", "timeline"],
	);
	const tracks = useMemo<TimelineTrack[]>(
		() =>
			scene
				? [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]
				: [],
		[scene],
	);
	const selectedElements = useEditor(
		(e) => e.selection.getSelectedElements(),
		["selection"],
	);
	const tracksWithSelection = useMemo(
		() => new Set(selectedElements.map((el) => el.trackId)),
		[selectedElements],
	);
	const selectedIdsByTrack = useMemo(() => {
		const byTrack = new Map<string, Set<string>>();
		for (const selected of selectedElements) {
			let ids = byTrack.get(selected.trackId);
			if (!ids) {
				ids = new Set();
				byTrack.set(selected.trackId, ids);
			}
			ids.add(selected.elementId);
		}
		return byTrack;
	}, [selectedElements]);
	const mediaAssets = useEditor((e) => e.media.getAssets(), ["media"]);
	// A media used twice on the timeline: every use gets the same thin line, another media another colour (Adobe's mark).
	const duplicateMarks = useMemo(() => duplicateMarksOf(tracks), [tracks]);
	const mediaById = useMemo(
		() => new Map<string, MediaAsset>(mediaAssets.map((a) => [a.id, a])),
		[mediaAssets],
	);

	const expandedElementIds = useTimelineStore((s) => s.expandedElementIds);

	const getTrackExpansionHeight = useCallback(
		(trackIndex: number) => {
			const track = tracks[trackIndex];
			if (!track) return 0;
			return computeTrackExpansionHeight({ track, expandedElementIds });
		},
		[tracks, expandedElementIds],
	);

	// The same Map for the whole drag (the controller keeps it), so this and the sort below don't redo
	// their work on every pointer move.
	const draggingElementIds =
		dragView.kind === "dragging"
			? dragView.memberTimeOffsets
			: (null as ReadonlyMap<string, MediaTime> | null);
	const sortedTracks = useMemo(() => {
		if (!draggingElementIds)
			return tracks.map((track, index) => ({ track, index }));
		return [...tracks]
			.map((track, index) => ({ track, index }))
			.sort((a, b) => {
				const aHasDragged = a.track.elements.some((element) =>
					draggingElementIds.has(element.id),
				);
				const bHasDragged = b.track.elements.some((element) =>
					draggingElementIds.has(element.id),
				);
				if (aHasDragged) return 1;
				if (bHasDragged) return -1;
				return 0;
			});
	}, [tracks, draggingElementIds]);

	return (
		<>
			{sortedTracks.map(({ track, index }) => (
				<div
					key={track.id}
					data-timeline-track-row={track.id}
					className={cn(
						"absolute right-0 left-0 transition-colors",
						tracksWithSelection.has(track.id) && SELECTED_TRACK_ROW_CLASS,
					)}
					style={
						{
							top: `${TIMELINE_CONTENT_TOP_PADDING_PX + tracksTopOffset + getCumulativeHeightBefore({ tracks, trackIndex: index, getExtraHeight: getTrackExpansionHeight })}px`,
							height: `${getTrackHeight({ type: track.type }) + getTrackExpansionHeight(index)}px`,
							// Clips position themselves from this (zoom without re-rendering them).
							"--timeline-pps": getTimelinePixelsPerSecond({ zoomLevel }),
						} as React.CSSProperties
					}
				>
					<TimelineTrackContent
						track={track}
						zoomLevel={zoomLevel}
						dragView={
							draggingElementIds &&
							track.elements.some((element) =>
								draggingElementIds.has(element.id),
							)
								? dragView
								: IDLE_DRAG_VIEW
						}
						onResizeStart={onResizeStart}
						onElementMouseDown={onElementMouseDown}
						onElementClick={onElementClick}
						onTrackMouseDown={onTrackMouseDown}
						onTrackMouseUp={onTrackMouseUp}
						shouldIgnoreClick={shouldIgnoreClick}
						targetElementId={
							isDragOver
								? (dropTarget?.targetElement?.elementId ?? null)
								: null
						}
						selectedElementIds={
							selectedIdsByTrack.get(track.id) ?? EMPTY_ID_SET
						}
						mediaById={mediaById}
						duplicateMarks={duplicateMarks}
						renderWindow={renderWindow}
						isMain={track.id === scene?.tracks.main.id}
					/>
				</div>
			))}
		</>
	);
});

const IDLE_DRAG_VIEW: ElementDragView = { kind: "idle" };
const EMPTY_ID_SET: ReadonlySet<string> = new Set();

/**
 * CapCut 9.5's menu on an empty part of a track (docs/capcut/compare/track-gap-menu-capcut.jpg): Close gap, Close all
 * gaps / Select / Paste. (Its Range › and Render › aren't here: Gaziyav has no render cache.)
 */
function TrackGapMenuItems({ trackId, time }: { trackId: string; time: number }) {
	const editor = useEditor();
	const track = useEditor((e) => e.timeline.getTrackById({ trackId }), ["scenes", "timeline"]);
	if (!track) return null;
	const gapHere = time >= 0 && closeGapAt(track, time) !== null;
	const anyGap = closeAllGaps(track) !== null;
	return (
		<>
			<ContextMenuItem
				disabled={!gapHere}
				onClick={(event: React.MouseEvent) => {
					event.stopPropagation();
					closeTrackGapAt(editor, trackId, time);
				}}
			>
				Close gap
			</ContextMenuItem>
			<ContextMenuItem
				disabled={!anyGap}
				onClick={(event: React.MouseEvent) => {
					event.stopPropagation();
					closeTrackGaps(editor, trackId);
				}}
			>
				Close all gaps
			</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem
				disabled={track.elements.length === 0}
				onClick={(event: React.MouseEvent) => {
					event.stopPropagation();
					editor.selection.setSelectedElements({
						elements: track.elements.map((element) => ({ trackId, elementId: element.id })),
					});
				}}
			>
				Select
			</ContextMenuItem>
			<ContextMenuItem
				disabled={!editor.clipboard.hasEntry()}
				textRight={getDisplayShortcut({ action: "paste-copied" })}
				onClick={(event: React.MouseEvent) => {
					event.stopPropagation();
					invokeAction("paste-copied");
				}}
			>
				Paste
			</ContextMenuItem>
		</>
	);
}

function TimelineGutter({
	onMouseDown,
	onClick,
}: {
	onMouseDown: (event: React.MouseEvent) => void;
	onClick: (event: React.MouseEvent) => void;
}) {
	return (
		// eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- spatial gesture surface (empty space below tracks); clicks here clear selection. Keyboard control is global timeline shortcuts.
		<div className="flex-1" onMouseDown={onMouseDown} onClick={onClick} />
	);
}

function TrackIcon({ track }: { track: TimelineTrack }) {
	return <>{TRACK_ICONS[track.type]}</>;
}

/** CapCut ⋯ on the main track: Track height (Short / Default / Tall) and Audio waveform size (30 / 60 / 100 %). */
function TrackOptionsMenu() {
	const trackHeight = useTimelineStore((s) => s.trackHeight);
	const setTrackHeight = useTimelineStore((s) => s.setTrackHeight);
	const waveformSize = useTimelineStore((s) => s.waveformSize);
	const setWaveformSize = useTimelineStore((s) => s.setWaveformSize);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label="Track options"
					title="Track options"
					data-track-button="Track options"
					className="hover:bg-accent text-muted-foreground hover:text-foreground flex size-5 shrink-0 items-center justify-center rounded-sm relative after:absolute after:-inset-0.5 after:content-['']"
				>
					<HugeiconsIcon icon={MoreHorizontalIcon} className="size-3.5" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-48">
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>Track height</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						<DropdownMenuRadioGroup value={trackHeight} onValueChange={(value) => setTrackHeight(value as TrackHeightChoice)}>
							<DropdownMenuRadioItem value="short" data-track-height="short">Short</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="default" data-track-height="default">Default</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="tall" data-track-height="tall">Tall</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>Audio waveform size</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						<DropdownMenuRadioGroup
							value={String(waveformSize)}
							onValueChange={(value) => setWaveformSize(Number(value) as WaveformSizeChoice)}
						>
							<DropdownMenuRadioItem value="30" data-waveform-size="30">30%</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="60" data-waveform-size="60">60%</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="100" data-waveform-size="100">100%</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** One icon button of a track header (`menu`: opens a menu instead of switching something on or off). */
function TrackHeaderButton({
	label,
	icon,
	onClick,
	isOff = false,
	menu = false,
}: {
	label: string;
	icon: IconSvgElement;
	onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
	isOff?: boolean;
	/** Opens a menu: no on/off state. */
	menu?: boolean;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={menu ? undefined : isOff}
			aria-haspopup={menu ? "menu" : undefined}
			title={label}
			data-track-button={label}
			className={cn(
				"hover:bg-accent flex size-5 shrink-0 items-center justify-center rounded-sm relative after:absolute after:-inset-0.5 after:content-['']",
				isOff ? "text-destructive" : "text-muted-foreground hover:text-foreground",
			)}
			onClick={(event) => onClick?.(event)}
		>
			<HugeiconsIcon icon={icon} className="size-3.5" />
		</button>
	);
}

function PropertyTree({ rows }: { rows: ExpandedRow[] }) {
	return (
		<div className="flex flex-col overflow-hidden">
			{rows.map((row) => (
				<div
					key={row.propertyPath}
					className={cn("flex shrink-0 items-center px-3 bg-muted/50")}
					style={{ height: `${KEYFRAME_LANE_HEIGHT_PX}px` }}
				>
					<span className="text-muted-foreground truncate text-xs leading-none">
						{getPropertyLabel(row.propertyPath)}
					</span>
				</div>
			))}
		</div>
	);
}
