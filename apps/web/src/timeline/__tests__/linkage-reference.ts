// The linkage as it was before 11.11 (speed): kept word for word as the reference the indexed one is held to
// (linkage-equivalence.test.ts). Not used by the app.
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline/types";
import type { LinkageKind } from "@/timeline/timeline-store";

/** Which Linkage setting an item on a non-main track answers to. */
export function linkageKindOf(element: TimelineElement): LinkageKind | null {
	switch (element.type) {
		case "text":
			return "text";
		case "sticker":
		case "graphic":
			return "sticker";
		case "effect":
			return "effect";
		case "audio":
			return "audio";
		case "video":
		case "image":
			return "overlay";
		default:
			return null;
	}
}

/** A caption made from speech (Auto captions / Auto lyrics): it belongs to the voice it transcribes, not to a picture. */
function isCaption(element: TimelineElement): boolean {
	if (element.type !== "text") return false;
	const style = element.params?.["caption.style"];
	return (typeof style === "string" && style !== "") || /^Caption \d+$/.test(element.name);
}

/** The voice a caption transcribes: the speech clip on an audio track under its start (a voice-over, a recording,
 * an uploaded track — never library music). Captions over a talking main clip have none and follow that clip. */
function speechUnder(tracks: SceneTracks, at: number): TimelineElement | null {
	let found: TimelineElement | null = null;
	for (const track of tracks.audio) {
		for (const element of track.elements) {
			if (element.type !== "audio" || element.sourceType === "library") continue;
			// A caption may start a little before the voice (Whisper's first phrase 0.07 s early, final-A W1): within a
			// tenth of the voice's length before it, it is still that voice's.
			const lead = element.duration * 0.1;
			if (element.startTime - lead <= at && at < element.startTime + element.duration && (!found || element.startTime > found.startTime)) found = element;
		}
	}
	return found;
}

/** The clip a caption was heard in (`caption.source`), wherever it is now. */
function captionSource(tracks: SceneTracks, item: TimelineElement): { track: TimelineTrack; element: TimelineElement } | null {
	const id = item.params?.["caption.source"];
	if (typeof id !== "string" || !id) return null;
	for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio]) {
		const element = track.elements.find((x) => x.id === id);
		if (element) return { track, element };
	}
	return null;
}

const rateOf = (element: TimelineElement): number => ("retime" in element && element.retime?.rate ? element.retime.rate : 1);

/** Where the clip's picture sits on the timeline: a move changes it, a left trim doesn't (start and trim move together). */
function contentAnchor(element: TimelineElement): number {
	const trim = "trimStart" in element ? element.trimStart : 0;
	return element.startTime - trim / rateOf(element);
}

/**
 * How far the items over a clip go after an edit of that clip: with its picture when it moved (a drag, a ripple), not at
 * all for a left trim (start and trim move together). A speed change keeps the clip's start and changes its length only:
 * the items stay too — read through the picture's anchor, a split piece's trim made them jump by trim × (1 − 1/rate),
 * hundreds of seconds at 100× (blind test 05.11). So does a new source under the clip (Reverse, Replace, an AI effect's
 * result): its trim counts in another file — a reversed split piece's trim went 0 → 6 s and took the music 6 s back, off
 * the timeline (blind test 05.11).
 */
export function followDelta(before: TimelineElement, after: TimelineElement): number {
	const sourceOf = (e: TimelineElement) => ("mediaId" in e ? e.mediaId : undefined);
	const sameContent = rateOf(after) === rateOf(before) && sourceOf(after) === sourceOf(before);
	return sameContent ? contentAnchor(after) - contentAnchor(before) : after.startTime - before.startTime;
}

/**
 * The sound detached from a clip (⌃⇧S) while it still is exactly that clip's sound: the same file, place, length, part of
 * the file and speed. Such a pair is edited as one, like Premiere's linked clips: a trim, a speed change or a split of the
 * picture is the sound's too. Left to the item rules, a head trim slid the sound under the clip before (the trimmed-off
 * words still heard there), and from then on it belonged to that clip: the next Q left it 9 frames out of sync
 * (pro-core, 09.11). A sound the user cut on its own (a J or L cut) is no longer a pair and follows as before.
 */
export function isLockstepPair(sound: TimelineElement, clip: TimelineElement): boolean {
	return (
		sound.type === "audio" &&
		sound.sourceType === "upload" &&
		clip.type === "video" &&
		clip.isSourceAudioEnabled === false &&
		sound.mediaId === clip.mediaId &&
		sound.startTime === clip.startTime &&
		sound.duration === clip.duration &&
		sound.trimStart === clip.trimStart &&
		rateOf(sound) === rateOf(clip)
	);
}

/** The detached sounds in lockstep with `clip` (isLockstepPair), with their tracks. */
export function lockstepSounds(tracks: SceneTracks, clip: TimelineElement): { trackId: string; element: TimelineElement }[] {
	if (clip.type !== "video" || clip.isSourceAudioEnabled !== false) return [];
	return tracks.audio.flatMap((track) => track.elements.filter((sound) => isLockstepPair(sound, clip)).map((element) => ({ trackId: track.id, element })));
}

/**
 * CapCut's Linkage: the items over a main-track clip (they start on it) go with it. After an edit, a main clip that was
 * deleted takes its items along; one that moved (a drag, a ripple after a delete) moves them by as much. Items the edit
 * changed itself (selected and dragged together, deleted with it) are left as the edit made them. Returns the same
 * object when nothing follows.
 *
 * Captions are the exception: made from speech, they go with the voice they transcribe. Over a voice-over on an audio
 * track they move only when that voice-over moves (the exam 03.11: a picture stretched on the main track carried the
 * captions 15 s away from the narration, which starts at 0 and stays); over a talking main clip they follow it as before.
 */
export function applyLinkageReference({
	before,
	after,
	kinds,
}: {
	before: SceneTracks;
	after: SceneTracks;
	kinds: ReadonlySet<LinkageKind>;
}): SceneTracks {
	if (before.main.id !== after.main.id) return after;
	const mainAfter = new Map(after.main.elements.map((element) => [element.id, element]));
	const others = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, ...tracks.audio];
	// A main clip dragged onto a layer track is not deleted: its items go with it in time (read as deleted, the drag of a
	// picture onto the captions' row took 20 captions with it — exam 03.11, probe-drop-on-text).
	const anywhereAfter = new Map([after.main, ...others(after)].flatMap((track) => track.elements.map((element) => [element.id, element] as const)));
	const afterById = new Map(others(after).flatMap((track) => track.elements.map((element) => [element.id, { track, element }] as const)));

	const shift = new Map<string, number>();
	const remove = new Set<string>();
	// Detached sounds that take their clip's new bounds (isLockstepPair).
	const pairBounds = new Map<string, TimelineElement>();
	/**
	 * An item moved by `delta`: a sound or a picture pushed before 0 loses its head instead (it stays in sync with the
	 * clip it follows — clamped at 0 it played 3 s late after a head trim); anything else stops at 0.
	 */
	const movedBy = <T extends TimelineElement>(element: T, delta: number): T | null => {
		const start = element.startTime + delta;
		if (start >= 0) return { ...element, startTime: start } as T;
		if ((element.type === "audio" || element.type === "video") && "trimStart" in element) {
			const cut = -start;
			if (cut >= element.duration - 1) return null;
			return { ...element, startTime: 0, duration: element.duration - cut, trimStart: element.trimStart + cut * rateOf(element) } as T;
		}
		return { ...element, startTime: 0 } as T;
	};
	// Captions cut to what is left of their speech: new start and length.
	const fit = new Map<string, { startTime: number; duration: number }>();
	const end = (element: TimelineElement) => element.startTime + element.duration;
	/**
	 * A caption stays inside the picture (or the voice) whose speech it writes: after a trim its words that were cut away
	 * go (they piled up at 0 after a head trim, or hung over the next clip after a tail trim — the user's «субтитры
	 * разъезжаются»); half cut, it is shortened. After a split it belongs to the piece its words are in now.
	 */
	const sameContentAs = (owner: TimelineElement) => (clip: TimelineElement) =>
		clip.id === owner.id ||
		(("mediaId" in clip && "mediaId" in owner && clip.mediaId === owner.mediaId) && Math.abs(contentAnchor(clip) - contentAnchor(owner)) < 2);
	// Split pieces that still play on from one another are one speech: a caption across the split is not cut. «Plays on»:
	// side by side on the timeline and in the file (a piece slowed down keeps playing on from its neighbour).
	const sourceStart = (element: TimelineElement) => ("trimStart" in element ? element.trimStart : 0);
	const sourceEnd = (element: TimelineElement) => sourceStart(element) + element.duration * rateOf(element);
	const playsOn = (a: TimelineElement, b: TimelineElement) =>
		"mediaId" in a && "mediaId" in b && a.mediaId === b.mediaId && Math.abs(sourceEnd(a) - sourceStart(b)) <= Math.max(2, b.duration * 0.002);
	const windowOf = (host: TimelineElement, pieces: readonly TimelineElement[], same: (clip: TimelineElement) => boolean) => {
		let first = host;
		let last = host;
		for (let grew = true; grew; ) {
			grew = false;
			for (const clip of pieces) {
				if (Math.abs(clip.startTime - end(last)) <= 1 && end(clip) > end(last) && (same(clip) || playsOn(last, clip))) {
					last = clip;
					grew = true;
				}
				if (Math.abs(end(clip) - first.startTime) <= 1 && clip.startTime < first.startTime && (same(clip) || playsOn(clip, first))) {
					first = clip;
					grew = true;
				}
			}
		}
		return { windowStart: first.startTime, windowEnd: end(last) };
	};
	/**
	 * A caption over a clip whose speed changed: the speech it writes now comes sooner or later and lasts shorter or
	 * longer, by the old rate / the new one (it kept its old time and the ones past the new end were deleted — targeted
	 * test 05.11). Measured from the clip's start, which a speed change keeps.
	 */
	const retimed = (item: TimelineElement, before: TimelineElement, now: TimelineElement) => {
		const scale = rateOf(before) / rateOf(now);
		if (Math.abs(scale - 1) < 1e-9) return null;
		return { ...item, startTime: before.startTime + Math.round((item.startTime - before.startTime) * scale), duration: Math.round(item.duration * scale) } as TimelineElement;
	};
	const keepInside = (
		item: TimelineElement,
		delta: number,
		owner: TimelineElement,
		pieces: readonly TimelineElement[],
		was: { owner: TimelineElement; pieces: readonly TimelineElement[]; retimed?: boolean },
	) => {
		const start = item.startTime + delta;
		const stop = start + item.duration;
		const sameContent = sameContentAs(owner);
		const host = pieces.find((clip) => sameContent(clip) && clip.startTime < stop && start < end(clip) && clip.startTime <= start) ??
			pieces.find((clip) => sameContent(clip) && clip.startTime < stop && start < end(clip));
		if (!host) {
			remove.add(item.id);
			return;
		}
		const { windowStart, windowEnd } = windowOf(host, pieces, sameContent);
		// A caption that already ran past the end of its speech keeps that overhang while the speech's end stays where it
		// was: any edit cut a caption over a short sound to the sound's end, a trim of another clip too (targeted test 05.11).
		// When the end itself is cut, the caption is cut there.
		const before = windowOf(was.owner, was.pieces, sameContentAs(was.owner));
		const tailKept = windowEnd >= before.windowEnd + delta - 1;
		const from = Math.max(start, windowStart);
		const to = tailKept ? stop : Math.min(stop, windowEnd);
		if (to - from < 1) {
			remove.add(item.id);
			return;
		}
		if (from !== start || to !== stop || was.retimed) fit.set(item.id, { startTime: from, duration: to - from });
		else if (delta !== 0) shift.set(item.id, delta);
	};
	const mainBefore = [...before.main.elements].sort((a, b) => a.startTime - b.startTime);
	/**
	 * A main clip replaced in one step by a clip that was not there before, starting where it started (a lipsync result
	 * «In place», «Replace», the muted copy under a result «Above the clip»): a replacement is not a delete. What lies
	 * over the old clip stays where it is (final-B D1, 07.11: «In place» with Linkage on silently took the picture, the
	 * AI clip and the voice-over above the piece). Only the old captions go: the speech they wrote is gone.
	 */
	const mainBeforeIds = new Set(mainBefore.map((clip) => clip.id));
	const freshMain = after.main.elements.filter((clip) => !mainBeforeIds.has(clip.id));
	const replaced = (owner: TimelineElement) => freshMain.some((clip) => Math.abs(clip.startTime - owner.startTime) <= 1);
	/**
	 * Where an item goes when the moment it starts on was cut out of its clip (Q / W, a trim): to the cut. Q pulled the
	 * layer clips over the cut head along with the clip, W left them over the next clip once the magnet closed the gap
	 * (targeted test 05.11) — now both put them where the cut is. A picture or a title over a cut head goes to the clip's
	 * new start; a sound or a video keeps its sync (its own head is cut, movedBy). Over a cut tail it goes to the clip's
	 * new end, only when the clips after it closed up (with a gap left, it stays over the gap). Not for a speed change or
	 * a new file under the clip (Reverse): those keep the items where they are.
	 */
	const toTheCut = (item: TimelineElement, delta: number, owner: TimelineElement, moved: TimelineElement): number => {
		if (!mainAfter.has(moved.id) || moved.id !== owner.id) return delta;
		if (rateOf(moved) !== rateOf(owner) || ("mediaId" in moved ? moved.mediaId : undefined) !== ("mediaId" in owner ? owner.mediaId : undefined)) return delta;
		const at = item.startTime + delta;
		if (at >= end(moved)) {
			const closedUp = mainBefore.some((clip) => clip.startTime >= end(owner) - 1 && (mainAfter.get(clip.id)?.startTime ?? Number.POSITIVE_INFINITY) < clip.startTime);
			return closedUp ? end(moved) - item.startTime : delta;
		}
		if (at < moved.startTime && item.type !== "audio" && item.type !== "video") return moved.startTime - item.startTime;
		return delta;
	};
	// Untouched by the edit: still there, same track, same place.
	const untouched = (item: TimelineElement, track: TimelineTrack) => {
		const now = afterById.get(item.id);
		return now && now.track.id === track.id && now.element.startTime === item.startTime ? now : null;
	};
	// The main clips a detached sound can be in lockstep with, by what the pair shares (one lookup per sound, built once
	// and only when a sound is met: the edit is O(items), not O(items × clips)).
	const lockstepKey = (element: TimelineElement) =>
		`${"mediaId" in element ? element.mediaId : ""}|${element.startTime}|${element.duration}|${"trimStart" in element ? element.trimStart : 0}|${rateOf(element)}`;
	let lockstepMap: Map<string, TimelineElement> | null = null;
	const lockstepByKey = () => {
		lockstepMap ??= new Map(
			mainBefore.filter((clip) => clip.type === "video" && clip.isSourceAudioEnabled === false).map((clip) => [lockstepKey(clip), clip] as const),
		);
		return lockstepMap;
	};
	const captions: { item: TimelineElement; voice: TimelineElement }[] = [];
	for (const track of others(before)) {
		for (const item of track.elements) {
			const kind = linkageKindOf(item);
			// Captions always follow their speech (Linkage on or off, text in its list or not); the rest as Linkage says.
			if (!kind || (!kinds.has(kind) && !isCaption(item))) continue;
			if (!untouched(item, track)) continue;
			// A detached sound in lockstep with its clip: trimmed, sped up and moved with it (the edit left it as it was).
			const pair = item.type === "audio" ? lockstepByKey().get(lockstepKey(item)) : undefined;
			const pairNow = pair && isLockstepPair(item, pair) ? (mainAfter.get(pair.id) ?? anywhereAfter.get(pair.id)) : undefined;
			const itemNow = afterById.get(item.id)?.element;
			if (pair && pairNow && itemNow && itemNow.duration === item.duration && "trimStart" in itemNow && itemNow.trimStart === item.trimStart) {
				const sameMedia = "mediaId" in pairNow && "mediaId" in item && pairNow.mediaId === item.mediaId;
				if (sameMedia && "trimStart" in pairNow) {
					const changed =
						pairNow.startTime !== pair.startTime || pairNow.duration !== pair.duration || pairNow.trimStart !== pair.trimStart || rateOf(pairNow) !== rateOf(pair);
					if (changed) {
						const retime = "retime" in pairNow ? pairNow.retime : undefined;
						pairBounds.set(item.id, {
							...itemNow,
							startTime: pairNow.startTime,
							duration: pairNow.duration,
							trimStart: pairNow.trimStart,
							trimEnd: pairNow.trimEnd,
							...(retime ? { retime } : {}),
						} as TimelineElement);
						if (!retime && "retime" in itemNow && itemNow.retime) pairBounds.set(item.id, { ...(pairBounds.get(item.id) as TimelineElement), retime: undefined } as TimelineElement);
					}
					continue;
				}
			}
			// A caption made from a clip's speech follows that clip (final-A W1: a speech clip on an overlay track left its
			// captions behind, and a voice's first caption, 0.07 s before the voice, stayed): a voice on an audio track
			// through the captions list, a picture clip like a main clip's item.
			const source = isCaption(item) ? captionSource(before, item) : null;
			if (isCaption(item)) {
				const voice = source?.track.type === "audio" ? source.element : source ? null : speechUnder(before, item.startTime);
				if (voice) {
					captions.push({ item, voice });
					continue;
				}
			}
			const owner = source?.element ?? mainBefore.find((clip) => clip.startTime <= item.startTime && item.startTime < clip.startTime + clip.duration);
			if (!owner) continue;
			const moved = mainAfter.get(owner.id) ?? anywhereAfter.get(owner.id);
			if (!moved) {
				if (replaced(owner)) {
					if (isCaption(item)) remove.add(item.id);
					continue;
				}
				// An item that runs on well past the deleted clip (a music bed, a long photo over several clips) belongs to
				// more than that clip: it stays (blind test 05.11: deleting a 1 s piece took a 5 s song along, silently).
				// Captions and items within the clip go with it, as in CapCut.
				const ownerEnd = owner.startTime + owner.duration;
				const runsOn = item.startTime + item.duration - ownerEnd > ownerEnd - item.startTime; // most of it lies past the clip
				if (!isCaption(item) && runsOn) continue;
				remove.add(item.id);
				continue;
			}
			const delta = Math.round(followDelta(owner, moved));
			if (isCaption(item)) {
				const onMain = mainAfter.has(moved.id);
				const timed = retimed(item, owner, moved);
				keepInside(timed ?? item, delta, moved, onMain ? after.main.elements : [moved], { owner, pieces: before.main.elements, retimed: !!timed });
				continue;
			}
			if (delta !== 0 || mainAfter.has(moved.id)) {
				const cut = toTheCut(item, delta, owner, moved);
				if (cut !== 0) shift.set(item.id, cut);
			}
		}
	}
	// Captions go where their voice went: as the edit moved it, plus what the linkage above moves it by.
	for (const { item, voice } of captions) {
		const now = afterById.get(voice.id);
		if (!now || remove.has(voice.id)) {
			remove.add(item.id);
			continue;
		}
		const voiceShift = shift.get(voice.id) ?? 0;
		// Where the voice really ends up (a head cut instead of a move before 0): the captions go with that.
		const voiceNow = voiceShift ? movedBy(now.element, voiceShift) : now.element;
		if (!voiceNow) {
			remove.add(item.id);
			continue;
		}
		// The words move as the voice's content does (by the whole shift, also when its head was cut at 0), and stay
		// inside what is left of it.
		const delta = Math.round(followDelta(voice, now.element) + voiceShift);
		const voiceTrack = others(before).find((track) => track.elements.some((element) => element.id === voice.id));
		const timed = retimed(item, voice, now.element);
		keepInside(timed ?? item, delta, voiceNow, now.track.elements.map((element) => (element.id === voice.id ? voiceNow : element)), {
			owner: voice,
			pieces: voiceTrack?.elements ?? [voice],
			retimed: !!timed,
		});
	}
	if (shift.size === 0 && remove.size === 0 && fit.size === 0 && pairBounds.size === 0) return after;
	const fix = <T extends TimelineTrack>(track: T): T => {
		if (!track.elements.some((element) => remove.has(element.id) || shift.has(element.id) || fit.has(element.id) || pairBounds.has(element.id))) return track;
		const elements = track.elements
			.filter((element) => !remove.has(element.id))
			.map((element) => {
				const bounds = pairBounds.get(element.id);
				if (bounds) return bounds as typeof element;
				const cut = fit.get(element.id);
				if (cut) return { ...element, startTime: Math.max(0, cut.startTime), duration: cut.duration } as typeof element;
				const delta = shift.get(element.id);
				return delta ? movedBy(element, delta) : element;
			})
			.filter((element): element is NonNullable<typeof element> => element !== null);
		return { ...track, elements } as T;
	};
	return { ...after, overlay: after.overlay.map(fix), audio: after.audio.map(fix) };
}
