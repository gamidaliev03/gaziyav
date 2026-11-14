"use client";

// Ducking drawn on the clip: the waveform dips where the music goes down under speech.
import { useEffect, useMemo, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import type { AudioCapableElement } from "@/timeline/audio-state";
import { TICKS_PER_SECOND } from "@/wasm";
import { type DuckRange, collectVoiceRanges, duckDbAt, type VoiceSource } from "./envelope";
import { readMixSettings } from "./fades";
import { analyseSpeech, speechIfReady } from "./speech";

/** Voice ranges for a clip that ducks (null when it does not); updates when analysis lands. */
function useDuckRanges(element: AudioCapableElement): readonly DuckRange[] | null {
	const ducks = readMixSettings(element).duck;
	const tracks = useEditor((e) => (ducks ? e.scenes.getActiveScene().tracks : null), ["scenes", "timeline"]);
	const assets = useEditor((e) => (ducks ? e.media.getAssets() : null), ["media"]);
	const [version, setVersion] = useState(0);
	const [pending, setPending] = useState<VoiceSource[]>([]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: version re-reads the speech analysis when it lands
	const ranges = useMemo(() => {
		if (!tracks || !assets) return null;
		const waiting: VoiceSource[] = [];
		const result = collectVoiceRanges({
			tracks,
			mediaAssets: assets,
			speech: (source) => {
				const known = speechIfReady(source);
				if (known === undefined) waiting.push(source);
				return known;
			},
		});
		queueMicrotask(() => setPending((prev) => (prev.length === 0 && waiting.length === 0 ? prev : waiting)));
		return result;
		// biome-ignore lint/correctness/useExhaustiveDependencies: version re-runs after analysis
	}, [tracks, assets, version]);
	useEffect(() => {
		if (pending.length === 0) return;
		let alive = true;
		void Promise.all(pending.map((s) => analyseSpeech(s))).then(() => {
			if (alive) setVersion((v) => v + 1);
		});
		return () => {
			alive = false;
		};
	}, [pending]);
	return ranges;
}

/** Waveform gain samples × ducking (same curve as playback and export). */
export function useDuckedGainSamples(element: AudioCapableElement, samples: number[]): number[] {
	const ranges = useDuckRanges(element);
	return useMemo(() => {
		if (!ranges || ranges.length === 0) return samples;
		const start = element.startTime / TICKS_PER_SECOND;
		const duration = element.duration / TICKS_PER_SECOND;
		const n = samples.length;
		return samples.map((g, i) => g * 10 ** (duckDbAt(ranges, start + ((i + 0.5) / n) * duration) / 20));
	}, [ranges, samples, element.startTime, element.duration]);
}
