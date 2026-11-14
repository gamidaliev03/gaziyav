// Auto Color (Kadr: Assist.autoColor): look at a few frames of the clip and set the clip's Color effect —
// exposure from the median brightness, contrast from the 1–99 % range, white balance (temperature/tint) from the
// mid-tones' cast, a little vibrance for flat footage. Only those five sliders change; the result stays fully
// editable in Effects → Color, and the same effect renders in the preview and in the export. One ⌘Z.
import { revealClipColor } from "@/components/editor/panels/properties/reveal";
import { EditorCore } from "@/core";
import type { ParamValues } from "@/params";
import { autoColorParams, colorStats } from "./color-math";
import { SetColorParamsCommand } from "./commands";
import { runAssist, throwIfAborted } from "./run";
import { type ClipRef, isPictureClip, pickClip, type ResolvedClip, selectedClips } from "./target";

const SIZE = 64;

/** RGBA of a few frames of the clip's piece (20 %, 50 %, 80 %), each scaled to 64×64. */
async function sampleFrames(clip: ResolvedClip, signal: AbortSignal): Promise<Uint8ClampedArray> {
	const file = clip.asset!.file;
	const canvas = new OffscreenCanvas(SIZE, SIZE);
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw new Error("Couldn't read the picture of the clip.");
	if (clip.element.type === "image") {
		const bitmap = await createImageBitmap(file);
		ctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
		bitmap.close();
		return ctx.getImageData(0, 0, SIZE, SIZE).data;
	}
	const { ALL_FORMATS, CanvasSink, Input } = await import("mediabunny");
	const { fileSource } = await import("@/media/file-source");
	const input = new Input({ source: fileSource(file), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error("This clip has no picture to balance.");
		if (!(await track.canDecode())) throw new Error("This video's format can't be decoded for Auto color.");
		const sink = new CanvasSink(track, { width: SIZE, height: SIZE, fit: "fill" });
		const first = await track.getFirstTimestamp();
		const out = new Uint8ClampedArray(SIZE * SIZE * 4 * 3);
		let n = 0;
		for (const q of [0.2, 0.5, 0.8]) {
			throwIfAborted(signal);
			const t = first + clip.sourceStart + clip.sourceLength * q;
			const frame = await sink.getCanvas(t);
			if (!frame) continue;
			ctx.clearRect(0, 0, SIZE, SIZE);
			ctx.drawImage(frame.canvas as CanvasImageSource, 0, 0, SIZE, SIZE);
			out.set(ctx.getImageData(0, 0, SIZE, SIZE).data, n * SIZE * SIZE * 4);
			n++;
		}
		if (!n) throw new Error("Couldn't read frames of this clip.");
		return out.subarray(0, n * SIZE * SIZE * 4);
	} finally {
		input.dispose?.();
	}
}

/** Auto colour for the right-clicked clip, or for every selected video/image clip. */
export function autoColor(ref?: ClipRef) {
	const editor = EditorCore.getInstance();
	const clips = ref ? [pickClip(editor, ref, isPictureClip)].filter((c): c is ResolvedClip => !!c) : selectedClips(editor).filter(isPictureClip);
	return runAssist("Auto color", async (ctl) => {
		if (!clips.length) throw new Error("Select a video or image clip on the timeline first.");
		const changes: Array<ClipRef & { params: ParamValues }> = [];
		for (const [i, clip] of clips.entries()) {
			ctl.stage(clips.length > 1 ? `Balancing colour ${i + 1} of ${clips.length}` : "Balancing colour", i / clips.length);
			const params = autoColorParams(colorStats(await sampleFrames(clip, ctl.signal)));
			changes.push({ trackId: clip.trackId, elementId: clip.element.id, params });
		}
		throwIfAborted(ctl.signal);
		editor.command.execute({ command: new SetColorParamsCommand(changes) });
		const after = editor.scenes.getActiveScene().tracks;
		// the result where it is edited: the clip's Adjust tab, its changed Color groups open
		revealClipColor(changes[0]);
		const p = changes[0].params;
		const sign = (v: unknown, unit = "") => `${Number(v) > 0 ? "+" : ""}${v}${unit}`;
		return {
			message:
				changes.length === 1
					? `Auto color: exposure ${sign(p.exposure)}, contrast ${sign(p.contrast)}, temperature ${sign(p.temperature)}, tint ${sign(p.tint)} — fine-tune in Adjust → Color`
					: `Auto color applied to ${changes.length} clips — fine-tune in Adjust → Color`,
			undo: () => {
				if (editor.scenes.getActiveScene().tracks === after) editor.command.undo();
			},
		};
	});
}
