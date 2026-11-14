"use client";

// On the preview: the tracked box of the selected clip's tracker under the playhead; drawing a box (Object) or
// clicking the subject (Subject) to start tracking; dragging the box / its corner to correct a frame (Edit box).
// Pointer events are taken only while drawing or editing — the preview works as usual otherwise.
import { useEffect, useRef, useState } from "react";
import { getElementLocalTime } from "@/animation";
import type { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import type { PreviewOverlaySourceResult } from "@/preview/overlays";
import { buildTransformFromParams, type Transform } from "@/rendering";
import { resolveTransformAtTime } from "@/rendering/animation-values";
import type { TimelineElement, TimelineTrack, VideoElement } from "@/timeline";
import { trackClip } from "../client";
import { attachFollower, detachFollower, updateTracker } from "../commands";
import { clipSourceSeconds } from "../follow";
import { useMotionStore } from "../store";
import { correctTrack, trackBoxAt } from "../tracker";

interface Geometry {
	transform: Transform;
	frame: [number, number];
	canvas: { width: number; height: number };
	k: number;
}

/** Normalized picture point → overlay px. */
function toOverlay(g: Geometry, nx: number, ny: number) {
	const contain = Math.min(g.canvas.width / g.frame[0], g.canvas.height / g.frame[1]);
	const lx = (nx - 0.5) * g.frame[0] * contain * g.transform.scaleX;
	const ly = (ny - 0.5) * g.frame[1] * contain * g.transform.scaleY;
	const r = (g.transform.rotate * Math.PI) / 180;
	const x = g.canvas.width / 2 + g.transform.position.x + lx * Math.cos(r) - ly * Math.sin(r);
	const y = g.canvas.height / 2 + g.transform.position.y + lx * Math.sin(r) + ly * Math.cos(r);
	return { x: x * g.k, y: y * g.k };
}

/** Overlay px → normalized picture point. */
function toPicture(g: Geometry, ox: number, oy: number) {
	const contain = Math.min(g.canvas.width / g.frame[0], g.canvas.height / g.frame[1]);
	const dx = ox / g.k - g.canvas.width / 2 - g.transform.position.x;
	const dy = oy / g.k - g.canvas.height / 2 - g.transform.position.y;
	const r = (-g.transform.rotate * Math.PI) / 180;
	const lx = dx * Math.cos(r) - dy * Math.sin(r);
	const ly = dx * Math.sin(r) + dy * Math.cos(r);
	return {
		x: lx / (g.frame[0] * contain * (g.transform.scaleX || 1)) + 0.5,
		y: ly / (g.frame[1] * contain * (g.transform.scaleY || 1)) + 0.5,
	};
}

function findClip(tracks: { main: TimelineTrack; overlay: TimelineTrack[] } | null, id: string | null): VideoElement | null {
	if (!tracks || !id) return null;
	for (const track of [tracks.main, ...tracks.overlay]) {
		for (const el of track.elements as TimelineElement[]) if (el.id === id && el.type === "video") return el as VideoElement;
	}
	return null;
}

function TrackerOverlay({ sceneWidth, sceneHeight }: { sceneWidth: number; sceneHeight: number }) {
	const editor = useEditor();
	const draw = useMotionStore((s) => s.draw);
	const selectedTrackers = useMotionStore((s) => s.selected);
	const selectedId = useEditor((e) => {
		const sel = e.selection.getSelectedElements();
		return sel.length === 1 ? sel[0].elementId : null;
	}, ["selection"]);
	const tracks = useEditor((e) => e.timeline.getPreviewTracks?.() ?? e.scenes.getActiveSceneOrNull()?.tracks ?? null, ["scenes", "timeline"]);
	const canvas = useEditor((e) => e.project.getActiveOrNull()?.settings.canvasSize ?? null, ["project"]);
	const clip = findClip(tracks, draw?.elementId ?? selectedId);
	const trackerId = draw?.mode === "edit" ? draw.trackerId : clip ? selectedTrackers[clip.id] ?? clip.trackers?.[clip.trackers.length - 1]?.id : undefined;
	const tracker = clip?.trackers?.find((t) => t.id === trackerId) ?? null;
	const active = !!clip && (!!tracker || !!draw);
	const time = useEditor((e) => (active ? e.playback.getCurrentTime() : 0), ["playback"]);
	const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
	const [edit, setEdit] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
	const dragRef = useRef<{ mode: "move" | "resize"; sx: number; sy: number; box: { x: number; y: number; w: number; h: number } } | null>(null);
	const layer = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!draw) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") useMotionStore.getState().setDraw(null);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [draw]);

	if (!clip || !canvas || !active) return null;
	const inClip = time >= clip.startTime && time < clip.startTime + clip.duration;
	const asset = editor.media.getAssets().find((m) => m.id === clip.mediaId);
	const frame: [number, number] = tracker?.frame ?? [asset?.width ?? canvas.width, asset?.height ?? canvas.height];
	const localTime = getElementLocalTime({ timelineTime: Math.min(Math.max(time, clip.startTime), clip.startTime + clip.duration - 1), elementStartTime: clip.startTime, elementDuration: clip.duration });
	const g: Geometry = {
		transform: resolveTransformAtTime({ baseTransform: buildTransformFromParams({ params: clip.params }), animations: clip.animations, localTime }),
		frame,
		canvas,
		k: sceneWidth / canvas.width,
	};
	const sourceTime = clipSourceSeconds(clip, time);
	const box = tracker && inClip ? trackBoxAt(tracker, sourceTime) : null;
	const shown = edit ?? (box ? { x: box.cx - box.w / 2, y: box.cy - box.h / 2, w: box.w, h: box.h } : null);
	const corners = shown ? [toOverlay(g, shown.x, shown.y), toOverlay(g, shown.x + shown.w, shown.y), toOverlay(g, shown.x + shown.w, shown.y + shown.h), toOverlay(g, shown.x, shown.y + shown.h)] : null;
	const capturing = !!draw && draw.elementId === clip.id;
	const local = (e: React.PointerEvent) => {
		const r = layer.current!.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	};
	const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

	const onDown = (e: React.PointerEvent) => {
		if (!draw) return;
		e.preventDefault();
		e.stopPropagation();
		const p = local(e);
		(e.target as Element).setPointerCapture?.(e.pointerId);
		if (draw.mode === "subject") {
			const n = toPicture(g, p.x, p.y);
			useMotionStore.getState().setDraw(null);
			void trackClip({ elementId: clip.id, kind: "subject", point: [clamp01(n.x), clamp01(n.y)] });
			return;
		}
		if (draw.mode === "object") {
			setRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
			return;
		}
		if (draw.mode === "edit" && shown && corners) {
			const n = toPicture(g, p.x, p.y);
			const near = Math.hypot(p.x - corners[2].x, p.y - corners[2].y) < 14;
			const inside = n.x >= shown.x && n.x <= shown.x + shown.w && n.y >= shown.y && n.y <= shown.y + shown.h;
			if (!near && !inside) return;
			dragRef.current = { mode: near ? "resize" : "move", sx: n.x, sy: n.y, box: shown };
			setEdit(shown);
		}
	};
	const onMove = (e: React.PointerEvent) => {
		if (!draw) return;
		const p = local(e);
		if (rect) setRect({ ...rect, x1: p.x, y1: p.y });
		const d = dragRef.current;
		if (d) {
			const n = toPicture(g, p.x, p.y);
			const dx = n.x - d.sx;
			const dy = n.y - d.sy;
			setEdit(
				d.mode === "move"
					? { ...d.box, x: d.box.x + dx, y: d.box.y + dy }
					: { ...d.box, w: Math.max(0.01, d.box.w + dx), h: Math.max(0.01, d.box.h + dy) },
			);
		}
	};
	const onUp = () => {
		if (rect && draw?.mode === "object") {
			const a = toPicture(g, Math.min(rect.x0, rect.x1), Math.min(rect.y0, rect.y1));
			const b = toPicture(g, Math.max(rect.x0, rect.x1), Math.max(rect.y0, rect.y1));
			setRect(null);
			const x = clamp01(Math.min(a.x, b.x));
			const y = clamp01(Math.min(a.y, b.y));
			const w = clamp01(Math.max(a.x, b.x)) - x;
			const h = clamp01(Math.max(a.y, b.y)) - y;
			if (w > 0.01 && h > 0.01) {
				useMotionStore.getState().setDraw(null);
				void trackClip({ elementId: clip.id, kind: "object", rect: [x, y, w, h] });
			}
			return;
		}
		const d = dragRef.current;
		if (d && edit && tracker) {
			dragRef.current = null;
			updateTracker(editor, clip.id, tracker.id, { samples: correctTrack(tracker, sourceTime, edit) });
			setEdit(null);
		}
	};

	const label = tracker ? `${tracker.name}${tracker.fx && tracker.fx.kind !== "none" ? ` · ${tracker.fx.kind === "colorPop" ? "colour pop" : tracker.fx.kind}` : ""}` : "";
	return (
		<div
			ref={layer}
			data-motion-overlay={capturing ? draw?.mode : "view"}
			className="absolute inset-0"
			style={{ width: sceneWidth, height: sceneHeight, pointerEvents: capturing ? "auto" : "none", cursor: capturing ? (draw?.mode === "edit" ? "move" : "crosshair") : undefined }}
			onPointerDown={onDown}
			onPointerMove={onMove}
			onPointerUp={onUp}
			onPointerCancel={onUp}
		>
			{capturing && draw?.mode !== "edit" && <div className="absolute inset-0 bg-black/15" />}
			<svg className="absolute inset-0 overflow-visible" width={sceneWidth} height={sceneHeight} aria-hidden>
				{corners && (
					<>
						<polygon
							points={corners.map((c) => `${c.x},${c.y}`).join(" ")}
							fill="none"
							stroke="white"
							strokeOpacity={0.9}
							strokeWidth={1.5}
							strokeDasharray={draw?.mode === "edit" ? undefined : "5 4"}
						/>
						<polygon points={corners.map((c) => `${c.x},${c.y}`).join(" ")} fill="none" stroke="black" strokeOpacity={0.35} strokeWidth={3} style={{ mixBlendMode: "multiply" }} />
						{draw?.mode === "edit" && <rect x={corners[2].x - 5} y={corners[2].y - 5} width={10} height={10} fill="white" stroke="black" strokeOpacity={0.5} />}
						<text x={corners[0].x} y={corners[0].y - 5} className="fill-white text-[11px] font-medium" style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,.55)", strokeWidth: 3 }}>
							{label}
						</text>
					</>
				)}
				{rect && (
					<rect
						x={Math.min(rect.x0, rect.x1)}
						y={Math.min(rect.y0, rect.y1)}
						width={Math.abs(rect.x1 - rect.x0)}
						height={Math.abs(rect.y1 - rect.y0)}
						fill="rgba(255,255,255,0.08)"
						stroke="white"
						strokeWidth={1.5}
					/>
				)}
			</svg>
			{capturing && !inClip && (
				<div className="absolute top-2 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-2 py-1 text-xs text-white">Move the playhead over the clip</div>
			)}
		</div>
	);
}

const ATTACHABLE = new Set(["text", "sticker", "image", "video", "graphic"]);

/** Where a clip's picture lands in the overlay at a time (its transform then, the tracker's frame). */
function clipGeometry(editor: EditorCore, clip: VideoElement, frameOf: [number, number] | undefined, time: number, canvas: { width: number; height: number }, sceneWidth: number): Geometry {
	const asset = editor.media.getAssets().find((m) => m.id === clip.mediaId);
	const localTime = getElementLocalTime({ timelineTime: Math.min(Math.max(time, clip.startTime), clip.startTime + clip.duration - 1), elementStartTime: clip.startTime, elementDuration: clip.duration });
	return {
		transform: resolveTransformAtTime({ baseTransform: buildTransformFromParams({ params: clip.params }), animations: clip.animations, localTime }),
		frame: frameOf ?? [asset?.width ?? canvas.width, asset?.height ?? canvas.height],
		canvas,
		k: sceneWidth / canvas.width,
	};
}

/**
 * A layer selected (text, sticker, photo, video, graphic): every tracked object under the playhead shows «📌 Attach»
 * on the preview — a click makes the layer move with it (one ⌘Z); «Attached ✓» takes it off again.
 */
function AttachTargets({ sceneWidth, sceneHeight }: { sceneWidth: number; sceneHeight: number }) {
	const editor = useEditor();
	const draw = useMotionStore((s) => s.draw);
	const selectedId = useEditor((e) => {
		const sel = e.selection.getSelectedElements();
		return sel.length === 1 ? sel[0].elementId : null;
	}, ["selection"]);
	const tracks = useEditor((e) => e.scenes.getActiveSceneOrNull()?.tracks ?? null, ["scenes", "timeline"]);
	const canvas = useEditor((e) => e.project.getActiveOrNull()?.settings.canvasSize ?? null, ["project"]);
	const time = useEditor((e) => e.playback.getCurrentTime(), ["playback"]);
	if (draw || !selectedId || !tracks || !canvas) return null;
	const layer = (tracks.overlay as TimelineTrack[]).flatMap((t) => t.elements as TimelineElement[]).find((el) => el.id === selectedId);
	if (!layer || !ATTACHABLE.has(layer.type)) return null;
	const targets: Array<{ key: string; clipId: string; trackerId: string; name: string; corners: Array<{ x: number; y: number }>; on: boolean }> = [];
	for (const track of [tracks.main, ...tracks.overlay] as TimelineTrack[]) {
		for (const el of track.elements as TimelineElement[]) {
			if (el.type !== "video" || el.id === layer.id || time < el.startTime || time >= el.startTime + el.duration) continue;
			const clip = el as VideoElement;
			for (const tracker of clip.trackers ?? []) {
				const box = trackBoxAt(tracker, clipSourceSeconds(clip, time));
				if (!box) continue;
				const g = clipGeometry(editor, clip, tracker.frame, time, canvas, sceneWidth);
				const x = box.cx - box.w / 2;
				const y = box.cy - box.h / 2;
				const corners = [toOverlay(g, x, y), toOverlay(g, x + box.w, y), toOverlay(g, x + box.w, y + box.h), toOverlay(g, x, y + box.h)];
				const link = (layer as { follow?: { trackerId: string } }).follow;
				targets.push({ key: `${clip.id}:${tracker.id}`, clipId: clip.id, trackerId: tracker.id, name: tracker.name, corners, on: link?.trackerId === tracker.id });
			}
		}
	}
	if (!targets.length) return null;
	return (
		<div className="absolute inset-0" style={{ width: sceneWidth, height: sceneHeight, pointerEvents: "none" }} data-motion-attach-targets>
			<svg className="absolute inset-0 overflow-visible" width={sceneWidth} height={sceneHeight} aria-hidden>
				{targets.map((t) => (
					<polygon key={t.key} points={t.corners.map((c) => `${c.x},${c.y}`).join(" ")} fill="none" stroke={t.on ? "#22d3ee" : "white"} strokeOpacity={0.9} strokeWidth={1.5} strokeDasharray={t.on ? undefined : "5 4"} />
				))}
			</svg>
			{targets.map((t) => (
				<button
					key={t.key}
					type="button"
					data-motion-attach={t.trackerId}
					aria-pressed={t.on}
					className="absolute rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-black/85"
					style={{ left: Math.min(...t.corners.map((c) => c.x)), top: Math.max(0, Math.min(...t.corners.map((c) => c.y)) - 22), pointerEvents: "auto" }}
					onPointerDown={(e) => e.stopPropagation()}
					onClick={(e) => {
						e.stopPropagation();
						if (t.on) detachFollower(editor, layer.id);
						else attachFollower(editor, layer.id, t.clipId, t.trackerId, {});
					}}
				>
					{t.on ? `Attached to ${t.name} ✓` : `📌 Attach to ${t.name}`}
				</button>
			))}
		</div>
	);
}

export const motionPreviewOverlaySource: PreviewOverlaySourceResult = {
	definitions: [],
	instances: [
		{
			id: "motion-tracker",
			mount: { kind: "scene" },
			plane: "over-interaction",
			pointerEvents: "none",
			zIndex: 5,
			render: ({ sceneWidth, sceneHeight }) => <TrackerOverlay sceneWidth={sceneWidth} sceneHeight={sceneHeight} />,
		},
		{
			id: "motion-attach",
			mount: { kind: "scene" },
			plane: "over-interaction",
			pointerEvents: "none",
			zIndex: 6,
			render: ({ sceneWidth, sceneHeight }) => <AttachTargets sceneWidth={sceneWidth} sceneHeight={sceneHeight} />,
		},
	],
};
