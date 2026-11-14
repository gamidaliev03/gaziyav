// What must hold on the timeline after every edit, undo and redo (CapCut's model, skill nle-editing-core). Pure: the
// command manager checks it in test runs (timeline-audit.ts) and the unit tests feed it hand-made tracks.
import type { EditorSelectionSnapshot } from "@/selection/editor-selection";
import type { TimelineTransition } from "@/transitions/types";
import type { LinkageKind } from "./timeline-store";
import type { SceneTracks, TimelineElement, TimelineTrack } from "./types";
import { followDelta, isLockstepPair, linkageKindOf } from "./linkage";

export interface InvariantViolation {
	rule: string;
	detail: string;
}

/** Two clips this close count as touching: a cut (transitions/commands.ts uses the same 1/50 s). */
const CUT_TOLERANCE = 2400;

const allTracks = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, tracks.main, ...tracks.audio];
const end = (element: TimelineElement) => element.startTime + element.duration;
const byStart = (elements: readonly TimelineElement[]) => elements.slice().sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
const label = (element: TimelineElement) => `${element.type} ${element.name ? `«${element.name.slice(0, 24)}» ` : ""}${element.id.slice(0, 8)}`;
const transitionsOf = (track: TimelineTrack): TimelineTransition[] => (track as { transitions?: TimelineTransition[] }).transitions ?? [];

/** The source-time rate of a clip: constant speed only (a curve or a reversed file is checked for its trims alone). */
function constantRate(element: TimelineElement): number | null {
	if ("reversed" in element && element.reversed) return null;
	if (!("retime" in element) || !element.retime) return 1;
	if (element.retime.mode === "curve") return null;
	return element.retime.rate > 0 ? element.retime.rate : null;
}

/** Every rule that holds on a state alone. `magnet`: the main-track magnet as the user sees it. */
export function checkTimelineInvariants({
	tracks,
	magnet,
	selection,
}: {
	tracks: SceneTracks;
	magnet: boolean;
	selection?: Pick<EditorSelectionSnapshot, "selectedElements" | "selectedKeyframes">;
}): InvariantViolation[] {
	const out: InvariantViolation[] = [];
	const ids = new Map<string, string>();
	const trackIds = new Set<string>();
	for (const track of allTracks(tracks)) {
		if (trackIds.has(track.id)) out.push({ rule: "unique-ids", detail: `track ${track.id} twice` });
		trackIds.add(track.id);
		for (const element of track.elements) {
			const seen = ids.get(element.id);
			if (seen) out.push({ rule: "unique-ids", detail: `${label(element)} on ${seen} and ${track.id}` });
			ids.set(element.id, track.id);
			const times = [element.startTime, element.duration, element.trimStart, element.trimEnd];
			if (!times.every(Number.isInteger)) out.push({ rule: "integer-ticks", detail: `${label(element)}: ${times.join(" / ")}` });
			if (element.duration <= 0 || element.startTime < 0) out.push({ rule: "clip-bounds", detail: `${label(element)} starts ${element.startTime}, lasts ${element.duration}` });
		}
		// one clip at a time on a track
		const sorted = byStart(track.elements);
		for (let i = 0; i + 1 < sorted.length; i++) {
			if (end(sorted[i]) > sorted[i + 1].startTime) {
				out.push({ rule: "no-overlap", detail: `${track.id}: ${label(sorted[i])} ends ${end(sorted[i])}, ${label(sorted[i + 1])} starts ${sorted[i + 1].startTime}` });
			}
		}
		// a transition sits on a cut: both clips on this track, touching, the second right after the first
		const byId = new Map(track.elements.map((element) => [element.id, element]));
		const cuts = new Set<string>();
		for (const transition of transitionsOf(track)) {
			const from = byId.get(transition.fromElementId);
			const to = byId.get(transition.toElementId);
			const key = `${transition.fromElementId}>${transition.toElementId}`;
			if (cuts.has(key)) out.push({ rule: "transition-on-cut", detail: `${track.id}: two transitions on one cut ${key}` });
			cuts.add(key);
			if (!from || !to) {
				out.push({ rule: "transition-on-cut", detail: `${track.id}: transition ${transition.id.slice(0, 8)} has lost ${from ? "its second" : "its first"} clip` });
				continue;
			}
			const next = sorted[sorted.indexOf(from) + 1];
			if (next !== to || Math.abs(end(from) - to.startTime) > CUT_TOLERANCE) {
				out.push({ rule: "transition-on-cut", detail: `${track.id}: transition ${transition.id.slice(0, 8)} between ${label(from)} (ends ${end(from)}) and ${label(to)} (starts ${to.startTime}), not a cut` });
			} else if (!(transition.duration > 0) || transition.duration > Math.min(from.duration, to.duration)) {
				out.push({ rule: "transition-on-cut", detail: `${track.id}: transition ${transition.id.slice(0, 8)} lasts ${transition.duration}, longer than ${label(from)} (${from.duration}) or ${label(to)} (${to.duration})` });
			}
		}
	}

	// the clip shows its own media: trims never negative, a constant-speed clip never past the file's end
	for (const track of allTracks(tracks)) {
		for (const element of track.elements) {
			if (element.trimStart < 0 || element.trimEnd < 0) out.push({ rule: "source-bounds", detail: `${label(element)}: trims ${element.trimStart} / ${element.trimEnd}` });
			if (element.type !== "video" && element.type !== "audio") continue;
			const rate = constantRate(element);
			if (rate == null || element.sourceDuration == null) continue;
			const used = element.trimStart + element.duration * rate;
			// a tick or so per unit of speed is rounding
			if (used > element.sourceDuration + Math.ceil(rate) + 1) {
				out.push({ rule: "source-bounds", detail: `${label(element)}: shows ${element.trimStart}…${Math.round(used)} of ${element.sourceDuration}` });
			}
		}
	}

	// the main track with its magnet: no gap, the first clip at 0. A compound clip made of main-track clips sits on a
	// track above (timeline/compound.ts) and plays in their place: the stretch it covers counts as filled.
	if (magnet) {
		const main = byStart(tracks.main.elements);
		const compounds = tracks.overlay.flatMap((track) => track.elements.filter((element) => element.type === "graphic" && element.params?.compound === true));
		const covered = (from: number, to: number) => compounds.some((c) => c.startTime <= from && end(c) >= to);
		let at = 0;
		for (const element of main) {
			if (element.startTime !== at && !(element.startTime > at && covered(at, element.startTime))) {
				out.push({ rule: "main-no-gap", detail: `${label(element)} starts ${element.startTime}, the clip before ends ${at}` });
				break;
			}
			at = end(element);
		}
	}

	// one sound per clip (blind3 F3): a video playing its own sound has no detached copy of it still heard
	const videos = new Map<string, TimelineElement>();
	for (const track of [...tracks.overlay, tracks.main]) for (const element of track.elements) if (element.type === "video") videos.set(element.id, element);
	for (const track of tracks.audio) {
		if (track.muted) continue;
		for (const sound of track.elements) {
			if (sound.type !== "audio" || sound.sourceType !== "upload" || !sound.detachedFrom || sound.params?.muted === true) continue;
			const clip = videos.get(sound.detachedFrom);
			if (!clip || clip.type !== "video" || clip.isSourceAudioEnabled === false || clip.mediaId !== sound.mediaId) continue;
			const rate = (e: TimelineElement) => ("retime" in e && e.retime && e.retime.rate > 0 ? e.retime.rate : 1);
			// the same words twice at once: its frames and its time both overlap the clip's
			const sameFrames = sound.trimStart < clip.trimStart + clip.duration * rate(clip) && sound.trimStart + sound.duration * rate(sound) > clip.trimStart;
			const sameTime = sound.startTime < clip.startTime + clip.duration && sound.startTime + sound.duration > clip.startTime;
			// a piece another detached clip plays with it (its frames, its time: a split clip's other half) is that clip's sound
			const claimed = [...videos.values()].some(
				(other) =>
					other.id !== clip.id &&
					other.type === "video" &&
					other.isSourceAudioEnabled === false &&
					other.mediaId === sound.mediaId &&
					sound.trimStart < other.trimStart + other.duration * rate(other) &&
					sound.trimStart + sound.duration * rate(sound) > other.trimStart &&
					sound.startTime < other.startTime + other.duration &&
					sound.startTime + sound.duration > other.startTime,
			);
			if (sameFrames && sameTime && !claimed) {
				out.push({ rule: "one-sound", detail: `${label(clip)} plays its own sound and its detached copy ${label(sound)} too` });
			}
		}
	}

	// the selection points at what is there
	if (selection) {
		const where = new Map<string, Set<string>>();
		for (const track of allTracks(tracks)) where.set(track.id, new Set(track.elements.map((element) => element.id)));
		for (const ref of selection.selectedElements) {
			if (!where.get(ref.trackId)?.has(ref.elementId)) out.push({ rule: "selection-exists", detail: `selected ${ref.elementId.slice(0, 8)} on ${ref.trackId.slice(0, 8)} is not there` });
		}
		for (const ref of selection.selectedKeyframes) {
			if (!where.get(ref.trackId)?.has(ref.elementId)) out.push({ rule: "selection-exists", detail: `selected key frame on ${ref.elementId.slice(0, 8)} is not there` });
		}
	}
	return out;
}

/**
 * Linkage keeps sound with its picture: an audio clip that started on a main clip, and that the edit itself left as it
 * was, keeps its place against that clip's picture while the clip stays on the main track, and goes when the clip
 * went. `afterCommand`: the tracks the command made, before ripple and linkage ran; `after`: the finished step.
 */
export function checkLinkedAudio({
	before,
	afterCommand,
	after,
	kinds,
}: {
	before: SceneTracks;
	afterCommand: SceneTracks;
	after: SceneTracks;
	kinds: ReadonlySet<LinkageKind>;
}): InvariantViolation[] {
	if (!kinds.has("audio") || before.main.id !== after.main.id) return [];
	const out: InvariantViolation[] = [];
	const find = (tracks: SceneTracks, id: string) => {
		for (const track of allTracks(tracks)) {
			const element = track.elements.find((x) => x.id === id);
			if (element) return { track, element };
		}
		return null;
	};
	const mainAfter = new Map(after.main.elements.map((element) => [element.id, element]));
	// A main clip replaced in the step by a new one at its start (a lipsync result in place, «Replace»): not a delete,
	// the sound over it stays (timeline/linkage.ts, final-B D1).
	const mainBeforeIds = new Set(before.main.elements.map((element) => element.id));
	const replaced = (clip: TimelineElement) => after.main.elements.some((x) => !mainBeforeIds.has(x.id) && Math.abs(x.startTime - clip.startTime) <= 1);
	for (const track of before.audio) {
		for (const item of track.elements) {
			if (linkageKindOf(item) !== "audio") continue;
			const clip = before.main.elements.find((x) => item.startTime >= x.startTime && item.startTime < end(x));
			if (!clip) continue;
			const made = find(afterCommand, item.id);
			// the edit moved, trimmed or deleted the sound itself: it is as the edit made it
			if (!made || made.track.id !== track.id || made.element.startTime !== item.startTime || made.element.duration !== item.duration) continue;
			const now = find(after, item.id);
			const clipNow = mainAfter.get(clip.id);
			if (!clipNow) {
				// A sound that runs on well past its clip (most of it after the clip's end: a music bed, a long voice) belongs
				// to more than that clip and stays, as linkage keeps it (timeline/linkage.ts): no fault then.
				const runsOn = end(item) - end(clip) > end(clip) - item.startTime;
				if (now && !runsOn && !find(after, clip.id) && !replaced(clip)) out.push({ rule: "linked-audio", detail: `${label(item)} stayed when its clip ${label(clip)} was deleted` });
				continue;
			}
			if (!now) {
				out.push({ rule: "linked-audio", detail: `${label(item)} went, its clip ${label(clip)} is still there` });
				continue;
			}
			// A detached sound in lockstep with its clip takes the clip's bounds: trimmed, sped up and moved with it.
			if (isLockstepPair(item, clip) && "mediaId" in clipNow && "mediaId" in item && clipNow.mediaId === item.mediaId) {
				const sound = now.element;
				const sameBounds =
					sound.startTime === clipNow.startTime && sound.duration === clipNow.duration && "trimStart" in sound && "trimStart" in clipNow && sound.trimStart === clipNow.trimStart;
				if (!sameBounds) out.push({ rule: "linked-audio", detail: `${label(item)} is not in step with its clip ${label(clipNow)}: ${sound.startTime}+${sound.duration} vs ${clipNow.startTime}+${clipNow.duration}` });
				continue;
			}
			// Where linkage must have put it (the same rule: with the picture on a move, nowhere on a left trim or a speed change).
			const off = now.element.startTime - (item.startTime + followDelta(clip, clipNow));
			if (Math.abs(off) > 1 && now.element.startTime > 0) out.push({ rule: "linked-audio", detail: `${label(item)} is ${off} ticks off its clip ${label(clipNow)}` });
		}
	}
	return out;
}

/** The timeline as ⌘Z and ⇧⌘Z must give it back, byte for byte (tracks, transitions, bookmarks). */
export function timelineStateKey(scene: { tracks: SceneTracks; bookmarks?: unknown }): string {
	return JSON.stringify({ tracks: scene.tracks, bookmarks: scene.bookmarks ?? [] });
}

/** The first few elements that differ between two state keys, for a readable report. */
export function describeStateDifference(a: string, b: string): string {
	try {
		const elementsOf = (key: string) => {
			const { tracks } = JSON.parse(key) as { tracks: SceneTracks };
			const map = new Map<string, string>();
			for (const track of allTracks(tracks)) {
				map.set(`track ${track.id.slice(0, 8)}`, JSON.stringify({ ...track, elements: track.elements.map((element) => element.id) }));
				for (const element of track.elements) map.set(`${element.type} ${element.id.slice(0, 8)}`, JSON.stringify({ track: track.id, ...element }));
			}
			return map;
		};
		const x = elementsOf(a);
		const y = elementsOf(b);
		const diffs: string[] = [];
		for (const [id, value] of x) {
			if (!y.has(id)) diffs.push(`${id} gone`);
			else if (y.get(id) !== value) {
				const before = JSON.parse(value) as Record<string, unknown>;
				const after = JSON.parse(y.get(id) as string) as Record<string, unknown>;
				const keys = Object.keys({ ...before, ...after }).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
				diffs.push(`${id}: ${keys.map((k) => `${k} ${JSON.stringify(before[k])?.slice(0, 40)} → ${JSON.stringify(after[k])?.slice(0, 40)}`).join(", ")}`);
			}
		}
		for (const id of y.keys()) if (!x.has(id)) diffs.push(`${id} added`);
		return diffs.length ? diffs.slice(0, 4).join("; ") : "bookmarks differ";
	} catch {
		return "unreadable state";
	}
}
