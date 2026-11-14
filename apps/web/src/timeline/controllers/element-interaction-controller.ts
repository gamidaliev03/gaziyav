import { useTimelineStore } from "@/timeline/timeline-store";
import { getTracksTopOffset } from "@/timeline/tracks-offset";
import { toast } from "sonner";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
	buildMoveGroup,
	resolveGroupMove,
	snapGroupEdges,
	type GroupMoveResult,
	type MoveGroup,
} from "@/timeline/group-move";
import { planMainTrackReorder, type MainTrackReorder } from "@/timeline/group-move/main-reorder";
import { groupMoveLanding, newTrackLine } from "@/timeline/group-move/landing";
import { withoutElements } from "@/timeline/group-move/track-placement";
import { copyElementWithFreshKeyframes } from "@/timeline/element-copy";
import { groupRemapper } from "@/timeline/groups";
import { BASE_TIMELINE_PIXELS_PER_SECOND } from "@/timeline/scale";
import {
	maxMediaTime,
	type MediaTime,
	mediaTime,
	roundFrameTime,
	subMediaTime,
	TICKS_PER_SECOND,
	ZERO_MEDIA_TIME,
} from "@/wasm";
import { TIMELINE_DRAG_THRESHOLD_PX } from "@/timeline/components/interaction";
import type { FrameRate } from "opencut-wasm";
import { computeDropTarget } from "@/timeline/components/drop-target";
import { getMouseTimeFromClientX } from "@/timeline/drag-utils";
import { generateUUID } from "@/utils/id";
import { registerCanceller } from "@/editor/cancel-interaction";
import type { SnapPoint } from "@/timeline/snapping";
import type {
	DragLanding,
	DropTarget,
	ElementRef,
	ElementDragView,
	SceneTracks,
	TimelineElement,
	TimelineTrack,
} from "@/timeline";

const MOUSE_BUTTON_RIGHT = 2;

// --- Config ---

export interface ViewportAdapter {
	getZoomLevel: () => number;
	getTracksScrollEl: () => HTMLDivElement | null;
	getTracksContainerEl: () => HTMLDivElement | null;
	getHeaderEl: () => HTMLElement | null;
}

export interface InputAdapter {
	isShiftHeld: () => boolean;
}

export interface SceneReader {
	getTracks: () => SceneTracks;
	getActiveFps: () => FrameRate | null;
}

export interface ElementSelectionApi {
	getSelected: () => readonly ElementRef[];
	isSelected: (ref: ElementRef) => boolean;
	/** The clip and the rest of its group (⌘G): what a press on an unselected clip drags. */
	groupOf: (ref: ElementRef) => ElementRef[];
	select: (ref: ElementRef) => void;
	handleClick: (args: ElementRef & { isMultiKey: boolean; isRangeKey?: boolean }) => void;
	clearKeyframeSelection: () => void;
}

export interface PlaybackReader {
	getCurrentTime: () => MediaTime;
}

export interface TimelineOps {
	moveElements: (args: Pick<GroupMoveResult, "moves" | "createTracks">) => void;
}

export interface SnapConfig {
	isEnabled: () => boolean;
	onChange?: (snapPoint: SnapPoint | null) => void;
}

/** The magnetic main track (CapCut): clips dragged along it go in at a cut instead of onto a new track. */
export interface MagnetApi {
	/** The main track's id while the magnet is on, else null. */
	getTrackId: () => string | null;
	/** Where that track's row is on screen (null when it isn't mounted). */
	getTrackRowRect: (trackId: string) => DOMRect | null;
	/** ⌥ held: copies go in, the originals stay. */
	isCopy: () => boolean;
	/** Shows the clips that stay at their new places while the pointer is over the track. */
	preview: (updates: { trackId: string; elementId: string; startTime: MediaTime }[]) => void;
	discardPreview: () => void;
	/** The track's elements after the drop, as one undo step. */
	commit: (args: { trackId: string; elements: TimelineElement[]; selection: ElementRef[] }) => void;
}

export interface ElementInteractionDeps {
	viewport: ViewportAdapter;
	input: InputAdapter;
	scene: SceneReader;
	selection: ElementSelectionApi;
	playback: PlaybackReader;
	timeline: TimelineOps;
	snap: SnapConfig;
	magnet?: MagnetApi;
}

export interface ElementInteractionDepsRef {
	readonly current: ElementInteractionDeps;
}

// --- Session ---

type Point = { readonly x: number; readonly y: number };

interface MousedownSnapshot {
	readonly origin: Point;
	readonly elementId: string;
	readonly trackId: string;
	readonly startElementTime: MediaTime;
	readonly clickOffsetTime: MediaTime;
	readonly selectedElements: readonly ElementRef[];
}

interface DragProgress {
	moveGroup: MoveGroup;
	// Pre-minted per member so the identity of any "new track" created by
	// this drag stays stable across mousemove-driven drop-target recomputes.
	// `resolveGroupMoveForDrop` runs every mousemove and emits a
	// `createTracks[]` carrying these IDs; downstream consumers (snap
	// indicator, drop-line, commit path) see the same entity every frame
	// instead of a churning UUID.
	reservedNewTrackIds: readonly string[];
	currentTime: MediaTime;
	currentMouseX: number;
	currentMouseY: number;
	groupMoveResult: GroupMoveResult | null;
	dropTarget: DropTarget | null;
	/** Set while the pointer is over the magnetic main track and every dragged clip is on it. */
	reorder: MainTrackReorder | null;
	/** What the preview shows (insert index + copy mode), so it is redrawn only when that changes. */
	reorderPreviewKey: string | null;
	/** Ids for ⌥ copies, fixed for the whole drag. */
	copyIds: ReadonlyMap<string, string>;
	/** ⌥ as the plan was made: a copy leaves the original in the way, so ⌥ pressed or let go re-plans. */
	planIsCopy: boolean;
}

type Session =
	| { kind: "idle" }
	| { kind: "pending"; mousedown: MousedownSnapshot }
	| { kind: "dragging"; mousedown: MousedownSnapshot; drag: DragProgress };

const IDLE_VIEW: ElementDragView = { kind: "idle" };

// --- Pure helpers ---

function pixelToClickOffsetTime({
	clientX,
	elementRect,
	zoomLevel,
}: {
	clientX: number;
	elementRect: DOMRect;
	zoomLevel: number;
}): MediaTime {
	const clickOffsetX = clientX - elementRect.left;
	const seconds = clickOffsetX / (BASE_TIMELINE_PIXELS_PER_SECOND * zoomLevel);
	return mediaTime({ ticks: Math.round(seconds * TICKS_PER_SECOND) });
}

function verticalDirection({
	startMouseY,
	currentMouseY,
}: {
	startMouseY: number;
	currentMouseY: number;
}): "up" | "down" | null {
	if (currentMouseY < startMouseY) return "up";
	if (currentMouseY > startMouseY) return "down";
	return null;
}

function orderedTracks(sceneTracks: SceneTracks): TimelineTrack[] {
	return [...sceneTracks.overlay, sceneTracks.main, ...sceneTracks.audio];
}

function movedPastDragThreshold({
	current,
	origin,
}: {
	current: Point;
	origin: Point;
}): boolean {
	return (
		Math.abs(current.x - origin.x) > TIMELINE_DRAG_THRESHOLD_PX ||
		Math.abs(current.y - origin.y) > TIMELINE_DRAG_THRESHOLD_PX
	);
}

function frameSnappedMouseTime({
	clientX,
	scrollContainer,
	zoomLevel,
	clickOffsetTime,
	fps,
}: {
	clientX: number;
	scrollContainer: HTMLDivElement;
	zoomLevel: number;
	clickOffsetTime: MediaTime;
	fps: FrameRate;
}): MediaTime {
	const mouseTime = getMouseTimeFromClientX({
		clientX,
		containerRect: scrollContainer.getBoundingClientRect(),
		zoomLevel,
		scrollLeft: scrollContainer.scrollLeft,
	});
	const adjusted = maxMediaTime({
		a: ZERO_MEDIA_TIME,
		b: subMediaTime({ a: mouseTime, b: clickOffsetTime }),
	});
	return roundFrameTime({ time: adjusted, fps });
}

function resolveDropTarget({
	clientX,
	clientY,
	elementId,
	trackId,
	tracks,
	viewport,
	zoomLevel,
	snappedTime,
	verticalDragDirection,
	movingIds,
}: {
	clientX: number;
	clientY: number;
	elementId: string;
	trackId: string;
	tracks: SceneTracks;
	viewport: ViewportAdapter;
	zoomLevel: number;
	snappedTime: MediaTime;
	verticalDragDirection: "up" | "down" | null;
	/** The clips that leave their places (all the dragged ones; none for ⌥ copies, the originals stay). */
	movingIds: ReadonlySet<string>;
}): DropTarget | null {
	const containerRect = viewport
		.getTracksContainerEl()
		?.getBoundingClientRect();
	const scrollContainer = viewport.getTracksScrollEl();
	if (!containerRect || !scrollContainer) return null;

	const sourceTrack = orderedTracks(tracks).find(({ id }) => id === trackId);
	const movingElement = sourceTrack?.elements.find(
		({ id }) => id === elementId,
	);
	if (!movingElement) return null;

	const scrollRect = scrollContainer.getBoundingClientRect();
	const headerHeight =
		viewport.getHeaderEl()?.getBoundingClientRect().height ?? 0;

	return computeDropTarget({
		elementType: movingElement.type,
		mouseX: clientX - scrollRect.left + scrollContainer.scrollLeft,
		mouseY: clientY - scrollRect.top + scrollContainer.scrollTop - headerHeight - getTracksTopOffset(),
		// The other dragged clips leave too: two photos of one track dragged together counted each other as in the way
		// and threw the second onto a new track (tester 05.11).
		tracks: withoutElements(tracks, movingIds),
		playheadTime: snappedTime,
		isExternalDrop: false,
		elementDuration: movingElement.duration,
		pixelsPerSecond: BASE_TIMELINE_PIXELS_PER_SECOND,
		zoomLevel,
		startTimeOverride: snappedTime,
		verticalDragDirection,
	});
}

function resolveGroupMoveForDrop({
	group,
	tracks,
	anchorStartTime,
	dropTarget,
	reservedNewTrackIds,
	keepOriginals,
}: {
	group: MoveGroup;
	tracks: SceneTracks;
	anchorStartTime: MediaTime;
	dropTarget: DropTarget;
	reservedNewTrackIds: readonly string[];
	keepOriginals: boolean;
}): GroupMoveResult | null {
	const targetTrack = dropTarget.isNewTrack ? null : orderedTracks(tracks)[dropTarget.trackIndex];
	return resolveGroupMove({
		group,
		tracks,
		anchorStartTime,
		target: targetTrack
			? { kind: "existingTrack", anchorTargetTrackId: targetTrack.id, insertIndex: dropTarget.trackIndex }
			: { kind: "newTracks", anchorInsertIndex: dropTarget.trackIndex },
		newTrackIds: reservedNewTrackIds,
		keepOriginals,
	});
}

/** The new-track line to draw: where the anchor's new track opens, else the first new track of the plan. */
function newTrackDropLine({
	result,
	anchorElementId,
	dropTarget,
}: {
	result: GroupMoveResult | null;
	anchorElementId: string;
	dropTarget: DropTarget;
}): DropTarget | null {
	if (!result || result.createTracks.length === 0) return null;
	const anchorTrackId = result.moves.find((move) => move.elementId === anchorElementId)?.targetTrackId;
	const line =
		(anchorTrackId ? newTrackLine({ createTracks: result.createTracks, trackId: anchorTrackId }) : null) ??
		newTrackLine({ createTracks: result.createTracks, trackId: result.createTracks[0].id });
	return line === null ? null : { ...dropTarget, trackIndex: line, isNewTrack: true, targetElement: null };
}

// --- Controller ---

export class ElementInteractionController {
	private session: Session = { kind: "idle" };
	// True once the active gesture crossed the drag threshold. Read by
	// onElementClick, which fires after mouseup — by which point the session
	// has already returned to idle, so the "was this a drag?" answer must
	// outlive the session. Reset on the next mousedown.
	private lastGestureWasDrag = false;

	private readonly subscribers = new Set<() => void>();
	private readonly depsRef: ElementInteractionDepsRef;
	// The view is rebuilt once per change (notify), not on every read: readers compare it by identity
	// (useSyncExternalStore), and the member offsets are fixed for the whole drag.
	private cachedView: ElementDragView = IDLE_VIEW;
	private cachedOffsets: { group: MoveGroup; offsets: ReadonlyMap<string, MediaTime> } | null = null;
	// Escape (cancelInteraction) cancels the gesture while the mouse is down.
	private unregisterCanceller: (() => void) | null = null;

	constructor(args: { depsRef: ElementInteractionDepsRef }) {
		this.depsRef = args.depsRef;
	}

	private get deps(): ElementInteractionDeps {
		return this.depsRef.current;
	}

	get view(): ElementDragView {
		return this.cachedView;
	}

	get isDragging(): boolean {
		return this.session.kind === "dragging";
	}

	private buildView(): ElementDragView {
		if (this.session.kind !== "dragging") {
			this.cachedOffsets = null;
			return IDLE_VIEW;
		}
		const { mousedown, drag } = this.session;
		if (this.cachedOffsets?.group !== drag.moveGroup) {
			const offsets = new Map<string, MediaTime>();
			for (const member of drag.moveGroup.members) {
				offsets.set(member.elementId, member.timeOffset);
			}
			this.cachedOffsets = { group: drag.moveGroup, offsets };
		}
		const memberTimeOffsets = this.cachedOffsets.offsets;
		return {
			kind: "dragging",
			anchorElementId: mousedown.elementId,
			trackId: mousedown.trackId,
			memberTimeOffsets,
			startMouseX: mousedown.origin.x,
			startMouseY: mousedown.origin.y,
			startElementTime: mousedown.startElementTime,
			clickOffsetTime: mousedown.clickOffsetTime,
			currentTime: drag.currentTime,
			currentMouseX: drag.currentMouseX,
			currentMouseY: drag.currentMouseY,
			dropTarget: drag.dropTarget,
			landing: this.landingOf(drag),
		};
	}

	/** Where the dragged clips go on release: the reorder's cut on the main track, or the planned moves (the same plans
	 * the drop commits, so the ghost and the result can't differ). */
	private landingOf(drag: DragProgress): DragLanding[] {
		if (drag.reorder) {
			if (drag.reorder.isNoop) return [];
			const trackId = this.deps.scene.getTracks().main.id;
			const inserted = new Set(drag.reorder.insertedIds);
			return drag.reorder.elements
				.filter((element) => inserted.has(element.id))
				.map((element) => ({ elementId: element.id, trackId, startTime: element.startTime, duration: element.duration }));
		}
		const result = drag.groupMoveResult;
		if (!result) return [];
		return groupMoveLanding({
			tracks: this.deps.scene.getTracks(),
			result,
			durations: new Map(drag.moveGroup.members.map((member) => [member.elementId, member.duration])),
			// The magnet closes the main track after a move (a ⌥ copy's step is final as placed).
			magnet: Boolean(this.deps.magnet?.getTrackId()) && !drag.planIsCopy,
		});
	}

	get isActive(): boolean {
		return this.session.kind !== "idle";
	}

	// An arrow: passed unbound to useSyncExternalStore.
	subscribe = (fn: () => void): (() => void) => {
		this.subscribers.add(fn);
		return () => {
			this.subscribers.delete(fn);
		};
	};

	cancel = (): void => {
		this.lastGestureWasDrag = false;
		this.finishSession();
	};

	destroy(): void {
		this.cancel();
		this.subscribers.clear();
	}

	onElementMouseDown = ({
		event,
		element,
		track,
	}: {
		event: ReactMouseEvent;
		element: TimelineElement;
		track: TimelineTrack;
	}): void => {
		// Right-click must not stopPropagation — ContextMenu needs the bubble.
		if (event.button === MOUSE_BUTTON_RIGHT) {
			const ref = { trackId: track.id, elementId: element.id };
			if (!this.deps.selection.isSelected(ref)) {
				this.deps.selection.handleClick({ ...ref, isMultiKey: false });
			}
			return;
		}

		event.stopPropagation();
		this.lastGestureWasDrag = false;

		const ref = { trackId: track.id, elementId: element.id };

		// ⌘ / ⇧ change the selection on a click (onElementClick), not on the press: a ⌘- or ⇧-drag ("drag without
		// snapping") moves the pressed clip, or the selection it is part of, exactly like a plain drag — never the
		// clips that happened to be selected before.
		const selectedElements = this.deps.selection.isSelected(ref)
			? this.deps.selection.getSelected()
			: this.deps.selection.groupOf(ref);

		this.session = {
			kind: "pending",
			mousedown: {
				origin: { x: event.clientX, y: event.clientY },
				elementId: element.id,
				trackId: track.id,
				startElementTime: element.startTime,
				clickOffsetTime: this.clickOffsetTime({ event, element }),
				selectedElements,
			},
		};
		this.activate();
		// No notify: a pending press doesn't change the view (it stays idle until the pointer crosses
		// the drag threshold). Re-rendering the whole timeline on every mousedown and mouseup made a
		// click-select cost three timeline renders instead of one.
	};

	onElementClick = ({
		event,
		element,
		track,
	}: {
		event: ReactMouseEvent;
		element: TimelineElement;
		track: TimelineTrack;
	}): void => {
		event.stopPropagation();

		if (this.lastGestureWasDrag) {
			this.lastGestureWasDrag = false;
			return;
		}

		const ref = { trackId: track.id, elementId: element.id };
		if (event.metaKey || event.ctrlKey || event.shiftKey) {
			// ⇧-click selects a range from the anchor clip; ⌘-click toggles one clip.
			this.deps.selection.handleClick({ ...ref, isMultiKey: true, isRangeKey: event.shiftKey && !event.metaKey && !event.ctrlKey });
			return;
		}

		if (
			!this.deps.selection.isSelected(ref) ||
			this.deps.selection.getSelected().length > 1
		) {
			this.deps.selection.select(ref);
			return;
		}

		this.deps.selection.clearKeyframeSelection();
	};

	private activate(): void {
		document.addEventListener("mousemove", this.handleMouseMove);
		document.addEventListener("mouseup", this.handleMouseUp);
		document.addEventListener("keydown", this.handleModifierKey);
		document.addEventListener("keyup", this.handleModifierKey);
		this.unregisterCanceller?.();
		this.unregisterCanceller = registerCanceller({ fn: () => this.cancel() });
	}

	private deactivate(): void {
		document.removeEventListener("mousemove", this.handleMouseMove);
		document.removeEventListener("mouseup", this.handleMouseUp);
		document.removeEventListener("keydown", this.handleModifierKey);
		document.removeEventListener("keyup", this.handleModifierKey);
		this.unregisterCanceller?.();
		this.unregisterCanceller = null;
	}

	private notify(): void {
		this.cachedView = this.buildView();
		for (const fn of this.subscribers) fn();
	}

	private finishSession(): void {
		if (this.session.kind === "dragging" && this.session.drag.reorder) {
			this.deps.magnet?.discardPreview();
		}
		const wasDragging = this.session.kind === "dragging";
		this.session = { kind: "idle" };
		this.deactivate();
		if (!wasDragging) return;
		this.deps.snap.onChange?.(null);
		this.notify();
	}

	// Measured in the same space the drag uses (scroll container → time), so the clip doesn't jump when the drag
	// starts: the clicked button sits a few px inside the clip (trim handles), which the old rect-based offset missed.
	private clickOffsetTime({
		event,
		element,
	}: {
		event: ReactMouseEvent;
		element: TimelineElement;
	}): MediaTime {
		const zoomLevel = this.deps.viewport.getZoomLevel();
		const scrollContainer = this.deps.viewport.getTracksScrollEl();
		if (!scrollContainer) {
			return pixelToClickOffsetTime({
				clientX: event.clientX,
				elementRect: event.currentTarget.getBoundingClientRect(),
				zoomLevel,
			});
		}
		const mouseTime = getMouseTimeFromClientX({
			clientX: event.clientX,
			containerRect: scrollContainer.getBoundingClientRect(),
			zoomLevel,
			scrollLeft: scrollContainer.scrollLeft,
		});
		return maxMediaTime({
			a: ZERO_MEDIA_TIME,
			b: subMediaTime({ a: mouseTime, b: element.startTime }),
		});
	}

	private snapResult({
		frameSnappedTime,
		group,
	}: {
		frameSnappedTime: MediaTime;
		group: MoveGroup;
	}): { snappedTime: MediaTime; snapPoint: SnapPoint | null } {
		const { snap, input, scene, viewport, playback } = this.deps;

		if (!snap.isEnabled() || input.isShiftHeld()) {
			return { snappedTime: frameSnappedTime, snapPoint: null };
		}

		const result = snapGroupEdges({
			group,
			anchorStartTime: frameSnappedTime,
			tracks: scene.getTracks(),
			playheadTime: playback.getCurrentTime(),
			zoomLevel: viewport.getZoomLevel(),
		});

		return {
			snappedTime: result.snappedAnchorStartTime,
			snapPoint: result.snapPoint,
		};
	}

	private updateDropTarget({
		clientX,
		clientY,
		mousedown,
		drag,
		snappedTime,
	}: {
		clientX: number;
		clientY: number;
		mousedown: MousedownSnapshot;
		drag: DragProgress;
		snappedTime: MediaTime;
	}): void {
		const { scene, viewport } = this.deps;
		const tracks = scene.getTracks();
		const zoomLevel = viewport.getZoomLevel();
		// ⌥ copies: the originals stay, so they are in the way of their copies like any clip (the copy's ghost sat on
		// its own row over the original while the drop put it on a new track — tester 05.11).
		const keepOriginals = this.deps.magnet?.isCopy() ?? false;
		drag.planIsCopy = keepOriginals;

		const reorder = this.resolveReorder({ clientX, clientY, drag });
		if (reorder) {
			drag.reorder = reorder;
			drag.groupMoveResult = null;
			drag.dropTarget = null;
			this.previewReorder({ drag, reorder });
			return;
		}
		if (drag.reorder) {
			drag.reorder = null;
			drag.reorderPreviewKey = null;
			this.deps.magnet?.discardPreview();
		}

		const anchorDropTarget = resolveDropTarget({
			clientX,
			clientY,
			elementId: mousedown.elementId,
			trackId: mousedown.trackId,
			tracks,
			viewport,
			zoomLevel,
			snappedTime,
			verticalDragDirection: verticalDirection({
				startMouseY: mousedown.origin.y,
				currentMouseY: clientY,
			}),
			movingIds: keepOriginals ? new Set() : new Set(drag.moveGroup.members.map((member) => member.elementId)),
		});

		const nextGroupMoveResult = anchorDropTarget
			? resolveGroupMoveForDrop({
					group: drag.moveGroup,
					tracks,
					anchorStartTime: snappedTime,
					dropTarget: anchorDropTarget,
					reservedNewTrackIds: drag.reservedNewTrackIds,
					keepOriginals,
				})
			: null;

		drag.groupMoveResult = nextGroupMoveResult;
		// The line shows a new track only where the plan opens one (it showed for a plan that couldn't be made, and the
		// drop then did nothing).
		drag.dropTarget = anchorDropTarget
			? newTrackDropLine({ result: nextGroupMoveResult, anchorElementId: mousedown.elementId, dropTarget: anchorDropTarget })
			: null;
	}

	/** The main-track reorder for this pointer position, or null when the normal drop applies. */
	private resolveReorder({
		clientX,
		clientY,
		drag,
	}: {
		clientX: number;
		clientY: number;
		drag: DragProgress;
	}): MainTrackReorder | null {
		const magnet = this.deps.magnet;
		const trackId = magnet?.getTrackId() ?? null;
		if (!magnet || !trackId) return null;
		const onMain = drag.moveGroup.members.every((member) => member.trackId === trackId);
		// Pictures and videos from a layer track dragged onto the magnetic main track go in at its cut too (CapCut), not
		// onto a new track above it (blind test 05.11: shown on the main track, landed on a new one).
		const fromLayers =
			!onMain && drag.moveGroup.members.every((member) => member.trackId !== trackId && (member.elementType === "video" || member.elementType === "image"));
		if (!onMain && !fromLayers) return null;
		const row = magnet.getTrackRowRect(trackId);
		// A little slack: a drag that wobbles off the row by a few pixels stays a reorder; dragging up leaves it.
		if (!row || clientY < row.top - 6 || clientY > row.bottom + 6) return null;
		const scrollContainer = this.deps.viewport.getTracksScrollEl();
		const track = this.deps.scene.getTracks().main;
		if (!scrollContainer || track.id !== trackId) return null;
		const pointerTime = getMouseTimeFromClientX({
			clientX,
			containerRect: scrollContainer.getBoundingClientRect(),
			zoomLevel: this.deps.viewport.getZoomLevel(),
			scrollLeft: scrollContainer.scrollLeft,
		});
		const all = orderedTracks(this.deps.scene.getTracks());
		const incoming = fromLayers
			? drag.moveGroup.members.flatMap((member) => all.find((t) => t.id === member.trackId)?.elements.find((e) => e.id === member.elementId) ?? [])
			: [];
		return planMainTrackReorder({
			elements: fromLayers ? [...track.elements, ...incoming] : track.elements,
			movingIds: new Set(drag.moveGroup.members.map((member) => member.elementId)),
			incomingIds: fromLayers ? new Set(incoming.map((element) => element.id)) : undefined,
			pointerTime,
			copyIds: magnet.isCopy() ? drag.copyIds : undefined,
			copyElement: (() => {
				const regroup = groupRemapper();
				return (element: Parameters<typeof copyElementWithFreshKeyframes>[0], id: string) =>
					regroup(copyElementWithFreshKeyframes(element, id));
			})(),
		});
	}

	/** The clips that stay move to where they'll be: the gap opens at the cut under the pointer. */
	private previewReorder({ drag, reorder }: { drag: DragProgress; reorder: MainTrackReorder }): void {
		const magnet = this.deps.magnet;
		if (!magnet) return;
		const isCopy = reorder.insertedIds.some((id) => !drag.moveGroup.members.some((m) => m.elementId === id));
		const key = `${reorder.insertIndex}:${isCopy}`;
		if (drag.reorderPreviewKey === key) return;
		drag.reorderPreviewKey = key;
		const trackId = this.deps.scene.getTracks().main.id;
		const inserted = new Set(reorder.insertedIds);
		magnet.preview(
			reorder.elements
				.filter((element) => !inserted.has(element.id))
				.map((element) => ({ trackId, elementId: element.id, startTime: element.startTime })),
		);
	}

	private handleMouseMove = ({ clientX, clientY }: MouseEvent): void => {
		const scrollContainer = this.deps.viewport.getTracksScrollEl();
		if (!scrollContainer) return;

		if (this.session.kind === "pending") {
			this.beginDragFromPending({
				mousedown: this.session.mousedown,
				clientX,
				clientY,
				scrollContainer,
			});
			return;
		}

		if (this.session.kind === "dragging") {
			this.updateActiveDrag({
				mousedown: this.session.mousedown,
				drag: this.session.drag,
				clientX,
				clientY,
				scrollContainer,
			});
		}
	};

	private beginDragFromPending({
		mousedown,
		clientX,
		clientY,
		scrollContainer,
	}: {
		mousedown: MousedownSnapshot;
		clientX: number;
		clientY: number;
		scrollContainer: HTMLDivElement;
	}): void {
		if (
			!movedPastDragThreshold({
				current: { x: clientX, y: clientY },
				origin: mousedown.origin,
			})
		) {
			return;
		}

		const fps = this.deps.scene.getActiveFps();
		if (!fps) return;

		const moveGroup = buildMoveGroup({
			anchorRef: {
				trackId: mousedown.trackId,
				elementId: mousedown.elementId,
			},
			selectedElements: [...mousedown.selectedElements],
			tracks: this.deps.scene.getTracks(),
		});
		if (!moveGroup) return;

		const zoomLevel = this.deps.viewport.getZoomLevel();
		const frameSnappedTime = frameSnappedMouseTime({
			clientX,
			scrollContainer,
			zoomLevel,
			clickOffsetTime: mousedown.clickOffsetTime,
			fps,
		});
		const { snappedTime, snapPoint } = this.snapResult({
			frameSnappedTime,
			group: moveGroup,
		});

		// Ensure the anchor is selected before we render the drag — covers the
		// case where the selection store hasn't committed the mousedown-time
		// selection click yet.
		const anchorRef = {
			trackId: mousedown.trackId,
			elementId: mousedown.elementId,
		};
		if (!this.deps.selection.isSelected(anchorRef)) {
			this.deps.selection.select(anchorRef);
		}

		const drag: DragProgress = {
			moveGroup,
			reservedNewTrackIds: moveGroup.members.map(() => generateUUID()),
			currentTime: snappedTime,
			currentMouseX: clientX,
			currentMouseY: clientY,
			groupMoveResult: null,
			dropTarget: null,
			reorder: null,
			reorderPreviewKey: null,
			copyIds: new Map(moveGroup.members.map((member) => [member.elementId, generateUUID()])),
			planIsCopy: false,
		};

		this.session = { kind: "dragging", mousedown, drag };
		this.lastGestureWasDrag = true;

		this.updateDropTarget({
			clientX,
			clientY,
			mousedown,
			drag,
			snappedTime,
		});

		// A reorder goes to a cut: no snap line.
		this.deps.snap.onChange?.(drag.reorder ? null : snapPoint);
		this.notify();
	}

	private updateActiveDrag({
		mousedown,
		drag,
		clientX,
		clientY,
		scrollContainer,
	}: {
		mousedown: MousedownSnapshot;
		drag: DragProgress;
		clientX: number;
		clientY: number;
		scrollContainer: HTMLDivElement;
	}): void {
		const fps = this.deps.scene.getActiveFps();
		if (!fps) return;

		const frameSnappedTime = frameSnappedMouseTime({
			clientX,
			scrollContainer,
			zoomLevel: this.deps.viewport.getZoomLevel(),
			clickOffsetTime: mousedown.clickOffsetTime,
			fps,
		});
		const { snappedTime, snapPoint } = this.snapResult({
			frameSnappedTime,
			group: drag.moveGroup,
		});

		drag.currentTime = snappedTime;
		drag.currentMouseX = clientX;
		drag.currentMouseY = clientY;

		this.updateDropTarget({
			clientX,
			clientY,
			mousedown,
			drag,
			snappedTime,
		});

		// A reorder goes to a cut: no snap line.
		this.deps.snap.onChange?.(drag.reorder ? null : snapPoint);
		this.notify();
	}

	/** ⌥ pressed or let go while the pointer stands still: the ghost shows the copy's place (or the move's) at once. */
	private handleModifierKey = (): void => {
		if (this.session.kind !== "dragging") return;
		const { mousedown, drag } = this.session;
		if ((this.deps.magnet?.isCopy() ?? false) === drag.planIsCopy) return;
		this.updateDropTarget({ clientX: drag.currentMouseX, clientY: drag.currentMouseY, mousedown, drag, snappedTime: drag.currentTime });
		this.notify();
	};

	private handleMouseUp = ({ clientX, clientY }: MouseEvent): void => {
		// A move in progress lands where it is let go, whatever the last move said (tlc C1b): the release plans from its
		// own position. (A press that never became a drag stays a click: a pending press shares its mousedown with the
		// edge trim and other gestures — starting a move from the release scrolled the view after every edge trim.)
		const scrollContainer = this.deps.viewport.getTracksScrollEl();
		if (scrollContainer && this.session.kind === "dragging" && (this.session.drag.currentMouseX !== clientX || this.session.drag.currentMouseY !== clientY)) {
			this.updateActiveDrag({ mousedown: this.session.mousedown, drag: this.session.drag, clientX, clientY, scrollContainer });
		}
		if (this.session.kind === "pending") {
			this.finishSession();
			return;
		}

		if (this.session.kind !== "dragging") return;

		const { mousedown, drag } = this.session;
		// ⌥ changed since the last plan (released with the key): commit the plan for the key as it is now.
		if ((this.deps.magnet?.isCopy() ?? false) !== drag.planIsCopy) {
			this.updateDropTarget({ clientX: drag.currentMouseX, clientY: drag.currentMouseY, mousedown, drag, snappedTime: drag.currentTime });
		}

		// If the drag returned within the click threshold of its origin, treat
		// this as a cancel rather than a commit — the user dragged then put the
		// element back.
		if (
			!movedPastDragThreshold({
				current: { x: clientX, y: clientY },
				origin: mousedown.origin,
			})
		) {
			this.lastGestureWasDrag = false;
			this.finishSession();
			return;
		}

		if (drag.reorder) {
			const { reorder } = drag;
			const trackId = this.deps.scene.getTracks().main.id;
			this.deps.magnet?.discardPreview();
			drag.reorder = null;
			if (!reorder.isNoop) {
				this.deps.magnet?.commit({
					trackId,
					elements: reorder.elements,
					selection: reorder.insertedIds.map((elementId) => ({ trackId, elementId })),
				});
			}
			this.finishSession();
			return;
		}

		const { moveGroup, groupMoveResult } = drag;
		if (!groupMoveResult) {
			this.finishSession();
			return;
		}

		const didMove = groupMoveResult.moves.some((move) => {
			const member = moveGroup.members.find(
				(m) => m.elementId === move.elementId,
			);
			const originalStartTime =
				mousedown.startElementTime + (member?.timeOffset ?? 0);
			return (
				member?.trackId !== move.targetTrackId ||
				originalStartTime !== move.newStartTime
			);
		});

		// CapCut's magnet: the main track cannot be emptied by dragging its clips away. A ⌥-drag copies: the originals
		// stay, so it can't empty anything (the only main clip's copy was refused with this toast).
		const main = this.deps.scene.getTracks().main;
		const leavingMain = new Set(
			groupMoveResult.moves.filter((move) => move.targetTrackId !== main.id).map((move) => move.elementId),
		);
		if (
			!this.deps.magnet?.isCopy() &&
			useTimelineStore.getState().rippleEditingEnabled &&
			main.elements.length > 0 &&
			main.elements.every((element) => leavingMain.has(element.id))
		) {
			toast.info("Main track cannot be empty");
			this.finishSession();
			return;
		}

		if (didMove || groupMoveResult.createTracks.length > 0) {
			this.deps.timeline.moveElements({
				moves: groupMoveResult.moves,
				createTracks: groupMoveResult.createTracks,
			});
		}

		this.finishSession();
	};
}
