// «Find scenes» on this Mac, free: reads the open timeline (its cuts, the loudness of its voices, its captions and, for
// clips without speech, the split-scenes detector) and proposes scene marks. Nothing changes until the proposals are
// accepted (applyChapterMarks: one ⌘Z).
import { create } from "zustand";
import { assistPost } from "@/assist/scenes";
import { runAssist } from "@/assist/run";
import { EditorCore } from "@/core";
import { t } from "@/i18n";
import { createTimelineAudioBuffer } from "@/media/audio";
import { uploadOnce } from "@/studio/client/api";
import { isCaptionElement } from "@/subtitles/apply-style";
import { frameLevels, speechIslands } from "@/transcribe/align";
import type { SceneTracks, TimelineElement } from "@/timeline/types";
import { TICKS_PER_SECOND } from "@/wasm";
import { minSceneFor, type Proposal, proposeMarks } from "./propose";

export interface FindState {
	/** What it is doing now, in words, and how far (0…1); null when idle. */
	running: { stage: string; progress?: number } | null;
	proposals: (Proposal & { on: boolean })[] | null;
	/** How the last search ended when it found nothing to show: nothing found, stopped, or failed (with why). */
	outcome: { kind: "none" | "stopped" | "error"; why?: string } | null;
	set: (patch: Partial<Omit<FindState, "set">>) => void;
}

export const useFindScenes = create<FindState>()((set) => ({ running: null, proposals: null, outcome: null, set: (patch) => set(patch) }));

const secs = (t: number) => t / TICKS_PER_SECOND;
const end = (e: TimelineElement) => e.startTime + e.duration;
const SAMPLE_RATE = 8000;
/** Longer films are not mixed to find pauses (the mix would not fit in memory): cuts, shots and captions only. */
const MAX_MIX_SECONDS = 90 * 60;

/** The voices only: no library music, and no long sound under much of the film (a music bed hides every pause). */
function voices(tracks: SceneTracks, total: number): SceneTracks {
	const music = (el: TimelineElement) => el.type === "audio" && (el.sourceType === "library" || el.duration > total * 0.5);
	return { ...tracks, overlay: [], audio: tracks.audio.map((t) => ({ ...t, elements: t.elements.filter((el) => !music(el)) })) };
}

const stripExt = (name: string) => name.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_-]+/g, " ").trim();

async function speechOf(editor: EditorCore, tracks: SceneTracks, total: number): Promise<{ start: number; end: number }[]> {
	if (secs(total) > MAX_MIX_SECONDS) return [];
	const buffer = await createTimelineAudioBuffer({ tracks: voices(tracks, total), mediaAssets: editor.media.getAssets(), duration: total, sampleRate: SAMPLE_RATE });
	if (!buffer) return [];
	const a = buffer.getChannelData(0);
	const b = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : a;
	const samples = new Int16Array(a.length);
	for (let i = 0; i < a.length; i++) samples[i] = Math.max(-32768, Math.min(32767, ((a[i] + b[i]) / 2) * 32767));
	return speechIslands(frameLevels(samples, buffer.sampleRate), { bridge: 0.6, minIsland: 0.15 });
}

export function findScenes(): Promise<void> {
	const editor = EditorCore.getInstance();
	const store = useFindScenes.getState();
	store.set({ proposals: null, outcome: null });
	return runAssist(t("Find scenes"), async (ctl) => {
		const stage = (text: string, progress?: number) => {
			ctl.stage(t(text), progress);
			useFindScenes.getState().set({ running: { stage: text, progress } });
		};
		try {
			const scene = editor.scenes.getActiveScene();
			const tracks = scene.tracks;
			const total = editor.timeline.getTotalDuration() as number;
			if (total <= 0) throw new Error("The timeline is empty. Add clips first.");
			const assets = new Map(editor.media.getAssets().map((a) => [a.id, a]));
			const main = [...tracks.main.elements].sort((x, y) => x.startTime - y.startTime);
			stage("Reading the cuts", 0.05);
			const nameOf = (e: TimelineElement) => {
				const asset = "mediaId" in e ? assets.get(e.mediaId) : undefined;
				return stripExt(asset?.name ?? e.name ?? "") || undefined;
			};
			const cuts = main.flatMap((e, i) => {
				const prev = main[i - 1];
				const media = "mediaId" in e ? e.mediaId : e.id;
				const prevMedia = prev && "mediaId" in prev ? prev.mediaId : prev?.id;
				if (i > 0 && media === prevMedia) return [];
				return [{ time: secs(i === 0 ? 0 : e.startTime), title: nameOf(e) }];
			});
			stage("Listening for pauses", 0.15);
			const speech = await speechOf(editor, tracks, total);
			if (ctl.signal.aborted) {
				useFindScenes.getState().set({ outcome: { kind: "stopped" } });
				return null;
			}
			const words = [...tracks.overlay, ...tracks.audio].flatMap((t) =>
				t.elements.filter(isCaptionElement).flatMap((c) => {
					const tokens = String(c.params.content ?? "").split(/\s+/).filter(Boolean);
					const step = c.duration / Math.max(1, tokens.length);
					return tokens.map((text, k) => ({ text, start: secs(c.startTime + k * step), end: secs(c.startTime + (k + 1) * step) }));
				}),
			);
			// Shot changes inside long clips that have little speech (footage, not talk).
			const shots: number[] = [];
			const minScene = minSceneFor(secs(total));
			const quiet = main.filter((e) => {
				if (e.type !== "video" || secs(e.duration) < 2 * minScene) return false;
				const talk = speech.reduce((sum, s) => sum + Math.max(0, Math.min(s.end, secs(end(e))) - Math.max(s.start, secs(e.startTime))), 0);
				return talk < 0.3 * secs(e.duration);
			});
			for (const [k, clip] of quiet.entries()) {
				const asset = "mediaId" in clip ? assets.get(clip.mediaId) : undefined;
				if (!asset?.file) continue;
				stage("Looking for shot changes", 0.3 + (0.6 * k) / quiet.length);
				try {
					const up = await uploadOnce(`media:${asset.id}`, asset.file);
					const rate = clip.type === "video" && clip.retime?.rate ? clip.retime.rate : 1;
					const r = await ctl.job<{ cuts: number[] }>(() =>
						assistPost("scenes", { fileId: up.fileId, start: secs(clip.trimStart), length: secs(clip.duration) * rate, sensitivity: 0.5 }),
					);
					for (const c of r.cuts) shots.push(secs(clip.startTime) + (c - secs(clip.trimStart)) / rate);
				} catch (error) {
					if ((error as Error)?.name === "AbortError") throw error;
					// One clip the detector cannot read does not stop the rest.
				}
			}
			stage("Choosing the scenes", 0.95);
			const proposals = proposeMarks({ total: secs(total), cuts, shots, speech, words });
			// A mark found by a pause or a turn of topic is put on the picture change next to it, when there is one within
			// 1.5 s: in a talking film the detector above never looks (it is for footage), the mark sat 0.4 s before the
			// new picture, and a scene moved by such a mark took 12 frames of its neighbour along (exam 11.11).
			for (const p of proposals.filter((x) => x.why === "pause" || x.why === "topic").slice(0, 40)) {
				const clip = main.find((e) => e.type === "video" && secs(e.startTime) <= p.time && secs(end(e)) >= p.time);
				const asset = clip && "mediaId" in clip ? assets.get(clip.mediaId) : undefined;
				if (!clip || !asset?.file || ctl.signal.aborted) continue;
				try {
					const rate = clip.type === "video" && clip.retime?.rate ? clip.retime.rate : 1;
					const at = secs(clip.trimStart) + (p.time - secs(clip.startTime)) * rate;
					const up = await uploadOnce(`media:${asset.id}`, asset.file);
					const r = await ctl.job<{ cuts: number[] }>(() => assistPost("scenes", { fileId: up.fileId, start: Math.max(0, at - 1.5), length: 3, sensitivity: 0.5 }));
					const near = r.cuts.map((c) => secs(clip.startTime) + (c - secs(clip.trimStart)) / rate).filter((t) => Math.abs(t - p.time) <= 1.5).sort((x, y) => Math.abs(x - p.time) - Math.abs(y - p.time))[0];
					if (near !== undefined && near > 0.5 && near < secs(total) - 0.5) p.time = near;
				} catch (error) {
					if ((error as Error)?.name === "AbortError") throw error;
				}
			}
			if (ctl.signal.aborted) {
				useFindScenes.getState().set({ outcome: { kind: "stopped" } });
				return null;
			}
			if (proposals.length < 2) useFindScenes.getState().set({ outcome: { kind: "none" } });
			else useFindScenes.getState().set({ proposals: proposals.map((p) => ({ ...p, on: true })) });
			return null;
		} catch (error) {
			const stopped = ctl.signal.aborted || (error as Error)?.name === "AbortError";
			useFindScenes.getState().set({ outcome: stopped ? { kind: "stopped" } : { kind: "error", why: (error as Error)?.message ?? String(error) } });
			throw error;
		} finally {
			useFindScenes.getState().set({ running: null });
		}
	});
}
