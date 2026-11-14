// Sync by waveform on the open timeline: the selected clips are lined up by their sound, as ONE undoable step.
// xcorr.ts finds the lag, place.ts says where the clips go; here the files are read (read.ts), the result is applied
// and put into words.
import { create } from "zustand";
import { TracksSnapshotCommand } from "@/commands/timeline/tracks-snapshot";
import type { EditorCore } from "@/core";
import { t } from "@/i18n";
import type { MediaAsset } from "@/media/types";
import type { ElementRef, TimelineElement, TimelineTrack } from "@/timeline";
import { buildEmptyTrack } from "@/timeline/placement";
import { generateUUID } from "@/utils/id";
import { TICKS_PER_SECOND } from "@/wasm";
import { type SyncClip, moveClips, pickReference, placeSynced } from "./place";
import { type Sound, atRate, openSound } from "./read";
import { MATCH_SCORE, SHARP_ENOUGH, coarseLag, fineLag, fitDrift, outline } from "./xcorr";

export interface SyncedClip {
	id: string;
	name: string;
	/** How far it moved on the timeline, seconds (negative: earlier). */
	movedSeconds: number;
	/** The lag found between the two files at the middle of what they share: seconds, and samples of the reference's file. */
	lagSeconds: number;
	lagSamples: number;
	/** Parts in a million one recorder's clock runs against the other's (100 = 0.01 %). */
	driftPpm: number;
	/** How far apart the two sounds are at the ends of what they share, because of the drift, milliseconds. */
	apartMs: number;
	/** Windows that agreed, of those compared. */
	windows: number;
	of: number;
	/** Its sound is the reference's upside down (polarity). */
	inverted: boolean;
}

export interface SyncResult {
	reference: { id: string; name: string; type: "video" | "audio" };
	clips: SyncedClip[];
	/** Clips that could not be lined up, each with why. */
	failed: Array<{ name: string; why: string }>;
	changed: boolean;
}

export const useSync = create<{ progress: number | null; stage: string; name: string }>()(() => ({ progress: null, stage: "", name: "" }));

/** 5 ms a point for the rough search. */
const OUTLINE_SECONDS = 0.005;
const WINDOW_SECONDS = 1.5;
const REACH_SECONDS = 0.25;
const WINDOWS = 12;
/** A drift under this is the measure's own grain, not a clock: it is not spoken of (ppm). */
export const DRIFT_WORTH_SAYING_PPM = 8;

class Cancelled extends Error {}

let controller: AbortController | null = null;
export const cancelSync = () => controller?.abort();
let last: SyncResult | null = null;
/** The last result (the proofs read it). */
export const lastSync = () => last;

interface Picked extends SyncClip {
	element: TimelineElement & { trimStart: number; trimEnd: number };
	track: TimelineTrack;
	asset: MediaAsset;
	name: string;
}

/** The selected clips that have sound of their own file, at normal speed. */
export function syncable(editor: EditorCore, refs: readonly ElementRef[] = editor.selection.getSelectedElements()): { clips: Picked[]; skipped: string[] } {
	const scene = editor.scenes.getActiveSceneOrNull();
	const assets = new Map(editor.media.getAssets().map((a) => [a.id, a]));
	const clips: Picked[] = [];
	const skipped: string[] = [];
	if (!scene) return { clips, skipped };
	for (const { track, element } of editor.timeline.getElementsWithTracks({ elements: [...refs] })) {
		if (element.type !== "audio" && element.type !== "video") continue;
		const asset = "mediaId" in element ? assets.get(element.mediaId) : undefined;
		if (!asset?.file || (element.type === "video" && (asset.hasAudio === false || element.isSourceAudioEnabled === false))) continue;
		if (element.retime && (element.retime.rate !== 1 || element.retime.mode === "curve")) {
			skipped.push(element.name);
			continue;
		}
		clips.push({ trackId: track.id, elementId: element.id, type: element.type, main: track.id === scene.tracks.main.id, startTime: element.startTime, duration: element.duration, element, track, asset, name: element.name });
	}
	return { clips, skipped };
}

/**
 * Lines the selected clips up by their sound. One ⌘Z takes it back. Throws with a plain sentence when the selection
 * cannot be synced; resolves null when cancelled.
 */
export async function syncByWaveform(editor: EditorCore, refs?: readonly ElementRef[]): Promise<SyncResult | null> {
	controller?.abort();
	const mine = new AbortController();
	controller = mine;
	const signal = mine.signal;
	const say = (stage: string, name: string, progress: number) => useSync.setState({ stage, name, progress });
	const stop = () => {
		if (signal.aborted) throw new Cancelled();
	};
	const sounds = new Map<string, Promise<Sound | null>>();
	const outlines = new Map<string, Float32Array>();
	try {
		const { clips, skipped } = syncable(editor, refs);
		if (clips.length < 2) {
			throw new Error(skipped.length ? "Sync needs clips at normal speed: set the speed back to 1× first." : "Select the clips to sync: a camera's clip and the sound recorded apart, or several cameras.");
		}
		const picked = pickReference(clips);
		if ("error" in picked) throw new Error(picked.error);
		const reference = clips.find((c) => c.elementId === picked.elementId) as Picked;
		const others = clips.filter((c) => c !== reference);
		say("Listening", reference.name, 0);

		const open = (asset: MediaAsset) => {
			let sound = sounds.get(asset.id);
			if (!sound) {
				sound = openSound(asset.file);
				sounds.set(asset.id, sound);
			}
			return sound;
		};
		const files = [...new Map(clips.map((c) => [c.asset.id, c])).values()];
		const outlineOf = async (clip: Picked, index: number) => {
			const had = outlines.get(clip.asset.id);
			if (had) return had;
			const sound = await open(clip.asset);
			if (!sound) return null;
			const hop = Math.max(1, Math.round(sound.rate * OUTLINE_SECONDS));
			const energy = await sound.energy(hop, (share) => say("Listening", clip.name, (0.7 * (index + share)) / files.length), signal);
			stop();
			const made = outline(energy);
			outlines.set(clip.asset.id, made);
			return made;
		};
		for (let i = 0; i < files.length; i++) await outlineOf(files[i], i);

		const refSound = await open(reference.asset);
		const refOutline = outlines.get(reference.asset.id);
		if (!refSound || !refOutline) throw new Error(t("«{name}» has no sound to sync by.", { name: reference.name }));
		const refHop = Math.max(1, Math.round(refSound.rate * OUTLINE_SECONDS)) / refSound.rate;

		const done: SyncedClip[] = [];
		const failed: SyncResult["failed"] = [];
		const moves: Array<{ trackId: string; elementId: string; startTime: number; trimStart: number; duration: number }> = [];
		for (let i = 0; i < others.length; i++) {
			const clip = others[i];
			stop();
			say("Lining up", clip.name, 0.7 + (0.3 * i) / others.length);
			let lagSeconds = 0;
			let drift = 0;
			let used = 1;
			let of = 1;
			let turned = 0;
			let shared = Math.min(reference.duration, clip.duration) / TICKS_PER_SECOND;
			if (clip.asset.id !== reference.asset.id) {
				const sound = await open(clip.asset);
				const shape = outlines.get(clip.asset.id);
				if (!sound || !shape) {
					failed.push({ name: clip.name, why: "it has no sound" });
					continue;
				}
				const hop = Math.max(1, Math.round(sound.rate * OUTLINE_SECONDS)) / sound.rate;
				// outlines of files at different rates have points of slightly different length: the clip's is put on the reference's grid
				const rough = coarseLag(refOutline, Math.abs(hop - refHop) < 1e-9 ? shape : atRate(shape, 1 / hop, 1 / refHop), refHop);
				if (!rough || rough.score < MATCH_SCORE) {
					failed.push({ name: clip.name, why: "the same sound is not in both" });
					continue;
				}
				// the stretch both files have, in the reference file's time — where the two clips show it, when they do
				let from = Math.max(0, rough.lag);
				let to = Math.min(refSound.duration, rough.lag + sound.duration);
				const seenFrom = Math.max(reference.element.trimStart, clip.element.trimStart + rough.lag * TICKS_PER_SECOND) / TICKS_PER_SECOND;
				const seenTo = Math.min(reference.element.trimStart + reference.duration, clip.element.trimStart + clip.duration + rough.lag * TICKS_PER_SECOND) / TICKS_PER_SECOND;
				if (seenTo - seenFrom >= 3) {
					from = Math.max(from, seenFrom);
					to = Math.min(to, seenTo);
				}
				shared = to - from;
				const length = Math.min(WINDOW_SECONDS, Math.max(0.25, shared / 2));
				const count = Math.max(1, Math.min(WINDOWS, Math.floor(shared / (length * 1.2))));
				const points: Array<{ t: number; lag: number }> = [];
				of = count;
				for (let k = 0; k < count; k++) {
					stop();
					const t = from + ((k + 0.5) * shared) / count - length / 2;
					const rate = refSound.rate;
					const reach = Math.round(REACH_SECONDS * rate);
					// both windows are cut on whole samples of their own files; the lag is counted from those cuts
					const cutA = Math.round(t * rate);
					const cutB = Math.round((t - rough.lag) * sound.rate) - Math.round(REACH_SECONDS * sound.rate);
					const a = await refSound.samples(cutA, Math.round(length * rate));
					const b = atRate(await sound.samples(cutB, Math.round((length + 2 * REACH_SECONDS) * sound.rate)), sound.rate, rate);
					const fine = fineLag(a, b, reach);
					if (fine && fine.sharpness >= SHARP_ENOUGH) {
						points.push({ t: cutA / rate + length / 2, lag: cutA / rate - cutB / sound.rate - reach / rate + fine.samples / rate });
						turned += fine.inverted ? 1 : -1;
					}
				}
				const middle = from + shared / 2;
				const fit = fitDrift(points, middle);
				if (!fit || fit.used < Math.max(1, Math.ceil(count / 3))) {
					failed.push({ name: clip.name, why: "the same sound is not in both" });
					continue;
				}
				lagSeconds = fit.lag;
				drift = fit.drift;
				used = fit.used;
			}
			const lagTicks = Math.round(lagSeconds * TICKS_PER_SECOND);
			const placed = placeSynced(reference.element, clip.element, lagTicks);
			if (!placed) {
				failed.push({ name: clip.name, why: "its sound ends before the timeline begins" });
				continue;
			}
			moves.push({ trackId: clip.trackId, elementId: clip.elementId, ...placed });
			done.push({
				id: clip.elementId,
				name: clip.name,
				movedSeconds: (placed.startTime - clip.startTime) / TICKS_PER_SECOND,
				lagSeconds,
				lagSamples: lagSeconds * refSound.rate,
				driftPpm: drift * 1e6,
				apartMs: Math.abs(drift) * (shared / 2) * 1000,
				windows: used,
				of,
				inverted: turned > 0,
			});
		}
		stop();
		if (done.length === 0) throw new Error(failed.length === 1 ? t("Couldn't sync «{name}»: {why}.", { name: failed[0].name, why: t(failed[0].why) }) : "Couldn't sync these clips: the same sound is not in them.");

		// one step, on the timeline as it is now
		const now = editor.scenes.getActiveScene().tracks;
		const next = moveClips(now, moves, (type) => buildEmptyTrack({ id: generateUUID(), type }));
		const changed = moves.some((m) => {
			const before = clips.find((c) => c.elementId === m.elementId);
			return !before || before.startTime !== m.startTime || before.element.trimStart !== m.trimStart || before.duration !== m.duration;
		});
		if (changed) editor.command.execute({ command: new TracksSnapshotCommand({ before: now, after: next }) });
		last = { reference: { id: reference.elementId, name: reference.name, type: reference.type }, clips: done, failed, changed };
		return last;
	} catch (error) {
		if (error instanceof Cancelled || signal.aborted) return null;
		throw error;
	} finally {
		for (const sound of sounds.values()) void sound.then((s) => s?.dispose(), () => {});
		useSync.setState({ progress: null, stage: "", name: "" });
		if (controller === mine) controller = null;
	}
}
