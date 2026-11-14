import {
	Command,
	createElementSelectionResult,
	type CommandResult,
} from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { SceneTracks, TimelineElement } from "@/timeline";
import type { ElementClipboardItem } from "@/clipboard";
import { generateUUID } from "@/utils/id";
import {
	applyPlacement,
	resolveTrackPlacement,
	enforceMainTrackStart,
} from "@/timeline/placement";
import { cloneAnimations } from "@/animation";
import { canElementGoOnTrack } from "@/timeline/placement/compatibility";
import { mainTrackCutAt } from "@/timeline/placement/main-track";
import { SplitElementsCommand } from "@/commands/timeline/element/split-elements";
import { lockstepSounds } from "@/timeline/linkage";
import {
	addMediaTime,
	type MediaTime,
	maxMediaTime,
	mediaTime,
	subMediaTime,
	ZERO_MEDIA_TIME,
} from "@/wasm";

/**
 * How a paste meets the clips already on its track: "insert" splits the clip under the paste point and moves
 * everything after it right by the pasted length; "over" replaces whatever the pasted clips cover (cut out).
 */
export type PasteMode = "insert" | "over";

export class PasteCommand extends Command {
	private savedState: SceneTracks | null = null;
	private pastedElements: { trackId: string; elementId: string }[] = [];
	private readonly time: MediaTime;
	private readonly clipboardItems: ElementClipboardItem[];
	private readonly targetTrackId: string | null;
	private readonly mode: PasteMode | null;

	constructor({
		time,
		clipboardItems,
		targetTrackId,
		mode,
	}: {
		time: MediaTime;
		clipboardItems: ElementClipboardItem[];
		/** With `mode`: the clips that fit this track go on it at `time`; the rest are placed as before. */
		targetTrackId?: string;
		mode?: PasteMode;
	}) {
		super();
		this.time = time;
		this.clipboardItems = clipboardItems;
		this.targetTrackId = targetTrackId ?? null;
		this.mode = mode ?? null;
	}

	execute(): CommandResult | undefined {
		if (this.clipboardItems.length === 0) return undefined;

		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;
		this.pastedElements = [];

		const remaining = this.mode && this.targetTrackId ? this.pasteOnTargetTrack() : this.clipboardItems;
		if (remaining.length === 0) {
			return this.pastedElements.length > 0 ? createElementSelectionResult(this.pastedElements) : undefined;
		}

		const minStart = this.clipboardItems.reduce(
			(earliestStartTime, item) =>
				item.element.startTime < earliestStartTime
					? item.element.startTime
					: earliestStartTime,
			this.clipboardItems[0].element.startTime,
		);

		let updatedTracks = editor.scenes.getActiveScene().tracks;
		const itemsByTrackId = groupClipboardItemsByTrackId({
			clipboardItems: remaining,
		});

		// The main track with its magnet (CapCut): its clips go in at the cut nearest the paste time, back to back, and
		// the clips after that cut make room — never over a clip, never a gap. What was copied with them (a title over a
		// clip, its sound) moves as far, so it stays with its clip.
		const magnet = editor.command.isRippleEnabled;
		const mainId = updatedTracks.main.id;
		const mainItems = magnet ? itemsByTrackId.get(mainId) : undefined;
		const mainBuilt = mainItems ? buildPastedElements({ items: mainItems, minStart, time: this.time }) : [];
		const cut = mainBuilt.length ? mainTrackCutAt({ elements: updatedTracks.main.elements, time: this.time }) : null;
		const shift = cut === null ? 0 : cut - Math.min(...mainBuilt.map((element) => element.startTime));

		for (const [trackId, items] of itemsByTrackId) {
			const built =
				trackId === mainId && mainBuilt.length
					? mainBuilt
					: buildPastedElements({
							items,
							minStart,
							time: this.time,
						});
			const elementsToAdd = shift
				? built.map((element) => ({ ...element, startTime: mediaTime({ ticks: Math.max(0, element.startTime + shift) }) }))
				: built;

			if (elementsToAdd.length === 0) {
				continue;
			}

			if (cut !== null && trackId === mainId) {
				let end: number = cut;
				const placed = [...elementsToAdd]
					.sort((a, b) => a.startTime - b.startTime)
					.map((element) => {
						const at = end;
						end += element.duration;
						return { ...element, startTime: mediaTime({ ticks: at }) };
					});
				const room = end - cut;
				const main = updatedTracks.main;
				const moved = main.elements.map((element) =>
					element.startTime >= cut ? { ...element, startTime: mediaTime({ ticks: element.startTime + room }) } : element,
				);
				updatedTracks = { ...updatedTracks, main: { ...main, elements: [...moved, ...placed] } as typeof main };
				for (const element of placed) this.pastedElements.push({ trackId: main.id, elementId: element.id });
				continue;
			}

			const trackType = items[0].trackType;
			const sourceTrackIndex = [
				...updatedTracks.overlay,
				updatedTracks.main,
				...updatedTracks.audio,
			].findIndex((track) => track.id === trackId);
			const placementResult = resolveTrackPlacement({
				tracks: updatedTracks,
				trackType,
				timeSpans: elementsToAdd.map((element) => ({
					startTime: element.startTime,
					duration: element.duration,
				})),
				strategy: { type: "aboveSource", sourceTrackIndex },
			});
			if (!placementResult) {
				continue;
			}

			let elementsForPlacement = elementsToAdd;
			if (placementResult.kind === "existingTrack") {
				const targetTrack =
					placementResult.trackIndex < updatedTracks.overlay.length
						? updatedTracks.overlay[placementResult.trackIndex]
						: placementResult.trackIndex === updatedTracks.overlay.length
							? updatedTracks.main
							: updatedTracks.audio[
									placementResult.trackIndex - updatedTracks.overlay.length - 1
								];
				if (targetTrack?.id === updatedTracks.main.id) {
					const earliestElement = elementsToAdd.reduce((earliest, element) =>
						element.startTime < earliest.startTime ? element : earliest,
					);
					const adjustedEarliestStartTime = enforceMainTrackStart({
						tracks: updatedTracks,
						targetTrackId: targetTrack.id,
						requestedStartTime: earliestElement.startTime,
					});
					const delta = subMediaTime({
						a: adjustedEarliestStartTime,
						b: earliestElement.startTime,
					});

					if (delta !== ZERO_MEDIA_TIME) {
						elementsForPlacement = elementsToAdd.map((element) => ({
							...element,
							startTime: maxMediaTime({
								a: ZERO_MEDIA_TIME,
								b: addMediaTime({ a: element.startTime, b: delta }),
							}),
						}));
					}
				}
			}

			const applied = applyPlacement({
				tracks: updatedTracks,
				placementResult,
				elements: elementsForPlacement,
			});
			if (!applied) {
				continue;
			}

			updatedTracks = applied.updatedTracks;

			for (const element of elementsForPlacement) {
				this.pastedElements.push({
					trackId: applied.targetTrackId,
					elementId: element.id,
				});
			}
		}

		editor.timeline.updateTracks(updatedTracks);

		if (this.pastedElements.length > 0) {
			return createElementSelectionResult(this.pastedElements);
		}
		return undefined;
	}

	/**
	 * The clips that fit the target track go on it at the paste time, as an insert or over the clips there; returns
	 * the ones that don't fit (placed the usual way).
	 */
	private pasteOnTargetTrack(): ElementClipboardItem[] {
		const editor = EditorCore.getInstance();
		const tracksNow = () => editor.scenes.getActiveScene().tracks;
		const findTrack = (tracks: SceneTracks) =>
			[tracks.main, ...tracks.overlay, ...tracks.audio].find((track) => track.id === this.targetTrackId);
		const target = findTrack(tracksNow());
		if (!target) return this.clipboardItems;
		// Clips copied from several tracks keep their own tracks: only the ones from the target track go on it, the rest
		// are placed as before, all at the same offsets from the paste time (copied from the main track and a layer, all
		// landed on the main track, one after another — targeted test 05.11).
		const fromSeveral = new Set(this.clipboardItems.map((item) => item.trackId)).size > 1;
		const fits = this.clipboardItems.filter(
			(item) =>
				canElementGoOnTrack({ elementType: item.element.type, trackType: target.type }) && (!fromSeveral || item.trackId === target.id),
		);
		if (fits.length === 0) return this.clipboardItems;

		const minStart = this.clipboardItems.reduce(
			(min, item) => (item.element.startTime < min ? item.element.startTime : min),
			this.clipboardItems[0].element.startTime,
		);
		const pasted = buildPastedElements({ items: fits, minStart, time: this.time });
		const from = this.time;
		const to = mediaTime({ ticks: pasted.reduce((end, element) => Math.max(end, element.startTime + element.duration), from as number) });
		const length = to - from;
		// Off the main track a paste never moves what is placed (CapCut): on the track when it is free there, else on a free
		// track (the usual placement). Pushed right, a title left its own voice-over behind (blind test 05.11).
		const lane = this.mode === "insert" && target.id !== tracksNow().main.id;
		if (lane && target.elements.some((element) => element.startTime < to && element.startTime + element.duration > from)) return this.clipboardItems;

		// Cut the clips at the edges of what goes in (the split command keeps speed ramps and keys right).
		const splitAt = (time: MediaTime) => {
			const spanning = findTrack(tracksNow())?.elements.filter(
				(element) => element.startTime < time && element.startTime + element.duration > time,
			);
			if (spanning && spanning.length > 0) {
				new SplitElementsCommand({
					elements: spanning.map((element) => ({ trackId: target.id, elementId: element.id })),
					splitTime: time,
				}).execute();
			}
		};
		if (this.mode === "over") splitAt(to);
		if (!lane) splitAt(from);

		const tracks = tracksNow();
		// A detached sound goes as its clip does (linkage.ts isLockstepPair): right with the clips pushed right, out with
		// the clips pasted over. The split above cut it too, and its new half was never seen by the linkage: it stayed at
		// the paste point while its picture moved on (pro-core, 09.11).
		const targetNow = findTrack(tracks);
		const pushedRight = this.mode === "insert" && !lane ? (targetNow?.elements.filter((element) => element.startTime >= from) ?? []) : [];
		const pastedOver =
			this.mode === "over" ? (targetNow?.elements.filter((element) => element.startTime >= from && element.startTime + element.duration <= to) ?? []) : [];
		const soundsOf = (clips: TimelineElement[]) => new Set(clips.flatMap((clip) => lockstepSounds(tracks, clip).map((sound) => sound.element.id)));
		const soundsPushed = soundsOf(pushedRight);
		const soundsGone = soundsOf(pastedOver);
		const update = <T extends { id: string; elements: TimelineElement[] }>(track: T): T => {
			if (track.id !== target.id) {
				if (!track.elements.some((element) => soundsPushed.has(element.id) || soundsGone.has(element.id))) return track;
				const elements = track.elements
					.filter((element) => !soundsGone.has(element.id))
					.map((element) =>
						soundsPushed.has(element.id) ? ({ ...element, startTime: mediaTime({ ticks: element.startTime + length }) } as typeof element) : element,
					);
				return { ...track, elements } as T;
			}
			const kept =
				this.mode === "over"
					? track.elements.filter((element) => !(element.startTime >= from && element.startTime + element.duration <= to))
					: lane
						? track.elements
						: track.elements.map((element) =>
							element.startTime >= from ? ({ ...element, startTime: mediaTime({ ticks: element.startTime + length }) } as typeof element) : element,
						);
			const elements = [...kept, ...pasted].sort((a, b) => a.startTime - b.startTime);
			return { ...track, elements } as T;
		};
		editor.timeline.updateTracks({
			...tracks,
			main: update(tracks.main),
			overlay: tracks.overlay.map(update),
			audio: tracks.audio.map(update),
		} as SceneTracks);
		for (const element of pasted) this.pastedElements.push({ trackId: target.id, elementId: element.id });
		return this.clipboardItems.filter((item) => !fits.includes(item));
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}

	getPastedElements(): { trackId: string; elementId: string }[] {
		return this.pastedElements;
	}
}

function groupClipboardItemsByTrackId({
	clipboardItems,
}: {
	clipboardItems: ElementClipboardItem[];
}): Map<string, ElementClipboardItem[]> {
	const groupedItems = new Map<string, ElementClipboardItem[]>();

	for (const item of clipboardItems) {
		const existingItems = groupedItems.get(item.trackId) ?? [];
		groupedItems.set(item.trackId, [...existingItems, item]);
	}

	return groupedItems;
}

function buildPastedElements({
	items,
	minStart,
	time,
}: {
	items: ElementClipboardItem[];
	minStart: MediaTime;
	time: MediaTime;
}): TimelineElement[] {
	const elementsToAdd: TimelineElement[] = [];

	for (const item of items) {
		const relativeOffset = subMediaTime({
			a: item.element.startTime,
			b: minStart,
		});
		const startTime = maxMediaTime({
			a: ZERO_MEDIA_TIME,
			b: addMediaTime({ a: time, b: relativeOffset }),
		});
		const newElementId = generateUUID();

		elementsToAdd.push({
			...item.element,
			id: newElementId,
			startTime,
			animations: cloneAnimations({
				animations: item.element.animations,
				shouldRegenerateKeyframeIds: true,
			}),
		} as TimelineElement);
	}

	return elementsToAdd;
}
