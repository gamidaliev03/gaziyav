"use client";

// Voice activity for ducking: music goes down only while someone actually speaks, not for the
// whole length of a talking-head clip. Works on the peak summary the timeline already builds
// for waveforms (one decode per source, shared), so it costs a few ms per clip.
import { waveformCache } from "@/services/waveform-cache/service";
import { detectSpeech, type SourceRange } from "./speech-detect";

export { detectSpeech, type SourceRange };

const results = new Map<string, SourceRange[] | null>();
const pending = new Map<string, Promise<SourceRange[] | null>>();

export interface SpeechSource {
	sourceKey: string;
	sourceFile?: File;
	audioUrl?: string;
}

/** Analyses once per source; null when the audio cannot be read (caller ducks the whole clip). */
export function analyseSpeech(source: SpeechSource): Promise<SourceRange[] | null> {
	const done = results.get(source.sourceKey);
	if (done !== undefined) return Promise.resolve(done);
	let p = pending.get(source.sourceKey);
	if (!p) {
		p = waveformCache
			.getSourceSummary(source)
			.then(detectSpeech)
			.catch(() => null)
			.then((ranges) => {
				results.set(source.sourceKey, ranges);
				pending.delete(source.sourceKey);
				return ranges;
			});
		pending.set(source.sourceKey, p);
	}
	return p;
}

/** Already-known result without waiting (preview start must never block on analysis). */
export function speechIfReady(source: SpeechSource): SourceRange[] | null | undefined {
	const done = results.get(source.sourceKey);
	if (done === undefined) void analyseSpeech(source);
	return done;
}
