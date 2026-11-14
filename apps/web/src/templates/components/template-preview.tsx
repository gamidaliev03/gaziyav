"use client";

// A template's cover drawn by the same Remotion composition the player and the export use: its motion-graphic layers
// on a 9:16 frame at the moment its first timed layer shows, the whole template looping while the card is hovered.
// Loaded lazily (Remotion stays out of the panel until it is open).
import { Thumbnail } from "@remotion/player";
import { useEffect, useMemo, useState } from "react";
import { MontageComposition } from "@/montage/remotion/composition";
import type { MontageInput } from "@/montage/types";
import { coverMoment, layerParams, placeTemplate, type Template, templateSeconds } from "../catalog";

const FPS = 30;

export default function TemplatePreview({ template, playing }: { template: Template; playing: boolean }) {
	const seconds = templateSeconds(template);
	const frames = Math.round(seconds * FPS);
	const { input, still } = useMemo(() => {
		const items = placeTemplate(template, 0).flatMap(({ part, start, dur }, index) => {
			if (!("mg" in part) || start == null || dur == null) return [];
			// The graphic's picture slots show the cover photo until the user picks one.
			const slots = { photoUrl: template.cover, leftUrl: template.cover, rightUrl: template.cover, screenUrl: template.cover, photo2Url: template.cover, photo3Url: template.cover };
			return [{ id: `${template.id}-${index}`, kind: part.mg, from: start, dur, props: { ...layerParams(template, part), ...slots } }];
		});
		const at = coverMoment(template);
		const input: MontageInput = { items: [...items].reverse(), words: [], origin: "", width: 1080, height: 1920, fps: FPS, durationInFrames: frames };
		return { input, still: Math.min(frames - 1, Math.round(at * FPS)) };
	}, [template, frames]);
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
			compositionWidth={1080}
			compositionHeight={1920}
			durationInFrames={frames}
			fps={FPS}
			frameToDisplay={frame}
			style={{ position: "absolute", inset: 0, width: "100%", height: "100%", background: "transparent" }}
		/>
	);
}
