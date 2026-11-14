// Export → «Export still frame» (CapCut): the frame under the playhead as a PNG at the export resolution, drawn by
// its own renderer and decoders (the preview's are only as sharp as the panel).
import type { EditorCore } from "@/core";
import { CanvasRenderer } from "@/services/renderer/canvas-renderer";
import { VideoCache } from "@/services/video-cache/service";
import { TICKS_PER_SECOND } from "@/wasm";

export async function renderStillFrame(
	editor: EditorCore,
	size?: { width: number; height: number },
	/** Media ticks; the playhead when not given. */
	at?: number,
): Promise<{ blob: Blob; seconds: number }> {
	const tree = editor.renderer.getRenderTree();
	const project = editor.project.getActiveOrNull();
	if (!tree || !project || editor.timeline.getTotalDuration() === 0) throw new Error("Add a clip to the timeline first.");
	const { canvasSize, fps } = project.settings;
	const time = Math.min(at ?? editor.playback.getCurrentTime(), editor.timeline.getLastFrameTime());
	const renderer = new CanvasRenderer({ width: canvasSize.width, height: canvasSize.height, fps, videoCache: new VideoCache() });
	const canvas = document.createElement("canvas");
	canvas.width = size?.width ?? canvasSize.width;
	canvas.height = size?.height ?? canvasSize.height;
	try {
		await renderer.renderToCanvas({ node: tree, time, targetCanvas: canvas });
	} finally {
		renderer.videoCache.clearAll();
	}
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
	if (!blob) throw new Error("Couldn't make the picture.");
	return { blob, seconds: time / TICKS_PER_SECOND };
}

export type StillFramePainter = ReturnType<typeof stillFramePainter>;

/**
 * Frames drawn straight onto a picker's own canvases (the cover's filmstrip, the frame under its handle): one renderer
 * and one set of decoders for all of them, the video decoded only as sharp as `width` needs, and no PNG — a PNG made
 * only to be shown cost the cover picker's open 60–80 ms of main thread (toBlob waits for the GPU's pixels, 03.11).
 */
export function stillFramePainter(editor: EditorCore, { width }: { width: number }) {
	const project = editor.project.getActiveOrNull();
	const canvasSize = project?.settings.canvasSize;
	const renderer =
		project && canvasSize
			? new CanvasRenderer({ width: canvasSize.width, height: canvasSize.height, fps: project.settings.fps, videoCache: new VideoCache(), capDecodeSize: true })
			: null;
	if (renderer && canvasSize) renderer.setDecodeScale(width / canvasSize.width);
	let last: Promise<void> = Promise.resolve();
	return {
		/** Draws the frame at `at` (media ticks) over all of `canvas`, one frame after the other. */
		paint(canvas: HTMLCanvasElement, at: number): Promise<void> {
			const next = last.then(async () => {
				const tree = editor.renderer.getRenderTree();
				if (!renderer || !tree || editor.timeline.getTotalDuration() === 0) return;
				await renderer.renderToCanvas({ node: tree, time: Math.min(at, editor.timeline.getLastFrameTime()), targetCanvas: canvas });
			});
			last = next.catch(() => {});
			return next;
		},
		dispose: () => renderer?.videoCache.clearAll(),
	};
}
