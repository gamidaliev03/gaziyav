"use client";

// Preview · safe zones: a warning on text that sits under the platform's interface, for the social frame «Разметка»
// shows (markup.tsx draws the frame; the numbers are in markup-zones.ts). DOM only — never part of the render or the export.
import { useEffect } from "react";
import { useEditor } from "@/editor/use-editor";
import { getVisibleElementsWithBounds } from "@/preview/element-bounds";
import type { PreviewOverlaySourceResult } from "@/preview/overlays";
import { useT } from "@/i18n";
import { MarkupGuides } from "./markup";
import { VERTICAL_UNION, socialMargins, socialSafeRect } from "./markup-geometry";
import { aspectOfCanvas } from "./markup-live";
import { defaultMarkup, useMarkup, useSafeZones } from "./markup-store";
import { VERTICAL_PLATFORMS } from "./markup-zones";

export { useSafeZones } from "./markup-store";

/** The 9:16 platforms (from markup-zones.ts) and their union («universal»), as fractions of the canvas. */
export const SAFE_ZONES = [{ ...VERTICAL_UNION, id: "universal" }, ...VERTICAL_PLATFORMS] as const;

export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** The safe rectangle in canvas pixels. */
export function safeRect(zone: { top: number; bottom: number; left: number; right: number }, canvas: { width: number; height: number }): Box {
	return {
		left: canvas.width * zone.left,
		top: canvas.height * zone.top,
		right: canvas.width * (1 - zone.right),
		bottom: canvas.height * (1 - zone.bottom),
	};
}

/** The shortest shift that puts `box` inside `rect` (centred on an axis where it is too big to fit). */
export function moveInto(box: Box, rect: Box): { dx: number; dy: number } {
	const axis = (low: number, high: number, min: number, max: number) => {
		if (high - low > max - min) return (min + max) / 2 - (low + high) / 2;
		if (low < min) return min - low;
		if (high > max) return max - high;
		return 0;
	};
	return { dx: axis(box.left, box.right, rect.left, rect.right), dy: axis(box.top, box.bottom, rect.top, rect.bottom) };
}

const CHECKED_TYPES = new Set(["text", "sticker", "graphic"]);

/** The social frame now on screen: its safe rectangle and the interface's name, or null. */
function useActiveFrame(): { rect: Box; ui: string } | null {
	const canvas = useEditor((e) => e.project.getActive().settings.canvasSize, ["project"]);
	const aspect = aspectOfCanvas(canvas);
	const saved = useMarkup((s) => s.byAspect[aspect]);
	const m = saved ?? defaultMarkup(aspect);
	if (!m.on || !m.layers.includes("social")) return null;
	const rect = socialSafeRect(aspect, canvas, m.platform);
	const margins = socialMargins(aspect, m.platform);
	return rect && margins ? { rect, ui: margins.ui } : null;
}

/**
 * «Under TikTok UI · Move in» on every text, caption or sticker at the playhead that reaches into a covered band.
 * Checked on seek, pause and edits; hidden while playing (no per-frame work).
 */
function SafeZonesWarnings({ sceneWidth, sceneHeight }: { sceneWidth: number; sceneHeight: number }) {
	const t = useT();
	const editor = useEditor();
	const frame = useActiveFrame();
	const warn = useSafeZones((s) => s.warn);
	// −1 while playing: the selector stays equal, so nothing re-renders per frame.
	const time = useEditor((e) => (e.playback.getIsPlaying() ? -1 : e.playback.getCurrentTime()), ["playback"]);
	const tracks = useEditor((e) => e.scenes.getActiveScene().tracks, ["scenes", "timeline"]);
	const canvas = useEditor((e) => e.project.getActive().settings.canvasSize, ["project"]);
	const media = useEditor((e) => e.media.getAssets(), ["media"]);
	const active = !!frame && warn && time >= 0;
	const rect = frame?.rect ?? null;
	const offenders =
		active && rect
			? getVisibleElementsWithBounds({ tracks, currentTime: time, canvasSize: canvas, mediaAssets: media })
					.filter(({ element }) => CHECKED_TYPES.has(element.type))
					.map((item) => {
						const { cx, cy, width, height } = item.bounds;
						const box = { left: cx - width / 2, top: cy - height / 2, right: cx + width / 2, bottom: cy + height / 2 };
						return { ...item, box, shift: moveInto(box, rect) };
					})
					.filter(({ shift }) => Math.abs(shift.dx) > 0.5 || Math.abs(shift.dy) > 0.5)
			: [];
	const count = offenders.length;
	useEffect(() => {
		if (time >= 0 || !frame) useSafeZones.setState({ outside: frame && warn ? count : 0 });
	}, [count, time, frame, warn]);
	if (!active || !frame || offenders.length === 0) return null;
	const scale = sceneWidth / canvas.width;
	const moveIn = (trackId: string, elementId: string, params: Record<string, unknown>, dx: number, dy: number) =>
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId,
					patch: {
						params: {
							...params,
							"transform.positionX": Number(params["transform.positionX"] ?? 0) + dx,
							"transform.positionY": Number(params["transform.positionY"] ?? 0) + dy,
						},
					} as never,
				},
			],
		});
	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ width: sceneWidth, height: sceneHeight }} data-look-hide="">
			{offenders.map(({ trackId, elementId, element, box, shift }) => (
				<div
					key={elementId}
					data-safe-warning={elementId}
					className="pointer-events-auto absolute flex h-6 -translate-y-full items-center gap-1 rounded-full bg-black/60 pr-1 pl-2 text-[11.5px] whitespace-nowrap"
					style={{ left: Math.max(0, box.left * scale), top: Math.max(24, box.top * scale) }}
				>
					<span className="text-caution">{t("Under {ui} UI", { ui: frame.ui === "the app" ? t("the app") : frame.ui })}</span>
					<button
						type="button"
						className="text-caution hover:bg-caution/15 focus-visible:ring-ring h-5 rounded-full px-1.5 font-medium focus-visible:ring-2 focus-visible:outline-hidden"
						data-safe-move-in
						onClick={() => moveIn(trackId, elementId, ("params" in element ? element.params : {}) as Record<string, unknown>, shift.dx, shift.dy)}
					>
						Move in
					</button>
				</div>
			))}
		</div>
	);
}

/** Registered in the editor page's overlay sources (one line there): the «Разметка» guides and the warnings. */
export const safeZonesPreviewOverlaySource: PreviewOverlaySourceResult = {
	definitions: [],
	instances: [
		{ id: "markup-guides", mount: { kind: "scene" }, plane: "under-interaction", render: (ctx) => <MarkupGuides {...ctx} /> },
		{ id: "safe-zones-warnings", mount: { kind: "scene" }, plane: "over-interaction", render: (ctx) => <SafeZonesWarnings {...ctx} /> },
	],
};
