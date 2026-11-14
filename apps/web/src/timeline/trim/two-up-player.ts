// Draws the two frames of a trim (two-up.ts) into the two panes over the player, at the speed of the hand: each pane
// has its own small decoder set (a roll between two pieces of one file needs that file at two places at once), frames
// are decoded no larger than the pane, and a request the hand has already passed is dropped. The player's own
// decoders and the compositor are not touched.
import type { FrameRate } from "opencut-wasm";
import type { EditorCore } from "@/core";
import { formatFrameTimecode } from "@/fps/timecode";
import { VideoCache } from "@/services/video-cache/service";
import { useTrimUi } from "./store";
import type { TwoUpFrame, TwoUpView } from "./two-up";

/** The panes' decoders are closed this long after the last trim (a second trim right after reuses them). */
const KEEP_MS = 4000;

type Source = { file: File; url?: string; type: string };
type Pane = 0 | 1;
/** Who shows the two frames: a trim in the hand (the model's or the old edge trim), or the edge picked for the keys. */
export type TwoUpOwner = "drag" | "edge" | "picked";

class TwoUpPlayer {
	private caches: [VideoCache, VideoCache] | null = null;
	private canvases: [HTMLCanvasElement | null, HTMLCanvasElement | null] = [null, null];
	/** The frame each pane should show (`kind|media|ticks`), and what it shows. */
	private wanted: [string | null, string | null] = [null, null];
	private frames: [TwoUpFrame | null, TwoUpFrame | null] = [null, null];
	private sources = new Map<string, Source>();
	private images = new Map<string, HTMLImageElement>();
	private closing: ReturnType<typeof setTimeout> | null = null;
	private active = false;
	private owner: TwoUpOwner | null = null;

	/** A trim starts (or an edge is picked): the files of the project's media, the panes' decoders kept or opened. The latest to begin owns the panes. */
	begin(editor: EditorCore, owner: TwoUpOwner): void {
		this.owner = owner;
		this.active = true;
		if (this.closing) clearTimeout(this.closing);
		this.closing = null;
		this.sources.clear();
		for (const asset of editor.media.getAssets()) {
			if (asset.file) this.sources.set(asset.id, { file: asset.file, url: asset.url, type: asset.type });
		}
	}

	/** Opens the decoders on the frames a trim starts from, before the panes show (the press, not yet a drag). */
	warm(owner: TwoUpOwner, view: TwoUpView | null): void {
		if (!this.active || this.owner !== owner || !view) return;
		const caches = this.cachesNow();
		for (const [index, frame] of [view.left, view.right].entries()) {
			const source = frame?.kind === "video" && frame.mediaId ? this.sources.get(frame.mediaId) : undefined;
			if (frame?.mediaId && source) caches[index as Pane].preroll({ mediaId: frame.mediaId, file: source.file, time: frame.sourceSeconds });
		}
	}

	/** The two frames to show now (null: nothing to show — the panes go). */
	show(owner: TwoUpOwner, view: TwoUpView | null, fps: FrameRate): void {
		if (!this.active || this.owner !== owner) return;
		const info = (frame: TwoUpFrame | null, label: string) =>
			frame ? { label, name: frame.name, kind: frame.kind, timecode: frame.kind === "video" ? formatFrameTimecode({ time: frame.sourceTicks, fps }) : "" } : null;
		useTrimUi.getState().setTwoUp(view ? { left: info(view.left, view.leftLabel), right: info(view.right, view.rightLabel) } : null);
		this.frames = [view?.left ?? null, view?.right ?? null];
		this.request(0);
		this.request(1);
	}

	/** The trim is over (or the edge let go of). Another owner's panes are left alone. */
	end(owner: TwoUpOwner): void {
		if (!this.active || this.owner !== owner) return;
		this.active = false;
		this.owner = null;
		this.wanted = [null, null];
		this.frames = [null, null];
		useTrimUi.getState().setTwoUp(null);
		if (this.closing) clearTimeout(this.closing);
		this.closing = setTimeout(() => {
			this.closing = null;
			for (const cache of this.caches ?? []) cache.clearAll();
			this.caches = null;
			this.images.clear();
			this.sources.clear();
		}, KEEP_MS);
	}

	/** A pane's canvas came or went (the view mounts after the first frames are asked for: they are asked again). */
	setCanvas(index: Pane, canvas: HTMLCanvasElement | null): void {
		this.canvases[index] = canvas;
		if (!canvas) return;
		const caches = this.cachesNow();
		caches[index].setMaxDecodeSize({ width: canvas.width, height: canvas.height });
		this.wanted[index] = null;
		this.request(index);
	}

	private cachesNow(): [VideoCache, VideoCache] {
		this.caches ??= [new VideoCache(), new VideoCache()];
		return this.caches;
	}

	private request(index: Pane): void {
		const frame = this.frames[index];
		const key = frame && frame.kind !== "none" && frame.mediaId ? `${frame.kind}|${frame.mediaId}|${frame.sourceTicks}` : null;
		if (this.wanted[index] === key) return;
		this.wanted[index] = key;
		const source = frame?.mediaId ? this.sources.get(frame.mediaId) : undefined;
		if (!key || !frame || !frame.mediaId || !source) {
			this.draw(index, null, 0, 0, "");
			return;
		}
		const mediaId = frame.mediaId;
		if (frame.kind === "image") {
			let image = this.images.get(mediaId);
			if (!image && source.url) {
				image = new Image();
				image.src = source.url;
				this.images.set(mediaId, image);
			}
			if (!image) return;
			const paint = () => {
				if (this.wanted[index] === key && image) this.draw(index, image, image.naturalWidth, image.naturalHeight, key);
			};
			if (image.complete) paint();
			else image.addEventListener("load", paint, { once: true });
			return;
		}
		this.cachesNow()
			[index].getFrameAt({ mediaId, file: source.file, time: frame.sourceSeconds })
			.then((decoded) => {
				// A request the hand has passed comes back with the decoder's latest frame: drawn all the same while the
				// pane still shows that file — the picture follows the hand instead of waiting for it to stop.
				const now = this.frames[index];
				if (!decoded || !this.active || now?.kind !== "video" || now.mediaId !== mediaId) return;
				this.draw(index, decoded.canvas, decoded.canvas.width, decoded.canvas.height, this.wanted[index] === key ? key : `${key}~`);
			})
			.catch(() => {});
	}

	/** The picture fitted into the pane on black (null: the pane emptied). */
	private draw(index: Pane, picture: CanvasImageSource | null, width: number, height: number, key: string): void {
		const canvas = this.canvases[index];
		const context = canvas?.getContext("2d");
		if (!canvas || !context) return;
		context.fillStyle = "#000";
		context.fillRect(0, 0, canvas.width, canvas.height);
		if (picture && width > 0 && height > 0) {
			const scale = Math.min(canvas.width / width, canvas.height / height);
			const w = width * scale;
			const h = height * scale;
			context.drawImage(picture, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
		}
		// what the pane shows, for the tests (`kind|media|ticks`; «~» at the end: a frame on the way to the one asked)
		canvas.dataset.twoUpShows = key;
		const stats = (window as { __twoUpStats?: { draws: number } }).__twoUpStats;
		if (stats) stats.draws++;
	}
}

export const twoUpPlayer = new TwoUpPlayer();
