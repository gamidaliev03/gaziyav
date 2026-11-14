import {
	Command,
	createElementSelectionResult,
	type CommandResult,
} from "@/commands/base-command";
import type { SceneTracks, TimelineElement } from "@/timeline";
import { generateUUID } from "@/utils/id";
import { EditorCore } from "@/core";
import { isRetimableElement } from "@/timeline";
import { splitAnimationsAtTime } from "@/animation";
import { splitBeats } from "@/timeline/beats";
import { getSourceSpanAtClipTime, splitRetimeAtClipTime } from "@/retime";
import {
	addMediaTime,
	type MediaTime,
	roundMediaTime,
	subMediaTime,
} from "@/wasm";
import { lockstepSounds } from "@/timeline/linkage";

type Ref = { trackId: string; elementId: string };

/**
 * The params of a split half without the fade or In / Out animation of the side the cut made: the clip's fade in stays
 * on its first half, its fade out on its second (CapCut). Both halves kept both, so a clip with a fade-out dipped to
 * silence at the cut and came back with a fade-in (claude-hear, 09.11). Nothing when the clip has none on that side.
 */
function withoutEdge(element: TimelineElement, side: "in" | "out"): { params?: TimelineElement["params"] } {
	const params = (element.params ?? null) as Record<string, unknown> | null;
	if (!params) return {};
	const fadeKey = side === "in" ? "fadeIn" : "fadeOut";
	const animKey = side === "in" ? "anim.in" : "anim.out";
	const fade = typeof params[fadeKey] === "number" && (params[fadeKey] as number) > 0;
	const anim = typeof params[animKey] === "string" && params[animKey] !== "none";
	if (!fade && !anim) return {};
	return { params: { ...params, ...(fade ? { [fadeKey]: 0 } : {}), ...(anim ? { [animKey]: "none" } : {}) } as TimelineElement["params"] };
}

/** `refs` and the lockstep sounds of the clips among them that are not in already. */
function withLockstepSounds(tracks: SceneTracks, refs: readonly Ref[]): Ref[] {
	const out = [...refs];
	const have = new Set(refs.map((ref) => ref.elementId));
	for (const track of [tracks.main, ...tracks.overlay]) {
		for (const clip of track.elements) {
			if (!refs.some((ref) => ref.trackId === track.id && ref.elementId === clip.id)) continue;
			for (const sound of lockstepSounds(tracks, clip)) {
				// a locked track's clips are never cut
				if (have.has(sound.element.id) || tracks.audio.find((t) => t.id === sound.trackId)?.locked === true) continue;
				have.add(sound.element.id);
				out.push({ trackId: sound.trackId, elementId: sound.element.id });
			}
		}
	}
	return out;
}

export class SplitElementsCommand extends Command {
	private savedState: SceneTracks | null = null;
	private rightSideElements: { trackId: string; elementId: string }[] = [];
	private readonly elements: { trackId: string; elementId: string }[];
	private readonly splitTime: MediaTime;
	private readonly retainSide: "both" | "left" | "right";

	constructor({
		elements,
		splitTime,
		retainSide = "both",
	}: {
		elements: { trackId: string; elementId: string }[];
		splitTime: MediaTime;
		retainSide?: "both" | "left" | "right";
	}) {
		super();
		this.elements = elements;
		this.splitTime = splitTime;
		this.retainSide = retainSide;
	}

	getRightSideElements(): { trackId: string; elementId: string }[] {
		return this.rightSideElements;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;
		this.rightSideElements = [];
		// A detached sound in lockstep with a clip cut in two is cut with it (linkage.ts isLockstepPair), so each half of
		// the picture keeps its own sound: a half moved or deleted took or left the whole sound. Q / W (one side kept) need
		// no cut: the sound takes the clip's new bounds through the linkage.
		const targets = this.retainSide === "both" ? withLockstepSounds(this.savedState, this.elements) : this.elements;

		const splitTrack = <
			TTrack extends { id: string; elements: TimelineElement[] },
		>(
			track: TTrack,
		): TTrack => {
			const elementsToSplit = targets.filter(
				(target) => target.trackId === track.id,
			);

			if (elementsToSplit.length === 0) {
				return track;
			}

			// A transition on the split clip's end cut belongs to the right half now (its id is new): remapped below.
			const rightIds = new Map<string, string>();
			const elements = track.elements.flatMap((element) => {
				const shouldSplit = elementsToSplit.some(
					(target) => target.elementId === element.id,
				);

				if (!shouldSplit) {
					return [element];
				}

				const effectiveStart = element.startTime;
				const effectiveEnd = element.startTime + element.duration;

				if (
					this.splitTime <= effectiveStart ||
					this.splitTime >= effectiveEnd
				) {
					return [element];
				}

				const relativeTime = subMediaTime({
					a: this.splitTime,
					b: element.startTime,
				});
				const leftVisibleDuration = relativeTime;
				const rightVisibleDuration = subMediaTime({
					a: element.duration,
					b: relativeTime,
				});
				const retimeRef = isRetimableElement(element)
					? element.retime
					: undefined;
				// Snap the source-side split point exactly once and derive the right
				// half from it. Independently rounding both spans (left and total)
				// would let a 1-tick rounding error desynchronise them, breaking the
				// invariant `leftSourceSpan + rightSourceSpan == totalSourceSpan`.
				// See the same discipline in `compute-resize.ts` (snap-once comment).
				const leftSourceSpan = roundMediaTime({
					time: getSourceSpanAtClipTime({
						clipTime: leftVisibleDuration,
						retime: retimeRef,
						duration: element.duration,
					}),
				});
				const totalSourceSpan = roundMediaTime({
					time: getSourceSpanAtClipTime({
						clipTime: element.duration,
						retime: retimeRef,
						duration: element.duration,
					}),
				});
				// A speed ramp is cut in two: each half keeps its part of the curve.
				const splitRetime = splitRetimeAtClipTime({
					retime: retimeRef,
					splitClipTime: relativeTime,
					duration: element.duration,
				});
				const rightSourceSpan = subMediaTime({
					a: totalSourceSpan,
					b: leftSourceSpan,
				});
				const { leftAnimations, rightAnimations } = splitAnimationsAtTime({
					animations: element.animations,
					splitTime: relativeTime,
					shouldIncludeSplitBoundary: true,
				});
				let splitResult: TimelineElement[];

				const leftTrimEnd = addMediaTime({
					a: element.trimEnd,
					b: rightSourceSpan,
				});
				const rightTrimStart = addMediaTime({
					a: element.trimStart,
					b: leftSourceSpan,
				});
				const splitBeatMarks = splitBeats({
					beats: element.beats,
					at: relativeTime,
					duration: element.duration,
				});

				if (this.retainSide === "left") {
					splitResult = [
						{
							...element,
							duration: leftVisibleDuration,
							trimEnd: leftTrimEnd,
							animations: leftAnimations,
							beats: splitBeatMarks.left,
							...(retimeRef !== undefined ? { retime: splitRetime.left } : {}),
						},
					];
				} else if (this.retainSide === "right") {
					// Keeping the right side is a head trim: the clip stays itself (its id). Under a new id the edit read as the
					// clip deleted, and Linkage took its titles, pictures and sound along (Q — blind test 05.11).
					rightIds.set(element.id, element.id);
					this.rightSideElements.push({
						trackId: track.id,
						elementId: element.id,
					});
					splitResult = [
						{
							...element,
							startTime: this.splitTime,
							duration: rightVisibleDuration,
							trimStart: rightTrimStart,
							animations: rightAnimations,
							beats: splitBeatMarks.right,
							...(retimeRef !== undefined ? { retime: splitRetime.right } : {}),
						},
					];
				} else {
					const secondElementId = generateUUID();
					rightIds.set(element.id, secondElementId);
					this.rightSideElements.push({
						trackId: track.id,
						elementId: secondElementId,
					});
					splitResult = [
						{
							...element,
							duration: leftVisibleDuration,
							trimEnd: leftTrimEnd,
							animations: leftAnimations,
							beats: splitBeatMarks.left,
							...(retimeRef !== undefined ? { retime: splitRetime.left } : {}),
							...withoutEdge(element, "out"),
						},
						{
							...element,
							id: secondElementId,
							startTime: this.splitTime,
							duration: rightVisibleDuration,
							trimStart: rightTrimStart,
							animations: rightAnimations,
							beats: splitBeatMarks.right,
							...(retimeRef !== undefined ? { retime: splitRetime.right } : {}),
							...withoutEdge(element, "in"),
						},
					];
				}

				return splitResult;
			});

			// The cut at the split clip's end is the right half's cut: a transition there moves with it (fuzz 03.11: it stayed
			// on the left half, away from any cut). A transition on the clip's start cut keeps its id — the left half.
			const list = (track as { transitions?: Array<{ fromElementId: string; toElementId: string }> }).transitions;
			const transitions = list?.some((t) => rightIds.has(t.fromElementId))
				? list.map((t) => (rightIds.has(t.fromElementId) ? { ...t, fromElementId: rightIds.get(t.fromElementId) as string } : t))
				: list;
			return { ...track, elements, ...(transitions !== list ? { transitions } : {}) } as TTrack;
		};

		const updatedTracks: SceneTracks = {
			overlay: this.savedState.overlay.map((track) => splitTrack(track)),
			main: splitTrack(this.savedState.main),
			audio: this.savedState.audio.map((track) => splitTrack(track)),
		};

		editor.timeline.updateTracks(updatedTracks);

		if (this.rightSideElements.length > 0) {
			return createElementSelectionResult(this.rightSideElements);
		}
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}
}
