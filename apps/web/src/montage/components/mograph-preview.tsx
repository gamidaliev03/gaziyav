"use client";

// A motion graphic's tile: the same Remotion component the player and the export draw, on a square frame over a photo
// of its theme (an intro for fitness over a workout, a shop CTA over a product) — a still once its entrance has
// played, the whole animation looping while the tile is hovered. Loaded lazily.
import { Thumbnail } from "@remotion/player";
import { useEffect, useMemo, useState } from "react";
import { MontageComposition } from "@/montage/remotion/composition";
import { type MographKind, mographDefaults, type Theme, themePhoto } from "@/montage/mograph";
import type { MontageInput } from "@/montage/types";

const FPS = 30;
const SIZE = 1080;

export default function MographPreview({
	kind,
	playing,
	theme,
	background,
}: {
	kind: MographKind;
	playing: boolean;
	theme?: Theme;
	/** What is under the graphic: its theme's photo, or (an effect set's tile) the effect's own still. */
	background?: string;
}) {
	const frames = Math.max(2, Math.round(kind.dur * FPS));
	const photo = themePhoto(theme ?? kind.themes[0]);
	const input = useMemo<MontageInput>(() => {
		// The graphic's own picture slots show the theme photo until the user picks one.
		const slots = Object.fromEntries((kind.images ?? []).filter((i) => i.key !== "logo").map((i) => [`${i.key}Url`, photo]));
		return {
			items: [{ id: `tile-${kind.kind}`, kind: kind.kind, from: 0, dur: kind.dur, props: { ...mographDefaults(kind), ...slots } }],
			words: [],
			origin: "",
			width: SIZE,
			height: SIZE,
			fps: FPS,
			durationInFrames: frames,
		};
	}, [kind, frames, photo]);
	const still = Math.min(frames - 1, Math.round((kind.previewAt ?? Math.min(kind.dur * 0.55, 2.2)) * FPS));
	const [frame, setFrame] = useState(still);
	useEffect(() => {
		if (!playing) {
			setFrame(still);
			return;
		}
		let current = 0;
		setFrame(0);
		const id = window.setInterval(() => {
			current = (current + 1) % frames;
			setFrame(current);
		}, 1000 / FPS);
		return () => window.clearInterval(id);
	}, [playing, still, frames]);
	return (
		<Thumbnail
			component={MontageComposition as unknown as React.FC<Record<string, unknown>>}
			inputProps={input as unknown as Record<string, unknown>}
			compositionWidth={SIZE}
			compositionHeight={SIZE}
			durationInFrames={frames}
			fps={FPS}
			frameToDisplay={frame}
			style={{ width: "100%", height: "100%", background: background ?? `#14161c url(${photo}) center / cover` }}
		/>
	);
}
