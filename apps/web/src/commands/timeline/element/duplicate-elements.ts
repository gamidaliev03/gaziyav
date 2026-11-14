import {
	Command,
	createElementSelectionResult,
	type CommandResult,
} from "@/commands/base-command";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline";
import { generateUUID } from "@/utils/id";
import { EditorCore } from "@/core";
import { applyPlacement, resolveTrackPlacement } from "@/timeline/placement";
import { cloneAnimations } from "@/animation";
import type { MediaTime } from "@/wasm";

interface DuplicateElementsParams {
	elements: { trackId: string; elementId: string }[];
}

export class DuplicateElementsCommand extends Command {
	private duplicatedElements: { trackId: string; elementId: string }[] = [];
	private savedState: SceneTracks | null = null;
	private elements: DuplicateElementsParams["elements"];

	constructor({ elements }: DuplicateElementsParams) {
		super();
		this.elements = elements;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;
		this.duplicatedElements = [];

		let updatedTracks = this.savedState;

		for (const track of [
			...this.savedState.overlay,
			this.savedState.main,
			...this.savedState.audio,
		]) {
			const elementsToDuplicate = this.elements.filter(
				(elementEntry) => elementEntry.trackId === track.id,
			);

			if (elementsToDuplicate.length === 0) {
				continue;
			}

			const elementIdsToDuplicate = new Set(
				elementsToDuplicate.map((element) => element.elementId),
			);
			const picked = (track.elements as TimelineElement[]).filter((element) => elementIdsToDuplicate.has(element.id));
			if (picked.length === 0) continue;

			// CapCut: the copy of a main-track clip follows it on the main track (the clips after it move on); a layer's
			// copy follows it on its own track when that spot is free, else it goes to a new track above.
			if (track.id === this.savedState.main.id) {
				updatedTracks = { ...updatedTracks, main: duplicateOnMain({ track: updatedTracks.main, picked, ids: elementIdsToDuplicate, out: this.duplicatedElements }) };
				continue;
			}
			const onOwnTrack = duplicateAfterOnTrack({ track: findTrack(updatedTracks, track.id) ?? track, picked, out: this.duplicatedElements });
			if (onOwnTrack) {
				updatedTracks = replaceTrack(updatedTracks, onOwnTrack);
				continue;
			}

			const newTrackElements: TimelineElement[] = picked.map((element) =>
				buildDuplicateElement({ element, id: generateUUID(), startTime: element.startTime }),
			);

			const placementResult = resolveTrackPlacement({
				tracks: updatedTracks,
				trackType: track.type,
				timeSpans: [],
				strategy: { type: "alwaysNew", position: "highest" },
			});
			if (!placementResult || placementResult.kind !== "newTrack") {
				continue;
			}

			const applied = applyPlacement({
				tracks: updatedTracks,
				placementResult,
				elements: newTrackElements,
			});
			if (!applied) {
				continue;
			}

			updatedTracks = applied.updatedTracks;

			for (const element of newTrackElements) {
				this.duplicatedElements.push({
					trackId: applied.targetTrackId,
					elementId: element.id,
				});
			}
		}

		editor.timeline.updateTracks(updatedTracks);

		if (this.duplicatedElements.length > 0) {
			return createElementSelectionResult(this.duplicatedElements);
		}
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}

	getDuplicatedElements(): { trackId: string; elementId: string }[] {
		return this.duplicatedElements;
	}
}

function buildDuplicateElement({
	element,
	id,
	startTime,
}: {
	element: TimelineElement;
	id: string;
	startTime: MediaTime;
}): TimelineElement {
	return {
		...element,
		id,
		name: `${element.name} (copy)`,
		startTime,
		animations: cloneAnimations({
			animations: element.animations,
			shouldRegenerateKeyframeIds: true,
		}),
	};
}

type Ref = { trackId: string; elementId: string };

function findTrack(tracks: SceneTracks, trackId: string): TimelineTrack | undefined {
	return [...tracks.overlay, tracks.main, ...tracks.audio].find((track) => track.id === trackId);
}

function replaceTrack(tracks: SceneTracks, track: TimelineTrack): SceneTracks {
	return {
		overlay: tracks.overlay.map((t) => (t.id === track.id ? (track as SceneTracks["overlay"][number]) : t)),
		main: tracks.main.id === track.id ? (track as SceneTracks["main"]) : tracks.main,
		audio: tracks.audio.map((t) => (t.id === track.id ? (track as SceneTracks["audio"][number]) : t)),
	};
}

/** Each picked main-track clip gets its copy right after it; everything after moves on by the copy's length. */
function duplicateOnMain({ track, picked, ids, out }: { track: SceneTracks["main"]; picked: TimelineElement[]; ids: Set<string>; out: Ref[] }): SceneTracks["main"] {
	const sorted = [...(track.elements as TimelineElement[])].sort((a, b) => a.startTime - b.startTime);
	const elements: TimelineElement[] = [];
	let shift = 0 as MediaTime;
	for (const element of sorted) {
		const moved = { ...element, startTime: (element.startTime + shift) as MediaTime };
		elements.push(moved);
		if (!ids.has(element.id)) continue;
		const copy = buildDuplicateElement({ element, id: generateUUID(), startTime: (moved.startTime + element.duration) as MediaTime });
		elements.push(copy);
		out.push({ trackId: track.id, elementId: copy.id });
		shift = (shift + element.duration) as MediaTime;
	}
	void picked;
	return { ...track, elements: elements as SceneTracks["main"]["elements"] };
}

/** The copies right after their originals on the same track, or null when any of those spots is taken. */
function duplicateAfterOnTrack({ track, picked, out }: { track: TimelineTrack; picked: TimelineElement[]; out: Ref[] }): TimelineTrack | null {
	const others = track.elements as TimelineElement[];
	const copies: TimelineElement[] = [];
	for (const element of picked) {
		const start = (element.startTime + element.duration) as MediaTime;
		const end = start + element.duration;
		const taken = [...others, ...copies].some((other) => other.startTime < end && other.startTime + other.duration > start);
		if (taken) return null;
		copies.push(buildDuplicateElement({ element, id: generateUUID(), startTime: start }));
	}
	for (const copy of copies) out.push({ trackId: track.id, elementId: copy.id });
	return { ...track, elements: [...others, ...copies].sort((a, b) => a.startTime - b.startTime) } as TimelineTrack;
}
