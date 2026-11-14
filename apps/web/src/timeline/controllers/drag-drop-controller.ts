import { haptic } from "@/haptics";
import type { ParamValues } from "@/params";
import type { DragEvent } from "react";
import { getTracksTopOffset } from "@/timeline/tracks-offset";
import { toast } from "sonner";
import { buildLandingElement, buildSourceRangeElement, markedRange } from "@/media/source-marks";
import { processMediaAssets } from "@/media/processing";
import { splitKnownFiles } from "@/components/editor/panels/assets/views/known-files";
import { showMediaUploadToast } from "@/media/upload-toast";
import {
	DEFAULT_NEW_ELEMENT_DURATION,
	toElementDurationTicks,
} from "@/timeline/creation";
import { BASE_TIMELINE_PIXELS_PER_SECOND } from "@/timeline/scale";
import type { FrameRate } from "opencut-wasm";
import {
	buildTextElement,
	buildGraphicElement,
	buildStickerElement,
	buildEffectElement,
} from "@/timeline/element-utils";
import { AddTrackCommand, InsertElementCommand } from "@/commands/timeline";
import { getTrackHeight } from "@/timeline/components/track-layout";
import { BatchCommand } from "@/commands";
import { TracksEditCommand } from "@/actions/tracks-edit-command";
import type { Command } from "@/commands/base-command";
import { computeDropTarget, getTrackAtY } from "@/timeline/components/drop-target";
import { applyTransition, type CutRef, listTrackCuts } from "@/transitions/commands";
import { applyLayerTransition } from "@/transitions/layer-commands";
import { TRANSITION_DRAG_MIME } from "@/transitions/components/assets-view";
import type { TimelineDragSource } from "@/timeline/drag-source";
import type {
	TrackType,
	DropTarget,
	ElementType,
	SceneTracks,
	TimelineElement,
	TimelineTrack,
	CreateTimelineElement,
} from "@/timeline";
import type { TimelineDragData } from "@/timeline/drag";
import type { MediaAsset } from "@/media/types";
import type { ProcessedMediaAsset } from "@/media/processing";
import { mediaTime, roundFrameTime, TICKS_PER_SECOND, type MediaTime } from "@/wasm";
import { snapGroupEdges } from "@/timeline/group-move/snap";
import type { GroupMember } from "@/timeline/group-move/types";
import type { SnapPoint } from "@/timeline/snapping";
import { buildLibraryClip, rememberRecent } from "@/library/client";

// --- Config ---

export interface DragDropConfig {
	zoomLevel: number;
	getContainerEl: () => HTMLDivElement | null;
	getHeaderEl: () => HTMLElement | null;
	getTracksScrollEl: () => HTMLDivElement | null;
	getActiveProjectFps: () => FrameRate | null;
	getActiveProjectId: () => string | null;
	getSceneTracks: () => SceneTracks;
	getCurrentPlayheadTime: () => MediaTime;
	getMediaAssets: () => MediaAsset[];
	/** The size of the user's own file behind an editing copy (MediaManager.getEditingOriginal). */
	originalSizeOf?: (assetId: string) => number | undefined;
	dragSource: TimelineDragSource;
	addMediaAsset: (args: {
		projectId: string;
		asset: ProcessedMediaAsset;
	}) => Promise<MediaAsset | null>;
	executeCommand: (command: Command) => void;
	insertElement: (args: {
		placement: { mode: "explicit"; trackId: string } | { mode: "auto" };
		element: CreateTimelineElement;
	}) => void;
	addClipEffect: (args: {
		trackId: string;
		elementId: string;
		effectType: string;
		params?: ParamValues;
	}) => void;
	/** The magnet: a dropped clip's edges stick to clip edges, the playhead and markers (⇧ while dragging: free). */
	isSnappingEnabled: () => boolean;
	onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
}

/** What lands where the cursor is: drawn as a ghost clip on the timeline while dragging. */
export interface DropGhost {
	duration: MediaTime;
	count: number;
}

export interface DragDropConfigRef {
	readonly current: DragDropConfig;
}

// --- State ---

interface DragOverState {
	kind: "over";
	dropTarget: DropTarget | null;
	elementType: ElementType | null;
	ghost: DropGhost | null;
	/** Nothing here can be dropped (e.g. a text file from Finder): the cursor shows the "no" sign. */
	forbidden: boolean;
	/** A transition dragged over a video track: the cut it goes on (the nearest one to the cursor on that track). */
	cut?: DropCut | null;
}

/** The same drop state as far as the timeline shows it (compared field by field, every dragover). */
export function sameDragOver(a: Omit<DragOverState, "kind">, b: Omit<DragOverState, "kind">): boolean {
	if (a.forbidden !== b.forbidden || a.elementType !== b.elementType) return false;
	if (a.ghost !== b.ghost && (a.ghost?.duration !== b.ghost?.duration || a.ghost?.count !== b.ghost?.count)) return false;
	const ac = a.cut ?? null;
	const bc = b.cut ?? null;
	if (ac !== bc && (ac?.trackId !== bc?.trackId || ac?.fromElementId !== bc?.fromElementId || ac?.toElementId !== bc?.toElementId || ac?.time !== bc?.time || ac?.trackIndex !== bc?.trackIndex || ac?.layer?.elementId !== bc?.layer?.elementId)) return false;
	const at = a.dropTarget;
	const bt = b.dropTarget;
	if (at === bt) return true;
	if (!at || !bt) return false;
	return (
		at.trackIndex === bt.trackIndex &&
		at.isNewTrack === bt.isNewTrack &&
		at.insertPosition === bt.insertPosition &&
		at.xPosition === bt.xPosition &&
		at.insertOnMain === bt.insertOnMain &&
		at.targetElement?.elementId === bt.targetElement?.elementId &&
		at.targetElement?.trackId === bt.targetElement?.trackId
	);
}

export interface DropCut extends CutRef {
	trackIndex: number;
	time: MediaTime;
	/** Over an adjustment layer (effect element): the transition goes on the layer (transitions/layer.ts), not a cut. */
	layer?: { elementId: string; duration: MediaTime };
}

/** How far from a cut (screen px) a transition still finds it. */
const CUT_REACH_PX = 80;

/** Near a track's top or bottom edge a drop opens a new track there (CapCut), at most this far in. */
const NEW_TRACK_EDGE_PX = 8;

/** Finder files the timeline can place: video, sound, pictures (an unknown type is let through, import decides). */
function isPlaceableFileType(type: string): boolean {
	return type === "" || type.startsWith("video/") || type.startsWith("audio/") || type.startsWith("image/");
}

type DragDropState = { kind: "idle" } | DragOverState;

interface TimelineCoords {
	mouseX: number;
	mouseY: number;
}

// --- Pure helpers ---

function elementTypeFromDrag({
	dragData,
}: {
	dragData: TimelineDragData;
}): ElementType {
	switch (dragData.type) {
		case "text":
			return "text";
		case "graphic":
			return "graphic";
		case "sticker":
			return "sticker";
		case "effect":
			return "effect";
		case "media":
			return dragData.mediaType;
		case "library-audio":
			return "audio";
		case "source-file":
			return dragData.mediaType;
		case "deferred":
			return dragData.elementType;
	}
}

function getTargetElementTypesForDrag({
	dragData,
}: {
	dragData: TimelineDragData;
}): string[] | undefined {
	if (dragData.type === "effect") return dragData.targetElementTypes;
	// Media never goes «onto a clip»: a picture or a video dropped over a clip lands where its ghost shows — in the cut on
	// the main track, at the cursor on a layer track — never on a free track of the editor's choosing (blind test 05.11:
	// the ghost vanished over any clip and the clip turned up on a new track above).
	return undefined;
}

export function getDurationForDrag({
	dragData,
	mediaAssets,
}: {
	dragData: TimelineDragData;
	mediaAssets: MediaAsset[];
}): MediaTime {
	if (dragData.type === "library-audio") {
		return toElementDurationTicks({ seconds: dragData.dur > 0 ? dragData.dur : 3 });
	}
	if (dragData.type === "source-file" || dragData.type === "deferred") {
		return dragData.dur > 0 ? toElementDurationTicks({ seconds: dragData.dur }) : DEFAULT_NEW_ELEMENT_DURATION;
	}
	if (dragData.type !== "media") return DEFAULT_NEW_ELEMENT_DURATION;
	const byId = new Map(mediaAssets.map((asset) => [asset.id, asset]));
	const assets = (dragData.ids ?? [dragData.id]).flatMap((id) => byId.get(id) ?? []);
	if (assets.length === 0) return DEFAULT_NEW_ELEMENT_DURATION;
	// Several files land one after another on the row under the cursor (placeInRow): the pictures and videos, or only the
	// sounds when only sounds are dragged. A sound dragged with pictures starts at the same point on its own track, so it
	// is no part of the ghost's length (a picture + a sound drew 10 s and landed as 5 s on the row).
	const rowIsAudio = (assets.find((asset) => asset.type !== "audio") ?? assets[0]).type === "audio";
	const row = assets.filter((asset) => (asset.type === "audio") === rowIsAudio);
	return mediaTime({ ticks: row.reduce((sum, asset) => sum + assetDuration(asset), 0) });
}

/** A media file's length on the timeline: only the In/Out range marked in the source preview, when there is one. */
function assetDuration(asset: MediaAsset): MediaTime {
	const range = markedRange({ asset });
	return toElementDurationTicks({ seconds: range ? range.end - range.start : asset.duration });
}

/** The main track's cut nearest a time: after every clip whose middle is left of it (0 before the first). */
function mainTrackCutAt({ elements, time }: { elements: readonly TimelineElement[]; time: number }): MediaTime {
	let cut = 0;
	for (const element of [...elements].sort((a, b) => a.startTime - b.startTime)) {
		if (element.startTime + element.duration / 2 <= time) cut = element.startTime + element.duration;
	}
	return mediaTime({ ticks: cut });
}

function orderedTracks({
	sceneTracks,
}: {
	sceneTracks: SceneTracks;
}): TimelineTrack[] {
	return [...sceneTracks.overlay, sceneTracks.main, ...sceneTracks.audio];
}

// --- Controller ---

export class DragDropController {
	private state: DragDropState = { kind: "idle" };
	private enterCount = 0;
	private readonly subscribers = new Set<() => void>();
	private readonly configRef: DragDropConfigRef;

	constructor(deps: { configRef: DragDropConfigRef }) {
		this.configRef = deps.configRef;
		this.onDragEnter = this.onDragEnter.bind(this);
		this.onDragOver = this.onDragOver.bind(this);
		this.onDragLeave = this.onDragLeave.bind(this);
		this.onDrop = this.onDrop.bind(this);
	}

	private get config(): DragDropConfig {
		return this.configRef.current;
	}

	get isDragOver(): boolean {
		return this.state.kind !== "idle";
	}

	get dropTarget(): DropTarget | null {
		return this.state.kind === "over" ? this.state.dropTarget : null;
	}

	get dragElementType(): ElementType | null {
		return this.state.kind === "over" ? this.state.elementType : null;
	}

	get dropGhost(): DropGhost | null {
		return this.state.kind === "over" ? this.state.ghost : null;
	}

	get isForbidden(): boolean {
		return this.state.kind === "over" && this.state.forbidden;
	}

	get dropCut(): DropCut | null {
		return this.state.kind === "over" ? (this.state.cut ?? null) : null;
	}

	subscribe(fn: () => void): () => void {
		this.subscribers.add(fn);
		return () => this.subscribers.delete(fn);
	}

	destroy(): void {
		this.subscribers.clear();
	}

	/**
	 * The drag ended somewhere (dropped on a cut marker, which keeps the drop to itself, or let go outside): nothing is
	 * shown any more. The cut bar of a transition stayed lit on the timeline after the first transition went on.
	 */
	reset(): void {
		this.enterCount = 0;
		if (this.state.kind !== "idle") this.setIdle();
	}

	// --- Drag event handlers (bound, stable, passed as React props) ---

	onDragEnter(event: DragEvent): void {
		event.preventDefault();
		const hasAsset = this.config.dragSource.isActive();
		const hasFiles = event.dataTransfer.types.includes("Files");
		const hasTransition = event.dataTransfer.types.includes(TRANSITION_DRAG_MIME);
		if (!hasAsset && !hasFiles && !hasTransition) return;

		this.enterCount += 1;
		if (this.state.kind === "idle") {
			this.setOver({ dropTarget: null, elementType: null, ghost: null, forbidden: false });
		}
	}

	onDragOver(event: DragEvent): void {
		event.preventDefault();

		const coords = this.getMouseTimelineCoords({ event });
		if (!coords) return;

		const dragData = this.config.dragSource.getActive();
		const hasFiles = event.dataTransfer.types.includes("Files");

		if (!dragData && event.dataTransfer.types.includes(TRANSITION_DRAG_MIME)) {
			const cut = this.findLayerAt({ coords }) ?? this.findCutNear({ coords });
			this.setOver({ dropTarget: null, elementType: null, ghost: null, forbidden: !cut, cut });
			event.dataTransfer.dropEffect = cut ? "copy" : "none";
			return;
		}

		if (!dragData) {
			if (!hasFiles) return;
			// Files from Finder: their length isn't known until they're read, so the ghost has the default length. Their
			// types are readable while dragging: a sound shows on an audio row, a text file gets the "no" sign.
			const types = Array.from(event.dataTransfer.items ?? [], (item) => item.type);
			if (types.length > 0 && !types.some(isPlaceableFileType)) {
				this.setOver({ dropTarget: null, elementType: null, ghost: null, forbidden: true });
				event.dataTransfer.dropEffect = "none";
				return;
			}
			const fileType: ElementType = types[0]?.startsWith("audio/") ? "audio" : "video";
			const count = Math.max(1, types.length);
			const duration = mediaTime({ ticks: DEFAULT_NEW_ELEMENT_DURATION * count });
			const target = this.resolveDropTarget({ elementType: fileType, coords, duration, isExternalDrop: true, free: event.shiftKey || event.metaKey });
			this.setOver({ dropTarget: target, elementType: fileType, ghost: { duration, count }, forbidden: false });
			event.dataTransfer.dropEffect = "copy";
			return;
		}

		const elementType = elementTypeFromDrag({ dragData });
		const duration = getDurationForDrag({
			dragData,
			mediaAssets: this.config.getMediaAssets(),
		});
		const target = this.resolveDropTarget({
			elementType,
			coords,
			duration,
			isExternalDrop: false,
			free: event.shiftKey || event.metaKey,
			targetElementTypes: getTargetElementTypesForDrag({ dragData }),
		});
		const count = dragData.type === "media" ? (dragData.ids?.length ?? 1) : 1;
		// Music is cut to the end of the video where it lands: the ghost shows that length, not the whole song (a 2:48 song
		// drew 12 000 px and landed as 10 s — targeted test 05.11).
		const song = dragData.type === "media" && !(dragData.ids && dragData.ids.length > 1) ? this.config.getMediaAssets().find((asset) => asset.id === dragData.id) : undefined;
		const shown =
			dragData.type === "library-audio" && target
				? buildLibraryClip({ entry: dragData, startTime: target.xPosition, tracks: this.config.getSceneTracks() }).duration
				: song?.type === "audio" && target
					? this.landing(song, target.xPosition).duration
					: duration;
		this.setOver({ dropTarget: target, elementType, ghost: { duration: shown, count }, forbidden: false });
		event.dataTransfer.dropEffect = "copy";
	}

	/**
	 * Where a drop lands: the track under the cursor (a new one near a track's edge), at the cursor's frame, the
	 * clip's start or end stuck to the nearest clip edge, the playhead or a marker when one is within reach.
	 */
	private resolveDropTarget({
		elementType,
		coords,
		duration,
		isExternalDrop,
		free,
		targetElementTypes,
	}: {
		elementType: ElementType;
		coords: TimelineCoords;
		duration: MediaTime;
		isExternalDrop: boolean;
		/** ⇧ held: no magnet. */
		free: boolean;
		targetElementTypes?: string[];
	}): DropTarget {
		const tracks = this.config.getSceneTracks();
		const base = {
			elementType,
			mouseX: coords.mouseX,
			mouseY: coords.mouseY,
			tracks,
			playheadTime: this.config.getCurrentPlayheadTime(),
			isExternalDrop,
			elementDuration: duration,
			pixelsPerSecond: BASE_TIMELINE_PIXELS_PER_SECOND,
			zoomLevel: this.config.zoomLevel,
			edgeInsertPx: NEW_TRACK_EDGE_PX,
		};
		// Onto a clip (an effect, a replacement): the clip is the target, its time doesn't matter.
		if (targetElementTypes && targetElementTypes.length > 0) {
			const onClip = computeDropTarget({ ...base, targetElementTypes });
			if (onClip.targetElement) {
				this.reportSnap(null);
				return onClip;
			}
		}

		const fps = this.config.getActiveProjectFps();
		const cursorTime = mediaTime({
			ticks: Math.round(
				(Math.max(0, coords.mouseX) / (BASE_TIMELINE_PIXELS_PER_SECOND * this.config.zoomLevel)) * TICKS_PER_SECOND,
			),
		});
		let startTime = fps ? roundFrameTime({ time: cursorTime, fps }) : cursorTime;

		// Pictures over the main track (not at its edges) go in at the cut nearest the cursor, as clips dragged along
		// it do (CapCut's magnetic main track): no gap, no clip thrown onto a new track.
		const mainIndex = tracks.overlay.length;
		const hit = getTrackAtY({ mouseY: coords.mouseY, tracks: orderedTracks({ sceneTracks: tracks }) });
		if (hit?.trackIndex === mainIndex && (elementType === "video" || elementType === "image") && tracks.main.elements.length > 0) {
			const height = getTrackHeight({ type: tracks.main.type });
			const edge = Math.min(NEW_TRACK_EDGE_PX, height / 5);
			// Only the top band means «a new track above»: the bottom band is still the main track (a drop there past the last
			// clip used to land at the cursor and leave a gap on the magnetic track — fuzz 03.11).
			if (hit.relativeY >= edge) {
				this.reportSnap(null);
				return {
					trackIndex: mainIndex,
					isNewTrack: false,
					insertPosition: null,
					xPosition: mainTrackCutAt({ elements: tracks.main.elements, time: cursorTime }),
					targetElement: null,
					insertOnMain: true,
				};
			}
		}
		let snapPoint: SnapPoint | null = null;
		if (!free && this.config.isSnappingEnabled()) {
			// The dropped clip as a one-member group: its start and its end both look for a snap point.
			const member: GroupMember = {
				trackId: "",
				elementId: "",
				elementType,
				duration,
				timeOffset: mediaTime({ ticks: 0 }),
				trackSection: "main",
				sectionIndex: 0,
				displayIndex: 0,
			};
			const snapped = snapGroupEdges({
				group: { anchor: member, members: [member] },
				anchorStartTime: startTime,
				tracks,
				playheadTime: base.playheadTime,
				zoomLevel: this.config.zoomLevel,
			});
			startTime = snapped.snappedAnchorStartTime;
			snapPoint = snapped.snapPoint;
		}
		this.reportSnap(snapPoint);
		return computeDropTarget({ ...base, startTimeOverride: startTime });
	}

	/** The adjustment layer under the cursor (a transition dropped there transitions everything below it). */
	private findLayerAt({ coords }: { coords: TimelineCoords }): DropCut | null {
		const tracks = orderedTracks({ sceneTracks: this.config.getSceneTracks() });
		const hit = getTrackAtY({ mouseY: coords.mouseY, tracks });
		const track = hit ? tracks[hit.trackIndex] : null;
		if (!hit || !track || track.type !== "effect" || track.locked) return null;
		const pixelsPerSecond = BASE_TIMELINE_PIXELS_PER_SECOND * this.config.zoomLevel;
		const cursor = (coords.mouseX / pixelsPerSecond) * TICKS_PER_SECOND;
		const element = track.elements.find((e) => cursor >= e.startTime && cursor <= e.startTime + e.duration);
		if (!element) return null;
		return {
			trackId: track.id,
			fromElementId: "",
			toElementId: "",
			trackIndex: hit.trackIndex,
			time: element.startTime,
			layer: { elementId: element.id, duration: element.duration },
		};
	}

	/** The cut of the video track under the cursor nearest to it, within reach. */
	private findCutNear({ coords }: { coords: TimelineCoords }): DropCut | null {
		const tracks = orderedTracks({ sceneTracks: this.config.getSceneTracks() });
		const hit = getTrackAtY({ mouseY: coords.mouseY, tracks });
		const track = hit ? tracks[hit.trackIndex] : null;
		if (!hit || !track || track.type !== "video") return null;
		const pixelsPerSecond = BASE_TIMELINE_PIXELS_PER_SECOND * this.config.zoomLevel;
		const cursor = (coords.mouseX / pixelsPerSecond) * TICKS_PER_SECOND;
		const reach = (CUT_REACH_PX / pixelsPerSecond) * TICKS_PER_SECOND;
		let best: DropCut | null = null;
		for (const cut of listTrackCuts(track)) {
			const distance = Math.abs(cut.time - cursor);
			if (distance > reach || (best && distance >= Math.abs(best.time - cursor))) continue;
			best = { trackId: cut.trackId, fromElementId: cut.fromElementId, toElementId: cut.toElementId, trackIndex: hit.trackIndex, time: cut.time as MediaTime };
		}
		return best;
	}

	private lastSnapPoint: SnapPoint | null = null;

	private reportSnap(snapPoint: SnapPoint | null): void {
		if (snapPoint === this.lastSnapPoint) return;
		this.lastSnapPoint = snapPoint;
		this.config.onSnapPointChange?.(snapPoint);
	}

	onDragLeave(event: DragEvent): void {
		event.preventDefault();
		if (this.enterCount === 0) return;
		this.enterCount -= 1;
		if (this.enterCount === 0) {
			this.setIdle();
		}
	}

	onDrop(event: DragEvent): void {
		event.preventDefault();
		this.enterCount = 0;

		const dragData = this.config.dragSource.getActive();
		const hasFiles = event.dataTransfer.files?.length > 0;
		const transitionType = dragData ? "" : event.dataTransfer.getData(TRANSITION_DRAG_MIME);
		const cut = this.dropCut;
		if (transitionType) {
			this.setIdle();
			if (cut?.layer) applyLayerTransition({ layer: { trackId: cut.trackId, elementId: cut.layer.elementId }, type: transitionType });
			else if (cut) applyTransition({ cut, type: transitionType });
			if (cut) haptic("drop");
			return;
		}
		if (!dragData && !hasFiles) return;

		const currentTarget = this.dropTarget;
		this.setIdle();

		try {
			if (dragData) {
				if (!currentTarget) return;
				this.executeAssetDrop({ target: currentTarget, dragData });
				haptic("drop"); // the drop is accepted: one tap (haptics)
				return;
			}

			const coords = this.getMouseTimelineCoords({ event });
			if (!coords) return;
			this.executeFileDrop({
				files: Array.from(event.dataTransfer.files),
				mouseX: coords.mouseX,
				mouseY: coords.mouseY,
			}).catch((error) => {
				console.error("Failed to process file drop:", error);
			});
		} catch (error) {
			console.error("Failed to process drop:", error);
		}
	}

	// --- Private ---

	private setOver(state: Omit<DragOverState, "kind">): void {
		// dragover comes every few ms while the pointer is held still or moves within one cut: each notify re-rendered
		// the whole timeline (every track and clip) — a transition dragged over a long edit stuttered. Only a change
		// of what is shown (the cut, the target, the ghost, the no-drop sign) is passed on.
		if (this.state.kind === "over" && sameDragOver(this.state, state)) return;
		this.state = { kind: "over", ...state };
		this.notify();
	}

	private setIdle(): void {
		this.state = { kind: "idle" };
		this.reportSnap(null);
		this.notify();
	}

	private notify(): void {
		for (const fn of this.subscribers) fn();
	}

	private getMouseTimelineCoords({
		event,
	}: {
		event: DragEvent;
	}): TimelineCoords | null {
		const scrollContainer = this.config.getTracksScrollEl();
		const referenceRect =
			scrollContainer?.getBoundingClientRect() ??
			this.config.getContainerEl()?.getBoundingClientRect();
		if (!referenceRect) return null;

		const scrollLeft = scrollContainer?.scrollLeft ?? 0;
		const scrollTop = scrollContainer?.scrollTop ?? 0;
		const headerHeight =
			this.config.getHeaderEl()?.getBoundingClientRect().height ?? 0;

		return {
			mouseX: event.clientX - referenceRect.left + scrollLeft,
			mouseY: event.clientY - referenceRect.top + scrollTop - headerHeight - getTracksTopOffset(),
		};
	}

	// Shared insertion logic — new track vs existing track.
	private insertAtTarget({
		element,
		target,
		trackType,
	}: {
		element: CreateTimelineElement;
		target: DropTarget;
		trackType: TrackType;
	}): void {
		if (target.isNewTrack) {
			const addTrackCmd = new AddTrackCommand({
				type: trackType,
				index: target.trackIndex,
			});
			this.config.executeCommand(
				new BatchCommand([
					addTrackCmd,
					new InsertElementCommand({
						element,
						placement: { mode: "explicit", trackId: addTrackCmd.getTrackId() },
					}),
				]),
			);
			return;
		}

		const tracks = orderedTracks({ sceneTracks: this.config.getSceneTracks() });
		const track = tracks[target.trackIndex];
		if (!track) return;
		this.config.insertElement({
			placement: { mode: "explicit", trackId: track.id },
			element,
		});
	}

	private executeAssetDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: TimelineDragData;
	}): void {
		switch (dragData.type) {
			case "text":
				this.executeTextDrop({ target, dragData });
				return;
			case "graphic":
				this.executeGraphicDrop({ target, dragData });
				return;
			case "sticker":
				this.executeStickerDrop({ target, dragData });
				return;
			case "effect":
				this.executeEffectDrop({ target, dragData });
				return;
			case "media":
				this.executeMediaDrop({ target, dragData });
				return;
			case "library-audio": {
				const { id, name, url, kind, dur, cat, gain } = dragData;
				this.insertAtTarget({
					element: buildLibraryClip({
						entry: { url, name, dur, kind, gain },
						startTime: target.xPosition,
						tracks: this.config.getSceneTracks(),
					}),
					target,
					trackType: "audio",
				});
				rememberRecent({ id, name, url, kind, dur, cat });
				return;
			}
			case "deferred": {
				// Loaded only now, then placed by its own code at the time under the cursor — on the track under it when
				// that track has room (it went to the top text track even when a lower one was free).
				const track = target.isNewTrack ? undefined : orderedTracks({ sceneTracks: this.config.getSceneTracks() })[target.trackIndex];
				const hint = target.isNewTrack ? { newTrackIndex: target.trackIndex } : { trackId: track?.id };
				void dragData.place(target.xPosition / TICKS_PER_SECOND, hint).catch((e) => toast.error((e as Error).message));
				return;
			}
			case "source-file":
				// Into Media first (only now: the user took it), then placed like any media file.
				void dragData
					.take()
					.then((asset) => this.executeMediaDrop({ target, dragData: { type: "media", id: asset.id, name: asset.name, mediaType: dragData.mediaType } }))
					.catch((e) => toast.error((e as Error).message));
				return;
		}
	}

	private executeTextDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "text" }>;
	}): void {
		const element = buildTextElement({
			raw: {
				name: dragData.name ?? "",
				params: { content: dragData.content ?? "" },
			},
			startTime: target.xPosition,
		});
		this.insertAtTarget({ element, target, trackType: "text" });
	}

	private executeStickerDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "sticker" }>;
	}): void {
		const element = buildStickerElement({
			stickerId: dragData.stickerId,
			name: dragData.name,
			startTime: target.xPosition,
		});
		this.insertAtTarget({ element, target, trackType: "graphic" });
	}

	private executeGraphicDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "graphic" }>;
	}): void {
		const element = buildGraphicElement({
			definitionId: dragData.definitionId,
			name: dragData.name,
			startTime: target.xPosition,
			params: dragData.params,
		});
		this.insertAtTarget({ element, target, trackType: "graphic" });
	}

	private executeMediaDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "media" }>;
	}): void {
		if ((dragData.ids && dragData.ids.length > 1) || !target.targetElement) {
			const byId = new Map(this.config.getMediaAssets().map((asset) => [asset.id, asset]));
			const assets = (dragData.ids ?? [dragData.id]).flatMap((id) => byId.get(id) ?? []);
			this.placeInRow({ assets, target: { ...target, targetElement: null } });
			return;
		}
		const mediaAsset = this.config
			.getMediaAssets()
			.find((asset) => asset.id === dragData.id);
		if (!mediaAsset) return;

		if (target.targetElement) {
			// Dropped onto a clip: never a silent no-op — the clip goes in at that time, on a free
			// track (a new one above when needed), like a drop next to it.
			this.config.insertElement({
				placement: { mode: "auto" },
				element: this.landing(mediaAsset, target.xPosition),
			});
			return;
		}

		const trackType: TrackType =
			dragData.mediaType === "audio" ? "audio" : "video";
		this.insertAtTarget({ element: this.landing(mediaAsset, target.xPosition), target, trackType });
	}

	private landing(asset: MediaAsset, startTime: MediaTime): CreateTimelineElement {
		return buildLandingElement({ asset, startTime, tracks: this.config.getSceneTracks() });
	}

	/**
	 * Several files dropped together land one after another from the drop point as one undo step: pictures and
	 * videos on the target track (the new one, when the drop opens a track), sounds after each other where they fit.
	 */
	private placeInRow({ assets, target }: { assets: MediaAsset[]; target: DropTarget }): void {
		if (assets.length === 0) return;
		const primaryIsAudio = (assets.find((asset) => asset.type !== "audio") ?? assets[0]).type === "audio";
		const commands: Command[] = [];
		let trackId: string | undefined;
		if (target.isNewTrack) {
			const addTrack = new AddTrackCommand({ type: primaryIsAudio ? "audio" : "video", index: target.trackIndex });
			commands.push(addTrack);
			trackId = addTrack.getTrackId();
		} else {
			trackId = orderedTracks({ sceneTracks: this.config.getSceneTracks() })[target.trackIndex]?.id;
		}
		if (target.insertOnMain && trackId) {
			// The clips from the cut on move along by what goes in (the last first: no overlap on the way).
			const total = assets
				.filter((asset) => (asset.type === "audio") === primaryIsAudio)
				.reduce((sum, asset) => sum + assetDuration(asset), 0);
			// Set as a whole: moved one by one, the first clip snapped back to 0 (a main track starts at 0) and the clip that
			// went in at 0 lay over it with the magnet off (targeted test 05.11).
			const tracks = this.config.getSceneTracks();
			const later = tracks.main.elements.filter((element) => element.startTime >= target.xPosition);
			if (later.length > 0 && total > 0) {
				const moved = tracks.main.elements.map((element) =>
					element.startTime >= target.xPosition ? { ...element, startTime: mediaTime({ ticks: element.startTime + total }) } : element,
				);
				commands.push(new TracksEditCommand({ before: tracks, after: { ...tracks, main: { ...tracks.main, elements: moved } as typeof tracks.main } }));
			}
		}
		let primaryAt = target.xPosition;
		let otherAt = target.xPosition;
		for (const asset of assets) {
			const isPrimary = (asset.type === "audio") === primaryIsAudio;
			const startTime = isPrimary ? primaryAt : otherAt;
			commands.push(
				new InsertElementCommand({
					// one file lands as its ghost showed (a song cut to the video's end); a row keeps each file whole
					element: assets.length === 1 ? this.landing(asset, startTime) : buildSourceRangeElement({ asset, startTime }),
					placement: isPrimary && trackId ? { mode: "explicit", trackId } : { mode: "auto" },
				}),
			);
			const next = mediaTime({ ticks: startTime + assetDuration(asset) });
			if (isPrimary) primaryAt = next;
			else otherAt = next;
		}
		this.config.executeCommand(commands.length === 1 ? commands[0] : new BatchCommand(commands));
	}

	private executeEffectDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "effect" }>;
	}): void {
		if (dragData.applyTo) {
			if (target.targetElement) dragData.applyTo(target.targetElement);
			return;
		}
		if (target.targetElement) {
			this.config.addClipEffect({
				trackId: target.targetElement.trackId,
				elementId: target.targetElement.elementId,
				effectType: dragData.effectType,
				params: dragData.params,
			});
			// the inspector opens where the dropped thing is edited (properties/reveal.ts listens)
			if (typeof window !== "undefined")
				window.dispatchEvent(
					new CustomEvent("gz-clip-effect-added", { detail: { trackId: target.targetElement.trackId, elementId: target.targetElement.elementId, effectType: dragData.effectType } }),
				);
			return;
		}

		const built = buildEffectElement({
			effectType: dragData.effectType,
			startTime: target.xPosition,
		});
		// The layer is named after its tile (a filter also carries its look); without params the tile's name was lost and
		// a dropped Custom adjustment read «Studio.color» while a double-click gave «Adjustment» (st45, 03.11).
		const element = { ...built, name: dragData.name ?? built.name, ...(dragData.params ? { params: { ...built.params, ...dragData.params } } : {}) };

		// Where the ghost and the drop line showed: a free spot of an effect track, or a new track there. Sent to the first
		// effect track it went over whatever was there, or to the top (targeted test 05.11).
		const onTrack = !target.isNewTrack ? orderedTracks({ sceneTracks: this.config.getSceneTracks() })[target.trackIndex] : undefined;
		if (target.isNewTrack || onTrack?.type === "effect") {
			this.insertAtTarget({ element, target, trackType: "effect" });
			return;
		}
		this.config.executeCommand(new InsertElementCommand({ element, placement: { mode: "auto", trackType: "effect" } }));
	}

	private async executeFileDrop({
		files,
		mouseX,
		mouseY,
	}: {
		files: File[];
		mouseX: number;
		mouseY: number;
	}): Promise<void> {
		const projectId = this.config.getActiveProjectId();
		if (!projectId) return;

		await showMediaUploadToast({
			filesCount: files.length,
			promise: async () => {
				// A file already in Media (same name and size) is placed from its asset: dropping it again used to
				// import it a second time, two identical tiles in Media.
				const { fresh, known } = splitKnownFiles({ files, assets: this.config.getMediaAssets(), originalSizeOf: this.config.originalSizeOf });
				const processedAssets = await processMediaAssets({ files: fresh });
				const knownById = new Map(this.config.getMediaAssets().map((asset) => [asset.id, asset]));
				const placements: Array<MediaAsset | ProcessedMediaAsset> = [
					...known.flatMap(({ assetId }) => knownById.get(assetId) ?? []),
					...processedAssets,
				];

				// Sequential on purpose: each iteration reads getSceneTracks()
				// to decide placement (reuse empty main vs new track) and that
				// decision depends on the effects of prior inserts.
				const assets: MediaAsset[] = [];
				for (const asset of placements) {
					const createdAsset =
						"id" in asset && knownById.has(asset.id)
							? (asset as MediaAsset)
							: await this.config.addMediaAsset({
									projectId,
									asset: asset as ProcessedMediaAsset,
								});
					if (createdAsset) assets.push(createdAsset);
				}
				if (assets.length === 0) return { uploadedCount: 0, assetNames: [] };
				// In the order they were dragged (known files come back from Media first).
				const order = new Map(files.map((file, index) => [file.name, index]));
				assets.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));

				const sceneTracks = this.config.getSceneTracks();
				const first = assets.find((asset) => asset.type !== "audio") ?? assets[0];
				const isEmpty =
					sceneTracks.overlay.length === 0 &&
					sceneTracks.audio.length === 0 &&
					sceneTracks.main.elements.length === 0;
				// An empty edit: the pictures go on the main track at the playhead, wherever they were dropped.
				const target: DropTarget =
					isEmpty && first.type !== "audio"
						? {
								trackIndex: sceneTracks.overlay.length,
								isNewTrack: false,
								insertPosition: null,
								xPosition: this.config.getCurrentPlayheadTime(),
								targetElement: null,
							}
						: this.resolveDropTarget({
								elementType: first.type,
								coords: { mouseX, mouseY },
								duration: mediaTime({
									ticks: assets.filter((asset) => (asset.type === "audio") === (first.type === "audio")).reduce((sum, asset) => sum + assetDuration(asset), 0),
								}),
								isExternalDrop: true,
								free: false,
							});
				this.reportSnap(null);
				this.placeInRow({ assets, target });

				return {
					uploadedCount: placements.length,
					assetNames: placements.map((asset) => asset.name),
				};
			},
		});
	}
}
