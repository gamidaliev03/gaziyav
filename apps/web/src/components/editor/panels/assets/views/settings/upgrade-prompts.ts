// After the project's frame rate or resolution goes above the clips', offer to fill the gap with AI:
// optical flow for more frames, Enhance + Upscale for more pixels. One toast, Accept or ignore.
import { toast } from "sonner";
import { EditorCore } from "@/core";
import { renderSmooth } from "@/motion/client";
import { applyToClip } from "@/neural/apply";
import type { RetimeConfig, VideoElement } from "@/timeline";

function videoClips() {
	const editor = EditorCore.getInstance();
	const tracks = editor.scenes.getActiveScene().tracks;
	const all = [tracks.main, ...tracks.overlay];
	const assets = editor.media.getAssets();
	return all.flatMap((track) =>
		track.elements
			.filter((e): e is VideoElement => e.type === "video")
			.map((element) => ({ trackId: track.id, element, asset: assets.find((a) => a.id === element.mediaId) })),
	);
}

export function offerSmoothForFps(fps: number) {
	const slow = videoClips().filter(({ asset }) => asset?.fps && asset.fps > 0 && asset.fps < fps - 0.5);
	if (!slow.length) return;
	const src = Math.round(Math.min(...slow.map(({ asset }) => asset!.fps!)));
	toast(`Your clips are ${src} fps`, {
		description: `Make the motion smooth at ${Math.round(fps)} fps with optical flow?`,
		duration: 12000,
		action: {
			label: "Smooth",
			onClick: async () => {
				const editor = EditorCore.getInstance();
				for (const { trackId, element, asset } of slow) {
					const retime: RetimeConfig = {
						...(element.retime ?? { rate: 1, maintainPitch: true }),
						smooth: true,
						fpsBoost: fps / asset!.fps!,
					};
					editor.timeline.updateElementRetime({ trackId, elementId: element.id, retime });
				}
				for (const { element } of slow) await renderSmooth(element.id);
			},
		},
	});
}

export function offerEnhanceForSize(size: { width: number; height: number }) {
	const short = Math.min(size.width, size.height);
	const small = videoClips().filter(({ asset }) => asset?.width && asset.height && Math.min(asset.width, asset.height) * 1.15 < short);
	if (!small.length) return;
	const src = Math.min(...small.map(({ asset }) => Math.min(asset!.width!, asset!.height!)));
	toast(`Your clips are ${src}p`, {
		description: `Sharpen them up to ${short}p with Upscale?`,
		duration: 12000,
		action: {
			label: "Upscale",
			onClick: () => {
				for (const { trackId, element, asset } of small) {
					const ratio = short / Math.min(asset!.width!, asset!.height!);
					applyToClip(trackId, element.id, "upscale", { scale: ratio > 2.2 ? "4" : "2" });
				}
			},
		},
	});
}
