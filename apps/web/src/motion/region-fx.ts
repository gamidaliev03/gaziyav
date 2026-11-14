// Tracker actions drawn into the clip's own picture (before its transform, so they move with the clip):
// blur / pixelate inside the tracked region, spotlight and colour pop outside it. Canvas 2D (GPU-backed in
// Chromium) — the same code runs for the preview and for export, so both match exactly.
import type { Tracker } from "./types";
import { trackBoxAt } from "./tracker";

type Canvas2D = OffscreenCanvasRenderingContext2D;

/** The looks a tracker can put on its object only (kind "filter"). */
const LOOKS: Record<NonNullable<Tracker["fx"]>["look"] & string, string> = {
	bw: "grayscale(1) contrast(1.1)",
	warm: "sepia(0.35) saturate(1.35) hue-rotate(-10deg) brightness(1.04)",
	cool: "saturate(1.15) hue-rotate(18deg) brightness(1.03)",
	vivid: "saturate(1.8) contrast(1.15)",
	vintage: "sepia(0.6) contrast(0.9) brightness(1.06)",
};

interface Surface {
	canvas: OffscreenCanvas;
	ctx: Canvas2D;
}

const surfaces = new Map<string, Surface>();

function surface(key: string, w: number, h: number): Surface {
	let s = surfaces.get(key);
	if (!s) {
		const canvas = new OffscreenCanvas(w, h);
		const ctx = canvas.getContext("2d") as Canvas2D;
		s = { canvas, ctx };
		surfaces.set(key, s);
		if (surfaces.size > 24) {
			const first = surfaces.keys().next().value as string;
			surfaces.delete(first);
		}
	}
	if (s.canvas.width !== w || s.canvas.height !== h) {
		s.canvas.width = w;
		s.canvas.height = h;
	}
	return s;
}

export function hasActiveFx(trackers: Tracker[] | undefined): boolean {
	return !!trackers?.some((t) => t.fx && t.fx.kind !== "none" && t.samples.length > 0);
}

interface Region {
	cx: number;
	cy: number;
	rw: number;
	rh: number;
	angle: number;
	feather: number;
	shape: "ellipse" | "rect";
}

function shapePath(ctx: Canvas2D, r: Region, grow = 0) {
	ctx.beginPath();
	if (r.shape === "ellipse") {
		ctx.ellipse(r.cx, r.cy, Math.max(1, r.rw / 2 + grow), Math.max(1, r.rh / 2 + grow), (r.angle * Math.PI) / 180, 0, Math.PI * 2);
	} else {
		ctx.save();
		ctx.translate(r.cx, r.cy);
		ctx.rotate((r.angle * Math.PI) / 180);
		ctx.rect(-r.rw / 2 - grow, -r.rh / 2 - grow, r.rw + 2 * grow, r.rh + 2 * grow);
		ctx.restore();
	}
}

/**
 * A soft white shape on transparent (the region's mask). `cover` (blur, pixelate: hiding something) keeps the
 * whole region fully covered and fades outside it; otherwise the soft edge sits on the outline.
 */
function drawMask(ctx: Canvas2D, r: Region, cover = false) {
	const blur = Math.max(0, r.feather);
	ctx.save();
	ctx.filter = blur > 0.5 ? `blur(${(blur * 0.5).toFixed(1)}px)` : "none";
	ctx.fillStyle = "#fff";
	shapePath(ctx, r, cover ? blur * 0.75 : 0);
	ctx.fill();
	ctx.restore();
}

/**
 * The picture with every active tracker action applied, or null when none applies at this time.
 * `sourceTime` = seconds of the media file; `key` identifies the clip (one reusable surface per clip).
 */
export function applyTrackerFx({
	key,
	source,
	width,
	height,
	trackers,
	sourceTime,
}: {
	key: string;
	source: CanvasImageSource;
	width: number;
	height: number;
	trackers: Tracker[];
	sourceTime: number;
}): OffscreenCanvas | null {
	const active: Array<{ region: Region; tracker: Tracker }> = [];
	for (const tracker of trackers) {
		const fx = tracker.fx;
		if (!fx || fx.kind === "none") continue;
		const box = trackBoxAt(tracker, sourceTime);
		if (!box) continue;
		const rw = box.w * width * fx.expand;
		const rh = box.h * height * fx.expand;
		active.push({
			tracker,
			region: {
				cx: box.cx * width,
				cy: box.cy * height,
				rw,
				rh,
				angle: box.angle,
				feather: Math.min(rw, rh) * 0.5 * Math.max(0, Math.min(1, fx.feather)),
				shape: fx.shape,
			},
		});
	}
	if (!active.length) return null;

	const out = surface(`${key}:out`, width, height);
	out.ctx.globalCompositeOperation = "copy";
	out.ctx.filter = "none";
	out.ctx.drawImage(source, 0, 0, width, height);
	out.ctx.globalCompositeOperation = "source-over";

	for (const { region, tracker } of active) {
		const fx = tracker.fx!;
		const amount = Math.max(0, Math.min(1, fx.amount));
		const layer = surface(`${key}:layer`, width, height);
		const lc = layer.ctx;
		lc.globalCompositeOperation = "source-over";
		lc.filter = "none";
		lc.clearRect(0, 0, width, height);
		// Work only around the region (blur / pixelate of a whole 4K frame would be wasted).
		const reach = Math.max(region.rw, region.rh) * 0.75 + region.feather * 1.5;
		switch (fx.kind) {
			case "blur": {
				const radius = Math.max(2, Math.min(width, height) * 0.06 * amount + Math.min(region.rw, region.rh) * 0.12 * amount);
				const pad = reach + radius * 2;
				const x0 = Math.max(0, Math.floor(region.cx - pad));
				const y0 = Math.max(0, Math.floor(region.cy - pad));
				const x1 = Math.min(width, Math.ceil(region.cx + pad));
				const y1 = Math.min(height, Math.ceil(region.cy + pad));
				if (x1 <= x0 || y1 <= y0) continue;
				lc.save();
				lc.beginPath();
				lc.rect(x0, y0, x1 - x0, y1 - y0);
				lc.clip();
				lc.filter = `blur(${radius.toFixed(1)}px)`;
				lc.drawImage(out.canvas, 0, 0);
				lc.restore();
				lc.filter = "none";
				// Keep only the region.
				lc.globalCompositeOperation = "destination-in";
				drawMask(lc, region, true);
				break;
			}
			case "pixelate": {
				const block = Math.max(4, Math.round(Math.min(region.rw, region.rh) * (0.04 + 0.16 * amount)));
				const x0 = Math.max(0, Math.floor((region.cx - reach) / block) * block);
				const y0 = Math.max(0, Math.floor((region.cy - reach) / block) * block);
				const x1 = Math.min(width, Math.ceil((region.cx + reach) / block) * block);
				const y1 = Math.min(height, Math.ceil((region.cy + reach) / block) * block);
				if (x1 <= x0 || y1 <= y0) continue;
				const sw = Math.max(1, Math.round((x1 - x0) / block));
				const sh = Math.max(1, Math.round((y1 - y0) / block));
				const small = surface(`${key}:small`, sw, sh);
				small.ctx.imageSmoothingEnabled = true;
				small.ctx.globalCompositeOperation = "copy";
				small.ctx.drawImage(out.canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, sw, sh);
				lc.imageSmoothingEnabled = false;
				lc.drawImage(small.canvas, 0, 0, sw, sh, x0, y0, x1 - x0, y1 - y0);
				lc.imageSmoothingEnabled = true;
				lc.globalCompositeOperation = "destination-in";
				drawMask(lc, region, true);
				break;
			}
			case "spotlight": {
				// Darkness everywhere except the (soft) region.
				lc.fillStyle = `rgba(0,0,0,${(0.35 + 0.6 * amount).toFixed(3)})`;
				lc.fillRect(0, 0, width, height);
				lc.globalCompositeOperation = "destination-out";
				drawMask(lc, region);
				break;
			}
			case "glow": {
				// The object lit up: a brighter, softly blurred copy only in the (soft) region, added on top.
				const radius = Math.max(2, Math.min(region.rw, region.rh) * 0.08);
				lc.filter = `brightness(${(1 + 0.7 * amount).toFixed(3)}) saturate(${(1 + 0.4 * amount).toFixed(3)}) blur(${radius.toFixed(1)}px)`;
				lc.drawImage(out.canvas, 0, 0);
				lc.filter = "none";
				lc.globalCompositeOperation = "destination-in";
				drawMask(lc, region);
				lc.globalCompositeOperation = "source-over";
				layer.ctx.globalAlpha = 1;
				out.ctx.globalCompositeOperation = "screen";
				out.ctx.globalAlpha = 0.35 + 0.5 * amount;
				out.ctx.drawImage(layer.canvas, 0, 0);
				out.ctx.globalAlpha = 1;
				out.ctx.globalCompositeOperation = "source-over";
				continue;
			}
			case "filter": {
				// A colour look only on the tracked thing (the rest of the picture as it was).
				lc.globalCompositeOperation = "copy";
				lc.filter = LOOKS[fx.look ?? "bw"];
				lc.globalAlpha = amount;
				lc.drawImage(out.canvas, 0, 0);
				lc.globalAlpha = 1;
				lc.filter = "none";
				lc.globalCompositeOperation = "destination-in";
				drawMask(lc, region);
				break;
			}
			case "colorPop": {
				// Black-and-white everywhere except the region.
				lc.globalCompositeOperation = "copy";
				lc.filter = `grayscale(${amount.toFixed(3)})`;
				lc.drawImage(out.canvas, 0, 0);
				lc.filter = "none";
				lc.globalCompositeOperation = "destination-out";
				drawMask(lc, region);
				break;
			}
		}
		lc.globalCompositeOperation = "source-over";
		out.ctx.drawImage(layer.canvas, 0, 0);
	}
	return out.canvas;
}
