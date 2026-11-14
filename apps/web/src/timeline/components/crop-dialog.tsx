"use client";

// CapCut's Crop window (timeline toolbar ✂▢): the clip's frame at the playhead with a crop frame on it — drag inside to
// move it, a corner or a side to resize it; Free / Original / 16:9 / 9:16 / 1:1 / 4:3 / 3:4 keep a shape; Rotate
// straightens the picture (±45°, enlarged so the frame has no empty corner); Reset shows the whole upright frame again;
// Confirm crops the clip (one ⌘Z), Cancel leaves it as it was.
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import type { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { getSourceTimeAtClipTime } from "@/retime";
import {
	cropFillScale,
	cropForRatio,
	MAX_CROP_ROTATION,
	normalizeCrop,
	readCrop,
	withCrop,
	type CropRect,
} from "@/timeline/crop";
import type { ElementRef, TimelineElement } from "@/timeline/types";
import { TICKS_PER_SECOND } from "@/wasm";
import { cn } from "@/utils/ui";

const FULL: CropRect = { x: 0, y: 0, width: 1, height: 1 };
const RATIOS: Array<{ id: string; label: string; ratio: number | "free" | "original" }> = [
	{ id: "free", label: "Free", ratio: "free" },
	{ id: "original", label: "Original", ratio: "original" },
	{ id: "16:9", label: "16:9", ratio: 16 / 9 },
	{ id: "9:16", label: "9:16", ratio: 9 / 16 },
	{ id: "1:1", label: "1:1", ratio: 1 },
	{ id: "4:3", label: "4:3", ratio: 4 / 3 },
	{ id: "3:4", label: "3:4", ratio: 3 / 4 },
];
type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export const useCropDialog = create<{ target: ElementRef | null; open: (target: ElementRef) => void; close: () => void }>()(
	(set) => ({
		target: null,
		open: (target) => set({ target }),
		close: () => set({ target: null }),
	}),
);

/** The toolbar's Crop: opens the window for the first selected video or photo. False when none is selected. */
export function openCropForSelection(editor: EditorCore): boolean {
	const [first] = editor.timeline
		.getElementsWithTracks({ elements: editor.selection.getSelectedElements() })
		.filter(({ element }) => element.type === "video" || element.type === "image");
	if (!first) return false;
	useCropDialog.getState().open({ trackId: first.track.id, elementId: first.element.id });
	return true;
}

export function CropDialog() {
	const target = useCropDialog((s) => s.target);
	const close = useCropDialog((s) => s.close);
	return (
		<Dialog open={!!target} onOpenChange={(open) => !open && close()}>
			{target ? <CropWindow target={target} onClose={close} /> : null}
		</Dialog>
	);
}

function CropWindow({ target, onClose }: { target: ElementRef; onClose: () => void }) {
	const editor = useEditor();
	const element = useMemo(
		() => editor.timeline.getElementsWithTracks({ elements: [target] })[0]?.element ?? null,
		[editor, target],
	) as (TimelineElement & { mediaId?: string }) | null;
	const asset = useMemo(
		() => (element?.mediaId ? (editor.media.getAssets().find((a) => a.id === element.mediaId) ?? null) : null),
		[editor, element],
	);
	const [crop, setCrop] = useState<CropRect>(() => {
		const saved = element ? readCrop(element.params) : null;
		return saved ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : FULL;
	});
	const [rotation, setRotation] = useState(() => (element ? (readCrop(element.params)?.rotation ?? 0) : 0));
	const [ratioId, setRatioId] = useState("free");
	const [source, setSource] = useState<{ width: number; height: number } | null>(
		asset?.width && asset?.height ? { width: asset.width, height: asset.height } : null,
	);
	// The picture's box, measured once it is in the page: the dialog's portal mounts its content a render after this
	// component (an effect on mount found no box: a black window with a frame of no size that couldn't be dragged).
	const [boxEl, setBoxEl] = useState<HTMLDivElement | null>(null);
	const [box, setBox] = useState({ width: 0, height: 0 });

	useEffect(() => {
		if (!boxEl) return;
		const update = () => setBox({ width: boxEl.clientWidth, height: boxEl.clientHeight });
		update();
		const observer = new ResizeObserver(update);
		observer.observe(boxEl);
		return () => observer.disconnect();
	}, [boxEl]);

	if (!element || !asset?.url) {
		return (
			<DialogContent className="max-w-md" data-crop-dialog="">
				<DialogHeader>
					<DialogTitle>Crop</DialogTitle>
					<DialogDescription>Select a video or photo to crop it.</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		);
	}

	// The frame the playhead is on (the first one when the playhead is off the clip).
	const clipTime = Math.min(Math.max(0, editor.playback.getCurrentTime() - element.startTime), element.duration);
	const sourceSeconds =
		(element.trimStart +
			getSourceTimeAtClipTime({ clipTime, retime: "retime" in element ? element.retime : undefined, duration: element.duration })) /
		TICKS_PER_SECOND;

	// Where the frame sits in the window (contain).
	const media = source ?? { width: 16, height: 9 };
	const scale = box.width && box.height ? Math.min(box.width / media.width, box.height / media.height) : 0;
	const shown = { width: media.width * scale, height: media.height * scale };
	const origin = { x: (box.width - shown.width) / 2, y: (box.height - shown.height) / 2 };
	const sourceRatio = media.width / media.height;
	// The picture turns inside the frame's place exactly as the player and the export draw it.
	const fill = cropFillScale({ rotation, sourceWidth: media.width, sourceHeight: media.height });
	const mediaStyle = rotation ? { transform: `rotate(${rotation}deg) scale(${fill})` } : undefined;
	const locked = RATIOS.find((r) => r.id === ratioId)?.ratio;
	const lockedRatio = typeof locked === "number" ? locked : locked === "original" ? sourceRatio : null;

	const pickRatio = (id: string) => {
		setRatioId(id);
		const entry = RATIOS.find((r) => r.id === id);
		if (!entry || entry.ratio === "free") return;
		if (entry.ratio === "original") {
			setCrop(FULL);
			return;
		}
		setCrop(cropForRatio({ ratio: entry.ratio, sourceWidth: media.width, sourceHeight: media.height, around: crop }));
	};

	const startDrag = (handle: Handle) => (event: React.PointerEvent) => {
		event.preventDefault();
		event.stopPropagation();
		const target = event.currentTarget as HTMLElement;
		target.setPointerCapture(event.pointerId);
		const start = { x: event.clientX, y: event.clientY, crop };
		const move = (e: PointerEvent) => {
			if (!shown.width || !shown.height) return;
			const dx = (e.clientX - start.x) / shown.width;
			const dy = (e.clientY - start.y) / shown.height;
			setCrop(dragCrop({ start: start.crop, handle, dx, dy, lockedRatio, sourceRatio }));
		};
		// The frame ends where the button came up: on a quick drag the last moves are merged (or dropped on a busy
		// page) and the frame stopped short of the pointer (a quarter dragged in kept 0.8 of the width).
		const up = (e: PointerEvent) => {
			if (e.type === "pointerup") move(e);
			target.removeEventListener("pointermove", move);
			target.removeEventListener("pointerup", up);
			target.removeEventListener("pointercancel", up);
		};
		target.addEventListener("pointermove", move);
		target.addEventListener("pointerup", up);
		target.addEventListener("pointercancel", up);
	};

	const confirm = () => {
		editor.timeline.updateElements({
			updates: [{ trackId: target.trackId, elementId: target.elementId, patch: { params: withCrop(element.params, { ...crop, rotation }) } }],
		});
		onClose();
	};

	const rect = {
		left: origin.x + crop.x * shown.width,
		top: origin.y + crop.y * shown.height,
		width: crop.width * shown.width,
		height: crop.height * shown.height,
	};

	return (
		<DialogContent
			className="max-w-3xl"
			data-crop-dialog=""
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					confirm();
				}
			}}
		>
			<DialogHeader>
				<DialogTitle>Crop</DialogTitle>
				<DialogDescription>Drag the frame or its handles; Confirm crops the clip.</DialogDescription>
			</DialogHeader>
			<div className="px-6">
				<div ref={setBoxEl} className="relative h-[52vh] max-h-[460px] min-h-[220px] w-full overflow-hidden rounded-md bg-black select-none">
					<div
						className="absolute overflow-hidden"
						style={{ left: origin.x, top: origin.y, width: shown.width, height: shown.height }}
					>
						{asset.type === "image" ? (
							// biome-ignore lint/performance/noImgElement: the clip's own picture from a local blob URL, shown as is
							<img
								src={asset.url}
								alt=""
								data-crop-picture=""
								className="absolute inset-0 size-full"
								style={mediaStyle}
								onLoad={(e) => !source && setSource({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
								draggable={false}
							/>
						) : (
							<video
								src={asset.url}
								muted
								playsInline
								preload="auto"
								data-crop-picture=""
								className="absolute inset-0 size-full"
								style={mediaStyle}
								onLoadedMetadata={(e) => {
									const video = e.currentTarget;
									if (!source && video.videoWidth) setSource({ width: video.videoWidth, height: video.videoHeight });
									video.currentTime = Math.min(sourceSeconds, Math.max(0, (video.duration || sourceSeconds) - 0.05));
								}}
							/>
						)}
					</div>
					{/* The dim outside the frame, the frame with its thirds, the handles. */}
					<div
						data-crop-rect=""
						className="absolute cursor-move border border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
						style={rect}
						onPointerDown={startDrag("move")}
					>
						{/* The rule of thirds. */}
						{["left-1/3", "left-2/3"].map((at) => (
							<span key={at} className={cn("pointer-events-none absolute inset-y-0 w-px bg-white/35", at)} />
						))}
						{["top-1/3", "top-2/3"].map((at) => (
							<span key={at} className={cn("pointer-events-none absolute inset-x-0 h-px bg-white/35", at)} />
						))}
						{HANDLES.map((handle) => (
							<span
								key={handle}
								data-crop-handle={handle}
								onPointerDown={startDrag(handle)}
								className={cn("absolute size-3.5 rounded-[2px] border border-black/40 bg-white", handleClass(handle))}
							/>
						))}
					</div>
				</div>
				<div className="mt-3 flex flex-wrap items-center gap-1.5">
					{RATIOS.map((r) => (
						<Button
							key={r.id}
							size="sm"
							variant={ratioId === r.id ? "secondary" : "outline"}
							data-crop-ratio={r.id}
							aria-pressed={ratioId === r.id}
							onClick={() => pickRatio(r.id)}
						>
							{r.label}
						</Button>
					))}
				</div>
				<div className="mt-3 flex items-center gap-3">
					<span className="text-muted-foreground text-xs">Rotate</span>
					<Slider
						data-crop-rotate=""
						aria-label="Rotate"
						className="max-w-72"
						min={-MAX_CROP_ROTATION}
						max={MAX_CROP_ROTATION}
						step={1}
						origin={0}
						value={[rotation]}
						onValueChange={([value]) => setRotation(value ?? 0)}
					/>
					<span data-crop-rotate-value="" className="w-9 text-right text-xs tabular-nums">
						{rotation}°
					</span>
				</div>
			</div>
			<DialogFooter>
				<Button
					variant="text"
					className="mr-auto"
					data-crop-reset=""
					onClick={() => {
						setRatioId("free");
						setCrop(FULL);
						setRotation(0);
					}}
				>
					Reset
				</Button>
				<Button variant="outline" onClick={onClose} data-crop-cancel="">
					Cancel
				</Button>
				<Button onClick={confirm} data-crop-confirm="">
					Confirm
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}

function handleClass(handle: Handle): string {
	const v = handle.includes("n") ? "-top-1.5" : handle.includes("s") ? "-bottom-1.5" : "top-1/2 -translate-y-1/2";
	const h = handle.includes("w") ? "-left-1.5" : handle.includes("e") ? "-right-1.5" : "left-1/2 -translate-x-1/2";
	const cursor = { n: "cursor-ns-resize", s: "cursor-ns-resize", e: "cursor-ew-resize", w: "cursor-ew-resize", ne: "cursor-nesw-resize", sw: "cursor-nesw-resize", nw: "cursor-nwse-resize", se: "cursor-nwse-resize", move: "cursor-move" }[handle];
	return `${v} ${h} ${cursor}`;
}

/** The crop after dragging `handle` by (dx, dy) — fractions of the frame; a locked shape keeps its pixel ratio. */
export function dragCrop({
	start,
	handle,
	dx,
	dy,
	lockedRatio,
	sourceRatio,
}: {
	start: CropRect;
	handle: Handle;
	dx: number;
	dy: number;
	lockedRatio: number | null;
	sourceRatio: number;
}): CropRect {
	if (handle === "move") {
		return {
			...start,
			x: Math.min(Math.max(0, start.x + dx), 1 - start.width),
			y: Math.min(Math.max(0, start.y + dy), 1 - start.height),
		};
	}
	let left = start.x;
	let top = start.y;
	let right = start.x + start.width;
	let bottom = start.y + start.height;
	if (handle.includes("w")) left = Math.min(right - 0.02, Math.max(0, left + dx));
	if (handle.includes("e")) right = Math.max(left + 0.02, Math.min(1, right + dx));
	if (handle.includes("n")) top = Math.min(bottom - 0.02, Math.max(0, top + dy));
	if (handle.includes("s")) bottom = Math.max(top + 0.02, Math.min(1, bottom + dy));
	let width = right - left;
	let height = bottom - top;
	if (lockedRatio) {
		// In frame fractions a shape of `lockedRatio` (pixels) has width / height = lockedRatio / sourceRatio.
		const k = lockedRatio / sourceRatio;
		const sideways = handle === "e" || handle === "w";
		if (sideways || (handle.length === 2 && Math.abs(dx) >= Math.abs(dy))) height = width / k;
		else width = height * k;
		if (width > 1) {
			width = 1;
			height = width / k;
		}
		if (height > 1) {
			height = 1;
			width = height * k;
		}
		if (handle.includes("w")) left = right - width;
		else if (!handle.includes("e")) left = start.x + (start.width - width) / 2;
		if (handle.includes("n")) top = bottom - height;
		else if (!handle.includes("s")) top = start.y + (start.height - height) / 2;
	}
	return normalizeCrop({ x: left, y: top, width, height });
}
