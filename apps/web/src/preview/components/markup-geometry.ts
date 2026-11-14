// Preview · markup: the guides' rectangles and lines in canvas pixels (top-left origin), from markup-zones.ts.
// Pure: the overlay draws these, the player's snapping and the «under the UI» warnings use the same numbers.
import { BROADCAST, FEED, type Margins, type SocialPlatform, TEXT_ZONES, THIRDS, VERTICAL_PLATFORMS, YOUTUBE_WIDE } from "./markup-zones";

export const MARKUP_LAYERS = ["social", "broadcast", "text", "thirds"] as const;
export type MarkupLayer = (typeof MARKUP_LAYERS)[number];
/** The project's shape as the guides know it (formatOf's ids; anything else is «custom»: no social frame). */
export type MarkupAspect = "9:16" | "16:9" | "1:1" | "4:5" | "custom";

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export type GuideKind =
	/** a part of the frame covered by an interface: veiled */
	| "band"
	/** a safe rectangle: outlined only */
	| "frame"
	/** a place for text: a light tint and an outline */
	| "zone"
	/** a full-length line (w or h = 0) */
	| "line"
	/** the centre cross */
	| "cross";

export interface Guide {
	id: string;
	layer: MarkupLayer;
	kind: GuideKind;
	/** English label (t() in the overlay); empty = no label */
	label: string;
	rect: Rect;
	/** where the label sits */
	labelAt?: "top-left" | "top-right" | "center" | "vertical";
}

interface Size {
	width: number;
	height: number;
}

/** The honest union of every 9:16 platform's covered bands: the largest band per side. */
export const VERTICAL_UNION: SocialPlatform = {
	id: "all",
	label: "All platforms",
	ui: "the app",
	top: Math.max(...VERTICAL_PLATFORMS.map((p) => p.top)),
	bottom: Math.max(...VERTICAL_PLATFORMS.map((p) => p.bottom)),
	left: Math.max(...VERTICAL_PLATFORMS.map((p) => p.left)),
	right: Math.max(...VERTICAL_PLATFORMS.map((p) => p.right)),
};

export function verticalPlatform(id: string | null | undefined): SocialPlatform {
	return VERTICAL_PLATFORMS.find((p) => p.id === id) ?? VERTICAL_UNION;
}

/** The covered bands of the social frame for an aspect, as margins (null: no frame for this shape). */
export function socialMargins(aspect: MarkupAspect, platform?: string | null): (Margins & { ui: string }) | null {
	if (aspect === "9:16") {
		const p = verticalPlatform(platform);
		return { top: p.top, bottom: p.bottom, left: p.left, right: p.right, ui: p.ui };
	}
	if (aspect === "16:9") return { top: YOUTUBE_WIDE.titleBar, bottom: YOUTUBE_WIDE.controls, left: 0, right: 0, ui: "YouTube" };
	if (aspect === "1:1" || aspect === "4:5") {
		const ratio = aspect === "1:1" ? 1 : 4 / 5;
		// the 3:4 grid tile keeps the full height and the centre FEED.gridAspect / ratio of the width
		const side = Math.max(0, (1 - FEED.gridAspect / ratio) / 2);
		return { top: 0, bottom: FEED.icons, left: side, right: side, ui: "Instagram" };
	}
	return null;
}

/** The rectangle inside the covered bands, in canvas px. */
export function socialSafeRect(aspect: MarkupAspect, canvas: Size, platform?: string | null) {
	const m = socialMargins(aspect, platform);
	if (!m) return null;
	return {
		left: canvas.width * m.left,
		top: canvas.height * m.top,
		right: canvas.width * (1 - m.right),
		bottom: canvas.height * (1 - m.bottom),
	};
}

/** Rounded to a millionth of a pixel: 1 − 0.9 is 0.0999…98 in floating point. */
const tidy = (v: number) => Math.round(v * 1e6) / 1e6;

const inset = (canvas: Size, fraction: number): Rect => {
	const dx = tidy((canvas.width * (1 - fraction)) / 2);
	const dy = tidy((canvas.height * (1 - fraction)) / 2);
	return { x: dx, y: dy, w: canvas.width - 2 * dx, h: canvas.height - 2 * dy };
};

/** Where captions sit by default: their centre and two lines of the default size (subtitles/build-subtitle-text-element). */
export interface SubtitlePlacement {
	/** centre, px from the frame's middle (resolveCaptionCenterY) */
	centerY: number;
	/** the block's height, px */
	height: number;
}

function socialGuides(aspect: MarkupAspect, canvas: Size, platform: string | null | undefined): Guide[] {
	const m = socialMargins(aspect, platform);
	if (!m) return [];
	const { width: W, height: H } = canvas;
	const top = H * m.top;
	const bottom = H * m.bottom;
	const left = W * m.left;
	const right = W * m.right;
	const out: Guide[] = [];
	const feed = aspect === "1:1" || aspect === "4:5";
	const wide = aspect === "16:9";
	const names = wide
		? { top: "Title bar", bottom: "Controls", left: "", right: "" }
		: feed
			? { top: "", bottom: "Feed icons", left: "Grid 3:4", right: "" }
			: { top: "Top bar", bottom: "Caption · progress", left: "", right: "Buttons" };
	if (top > 0) out.push({ id: "social-top", layer: "social", kind: "band", label: names.top, rect: { x: 0, y: 0, w: W, h: top }, labelAt: "center" });
	if (bottom > 0)
		out.push({ id: "social-bottom", layer: "social", kind: "band", label: names.bottom, rect: { x: 0, y: H - bottom, w: W, h: bottom }, labelAt: "center" });
	const midH = H - top - bottom;
	if (left > 0) out.push({ id: "social-left", layer: "social", kind: "band", label: names.left, rect: { x: 0, y: top, w: left, h: midH }, labelAt: "vertical" });
	if (right > 0)
		out.push({ id: "social-right", layer: "social", kind: "band", label: names.right, rect: { x: W - right, y: top, w: right, h: midH }, labelAt: "vertical" });
	out.push({ id: "social-safe", layer: "social", kind: "frame", label: "", rect: { x: left, y: top, w: W - left - right, h: midH } });
	if (wide) {
		const e = YOUTUBE_WIDE.endScreen;
		out.push({
			id: "social-endscreen",
			layer: "social",
			kind: "zone",
			label: "End screen ≈",
			rect: { x: W * e.left, y: H * e.top, w: W * (1 - e.left - e.right), h: H * (1 - e.top - e.bottom) },
			labelAt: "top-right",
		});
	}
	return out;
}

/** Every guide of the visible layers, in drawing order. */
export function markupGuides({
	aspect,
	canvas,
	layers,
	platform,
	subtitle,
}: {
	aspect: MarkupAspect;
	canvas: Size;
	layers: ReadonlySet<MarkupLayer> | readonly MarkupLayer[];
	platform?: string | null;
	subtitle?: SubtitlePlacement | null;
}): Guide[] {
	const on = new Set(layers);
	const { width: W, height: H } = canvas;
	const out: Guide[] = [];
	if (on.has("social")) out.push(...socialGuides(aspect, canvas, platform));
	const title = inset(canvas, BROADCAST.title);
	if (on.has("text")) {
		const lt = TEXT_ZONES.lowerThird;
		out.push({ id: "text-lower-third", layer: "text", kind: "zone", label: "Lower third", rect: { x: title.x, y: H * lt.top, w: title.w, h: H * (lt.bottom - lt.top) } });
		const bt = TEXT_ZONES.bigTitle;
		out.push({ id: "text-big-title", layer: "text", kind: "zone", label: "Big title", rect: { x: title.x, y: H * bt.top, w: title.w, h: H * (bt.bottom - bt.top) } });
		if (subtitle) {
			const cy = H / 2 + subtitle.centerY;
			out.push({ id: "text-subtitles", layer: "text", kind: "zone", label: "Subtitles", rect: { x: title.x, y: cy - subtitle.height / 2, w: title.w, h: subtitle.height }, labelAt: "top-right" });
		}
	}
	if (on.has("broadcast")) {
		out.push({ id: "broadcast-action", layer: "broadcast", kind: "frame", label: "Action safe 93%", rect: inset(canvas, BROADCAST.action), labelAt: "top-right" });
		out.push({ id: "broadcast-title", layer: "broadcast", kind: "frame", label: "Title safe 90%", rect: title, labelAt: "top-left" });
		const arm = Math.min(W, H) * BROADCAST.cross;
		out.push({ id: "broadcast-cross", layer: "broadcast", kind: "cross", label: "", rect: { x: W / 2 - arm / 2, y: H / 2 - arm / 2, w: arm, h: arm } });
	}
	if (on.has("thirds")) {
		for (const [i, f] of THIRDS.entries()) {
			out.push({ id: `thirds-v${i + 1}`, layer: "thirds", kind: "line", label: "", rect: { x: W * f, y: 0, w: 0, h: H } });
			out.push({ id: `thirds-h${i + 1}`, layer: "thirds", kind: "line", label: "", rect: { x: 0, y: H * f, w: W, h: 0 } });
		}
		out.push({ id: "centre-v", layer: "thirds", kind: "line", label: "", rect: { x: W / 2, y: 0, w: 0, h: H } });
		out.push({ id: "centre-h", layer: "thirds", kind: "line", label: "", rect: { x: 0, y: H / 2, w: W, h: 0 } });
	}
	return out;
}

/**
 * What a dragged object snaps to: the edges and centres of the visible guides, in the player's position space
 * (px from the frame's centre). The frame's own edges and centre are the snapping's own targets already.
 */
export function guideSnapTargets(guides: readonly Guide[], canvas: Size): { x: number[]; y: number[] } {
	const xs = new Set<number>();
	const ys = new Set<number>();
	const round = (v: number) => Math.round(v * 1000) / 1000;
	for (const g of guides) {
		if (g.kind === "band") {
			// a band's inner edge is the safe edge; its outer edge is the frame's
			continue;
		}
		const { x, y, w, h } = g.rect;
		if (g.kind === "line") {
			if (w === 0) xs.add(round(x - canvas.width / 2));
			else ys.add(round(y - canvas.height / 2));
			continue;
		}
		for (const v of [x, x + w / 2, x + w]) xs.add(round(v - canvas.width / 2));
		for (const v of [y, y + h / 2, y + h]) ys.add(round(v - canvas.height / 2));
	}
	const frameX = new Set([0, round(-canvas.width / 2), round(canvas.width / 2)]);
	const frameY = new Set([0, round(-canvas.height / 2), round(canvas.height / 2)]);
	return { x: [...xs].filter((v) => !frameX.has(v)).sort((a, b) => a - b), y: [...ys].filter((v) => !frameY.has(v)).sort((a, b) => a - b) };
}
