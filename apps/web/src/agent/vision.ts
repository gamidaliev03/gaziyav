// Gaziyav AI's eyes: what the user sees, as pictures for the model. Frames of the preview at chosen moments (the
// playhead moves there as if the agent scrubbed, then comes back), a strip of frames over a stretch (pacing, motion,
// cuts), the timeline as it looks, and the media pool with names and ids. Pictures come from the app window itself
// (Electron capturePage), so AI layers, captions and effects are seen exactly as rendered in the preview.
import { useSourceStore } from "@/components/editor/panels/assets/source/source-store";
import { EditorCore } from "@/core";
import { mediaTimeFromSeconds, TICKS_PER_SECOND } from "@/wasm";

type Capture = (rect: { x: number; y: number; width: number; height: number; maxHeight?: number }) => Promise<string | null>;

function capturer(): Capture | null {
	const app = (window as unknown as { studioApp?: { capture?: Capture } }).studioApp;
	return app?.capture ?? null;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function shoot(el: Element | null, maxHeight: number): Promise<string | null> {
	const capture = capturer();
	if (!el || !capture) return null;
	const r = el.getBoundingClientRect();
	if (r.width < 4 || r.height < 4) return null;
	return capture({ x: r.x, y: r.y, width: r.width, height: r.height, maxHeight });
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => resolve(null);
		img.src = src;
	});
}

const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** A cell's width for pictures of these shapes: their median aspect, kept between 9:16 and 16:9. */
export function cellAspect(aspects: number[]): number {
	const ok = aspects.filter((a) => Number.isFinite(a) && a > 0).sort((a, b) => a - b);
	if (!ok.length) return 16 / 9;
	return Math.min(16 / 9, Math.max(9 / 16, ok[Math.floor(ok.length / 2)]));
}

/** The text cut to a width with «…» (canvas measures it). */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
	if (ctx.measureText(text).width <= width) return text;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (ctx.measureText(`${text.slice(0, mid)}…`).width <= width) lo = mid;
		else hi = mid - 1;
	}
	return `${text.slice(0, lo)}…`;
}

/**
 * Pictures in a grid with a label under each: one image for the model instead of many. `media`: every picture sits on
 * grey padding inside a thin frame (black bars are never the padding, so a 16:9 picture doesn't look letterboxed) and
 * the label takes two lines (id · kind · W×H · length, then the name).
 */
async function sheet(cells: { src: string | null; label: string; name?: string }[], cellHeight: number, columns: number, { media = false }: { media?: boolean } = {}): Promise<string> {
	const imgs = await Promise.all(cells.map((c) => (c.src ? loadImage(c.src) : Promise.resolve(null))));
	const first = imgs.find(Boolean) as HTMLImageElement | undefined;
	const aspect = media ? cellAspect(imgs.filter((x): x is HTMLImageElement => !!x).map((x) => x.width / x.height)) : first ? first.width / first.height : 16 / 9;
	const cellW = Math.round(cellHeight * Math.min(2, Math.max(0.4, aspect)));
	const labelH = media ? 36 : 22;
	const cols = Math.min(columns, cells.length);
	const rows = Math.ceil(cells.length / cols);
	const canvas = document.createElement("canvas");
	canvas.width = cols * (cellW + 8) + 8;
	canvas.height = rows * (cellHeight + labelH + 8) + 8;
	const ctx = canvas.getContext("2d")!;
	ctx.fillStyle = "#1b1b1f";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.font = media ? "12px -apple-system, sans-serif" : "13px -apple-system, sans-serif";
	ctx.textBaseline = "middle";
	cells.forEach((c, i) => {
		const x = 8 + (i % cols) * (cellW + 8);
		const y = 8 + Math.floor(i / cols) * (cellHeight + labelH + 8);
		const img = imgs[i];
		ctx.fillStyle = media ? "#4a4a52" : "#000";
		ctx.fillRect(x, y, cellW, cellHeight);
		if (img) {
			const s = Math.min(cellW / img.width, cellHeight / img.height);
			const w = img.width * s, h = img.height * s;
			const ix = x + (cellW - w) / 2;
			const iy = y + (cellHeight - h) / 2;
			ctx.drawImage(img, ix, iy, w, h);
			if (media) {
				ctx.strokeStyle = "#d8d8de";
				ctx.lineWidth = 1;
				ctx.strokeRect(Math.round(ix) + 0.5, Math.round(iy) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
			}
		} else {
			ctx.fillStyle = "#aaa";
			ctx.fillText(c.src ? "(no picture)" : "(sound)", x + 8, y + cellHeight / 2);
		}
		ctx.fillStyle = "#e8e8ea";
		if (media) {
			ctx.fillText(fit(ctx, c.label, cellW - 4), x + 2, y + cellHeight + 10);
			ctx.fillStyle = "#b8b8c0";
			ctx.fillText(fit(ctx, c.name ?? "", cellW - 4), x + 2, y + cellHeight + 27);
		} else ctx.fillText(c.label.slice(0, Math.floor(cellW / 7)), x + 2, y + cellHeight + labelH / 2 + 2);
	});
	return canvas.toDataURL("image/jpeg", 0.8);
}

/** The preview's frame as the timeline shows it: the Media source player, if one is over it, is hidden for the shot. */
async function shootPreview(maxHeight: number): Promise<string | null> {
	// the source player, and the player's own guides (data-look-hide: «Разметка», the safe-zone warnings) — not the picture
	const hidden = [...document.querySelectorAll<HTMLElement>("[data-source-monitor], [data-look-hide]")];
	const was = hidden.map((el) => el.style.visibility);
	if (hidden.length) {
		for (const el of hidden) el.style.visibility = "hidden";
		await frame();
		await frame();
	}
	try {
		return await shoot(document.querySelector("[data-preview-frame]"), maxHeight);
	} finally {
		hidden.forEach((el, i) => {
			el.style.visibility = was[i] ?? "";
		});
	}
}

/**
 * The preview at the given moments (seconds). The playhead goes there (selection hidden, so no handles cover the
 * picture) and everything is put back afterwards. Returns one picture per moment.
 */
export async function lookAt(times: number[], maxHeight = 640): Promise<{ at: number; src: string | null }[]> {
	const ed = EditorCore.getInstance();
	// A media item open in the Media source player covers the preview: the look is of the TIMELINE, so the source
	// player closes first and opens again on the same item afterwards (its In/Out marks are kept).
	const sourceAsset = useSourceStore.getState().assetId;
	if (sourceAsset) {
		useSourceStore.getState().close();
		await frame();
		await frame();
	}
	const wasPlaying = ed.playback.getIsPlaying();
	if (wasPlaying) ed.playback.pause();
	const back = ed.playback.getCurrentTime();
	const selected = ed.selection.getSelectedElements();
	if (selected.length) ed.selection.clearSelection();
	const end = ed.timeline.getTotalDuration() / TICKS_PER_SECOND;
	const out: { at: number; src: string | null }[] = [];
	try {
		for (const [i, t] of times.entries()) {
			const at = Math.max(0, Math.min(t, Math.max(0, end - 0.04)));
			ed.playback.seek({ time: mediaTimeFromSeconds({ seconds: at }) });
			// The preview decodes and draws the frame (AI layers on their own animation frame): the first one waits longer.
			await frame();
			await sleep(i === 0 ? 450 : 260);
			await frame();
			out.push({ at, src: await shootPreview(maxHeight) });
		}
	} finally {
		ed.playback.seek({ time: back });
		if (selected.length) ed.selection.setSelectedElements({ elements: selected });
		if (wasPlaying) ed.playback.play();
		if (sourceAsset && !useSourceStore.getState().assetId && ed.media.getAssets().some((a) => a.id === sourceAsset)) useSourceStore.getState().open(sourceAsset);
	}
	return out;
}

/** Frames spread over [from, to] in one strip: how it plays (pacing, cuts, motion of titles and effects). */
export async function watch(from: number, to: number, count: number): Promise<{ image: string; times: number[] }> {
	const n = Math.max(2, Math.min(16, Math.round(count)));
	const span = Math.max(0.1, to - from);
	const times = Array.from({ length: n }, (_, i) => from + (span * i) / (n - 1));
	const shots = await lookAt(times, 420);
	const image = await sheet(
		shots.map((s) => ({ src: s.src, label: clock(s.at) })),
		260,
		n <= 4 ? n : n <= 9 ? Math.ceil(n / 2) : 6,
	);
	return { image, times: shots.map((s) => s.at) };
}

/** The timeline panel as it looks now. */
export async function lookAtTimeline(): Promise<string | null> {
	return shoot(document.querySelector('section[aria-label="Timeline"]'), 720);
}

/**
 * The media pool, newest first: each file's picture with its id, kind, size (W×H), length and name (sounds as a named
 * tile). `ids`: these files (one or two are drawn large); `count` / `offset`: a page of the newest (24 by default).
 */
export async function lookAtMedia({ ids, count, offset }: { ids?: string[]; count?: number; offset?: number } = {}): Promise<{ image: string | null; count: number; shown: number; offset: number; missing: string[] }> {
	const all = EditorCore.getInstance().media.getAssets().filter((a) => !a.motionProxy && !a.editingOriginalOf && !a.ephemeral);
	const missing: string[] = [];
	let pick: typeof all;
	let from = 0;
	if (ids?.length) {
		pick = [];
		for (const id of ids.map(String)) {
			const hit = all.find((a) => a.id === id || a.id.startsWith(id));
			if (hit && !pick.includes(hit)) pick.push(hit);
			else if (!hit) missing.push(id);
		}
	} else {
		from = Math.max(0, Math.floor(Number(offset) || 0));
		const n = Math.max(1, Math.min(48, Math.floor(Number(count) || 24)));
		pick = [...all].reverse().slice(from, from + n);
	}
	if (!pick.length) return { image: null, count: all.length, shown: 0, offset: from, missing };
	const cells = pick.map((a) => ({
		src: a.type === "audio" ? null : (a.thumbnailUrl ?? (a.type === "image" ? a.url ?? null : null)),
		label: `${a.id.slice(0, 8)} ${a.type}${a.width && a.height ? ` ${a.width}×${a.height}` : ""}${a.duration ? ` ${clock(a.duration)}` : ""}`,
		name: a.name,
	}));
	const big = pick.length <= 2;
	return { image: await sheet(cells, big ? 400 : 150, big ? pick.length : 4, { media: true }), count: all.length, shown: pick.length, offset: from, missing };
}

export const canSee = () => !!capturer();
