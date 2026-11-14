"use client";

// A preset's AI layers drawn by the same Remotion composition the preview and the export use: a still after the
// entrance, the whole animation looping while the tile is hovered, zoomed onto what it draws (a plate is a small part
// of a 9:16 frame). Loaded lazily (Remotion stays out of the panel).
import { Thumbnail } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import { KIND_BY_ID } from "@/montage/catalog";
import { MontageComposition } from "@/montage/remotion/composition";
import { layoutDefaults } from "@/montage/run-agent";
import type { MontageInput } from "@/montage/types";
import type { LayersPreset } from "../user-presets";

const FPS = 30;
// The frame the kit is designed for (vertical video).
const WIDTH = 1080;
const HEIGHT = 1920;
/** Room around the drawing, and the most it is enlarged. */
const PAD = 0.12;
const MAX_ZOOM = 14;

interface Fit {
	scale: number;
	x: number;
	y: number;
}

/**
 * The zoom that fills the tile with what is drawn: the union of the drawn elements' boxes, leaving out the
 * frame-sized wrappers (the tile's player, the 9:16 frame fitted inside it, every layer's full-frame box).
 * Null when nothing is drawn yet.
 */
function fitToDrawing(root: HTMLElement): Fit | null {
	const frame = root.getBoundingClientRect();
	if (frame.width < 1 || frame.height < 1) return null;
	// The video frame as the player fits it into the tile (contain).
	const frameWidth = Math.min(frame.width, (frame.height * WIDTH) / HEIGHT);
	const frameHeight = (frameWidth * HEIGHT) / WIDTH;
	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	for (const node of root.querySelectorAll("*")) {
		const r = node.getBoundingClientRect();
		if (r.width < 0.5 || r.height < 0.5) continue;
		if (r.width >= frameWidth * 0.9 && r.height >= frameHeight * 0.9) continue;
		left = Math.min(left, r.left);
		top = Math.min(top, r.top);
		right = Math.max(right, r.right);
		bottom = Math.max(bottom, r.bottom);
	}
	if (!Number.isFinite(left)) return null;
	const width = right - left;
	const height = bottom - top;
	const scale = Math.min(MAX_ZOOM, Math.max(1, Math.min(frame.width / (width * (1 + 2 * PAD)), frame.height / (height * (1 + 2 * PAD)))));
	const cx = (left + right) / 2 - frame.left;
	const cy = (top + bottom) / 2 - frame.top;
	return { scale, x: frame.width / 2 - cx * scale, y: frame.height / 2 - cy * scale };
}

export default function LayerPreview({ preset, playing }: { preset: LayersPreset; playing: boolean }) {
	const durationInFrames = Math.max(2, Math.ceil(preset.duration * FPS) + 1);
	const input = useMemo<MontageInput>(
		() => ({
			items: preset.layers.map((layer, index) => {
				const kind = KIND_BY_ID.get(layer.kind);
				return {
					id: `${preset.id}-${index}`,
					kind: layer.kind,
					from: layer.from,
					dur: Math.max(0.3, layer.to - layer.from),
					props: { ...(kind ? layoutDefaults(kind.fields) : {}), ...layer.props },
				};
			}),
			words: [],
			origin: "",
			width: WIDTH,
			height: HEIGHT,
			fps: FPS,
			durationInFrames,
		}),
		[preset, durationInFrames],
	);
	// Still: once the entrance has played (or the middle of a short preset).
	const still = Math.min(durationInFrames - 1, Math.round(Math.min(1.4, preset.duration / 2) * FPS));
	const [frame, setFrame] = useState(still);
	useEffect(() => {
		if (!playing) {
			setFrame(still);
			return;
		}
		let current = 0;
		setFrame(0);
		const id = window.setInterval(() => {
			current = (current + 1) % durationInFrames;
			setFrame(current);
		}, 1000 / FPS);
		return () => window.clearInterval(id);
	}, [playing, still, durationInFrames]);

	// Measured once on the still (fonts and images need a moment), then kept while it plays.
	const box = useRef<HTMLDivElement>(null);
	const [fit, setFit] = useState<Fit | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: measured again for every new preset input
	useEffect(() => {
		setFit(null);
		const timer = window.setTimeout(() => {
			if (box.current) setFit(fitToDrawing(box.current) ?? { scale: 1, x: 0, y: 0 });
		}, 700);
		return () => window.clearTimeout(timer);
	}, [input]);

	return (
		<div ref={box} className="relative size-full overflow-hidden">
			<div
				className="size-full"
				style={fit ? { transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`, transformOrigin: "0 0" } : { visibility: "hidden" }}
			>
				<Thumbnail
					component={MontageComposition as unknown as React.FC<Record<string, unknown>>}
					inputProps={input as unknown as Record<string, unknown>}
					compositionWidth={WIDTH}
					compositionHeight={HEIGHT}
					durationInFrames={durationInFrames}
					fps={FPS}
					frameToDisplay={frame}
					style={{ width: "100%", height: "100%", background: "transparent" }}
				/>
			</div>
		</div>
	);
}
