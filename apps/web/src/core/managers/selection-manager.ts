import type { EditorCore } from "@/core";
import type { SelectedKeyframeRef } from "@/animation/types";
import type {
	EditorSelectionKind,
	EditorSelectionPatch,
	EditorSelectionSnapshot,
	SelectedMaskPointSelection,
} from "@/selection/editor-selection";
import type { ElementRef, SceneTracks } from "@/timeline/types";

/**
 * Shared "no keyframes selected" value. Every timeline element subscribes to the
 * keyframe selection; a fresh [] on each element-selection change re-rendered
 * all of them (260 elements -> ~2,600 component renders per click/split/undo).
 */
const NO_KEYFRAMES: SelectedKeyframeRef[] = [];

export class SelectionManager {
	private selectedElements: ElementRef[] = [];
	/** The clip a ⇧-click extends from (timeline/selection-click.ts); null: the last selected clip. */
	private elementAnchor: ElementRef | null = null;
	private selectedKeyframes: SelectedKeyframeRef[] = NO_KEYFRAMES;
	private keyframeSelectionAnchor: SelectedKeyframeRef | null = null;
	private selectedMaskPoints: SelectedMaskPointSelection | null = null;
	private listeners = new Set<() => void>();

	constructor(editor: EditorCore) {
		void editor;
	}

	getSelectedElements(): ElementRef[] {
		return this.selectedElements;
	}

	getSelectionAnchor(): ElementRef | null {
		return this.elementAnchor;
	}

	getSelectedKeyframes(): SelectedKeyframeRef[] {
		return this.selectedKeyframes;
	}

	getKeyframeSelectionAnchor(): SelectedKeyframeRef | null {
		return this.keyframeSelectionAnchor;
	}

	getSelectedMaskPointSelection(): SelectedMaskPointSelection | null {
		return this.selectedMaskPoints;
	}

	getActiveSelectionKind(): EditorSelectionKind | null {
		if ((this.selectedMaskPoints?.pointIds.length ?? 0) > 0) {
			return "mask-points";
		}
		if (this.selectedKeyframes.length > 0) {
			return "keyframes";
		}
		if (this.selectedElements.length > 0) {
			return "elements";
		}
		return null;
	}

	getSnapshot(): EditorSelectionSnapshot {
		return {
			selectedElements: [...this.selectedElements],
			selectedKeyframes: [...this.selectedKeyframes],
			keyframeSelectionAnchor: this.keyframeSelectionAnchor,
			selectedMaskPoints: this.selectedMaskPoints
				? {
						...this.selectedMaskPoints,
						pointIds: [...this.selectedMaskPoints.pointIds],
					}
				: null,
		};
	}

	setSelectedElements({ elements, anchor = null }: { elements: ElementRef[]; anchor?: ElementRef | null }): void {
		this.selectedElements = elements;
		this.elementAnchor = anchor;
		this.selectedKeyframes = NO_KEYFRAMES;
		this.keyframeSelectionAnchor = null;
		this.selectedMaskPoints = null;
		this.notify();
	}

	setSelectedKeyframes({
		keyframes,
		anchorKeyframe,
	}: {
		keyframes: SelectedKeyframeRef[];
		anchorKeyframe?: SelectedKeyframeRef | null;
	}): void {
		this.selectedKeyframes = keyframes.length ? keyframes : NO_KEYFRAMES;
		if (anchorKeyframe !== undefined) {
			this.keyframeSelectionAnchor = anchorKeyframe;
		} else if (keyframes.length === 0) {
			this.keyframeSelectionAnchor = null;
		}
		this.selectedMaskPoints = null;
		this.notify();
	}

	setSelectedMaskPoints({
		selection,
	}: {
		selection: SelectedMaskPointSelection | null;
	}): void {
		this.selectedMaskPoints =
			selection && selection.pointIds.length > 0
				? {
						...selection,
						pointIds: [...selection.pointIds],
					}
				: null;
		this.selectedKeyframes = NO_KEYFRAMES;
		this.keyframeSelectionAnchor = null;
		this.notify();
	}

	clearSelection(): void {
		this.selectedElements = [];
		this.elementAnchor = null;
		this.selectedKeyframes = NO_KEYFRAMES;
		this.keyframeSelectionAnchor = null;
		this.selectedMaskPoints = null;
		this.notify();
	}

	/**
	 * The selection on these tracks: a ref to a clip that is gone drops (a step undone or redone, another timeline
	 * shown), one to a clip now on another track follows it. The selection, and the inspector with it, never points at
	 * nothing. Nothing changes (and nobody is told) when every ref is where it says.
	 */
	keepPresent({ tracks }: { tracks: SceneTracks }): void {
		const trackOf = new Map<string, string>();
		for (const track of [...tracks.overlay, tracks.main, ...tracks.audio]) for (const element of track.elements) trackOf.set(element.id, track.id);
		let changed = false;
		const follow = <T extends { trackId: string; elementId: string }>(ref: T): T | null => {
			const trackId = trackOf.get(ref.elementId);
			if (trackId === ref.trackId) return ref;
			changed = true;
			return trackId ? { ...ref, trackId } : null;
		};
		const elements = this.selectedElements.map(follow).filter((ref): ref is ElementRef => !!ref);
		const keyframes = this.selectedKeyframes.map(follow).filter((ref): ref is SelectedKeyframeRef => !!ref);
		const anchor = this.keyframeSelectionAnchor && follow(this.keyframeSelectionAnchor);
		const maskPoints = this.selectedMaskPoints && follow(this.selectedMaskPoints);
		if (!changed) return;
		this.selectedElements = elements;
		this.selectedKeyframes = keyframes.length ? keyframes : NO_KEYFRAMES;
		this.keyframeSelectionAnchor = anchor;
		this.selectedMaskPoints = maskPoints;
		this.notify();
	}

	clearKeyframeSelection(): void {
		this.selectedKeyframes = NO_KEYFRAMES;
		this.keyframeSelectionAnchor = null;
		this.notify();
	}

	clearMaskPointSelection(): void {
		if (!this.selectedMaskPoints) {
			return;
		}
		this.selectedMaskPoints = null;
		this.notify();
	}

	clearMostSpecificSelection(): boolean {
		const activeSelectionKind = this.getActiveSelectionKind();
		if (activeSelectionKind === "mask-points") {
			this.clearMaskPointSelection();
			return true;
		}
		if (activeSelectionKind === "keyframes") {
			this.clearKeyframeSelection();
			return true;
		}
		if (activeSelectionKind === "elements") {
			this.setSelectedElements({ elements: [] });
			return true;
		}
		return false;
	}

	applySelectionPatch({
		patch,
	}: {
		patch: EditorSelectionPatch;
	}): EditorSelectionSnapshot {
		if (patch.selectedElements !== undefined) {
			this.selectedElements = [...patch.selectedElements];
			this.elementAnchor = null;
		}
		if (patch.selectedKeyframes !== undefined) {
			this.selectedKeyframes = patch.selectedKeyframes.length
				? [...patch.selectedKeyframes]
				: NO_KEYFRAMES;
		}
		if (patch.keyframeSelectionAnchor !== undefined) {
			this.keyframeSelectionAnchor = patch.keyframeSelectionAnchor;
		}
		if (patch.selectedMaskPoints !== undefined) {
			this.selectedMaskPoints = patch.selectedMaskPoints
				? {
						...patch.selectedMaskPoints,
						pointIds: [...patch.selectedMaskPoints.pointIds],
					}
				: null;
		}
		this.notify();
		return this.getSnapshot();
	}

	restoreSnapshot({ snapshot }: { snapshot: EditorSelectionSnapshot }): void {
		this.selectedElements = [...snapshot.selectedElements];
		this.elementAnchor = null;
		this.selectedKeyframes = snapshot.selectedKeyframes.length
			? [...snapshot.selectedKeyframes]
			: NO_KEYFRAMES;
		this.keyframeSelectionAnchor = snapshot.keyframeSelectionAnchor;
		this.selectedMaskPoints = snapshot.selectedMaskPoints
			? {
					...snapshot.selectedMaskPoints,
					pointIds: [...snapshot.selectedMaskPoints.pointIds],
				}
			: null;
		this.notify();
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
}
