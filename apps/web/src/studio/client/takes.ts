// Takes of a clip (the charter's rule F, lip3): after a lipsync the clip on the timeline is the same clip with takes —
// take 0 is the original footage, then each lipsync result. A flip shows another take IN PLACE: the same element (id,
// start, length, effects), only its media and the trims that map the same moment of the footage; one ⌘Z. Each take
// remembers what it was made from (stale.ts) so the clip can say «губы устарели».
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EditorCore } from "@/core";
import type { TimelineElement, TimelineTrack } from "@/timeline";
import { mediaTimeFromSeconds, mediaTimeToSeconds, type MediaTime } from "@/wasm";
import { type Made, type SoundOnTimeline, soundOfFile, soundUnder, spanOf } from "./stale";
import { useStudioStore } from "./studio-store";

export interface Take {
	assetId: string;
	/** The take's second 0 is this second of the original footage. */
	offset: number;
	made?: Made;
	createdAt: number;
}

export interface TakeGroup {
	originalId: string;
	/** Oldest first: take 1, take 2, … (take 0 is the original). */
	takes: Take[];
}

interface TakesState {
	/** By the piece's versions key (studio-store versionKey). */
	groups: Record<string, TakeGroup>;
	/** `<projectId>|<elementId>` → its group. */
	clips: Record<string, string>;
}

export const useTakesStore = create<TakesState>()(persist(() => ({ groups: {}, clips: {} }), { name: "lipsync-takes" }));

const sec = (t: MediaTime | number | undefined) => (t == null ? 0 : mediaTimeToSeconds({ time: t as MediaTime }));
const T = (s: number) => mediaTimeFromSeconds({ seconds: Math.max(0, s) });
const clipKey = (projectId: string, elementId: string) => `${projectId}|${elementId}`;

type MediaEl = TimelineElement & { mediaId?: string; trimStart: MediaTime; trimEnd: MediaTime; sourceDuration?: MediaTime; startTime: MediaTime; duration: MediaTime };

function find(editor: EditorCore, elementId: string): { track: TimelineTrack; el: MediaEl } | null {
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return null;
	for (const track of [tracks.main, ...tracks.overlay] as TimelineTrack[]) {
		const el = (track.elements as TimelineElement[]).find((e) => e.id === elementId);
		if (el) return { track, el: el as MediaEl };
	}
	return null;
}

/** Every audible sound on the audio tracks (seconds), for soundUnder. */
function soundsOf(editor: EditorCore): SoundOnTimeline[] {
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return [];
	const out: SoundOnTimeline[] = [];
	for (const track of tracks.audio as TimelineTrack[]) {
		for (const e of track.elements as Array<MediaEl & { muted?: boolean; params?: { muted?: boolean } }>) {
			if (!e.mediaId) continue;
			out.push({ mediaId: e.mediaId, start: sec(e.startTime), length: sec(e.duration), trimStart: sec(e.trimStart), muted: !!(track as { muted?: boolean }).muted || !!e.muted || !!e.params?.muted });
		}
	}
	return out;
}

/** What the clip's lips follow right now: its sound (the audio under it, or its voice file) and its span of the take. */
export function madeNow(editor: EditorCore, projectId: string, elementId: string): Made | null {
	const hit = find(editor, elementId);
	if (!hit) return null;
	const at = sec(hit.el.startTime);
	const length = sec(hit.el.duration);
	const draft = useStudioStore.getState().drafts[clipKey(projectId, elementId)];
	const sound = draft?.voice === "timeline" ? soundUnder({ at, length }, soundsOf(editor)) : soundOfFile(draft?.speech?.fileId);
	return { sound, span: spanOf({ trimStart: sec(hit.el.trimStart), length }) };
}

/** The clip's takes and which one it shows (0 = the original); null when the clip has none. */
export function takesOf(editor: EditorCore, projectId: string, elementId: string): { group: TakeGroup; key: string; shown: number } | null {
	const s = useTakesStore.getState();
	const key = s.clips[clipKey(projectId, elementId)];
	const group = key ? s.groups[key] : undefined;
	const hit = find(editor, elementId);
	if (!group || !hit?.el.mediaId) return null;
	const mediaId = hit.el.mediaId;
	const shown = mediaId === group.originalId ? 0 : group.takes.findIndex((t) => t.assetId === mediaId) + 1;
	if (shown < 0 || (shown === 0 && mediaId !== group.originalId)) return null;
	return { group, key, shown };
}

/**
 * A lipsync result landed (actions.ts completeLipsync): it joins its piece's takes and the clip it landed as carries
 * them, remembering what its lips follow now.
 */
export function recordTake(
	editor: EditorCore,
	r: { projectId: string; key: string; originalId?: string; offset: number; assetId: string; sourceElementId?: string; elementId?: string },
) {
	if (!r.originalId) return;
	const elementId = r.elementId ?? findByMedia(editor, r.assetId);
	if (!elementId) return;
	const made = madeNow(editor, r.projectId, elementId) ?? undefined;
	useTakesStore.setState((s) => {
		const known = r.sourceElementId ? s.clips[clipKey(r.projectId, r.sourceElementId)] : undefined;
		const gk = known && s.groups[known] ? known : r.key;
		const g = s.groups[gk] ?? { originalId: r.originalId!, takes: [] };
		const takes = [...g.takes.filter((t) => t.assetId !== r.assetId), { assetId: r.assetId, offset: r.offset, made, createdAt: Date.now() }];
		return { groups: { ...s.groups, [gk]: { ...g, takes } }, clips: { ...s.clips, [clipKey(r.projectId, elementId)]: gk } };
	});
}

function findByMedia(editor: EditorCore, assetId: string): string | undefined {
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return undefined;
	for (const track of [tracks.main, ...tracks.overlay] as TimelineTrack[]) {
		const el = (track.elements as MediaEl[]).find((e) => e.mediaId === assetId);
		if (el) return el.id;
	}
	return undefined;
}

/**
 * Shows take `index` (0 = the original) in the clip, in place: the same element, start and length, effects and
 * keyframes untouched; the trims move so the same moment of the footage plays. One ⌘Z. False when it can't (the take
 * is gone from Media, or too short for the clip).
 */
export function showTake(editor: EditorCore, projectId: string, elementId: string, index: number): boolean {
	const info = takesOf(editor, projectId, elementId);
	const hit = find(editor, elementId);
	if (!info || !hit || index === info.shown || index < 0 || index > info.group.takes.length) return false;
	const { group } = info;
	const from = info.shown === 0 ? 0 : group.takes[info.shown - 1].offset;
	const target = index === 0 ? { assetId: group.originalId, offset: 0 } : group.takes[index - 1];
	const asset = editor.media.getAssets().find((a) => a.id === target.assetId);
	if (!asset) return false;
	const el = hit.el;
	// the footage the clip plays: its length on the timeline (a result's sourceDuration may still be its original's)
	const span = sec(el.duration);
	const total = asset.duration ?? sec(el.sourceDuration);
	let trimStart = sec(el.trimStart) + from - target.offset;
	let trimEnd = total - trimStart - span;
	if (trimEnd < 0) {
		trimStart += trimEnd;
		trimEnd = 0;
	}
	// a file a frame shorter than the clip's span (the model's rounding) still flips; more than that does not fit
	const slack = 0.05;
	if (trimStart < -slack || span > total + slack) return false;
	trimStart = Math.max(0, trimStart);
	trimEnd = Math.max(0, Math.min(trimEnd, total - trimStart));
	editor.timeline.updateElements({
		updates: [
			{
				trackId: hit.track.id,
				elementId,
				patch: { mediaId: asset.id, name: asset.name, sourceDuration: T(total), trimStart: T(trimStart), trimEnd: T(Math.max(0, trimEnd)) } as unknown as Partial<TimelineElement>,
			},
		],
	});
	return true;
}

/** Can take `index` fill the clip (its file at least as long as the clip from the same moment)? */
export function takeFits(editor: EditorCore, projectId: string, elementId: string, index: number): boolean {
	const info = takesOf(editor, projectId, elementId);
	const hit = find(editor, elementId);
	if (!info || !hit) return false;
	const from = info.shown === 0 ? 0 : info.group.takes[info.shown - 1].offset;
	const target = index === 0 ? { assetId: info.group.originalId, offset: 0 } : info.group.takes[index - 1];
	const total = editor.media.getAssets().find((a) => a.id === target?.assetId)?.duration;
	if (!target || total == null) return false;
	return sec(hit.el.duration) <= total + 0.05 && sec(hit.el.trimStart) + from - target.offset >= -0.05;
}

/** The key's flip: the original ↔ the newest lipsynced take. */
export function flipTake(editor: EditorCore, projectId: string, elementId: string): boolean {
	const info = takesOf(editor, projectId, elementId);
	if (!info) return false;
	return showTake(editor, projectId, elementId, info.shown === 0 ? info.group.takes.length : 0);
}

/** Is the take the clip shows stale (its sound or span changed since it was made)? */
export function takeIsStale(editor: EditorCore, projectId: string, elementId: string, isStale: (a: Made, b: Made) => boolean): boolean {
	const info = takesOf(editor, projectId, elementId);
	if (!info || info.shown === 0) return false;
	const made = info.group.takes[info.shown - 1].made;
	const now = madeNow(editor, projectId, elementId);
	return !!made && !!now && isStale(made, now);
}

// the walk reads and drives takes like the user (lipsync-walk.mjs «takes», «stale»)
if (typeof window !== "undefined") (window as unknown as { __takes: unknown }).__takes = { store: useTakesStore, takesOf, showTake, flipTake, madeNow };
