// Freeze frame (Speed): the frame under the playhead becomes a still that holds for a few seconds; the clip is cut
// there and its rest (and everything after it on the same track) moves right; on the main track every other track
// follows (its own extracted sound is cut and waits, titles over the moment stay). One ⌘Z puts everything back.
import { toast } from "sonner";
import { t } from "@/i18n";
import { Command, type CommandResult, createElementSelectionResult } from "@/commands/base-command";
import { SplitElementsCommand } from "@/commands/timeline/element/split-elements";
import { EditorCore } from "@/core";
import type { MediaAsset } from "@/media/types";
import { getSourceTimeAtClipTime } from "@/retime/resolve";
import { importToMedia } from "@/studio/client/editor-bridge";
import type { SceneTracks, TimelineElement, TimelineTrack, VideoElement } from "@/timeline";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { generateUUID } from "@/utils/id";
import { type MediaTime, mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";

export const FREEZE_SECONDS = 3;

const tracksNow = () => EditorCore.getInstance().scenes.getActiveScene().tracks;
const setTracks = (t: SceneTracks) => EditorCore.getInstance().timeline.updateTracks(t);
const sec = (t: number) => mediaTimeToSeconds({ time: t as MediaTime });

/** The picture of `file` at `seconds`, as a JPEG file (decoded by the browser, so any format the editor plays). */
async function grabFrame(file: File, seconds: number, name: string): Promise<File> {
	const url = URL.createObjectURL(file);
	try {
		const video = document.createElement("video");
		video.muted = true;
		video.preload = "auto";
		video.src = url;
		await new Promise<void>((resolve, reject) => {
			video.onloadeddata = () => resolve();
			video.onerror = () => reject(new Error("The clip's picture couldn't be read"));
		});
		await new Promise<void>((resolve) => {
			video.onseeked = () => resolve();
			video.currentTime = Math.max(0, Math.min(seconds, (video.duration || seconds) - 0.04));
		});
		const canvas = document.createElement("canvas");
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		canvas.getContext("2d")!.drawImage(video, 0, 0);
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
		if (!blob) throw new Error("The frame couldn't be saved");
		return new File([blob], name, { type: "image/jpeg" });
	} finally {
		URL.revokeObjectURL(url);
	}
}

class FreezeFrameCommand extends Command {
	private before: SceneTracks | null = null;
	private after: SceneTracks | null = null;
	private stillId = generateUUID();

	constructor(
		private readonly ref: { trackId: string; elementId: string },
		private readonly at: MediaTime,
		private readonly still: MediaAsset,
		private readonly hold: MediaTime,
	) {
		super();
	}

	execute(): CommandResult | undefined {
		this.before = tracksNow();
		const clip = findClip(this.before, this.ref.elementId);
		if (!clip) return undefined;
		const at = this.at as number;
		const inside = at > (clip.startTime as number) && at < (clip.startTime as number) + (clip.duration as number);
		if (inside) new SplitElementsCommand({ elements: [this.ref], splitTime: this.at }).execute();
		const hold = this.hold as number;
		// On the main track the whole edit after the freeze moves with it (sound, captions, titles stay in sync).
		const onMain = this.ref.trackId === this.before.main.id;
		const spans = (e: TimelineElement) => (e.startTime as number) < at && (e.startTime as number) + (e.duration as number) > at;
		if (onMain) {
			// The clip's own sound pulled onto another track is cut there too: it pauses with the picture.
			const t0 = tracksNow();
			const linked = [...t0.overlay, ...t0.audio].flatMap((track) =>
				(track.elements as TimelineElement[])
					.filter((e) => e.type === "audio" && "mediaId" in e && e.mediaId === clip.mediaId && spans(e))
					.map((e) => ({ trackId: track.id, elementId: e.id })),
			);
			if (linked.length) new SplitElementsCommand({ elements: linked, splitTime: this.at }).execute();
		}
		const ripple = (track: TimelineTrack): TimelineTrack => {
			if (!onMain || track.id === this.ref.trackId) return track;
			const elements = (track.elements as TimelineElement[]).map((e) => {
				// As CapCut: what starts after the freeze moves on by it; a layer over the frozen moment keeps its length
				// (it was stretched by the hold — a 3 s title became 6 s; final check 04.11 №5).
				if ((e.startTime as number) >= at) return { ...e, startTime: ((e.startTime as number) + hold) as MediaTime };
				return e;
			});
			return { ...track, elements } as TimelineTrack;
		};
		const shift = (track: TimelineTrack): TimelineTrack => {
			if (track.id !== this.ref.trackId) return track;
			const moved = (track.elements as TimelineElement[]).map((e) =>
				(e.startTime as number) >= at ? { ...e, startTime: ((e.startTime as number) + hold) as MediaTime } : e,
			);
			const base = buildElementFromMedia({
				mediaId: this.still.id,
				mediaType: "image",
				name: this.still.name,
				duration: this.hold,
				startTime: this.at,
			});
			// The still looks like the clip: same placement, effects and masks.
			const { volume: _v, muted: _m, ...visual } = (clip.params ?? {}) as Record<string, unknown>;
			const still = {
				...base,
				id: this.stillId,
				params: { ...(base.params ?? {}), ...visual },
				...(clip.effects ? { effects: clip.effects } : {}),
				...(clip.masks ? { masks: clip.masks } : {}),
			} as TimelineElement;
			const elements = [...moved, still].sort((a, b) => (a.startTime as number) - (b.startTime as number));
			return { ...track, elements } as TimelineTrack;
		};
		const t = tracksNow();
		setTracks({
			...t,
			main: shift(t.main) as SceneTracks["main"],
			overlay: t.overlay.map((track) => ripple(shift(track))) as SceneTracks["overlay"],
			audio: t.audio.map(ripple) as SceneTracks["audio"],
		});
		this.after = tracksNow();
		return createElementSelectionResult([{ trackId: this.ref.trackId, elementId: this.stillId }]);
	}

	undo(): void {
		if (this.before) setTracks(this.before);
	}

	redo(): CommandResult | undefined {
		if (!this.after) return this.execute();
		setTracks(this.after);
		return createElementSelectionResult([{ trackId: this.ref.trackId, elementId: this.stillId }]);
	}
}

function findClip(tracks: SceneTracks, elementId: string): VideoElement | null {
	for (const track of [tracks.main, ...tracks.overlay]) {
		const e = (track.elements as TimelineElement[]).find((x) => x.id === elementId);
		if (e?.type === "video") return e;
	}
	return null;
}

/** The video clip to freeze: the given one, else the selected one, else the one under the playhead (top first). */
export function freezeTarget(ref?: { trackId: string; elementId: string }): { trackId: string; elementId: string } | null {
	const editor = EditorCore.getInstance();
	const tracks = tracksNow();
	if (ref) return ref;
	const isVideo = (r: { trackId: string; elementId: string }) => !!findClip(tracks, r.elementId);
	const selected = editor.selection.getSelectedElements().find(isVideo);
	if (selected) return selected;
	const now = editor.playback.getCurrentTime() as number;
	for (const track of [...tracks.overlay, tracks.main]) {
		const e = (track.elements as TimelineElement[]).find(
			(x) => x.type === "video" && now >= (x.startTime as number) && now < (x.startTime as number) + (x.duration as number),
		);
		if (e) return { trackId: track.id, elementId: e.id };
	}
	return null;
}

export async function freezeFrame(ref?: { trackId: string; elementId: string }): Promise<boolean> {
	const editor = EditorCore.getInstance();
	const target = freezeTarget(ref);
	const clip = target ? findClip(tracksNow(), target.elementId) : null;
	if (!target || !clip) {
		toast("Select a video clip to freeze");
		return false;
	}
	const asset = editor.media.getAssets().find((a) => a.id === clip.mediaId);
	if (!asset?.file) {
		toast("This clip's file isn't available");
		return false;
	}
	const start = clip.startTime as number;
	const end = start + (clip.duration as number);
	const now = editor.playback.getCurrentTime() as number;
	// Off the clip: freeze its first frame.
	const at = (now > start && now < end ? now : start) as MediaTime;
	const clipTime = sec(at - start);
	const sourceSeconds = sec(clip.trimStart as number) + getSourceTimeAtClipTime({ clipTime, retime: clip.retime, duration: sec(clip.duration as number) });
	try {
		const file = await grabFrame(asset.file, sourceSeconds, `${asset.name.replace(/\.[^.]+$/, "")} · freeze.jpg`);
		const still = await importToMedia(editor, file, undefined, "result");
		editor.command.execute({ command: new FreezeFrameCommand(target, at, still, mediaTimeFromSeconds({ seconds: FREEZE_SECONDS })) });
		return true;
	} catch (error) {
		toast.error(t("Freeze frame: {error}", { error: (error as Error).message }));
		return false;
	}
}
