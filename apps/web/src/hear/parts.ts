// «Split into parts» / «Разложить по партиям»: a song's four stems (the score's separation, hear/score-server.ts) as
// labelled tracks right under it — «· vocals», «· drums», «· bass», «· other» — in sync with it (the same start, trims
// and speed), muted so the mix doesn't double; «Solo» on a part hears it alone, «Full mix» brings the song back. Each
// is one ⌘Z. The two-way «Separate voice and music» (neural/apply.ts) is untouched.
import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import { t as tr } from "@/i18n";
import { jobCenter } from "@/jobs/store";
import { processMediaAssets } from "@/media/processing";
import type { MediaAsset } from "@/media/types";
import type { AudioTrack, SceneTracks, TimelineElement, TimelineTrack } from "@/timeline";
import { buildEmptyTrack } from "@/timeline/placement";
import { generateUUID } from "@/utils/id";
import { findSounding, type Sounding } from "./client";
import { cancelScore, songScore, stemFile } from "./score-client";
import { PARTS, type PartName } from "./score-types";

const editor = () => EditorCore.getInstance();
export const PART_EFFECT = "ai.parts";
export const partTrackName = (p: PartName) => `· ${p}`;

/** The part a timeline clip is (a «Split into parts» stem), or null. */
export function partOf(element: TimelineElement): { part: PartName; songId: string } | null {
	const mediaId = (element as { mediaId?: string }).mediaId;
	const asset = mediaId ? editor().media.getAssets().find((a) => a.id === mediaId) : undefined;
	const n = asset?.neural;
	if (n?.effect !== PART_EFFECT) return null;
	return { part: n.params.part as PartName, songId: n.originalId };
}

/** Clips that can be split: a song with sound (an imported audio or video clip, or a library track), not a part. */
export function canSplit(element: TimelineElement): boolean {
	if (element.type !== "audio" && element.type !== "video") return false;
	if (partOf(element)) return false;
	return !!findSounding(element.id);
}

/** The four part clips under the song, in one command (⌘Z removes them and their tracks). */
export class SplitPartsCommand extends Command {
	private before: SceneTracks | null = null;
	private after: SceneTracks | null = null;
	constructor(
		private readonly songTrackId: string,
		private readonly song: TimelineElement,
		private readonly media: Record<PartName, MediaAsset>,
		private readonly baseName: string,
	) {
		super();
	}
	execute(): CommandResult | undefined {
		const ed = editor();
		this.before = ed.scenes.getActiveScene().tracks;
		const t = this.before;
		const song = this.song as TimelineElement & { trimStart: number; trimEnd: number; retime?: unknown; sourceDuration?: number };
		const tracks: AudioTrack[] = PARTS.map((p) => {
			const track = buildEmptyTrack({ id: generateUUID(), type: "audio", name: partTrackName(p) }) as AudioTrack;
			const el = {
				id: generateUUID(),
				type: "audio",
				sourceType: "upload",
				mediaId: this.media[p].id,
				name: `${this.baseName} · ${p}`,
				startTime: song.startTime,
				duration: song.duration,
				trimStart: song.trimStart,
				trimEnd: song.trimEnd,
				...(song.sourceDuration != null ? { sourceDuration: song.sourceDuration } : {}),
				...(song.retime ? { retime: song.retime } : {}),
				params: {},
			} as unknown as AudioTrack["elements"][number];
			return { ...track, muted: true, elements: [el] };
		});
		// right under the song: after its audio track, or at the top of the audio tracks for a video / main clip
		const at = t.audio.findIndex((x) => x.id === this.songTrackId);
		const audio = [...t.audio];
		audio.splice(at >= 0 ? at + 1 : 0, 0, ...tracks);
		this.after = { ...t, audio };
		ed.timeline.updateTracks(this.after);
		return undefined;
	}
	undo(): void {
		if (this.before) editor().timeline.updateTracks(this.before);
	}
	redo(): CommandResult | undefined {
		if (!this.after) return this.execute();
		editor().timeline.updateTracks(this.after);
		return undefined;
	}
}

/** Mute / unmute tracks and clips in one step (Solo, Full mix). */
class MuteCommand extends Command {
	private before: SceneTracks | null = null;
	constructor(private readonly change: (tracks: SceneTracks) => SceneTracks) {
		super();
	}
	execute(): CommandResult | undefined {
		this.before = editor().scenes.getActiveScene().tracks;
		editor().timeline.updateTracks(this.change(this.before));
		return undefined;
	}
	undo(): void {
		if (this.before) editor().timeline.updateTracks(this.before);
	}
}

const allTracks = (t: SceneTracks): TimelineTrack[] => [...t.overlay, t.main, ...t.audio] as TimelineTrack[];

/** The part tracks of a song (by its media) on the timeline now. */
export function partTracks(songMediaId: string, t = editor().scenes.getActiveScene().tracks): Array<{ track: AudioTrack; part: PartName }> {
	const assets = editor().media.getAssets();
	return t.audio.flatMap((track) => {
		const el = track.elements[0] as { mediaId?: string } | undefined;
		const a = el?.mediaId ? assets.find((x) => x.id === el.mediaId) : undefined;
		return a?.neural?.effect === PART_EFFECT && a.neural.originalId === songMediaId ? [{ track, part: a.neural.params.part as PartName }] : [];
	});
}

/** The song clip(s) whose media the parts came from. */
function songClips(t: SceneTracks, songMediaId: string) {
	return allTracks(t).flatMap((track) => (track.elements as TimelineElement[]).filter((e) => (e as { mediaId?: string }).mediaId === songMediaId).map((e) => ({ track, e })));
}

/** Hear one part alone: its track on, the other parts and the song off. `part` null = the full mix again. */
export function soloPart(songMediaId: string, part: PartName | null): string {
	const parts = partTracks(songMediaId);
	if (!parts.length) throw new Error("This song has no parts on the timeline: Split into parts first.");
	editor().command.execute({
		command: new MuteCommand((t) => {
			const songs = new Set(songClips(t, songMediaId).map((x) => x.e.id));
			const ids = new Map(parts.map((p) => [p.track.id, p.part]));
			const mute = (track: TimelineTrack): TimelineTrack => {
				const p = ids.get(track.id);
				if (p) return { ...track, muted: part ? p !== part : true } as TimelineTrack;
				const els = (track.elements as TimelineElement[]).map((e) => (songs.has(e.id) ? ({ ...e, params: { ...(e.params ?? {}), muted: part ? true : undefined } } as TimelineElement) : e));
				return { ...track, elements: els } as TimelineTrack;
			};
			return { overlay: t.overlay.map(mute), main: mute(t.main), audio: t.audio.map(mute) } as SceneTracks;
		}),
	});
	return part ? `Solo: only «· ${part}» is heard (the song and the other parts are muted). ⌘Z or «Full mix» brings the song back.` : "The full mix again: the song is heard, its parts are muted.";
}

const running = new Map<string, Promise<string>>();

/**
 * Split the clip into its four parts: the score's separation (made once per song, on this Mac), the stems added to
 * Media, four muted tracks under the song. Progress in the job list (cancellable); resolves with a line of what was made.
 */
export function splitIntoParts(trackId: string, elementId: string): Promise<string> {
	const hit = running.get(elementId);
	if (hit) return hit;
	const p = doSplit(trackId, elementId).finally(() => running.delete(elementId));
	running.set(elementId, p);
	return p;
}

async function doSplit(trackId: string, elementId: string): Promise<string> {
	const ed = editor();
	const projectId = ed.project.getActiveOrNull()?.metadata.id;
	if (!projectId) throw new Error("No project is open.");
	const s: Sounding | null = findSounding(elementId);
	if (!s) throw new Error("This clip has no sound to split.");
	const songMediaId = (s.element as { mediaId?: string }).mediaId ?? `library:${(s.element as { sourceUrl?: string }).sourceUrl ?? ""}`;
	const already = partTracks(songMediaId);
	if (already.length === PARTS.length) return `«${s.name}» is already split: ${already.map((x) => `«${x.track.name}»`).join(", ")} are under it.`;
	let serverJob = "";
	const controller = new AbortController();
	const jobId = jobCenter.start({
		kind: "other",
		title: tr("Split into parts"),
		stage: tr("Separating the parts · on this Mac, free"),
		progress: 0,
		tab: "media",
		// craft B: the song's clip lights up left → right as it is heard (jobs/components/clip-progress.tsx)
		place: { elements: [elementId] },
		cancel: () => {
			controller.abort();
			if (serverJob) cancelScore(serverJob);
		},
	});
	try {
		const r = await songScore(s, {
			signal: controller.signal,
			onProgress: (progress, stage, id) => {
				serverJob = id;
				jobCenter.update(jobId, { progress: progress * 0.9, stage: tr(stage) });
			},
		});
		if (r.state !== "done") throw new Error(r.state === "failed" ? r.error : "The separation is still running.");
		jobCenter.update(jobId, { progress: 0.92, stage: tr("Adding the parts") });
		const base = s.name.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/ · (voice|music)$/i, "");
		const media = {} as Record<PartName, MediaAsset>;
		for (const p of PARTS) {
			const key = `parts-${r.key}-${p}`;
			let asset = ed.media.getAssets().find((a) => a.neural?.key === key && a.file);
			if (!asset) {
				const file = await stemFile(r.key, p, `${base} · ${p}.m4a`);
				if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
				const [processed] = await processMediaAssets({ files: [file] });
				if (!processed) throw new Error("The editor couldn't read a part's sound.");
				const added = await ed.media.addMediaAsset({
					projectId,
					asset: { ...processed, origin: "result" as const, neural: { effect: PART_EFFECT, key, label: p, params: { part: p }, sourceId: songMediaId, originalId: songMediaId, offset: 0 } },
				});
				if (!added) throw new Error("Not enough storage space for the parts — free some disk space and retry.");
				asset = added;
			}
			media[p] = asset;
		}
		const now = ed.timeline.getElementsWithTracks({ elements: [{ trackId, elementId }] })[0]?.element ?? s.element;
		ed.command.execute({ command: new SplitPartsCommand(trackId, now, media, base) });
		const line = `«${s.name}» split into parts: ${PARTS.map((p) => `«${partTrackName(p)}»`).join(", ")} under it, muted (Solo on a part to hear it alone). ${r.score.tempo.length ? `${r.score.tempo.map((x) => `${x.bpm} BPM`).join(" → ")}, ` : ""}${r.score.bars.length} bars.`;
		jobCenter.finish(jobId, tr("Split into parts: four tracks under the song"));
		return line;
	} catch (error) {
		if (controller.signal.aborted || (error as Error)?.name === "AbortError") {
			jobCenter.cancelled(jobId);
			throw new Error("Cancelled.");
		}
		jobCenter.fail(jobId, error instanceof Error ? error.message : "Split into parts failed");
		jobCenter.update(jobId, { retry: () => void splitIntoParts(trackId, elementId).catch(() => {}) });
		throw error;
	}
}
