import type { TCanvasSize } from "@/project/types";

/** The formats short videos are made in, in the order people reach for them. */
export const CANVAS_FORMATS = [
	{ id: "9:16", width: 9, height: 16, label: "Vertical", hint: "TikTok, Reels, Shorts" },
	{ id: "16:9", width: 16, height: 9, label: "Wide", hint: "YouTube" },
	{ id: "1:1", width: 1, height: 1, label: "Square", hint: "Feed posts" },
	{ id: "4:5", width: 4, height: 5, label: "Portrait", hint: "Instagram feed" },
] as const;

export type CanvasFormatId = (typeof CANVAS_FORMATS)[number]["id"];

/** The format a canvas is in, or null for a custom shape. */
export function formatOf(size: TCanvasSize): CanvasFormatId | null {
	const ratio = size.width / size.height;
	return CANVAS_FORMATS.find((format) => Math.abs(format.width / format.height - ratio) < 0.005)?.id ?? null;
}

/**
 * The canvas in another format at the same quality: the short side stays (1080 × 1920 → 1920 × 1080, 1080 × 1080),
 * both sides even, as the H.264 encoder needs.
 */
export function sizeInFormat(current: TCanvasSize, id: CanvasFormatId): TCanvasSize {
	const format = CANVAS_FORMATS.find((f) => f.id === id) ?? CANVAS_FORMATS[0];
	const short = Math.min(current.width, current.height);
	const unit = short / Math.min(format.width, format.height);
	const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
	return { width: even(format.width * unit), height: even(format.height * unit) };
}
