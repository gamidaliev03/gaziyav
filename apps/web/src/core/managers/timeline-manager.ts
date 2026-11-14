import { dropOrphanTransitions } from "@/timeline/orphan-transitions";
import type { EditorCore } from "@/core";
import type { ElementBounds } from "@/preview/element-bounds";
import type { ParamValues } from "@/params";
import type {
	SceneTracks,
	TrackType,
	TimelineTrack,
	TimelineElement,
	RetimeConfig,
} from "@/timeline";
import { calculateTotalDuration } from "@/timeline";
import { TimelineDragSource } from "@/timeline/drag-source";
import { findTrackInSceneTracks } from "@/timeline/track-element-update";
import { findElementById, findElementOnTrack } from "@/timeline/element-index";
import { speedOff } from "@/timeline/speed-flags";
import { lastFrameMediaTime, type MediaTime, ZERO_MEDIA_TIME } from "@/wasm";
import {
	canElementBeHidden,
	canElementHaveAudio,
} from "@/timeline/element-utils";
import { isElementMuted } from "@/timeline/audio-state";
import type {
	AnimationPath,
	AnimationInterpolation,
	ScalarCurveKeyframePatch,
} from "@/animation/types";
import type { ParamValue } from "@/params";
import {
	getElementLocalTime,
	resolveAnimationPathValueAtTime,
} from "@/animation";
import { resolveAnimationTarget } from "@/timeline/animation-targets";
import { BatchCommand } from "@/commands";
import {
	AddTrackCommand,
	RemoveTrackCommand,
	ToggleTrackMuteCommand,
	ToggleTrackVisibilityCommand,
	InsertElementCommand,
	DeleteElementsCommand,
	DuplicateElementsCommand,
	UpdateElementsCommand,
	SplitElementsCommand,
	MoveElementCommand,
	TracksSnapshotCommand,
	UpsertKeyframeCommand,
	RemoveKeyframeCommand,
	RetimeKeyframeCommand,
	UpdateScalarKeyframeCurveCommand,
	AddClipEffectCommand,
	DeleteFreeformPathMaskPointsCommand,
	InsertFreeformPathMaskPointCommand,
	RemoveClipEffectCommand,
	UpdateClipEffectParamsCommand,
	ToggleClipEffectCommand,
	ReorderClipEffectsCommand,
	RemoveMaskCommand,
	ToggleMaskInvertedCommand,
	UpsertEffectParamKeyframeCommand,
	RemoveEffectParamKeyframeCommand,
	ToggleSourceAudioSeparationCommand,
} from "@/commands/timeline";
import type { InsertElementParams } from "@/commands/timeline/element/insert-element";
import type {
	PlannedElementMove,
	PlannedTrackCreation,
} from "@/timeline/group-move";

/** True when laying this preview over the element would change none of its values. */
function overlayChangesNothing(element: TimelineElement, overlay: Partial<TimelineElement>): boolean {
	const own = element as unknown as Record<string, unknown>;
	for (const [key, value] of Object.entries(overlay)) {
		if (key === "params" && value && typeof value === "object" && own.params && typeof own.params === "object") {
			const params = own.params as Record<string, unknown>;
			for (const [param, paramValue] of Object.entries(value as Record<string, unknown>)) {
				if (!Object.is(params[param], paramValue)) return false;
			}
			continue;
		}
		if (!Object.is(own[key], value)) return false;
	}
	return true;
}

export class TimelineManager {
	private listeners = new Set<() => void>();
	private previewOverlay = new Map<string, Partial<TimelineElement>>();
	private previewTracks: SceneTracks | null = null;
	/** The committed tracks `previewTracks` was built from: when they change by any path, it is built again. */
	private previewBase: SceneTracks | null = null;
	public readonly dragSource = new TimelineDragSource();

	constructor(private editor: EditorCore) {}

	addTrack({ type, index }: { type: TrackType; index?: number }): string {
		const command = new AddTrackCommand({ type, index });
		this.editor.command.execute({ command });
		return command.getTrackId();
	}

	removeTrack({ trackId }: { trackId: string }): void {
		const command = new RemoveTrackCommand(trackId);
		this.editor.command.execute({ command });
	}

	insertElement({ element, placement }: InsertElementParams): void {
		const command = new InsertElementCommand({ element, placement });
		this.editor.command.execute({ command });
	}

	updateElementTrim({
		elementId,
		trimStart,
		trimEnd,
		startTime,
		duration,
		pushHistory = true,
	}: {
		elementId: string;
		trimStart: MediaTime;
		trimEnd: MediaTime;
		startTime?: MediaTime;
		duration?: MediaTime;
		pushHistory?: boolean;
	}): void {
		const trackId = this.findTrackIdForElement({ elementId });
		if (!trackId) {
			return;
		}

		const nextUpdates: Partial<TimelineElement> = {
			trimStart,
			trimEnd,
		};
		if (startTime !== undefined) {
			nextUpdates.startTime = startTime;
		}
		if (duration !== undefined) {
			nextUpdates.duration = duration;
		}

		this.updateElements({
			updates: [
				{
					trackId,
					elementId,
					patch: nextUpdates,
				},
			],
			pushHistory,
		});
	}

	updateElementRetime({
		trackId,
		elementId,
		retime,
		pushHistory = true,
	}: {
		trackId: string;
		elementId: string;
		retime?: RetimeConfig;
		pushHistory?: boolean;
	}): void {
		this.updateElements({
			updates: [
				{
					trackId,
					elementId,
					patch: {
						retime,
					},
				},
			],
			pushHistory,
		});
	}

	moveElements({
		moves,
		createTracks,
	}: {
		moves: PlannedElementMove[];
		createTracks?: PlannedTrackCreation[];
	}): void {
		if (moves.length === 0) {
			return;
		}

		const command = new MoveElementCommand({
			moves,
			createTracks,
		});
		this.editor.command.execute({ command });
	}

	toggleTrackMute({ trackId }: { trackId: string }): void {
		const command = new ToggleTrackMuteCommand(trackId);
		this.editor.command.execute({ command });
	}

	toggleTrackVisibility({ trackId }: { trackId: string }): void {
		const command = new ToggleTrackVisibilityCommand(trackId);
		this.editor.command.execute({ command });
	}

	splitElements({
		elements,
		splitTime,
		retainSide = "both",
	}: {
		elements: { trackId: string; elementId: string }[];
		splitTime: MediaTime;
		retainSide?: "both" | "left" | "right";
	}): { trackId: string; elementId: string }[] {
		const command = new SplitElementsCommand({
			elements,
			splitTime,
			retainSide,
		});
		this.editor.command.execute({ command });
		return command.getRightSideElements();
	}

	getTotalDuration(): MediaTime {
		const activeScene = this.editor.scenes.getActiveSceneOrNull();
		if (!activeScene) {
			return ZERO_MEDIA_TIME;
		}

		return calculateTotalDuration({ tracks: activeScene.tracks });
	}

	getLastFrameTime(): MediaTime {
		const duration = this.getTotalDuration();
		const fps = this.editor.project.getActive()?.settings.fps;
		if (!fps || duration <= 0) return duration;
		return lastFrameMediaTime({ duration, fps });
	}

	getTrackById({ trackId }: { trackId: string }): TimelineTrack | null {
		const activeScene = this.editor.scenes.getActiveSceneOrNull();
		if (!activeScene) {
			return null;
		}

		return findTrackInSceneTracks({ tracks: activeScene.tracks, trackId });
	}

	getElementsWithTracks({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): Array<{ track: TimelineTrack; element: TimelineElement }> {
		const result: Array<{ track: TimelineTrack; element: TimelineElement }> =
			[];
		const tracks = this.editor.scenes.getActiveSceneOrNull()?.tracks;
		if (!tracks) return result;

		// By the tracks' id index (timeline/element-index): asked for every selected clip on each notification of an edit.
		for (const { trackId, elementId } of elements) {
			const found = findElementOnTrack({ tracks, trackId, elementId });
			if (found) result.push({ track: found.track, element: found.element });
		}

		return result;
	}

	deleteElements({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): void {
		const command = new DeleteElementsCommand({ elements });
		this.editor.command.execute({ command });
	}

	toggleSourceAudioSeparation({
		trackId,
		elementId,
	}: {
		trackId: string;
		elementId: string;
	}): void {
		const command = new ToggleSourceAudioSeparationCommand({
			trackId,
			elementId,
		});
		this.editor.command.execute({ command });
	}

	updateElements({
		updates,
		pushHistory = true,
	}: {
		updates: Array<{
			trackId: string;
			elementId: string;
			patch: Partial<TimelineElement>;
		}>;
		pushHistory?: boolean;
	}): void {
		if (updates.length === 0) {
			return;
		}

		const command = new UpdateElementsCommand({
			updates,
		});
		if (pushHistory) {
			this.editor.command.execute({ command });
		} else {
			command.execute();
		}
	}

	addClipEffect({
		trackId,
		elementId,
		effectType,
		params,
	}: {
		trackId: string;
		elementId: string;
		effectType: string;
		params?: ParamValues;
	}): string {
		const command = new AddClipEffectCommand({
			trackId,
			elementId,
			effectType,
			params,
		});
		this.editor.command.execute({ command });
		return command.getEffectId() ?? "";
	}

	removeClipEffect({
		trackId,
		elementId,
		effectId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
	}): void {
		const command = new RemoveClipEffectCommand({
			trackId,
			elementId,
			effectId,
		});
		this.editor.command.execute({ command });
	}

	removeMask({
		trackId,
		elementId,
		maskId,
	}: {
		trackId: string;
		elementId: string;
		maskId: string;
	}): void {
		const command = new RemoveMaskCommand({
			trackId,
			elementId,
			maskId,
		});
		this.editor.command.execute({ command });
	}

	deleteFreeformPathMaskPoints({
		trackId,
		elementId,
		maskId,
		pointIds,
	}: {
		trackId: string;
		elementId: string;
		maskId: string;
		pointIds: string[];
	}): void {
		if (pointIds.length === 0) {
			return;
		}
		const command = new DeleteFreeformPathMaskPointsCommand({
			trackId,
			elementId,
			maskId,
			pointIds,
		});
		this.editor.command.execute({ command });
	}

	insertFreeformPathMaskPoint({
		trackId,
		elementId,
		maskId,
		segmentIndex,
		canvasPoint,
		bounds,
	}: {
		trackId: string;
		elementId: string;
		maskId: string;
		segmentIndex: number;
		canvasPoint: { x: number; y: number };
		bounds: ElementBounds;
	}): void {
		const command = new InsertFreeformPathMaskPointCommand({
			trackId,
			elementId,
			maskId,
			segmentIndex,
			canvasPoint,
			bounds,
		});
		this.editor.command.execute({ command });
	}

	updateClipEffectParams({
		trackId,
		elementId,
		effectId,
		params,
		pushHistory = true,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
		params: Partial<ParamValues>;
		pushHistory?: boolean;
	}): void {
		const command = new UpdateClipEffectParamsCommand({
			trackId,
			elementId,
			effectId,
			params,
		});
		if (pushHistory) {
			this.editor.command.execute({ command });
		} else {
			command.execute();
		}
	}

	toggleClipEffect({
		trackId,
		elementId,
		effectId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
	}): void {
		const command = new ToggleClipEffectCommand({
			trackId,
			elementId,
			effectId,
		});
		this.editor.command.execute({ command });
	}

	toggleMaskInverted({
		trackId,
		elementId,
		maskId,
	}: {
		trackId: string;
		elementId: string;
		maskId: string;
	}): void {
		const command = new ToggleMaskInvertedCommand({
			trackId,
			elementId,
			maskId,
		});
		this.editor.command.execute({ command });
	}

	reorderClipEffects({
		trackId,
		elementId,
		fromIndex,
		toIndex,
	}: {
		trackId: string;
		elementId: string;
		fromIndex: number;
		toIndex: number;
	}): void {
		const command = new ReorderClipEffectsCommand({
			trackId,
			elementId,
			fromIndex,
			toIndex,
		});
		this.editor.command.execute({ command });
	}

	upsertKeyframes({
		keyframes,
	}: {
		keyframes: Array<{
			trackId: string;
			elementId: string;
			propertyPath: AnimationPath;
			time: MediaTime;
			value: ParamValue;
			interpolation?: AnimationInterpolation;
			keyframeId?: string;
		}>;
	}): void {
		if (keyframes.length === 0) {
			return;
		}

		const commands = keyframes.map(
			({
				trackId,
				elementId,
				propertyPath,
				time,
				value,
				interpolation,
				keyframeId,
			}) =>
				new UpsertKeyframeCommand({
					trackId,
					elementId,
					propertyPath,
					time,
					value,
					interpolation,
					keyframeId,
				}),
		);
		const command =
			commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
	}

	removeKeyframes({
		keyframes,
	}: {
		keyframes: Array<{
			trackId: string;
			elementId: string;
			propertyPath: AnimationPath;
			keyframeId: string;
		}>;
	}): void {
		if (keyframes.length === 0) {
			return;
		}

		// Pre-sample values at playhead for each (element, property) pair.
		// This preserves "what you see is what you get" when all keyframes are deleted.
		const playheadTime = this.editor.playback.getCurrentTime();
		const valueAtPlayheadMap = new Map<string, ParamValue | null>();

		for (const { trackId, elementId, propertyPath } of keyframes) {
			const key = `${elementId}:${propertyPath}`;
			if (valueAtPlayheadMap.has(key)) {
				continue;
			}

			const element = this.getElementByRef({ trackId, elementId });
			if (!element) {
				valueAtPlayheadMap.set(key, null);
				continue;
			}

			const localTime = getElementLocalTime({
				timelineTime: playheadTime,
				elementStartTime: element.startTime,
				elementDuration: element.duration,
			});

			const target = resolveAnimationTarget({ element, path: propertyPath });
			const baseValue = target?.getBaseValue() ?? null;
			if (baseValue === null) {
				valueAtPlayheadMap.set(key, null);
				continue;
			}

			const value = resolveAnimationPathValueAtTime({
				animations: element.animations,
				propertyPath,
				localTime,
				fallbackValue: baseValue,
			});
			valueAtPlayheadMap.set(key, value);
		}

		const commands = keyframes.map(
			({ trackId, elementId, propertyPath, keyframeId }) =>
				new RemoveKeyframeCommand({
					trackId,
					elementId,
					propertyPath,
					keyframeId,
					valueAtPlayhead:
						valueAtPlayheadMap.get(`${elementId}:${propertyPath}`) ?? null,
				}),
		);
		const command =
			commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
	}

	retimeKeyframe({
		trackId,
		elementId,
		propertyPath,
		keyframeId,
		time,
	}: {
		trackId: string;
		elementId: string;
		propertyPath: AnimationPath;
		keyframeId: string;
		time: MediaTime;
	}): void {
		const command = new RetimeKeyframeCommand({
			trackId,
			elementId,
			propertyPath,
			keyframeId,
			nextTime: time,
		});
		this.editor.command.execute({ command });
	}

	updateKeyframeCurves({
		keyframes,
	}: {
		keyframes: Array<{
			trackId: string;
			elementId: string;
			propertyPath: AnimationPath;
			componentKey: string;
			keyframeId: string;
			patch: ScalarCurveKeyframePatch;
		}>;
	}): void {
		if (keyframes.length === 0) {
			return;
		}

		const commands = keyframes.map(
			({ trackId, elementId, propertyPath, componentKey, keyframeId, patch }) =>
				new UpdateScalarKeyframeCurveCommand({
					trackId,
					elementId,
					propertyPath,
					componentKey,
					keyframeId,
					patch,
				}),
		);
		const command =
			commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
	}

	upsertEffectParamKeyframe({
		trackId,
		elementId,
		effectId,
		paramKey,
		time,
		value,
		interpolation,
		keyframeId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
		paramKey: string;
		time: MediaTime;
		value: number;
		interpolation?: "linear" | "hold";
		keyframeId?: string;
	}): void {
		const command = new UpsertEffectParamKeyframeCommand({
			trackId,
			elementId,
			effectId,
			paramKey,
			time,
			value,
			interpolation,
			keyframeId,
		});
		this.editor.command.execute({ command });
	}

	removeEffectParamKeyframe({
		trackId,
		elementId,
		effectId,
		paramKey,
		keyframeId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
		paramKey: string;
		keyframeId: string;
	}): void {
		const command = new RemoveEffectParamKeyframeCommand({
			trackId,
			elementId,
			effectId,
			paramKey,
			keyframeId,
		});
		this.editor.command.execute({ command });
	}

	isPreviewActive(): boolean {
		return this.previewOverlay.size > 0;
	}

	previewElements({
		updates,
	}: {
		updates: readonly {
			trackId: string;
			elementId: string;
			updates: Partial<TimelineElement>;
		}[];
	}): void {
		let changedOverlayCount = 0;
		for (const { elementId, updates: elementUpdates } of updates) {
			const existingOverlay = this.previewOverlay.get(elementId);
			const changed = Object.entries(elementUpdates).some(([key, value]) => {
				return !Object.is(
					existingOverlay?.[key as keyof TimelineElement],
					value,
				);
			});
			if (changed) {
				changedOverlayCount += 1;
				const mergedOverlay = {
					...existingOverlay,
					...elementUpdates,
					...(existingOverlay?.params && elementUpdates.params ? { params: { ...existingOverlay.params, ...elementUpdates.params } } : {}),
				} as Partial<TimelineElement>;
				this.previewOverlay.set(elementId, mergedOverlay);
			}
		}
		const committedTracks = this.editor.scenes.getActiveSceneOrNull()?.tracks;
		if (!committedTracks) {
			return;
		}
		if (changedOverlayCount === 0) {
			return;
		}
		this.previewTracks = this.applyPreviewOverlay(committedTracks);
		this.previewBase = committedTracks;
		this.notify();
	}

	commitPreview(): void {
		if (this.previewOverlay.size === 0) return;
		const committedTracks = this.editor.scenes.getActiveSceneOrNull()?.tracks;
		if (!committedTracks) {
			return;
		}
		// Applied to what is committed now, never the tracks cached at the last preview step: an edit committed in
		// between (a job that landed, another command) was otherwise put back by this commit, and its ⌘Z then
		// seemed to do nothing. The step changes only the previewed elements.
		const afterTracks = this.applyPreviewOverlay(committedTracks);
		// A preview that changed nothing (a value set to what it was, an option clicked again) leaves no undo step:
		// an empty step made the next ⌘Z seem to do nothing.
		const elementIn = (tracks: SceneTracks, id: string): TimelineElement | undefined => {
			for (const track of [...tracks.overlay, tracks.main, ...tracks.audio] as TimelineTrack[]) {
				const found = (track.elements as TimelineElement[]).find((element) => element.id === id);
				if (found) return found;
			}
			return undefined;
		};
		const changed = [...this.previewOverlay.keys()].some(
			(id) => JSON.stringify(elementIn(committedTracks, id)) !== JSON.stringify(elementIn(afterTracks, id)),
		);
		if (!changed) {
			this.discardPreview();
			return;
		}
		const command = new TracksSnapshotCommand({
			before: committedTracks,
			after: afterTracks,
		});
		this.previewOverlay.clear();
		this.previewTracks = null;
		// A main-track clip's length changed (a speed, a duration slider): the step runs as an edit, so the magnet
		// closes up or makes room as for a trim (pushed as a finished snapshot, a slower clip covered the next one).
		const resized = afterTracks.main.elements.some((element) => {
			const was = committedTracks.main.elements.find((e) => e.id === element.id);
			return !!was && was.duration !== element.duration;
		});
		if (resized) {
			this.editor.command.execute({ command });
			return;
		}
		this.editor.command.push({ command });
		this.updateTracks(afterTracks);
	}

	discardPreview(): void {
		if (this.previewOverlay.size === 0) return;
		this.previewOverlay.clear();
		this.previewTracks = null;
		this.notify();
	}

	private applyPreviewOverlay(tracks: SceneTracks): SceneTracks {
		if (this.previewOverlay.size === 0) return tracks;

		const applyTrackOverlay = <TTrack extends TimelineTrack>(
			track: TTrack,
		): TTrack => {
			const hasOverlay = track.elements.some((element) =>
				this.previewOverlay.has(element.id),
			);
			if (!hasOverlay) {
				return track;
			}

			// A preview that leaves an element as it is keeps the element (and a track of such elements keeps the
			// track): a drag along the magnetic main track previews the start of every clip that stays — 1 790 of them
			// on a two-hour film, nearly all unmoved — and every mounted clip drew again on each new cut.
			const keepSame = !speedOff("previewSame");
			let changed = false;
			const nextElements = track.elements.map((element) => {
				const overlay = this.previewOverlay.get(element.id);
				if (!overlay || (keepSame && overlayChangesNothing(element as TimelineElement, overlay))) return element;
				changed = true;
				// Params are merged, not replaced: the volume line previews `params: { volume }` only, and the clip's
				// fades, position, scale and effects were wiped by the drag (and by its commit).
				return { ...element, ...overlay, ...(overlay.params ? { params: { ...element.params, ...overlay.params } } : {}) } as TimelineElement;
			});
			if (keepSame && !changed) return track;

			return { ...track, elements: nextElements } as TTrack;
		};

		return {
			overlay: tracks.overlay.map((track) => applyTrackOverlay(track)),
			main: applyTrackOverlay(tracks.main),
			audio: tracks.audio.map((track) => applyTrackOverlay(track)),
		};
	}

	duplicateElements({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): { trackId: string; elementId: string }[] {
		const command = new DuplicateElementsCommand({ elements });
		this.editor.command.execute({ command });
		return command.getDuplicatedElements();
	}

	toggleElementsVisibility({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): void {
		const shouldHide = elements.some(({ trackId, elementId }) => {
			const element = this.getElementByRef({ trackId, elementId });
			return element && canElementBeHidden(element) && !element.hidden;
		});

		const nextUpdates = elements.flatMap(({ trackId, elementId }) => {
			const element = this.getElementByRef({ trackId, elementId });
			if (!element || !canElementBeHidden(element)) {
				return [];
			}

			return [
				{
					trackId,
					elementId,
					patch: { hidden: shouldHide },
				},
			];
		});

		this.updateElements({ updates: nextUpdates });
	}

	toggleElementsMuted({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): void {
		const shouldMute = elements.some(({ trackId, elementId }) => {
			const element = this.getElementByRef({ trackId, elementId });
			return element && canElementHaveAudio(element) && !isElementMuted({ element });
		});

		const nextUpdates = elements.flatMap(({ trackId, elementId }) => {
			const element = this.getElementByRef({ trackId, elementId });
			if (!element || !canElementHaveAudio(element)) {
				return [];
			}

			return [
				{
					trackId,
					elementId,
					patch: { params: { muted: shouldMute } },
				},
			];
		});

		this.updateElements({ updates: nextUpdates });
	}

	getPreviewTracks(): SceneTracks | null {
		const committed = this.editor.scenes.getActiveSceneOrNull()?.tracks ?? null;
		if (this.previewOverlay.size === 0 || !committed) return committed;
		// The preview over what is committed now: tracks changed by any path (not only updateTracks) are not shown stale.
		if (!this.previewTracks || this.previewBase !== committed) {
			this.previewTracks = this.applyPreviewOverlay(committed);
			this.previewBase = committed;
		}
		return this.previewTracks;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}

	private getElementByRef({
		trackId,
		elementId,
	}: {
		trackId: string;
		elementId: string;
	}): TimelineElement | undefined {
		const tracks = this.editor.scenes.getActiveSceneOrNull()?.tracks;
		return tracks ? findElementOnTrack({ tracks, trackId, elementId })?.element : undefined;
	}

	private findTrackIdForElement({
		elementId,
	}: {
		elementId: string;
	}): string | null {
		const activeScene = this.editor.scenes.getActiveSceneOrNull();
		if (!activeScene) {
			return null;
		}
		return findElementById({ tracks: activeScene.tracks, elementId })?.track.id ?? null;
	}

	updateTracks(newTracks: SceneTracks): void {
		this.previewOverlay.clear();
		this.previewTracks = null;
		// Every committed edit: transitions whose clips are gone don't stay behind (undo brings both back together).
		this.editor.scenes.updateSceneTracks({ tracks: dropOrphanTransitions(newTracks) });
		this.notify();
	}

	/**
	 * The words of titles being typed in the preview ("" when none): the one part of a preview that goes into every
	 * save (ProjectManager.scenesForSave). The save manager saves when they change, not on every preview step (perf, 13.11).
	 */
	getTypedPreviewKey(): string {
		if (this.previewOverlay.size === 0) return "";
		const tracks = this.editor.scenes.getActiveSceneOrNull()?.tracks;
		let key = "";
		for (const [elementId, overlay] of this.previewOverlay) {
			const content = (overlay as { params?: { content?: unknown } }).params?.content;
			if (typeof content !== "string") continue;
			// a slider that previews a title's whole params carries its words unchanged: nothing typed
			const committed = tracks ? findElementById({ tracks, elementId })?.element : undefined;
			if ((committed as { params?: { content?: unknown } } | undefined)?.params?.content === content) continue;
			key += `${elementId}\u0000${content}\u0001`;
		}
		return key;
	}
}
