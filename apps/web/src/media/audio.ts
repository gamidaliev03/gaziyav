import type {
	AudioElement,
	VideoElement,
	LibraryAudioElement,
	RetimeConfig,
	SceneTracks,
} from "@/timeline";
import { shouldMaintainPitch } from "@/retime/rate";
import type { MediaAsset } from "@/media/types";
import { applyAudioMasteringToBuffer } from "@/media/audio-mastering";
import type { AudioCapableElement } from "@/timeline/audio-state";
import {
	isElementMuted,
	resolveEffectiveAudioGain,
} from "@/timeline/audio-state";
import { doesElementHaveEnabledAudio } from "@/timeline/audio-separation";
import { canElementHaveAudio, hasMediaId } from "@/timeline/element-utils";
import { canTrackHaveAudio } from "@/timeline";
import { mediaSupportsAudio } from "@/media/media-utils";
import { getSourceTimeAtClipTime, renderRetimedBuffer } from "@/retime";
import { Input, ALL_FORMATS, AudioBufferSink } from "mediabunny";
// Safari up to 18 has no AudioDecoder for pages: AAC goes through the system decoder there (a no-op elsewhere)
import "./aac-fallback";
import { fileSource } from "@/media/file-source";
import { gatherChunks, stereoSources, trackBase } from "@/media/audio-gather";
import { clipSampleSpan, clipTimeAtSample } from "@/media/clip-samples";
import { TICKS_PER_SECOND } from "@/wasm";
import {
	computeRmsBuckets,
	type SampleBucket,
} from "@/media/waveform-summary";
import {
	type ClipEnvelope,
	type DuckRange,
	collectVoiceElements,
	collectVoiceRanges,
	voiceSourceOf,
	isEnvelopeDynamic,
	makeClipEnvelope,
	renderEnvelopeGains,
} from "@/sounds/mix/envelope";
import { normalizeLoudness } from "@/sounds/mix/loudness";
import { analyseSpeech, speechIfReady } from "@/sounds/mix/speech";
import { fxSettingsKey, fxSettingsOf, readFxChain } from "@/sounds/mix/fx";
import { create } from "zustand";
import { CENTRE, isPanned, panMatrix, readPan, renderPanValues, writePanMatrix } from "@/sounds/mix/pan";
import { toast } from "sonner";
import { libraryCopy, useMissingLibrary } from "@/library/missing";
import { applyMasterToBuffer } from "@/sound/master";
import { isTrackSilent, silencedBySolo } from "@/sound/solo";

// ---- Per-clip audio effects (sounds/mix/fx.ts) ----
// Each clip source + effect chain + settings is rendered once on this Mac (/api/audio/fx) into a WAV of exactly the
// same length; preview and export both play that file instead of the source. A setting moved in the inspector renders
// again ~300 ms after it stops (not on every step of a drag); until the new file is there, the clip keeps playing the
// one made before («Applying…» in its card), never the dry source.

const fxFiles = new Map<string, Promise<File>>();
const fxDone = new Map<string, File>();
/** The last finished render of each clip (its key and file): played while a newer setting renders. */
const fxLast = new Map<string, { key: string; source: string; file: File }>();
const fxTimers = new Map<string, ReturnType<typeof setTimeout>>();
const FX_DEBOUNCE_MS = 300;

/** Bumped when a render finishes: the player swaps the clip's sound for it (core/managers/audio-manager.ts). */
let fxVersion = 0;
const fxListeners = new Set<() => void>();
export const fxRenderVersion = () => fxVersion;
export function subscribeFxRendered(listener: () => void): () => void {
	fxListeners.add(listener);
	return () => fxListeners.delete(listener);
}

/** Clips whose effects are rendering now (the inspector's «Applying…»), and the last error per clip. */
export const useAudioFxStatus = create<{ applying: Record<string, boolean>; error: Record<string, string> }>(() => ({ applying: {}, error: {} }));
const setApplying = (elementId: string, on: boolean) =>
	useAudioFxStatus.setState((s) => (!!s.applying[elementId] === on ? s : { applying: { ...s.applying, [elementId]: on } }));

function fxKey(element: AudioCapableElement, mediaAsset: MediaAsset | null): { key: string; chain: string; settings: string; source: string } | null {
	const chain = readFxChain(element);
	if (chain.length === 0) return null;
	const source =
		element.type === "audio" && element.sourceType === "library"
			? `library:${element.sourceUrl}`
			: mediaAsset
				? `media:${mediaAsset.id}`
				: null;
	if (!source) return null;
	const settings = fxSettingsOf(element);
	const settingsKey = fxSettingsKey(settings);
	return {
		key: `${source}|${chain.join(",")}${settingsKey ? `|${settingsKey}` : ""}`,
		chain: chain.join(","),
		settings: Object.keys(settings).length ? JSON.stringify(settings) : "",
		source,
	};
}

function encodeWav(buffer: AudioBuffer): Blob {
	const channels = Math.min(MAX_AUDIO_CHANNELS, buffer.numberOfChannels);
	const frames = buffer.length;
	const data = new DataView(new ArrayBuffer(44 + frames * channels * 2));
	const text = (at: number, s: string) => {
		for (let i = 0; i < s.length; i++) data.setUint8(at + i, s.charCodeAt(i));
	};
	text(0, "RIFF");
	data.setUint32(4, 36 + frames * channels * 2, true);
	text(8, "WAVE");
	text(12, "fmt ");
	data.setUint32(16, 16, true);
	data.setUint16(20, 1, true);
	data.setUint16(22, channels, true);
	data.setUint32(24, buffer.sampleRate, true);
	data.setUint32(28, buffer.sampleRate * channels * 2, true);
	data.setUint16(32, channels * 2, true);
	data.setUint16(34, 16, true);
	text(36, "data");
	data.setUint32(40, frames * channels * 2, true);
	const chans = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
	let o = 44;
	for (let i = 0; i < frames; i++) {
		for (const ch of chans) {
			const v = Math.max(-1, Math.min(1, ch[i]));
			data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
			o += 2;
		}
	}
	return new Blob([data.buffer], { type: "audio/wav" });
}

async function decodeSourceForFx(element: AudioCapableElement, mediaAsset: MediaAsset | null): Promise<AudioBuffer> {
	const context = createAudioContext({ sampleRate: EXPORT_SAMPLE_RATE });
	try {
		let buffer: AudioBuffer | null = null;
		if (element.type === "audio" && element.sourceType === "library") {
			const file = await loadLibraryFile(element.sourceUrl, element.name);
			buffer = await context.decodeAudioData(await file.arrayBuffer());
		} else if (mediaAsset) {
			buffer = await resolveAudioBufferForAsset({ asset: mediaAsset, audioContext: context });
		}
		if (!buffer) throw new Error("This clip has no readable audio.");
		return buffer;
	} finally {
		void context.close();
	}
}

/** The decoded source as WAV, kept for the clip's next renders (a slider moved again re-renders from it). */
const fxSources = new Map<string, Promise<Blob>>();

/** The clip's processed audio (started on first call, cached), or null when it has no effects. Export waits for it. */
export function processedAudio(element: AudioCapableElement, mediaAsset: MediaAsset | null): Promise<File> | null {
	const id = fxKey(element, mediaAsset);
	if (!id) return null;
	let pending = fxFiles.get(id.key);
	if (!pending) {
		const timer = fxTimers.get(element.id);
		if (timer) {
			clearTimeout(timer);
			fxTimers.delete(element.id);
		}
		setApplying(element.id, true);
		pending = (async () => {
			let wav = fxSources.get(id.source);
			if (!wav) {
				wav = decodeSourceForFx(element, mediaAsset).then(encodeWav);
				fxSources.set(id.source, wav);
				wav.catch(() => fxSources.delete(id.source));
			}
			const query = new URLSearchParams({ chain: id.chain });
			if (id.settings) query.set("settings", id.settings);
			const r = await fetch(`/api/audio/fx?${query}`, {
				method: "POST",
				headers: { "Content-Type": "audio/wav", "X-Studio": "1" },
				body: await wav,
			});
			if (!r.ok) {
				const data = await r.json().catch(() => null);
				throw new Error(data?.error ?? `Audio effects failed (HTTP ${r.status}).`);
			}
			const file = new File([await r.blob()], `${element.name} (effects).wav`, { type: "audio/wav" });
			fxDone.set(id.key, file);
			fxLast.set(element.id, { key: id.key, source: id.source, file });
			fxVersion++;
			for (const listener of fxListeners) listener();
			return file;
		})();
		pending.then(
			() => {
				setApplying(element.id, false);
				useAudioFxStatus.setState((s) => ({ error: { ...s.error, [element.id]: "" } }));
			},
			(error) => {
				fxFiles.delete(id.key);
				setApplying(element.id, false);
				const message = error instanceof Error ? error.message : String(error);
				useAudioFxStatus.setState((s) => ({ error: { ...s.error, [element.id]: message } }));
				toast.error(`Audio effects on “${element.name}”: ${message}`);
			},
		);
		fxFiles.set(id.key, pending);
	}
	return pending;
}

/**
 * Processed audio for playback, never waiting: this exact render when it is done; else the clip's last render (the
 * settings changed and the new one is on its way — started once they have been still for 300 ms).
 */
function processedIfReady(
	element: AudioCapableElement,
	mediaAsset: MediaAsset | null,
): { file: File; key: string } | null {
	const id = fxKey(element, mediaAsset);
	if (!id) return null;
	const file = fxDone.get(id.key);
	if (file) return { file, key: id.key };
	scheduleRender(element, mediaAsset, id.key);
	const last = fxLast.get(element.id);
	return last && last.source === id.source ? { file: last.file, key: last.key } : null;
}

/** A render for the clip's current settings, once they have stopped changing for a moment (a slider being dragged). */
function scheduleRender(element: AudioCapableElement, mediaAsset: MediaAsset | null, key: string) {
	if (fxFiles.has(key)) return;
	// the first render of a clip starts at once; later ones wait for the settings to settle
	if (!fxLast.has(element.id)) {
		void processedAudio(element, mediaAsset)?.catch(() => {});
		return;
	}
	const previous = fxTimers.get(element.id);
	if (previous) clearTimeout(previous);
	setApplying(element.id, true);
	fxTimers.set(
		element.id,
		setTimeout(() => {
			fxTimers.delete(element.id);
			void processedAudio(element, mediaAsset)?.catch(() => {});
		}, FX_DEBOUNCE_MS),
	);
}

/** Diagnostics (e2e): the processed audio of a clip as the export takes it. */
if (typeof window !== "undefined") {
	(window as unknown as { __gzAudioFx?: unknown }).__gzAudioFx = {
		render: async (element: AudioCapableElement, mediaAsset: MediaAsset | null) => {
			const file = await processedAudio(element, mediaAsset);
			return file ? new Uint8Array(await file.arrayBuffer()) : null;
		},
		key: (element: AudioCapableElement, mediaAsset: MediaAsset | null) => fxKey(element, mediaAsset)?.key ?? null,
		ready: (element: AudioCapableElement, mediaAsset: MediaAsset | null) => {
			const id = fxKey(element, mediaAsset);
			return !!id && fxDone.has(id.key);
		},
		/** The export's own mix (collectAudioElements → processedAudio) of these tracks, as a 16-bit WAV. */
		exportMix: async (tracks: SceneTracks, mediaAssets: MediaAsset[], duration: number) => {
			const buffer = await createTimelineAudioBuffer({ tracks, mediaAssets, duration, normalize: false });
			return buffer ? new Uint8Array(await encodeWav(buffer).arrayBuffer()) : null;
		},
	};
}

/** Runs voice-activity analysis for every voice clip (export waits for it; preview warms it up). */
export async function prepareSpeech({
	tracks,
	mediaAssets,
}: {
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
}): Promise<void> {
	const jobs: Array<Promise<unknown>> = [];
	for (const voice of collectVoiceElements({ tracks, mediaAssets })) {
		const source = voiceSourceOf(voice);
		if (source) jobs.push(analyseSpeech(source));
	}
	// Effects start rendering as soon as they are switched on (this runs on every timeline change); a moved setting
	// waits for the slider to stop.
	for (const { element, mediaAsset } of collectAudibleCandidates({ tracks, mediaAssets })) {
		const id = fxKey(element, mediaAsset);
		if (id && !fxDone.has(id.key)) scheduleRender(element, mediaAsset, id.key);
	}
	await Promise.all(jobs);
}

const MAX_AUDIO_CHANNELS = 2;
const EXPORT_SAMPLE_RATE = 48000;

export interface CollectedAudioElement {
	timelineElement: AudioCapableElement;
	/** Null for a video's own sound: only the part this clip plays is decoded, when it is mixed. */
	buffer: AudioBuffer | null;
	asset?: MediaAsset;
	startTime: number;
	duration: number;
	trimStart: number;
	trimEnd: number;
	volume: number;
	muted: boolean;
	retime?: RetimeConfig;
	/** Volume × fades × ducking, shared with preview playback. */
	envelope: ClipEnvelope;
}

const envelopeFor = (
	element: AudioCapableElement,
	voiceRanges: readonly DuckRange[],
	trackMuted = false,
): ClipEnvelope =>
	makeClipEnvelope({
		element,
		startTime: element.startTime / TICKS_PER_SECOND,
		duration: element.duration / TICKS_PER_SECOND,
		voiceRanges,
		trackMuted,
	});

export function createAudioContext({
	sampleRate,
}: {
	sampleRate?: number;
} = {}): AudioContext {
	const AudioContextConstructor =
		window.AudioContext ||
		(window as typeof window & { webkitAudioContext?: typeof AudioContext })
			.webkitAudioContext;

	return new AudioContextConstructor(sampleRate ? { sampleRate } : undefined);
}

export interface DecodedAudio {
	samples: Float32Array;
	sampleRate: number;
}

export async function decodeAudioToFloat32({
	audioBlob,
	sampleRate,
}: {
	audioBlob: Blob;
	sampleRate?: number;
}): Promise<DecodedAudio> {
	const audioContext = createAudioContext({ sampleRate });
	const arrayBuffer = await audioBlob.arrayBuffer();
	const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

	// mix down to mono
	const numChannels = audioBuffer.numberOfChannels;
	const length = audioBuffer.length;
	const samples = new Float32Array(length);

	for (let i = 0; i < length; i++) {
		let sum = 0;
		for (let channel = 0; channel < numChannels; channel++) {
			sum += audioBuffer.getChannelData(channel)[i];
		}
		samples[i] = sum / numChannels;
	}

	return { samples, sampleRate: audioBuffer.sampleRate };
}

export interface AudibleElementCandidate {
	element: AudioElement | VideoElement;
	mediaAsset: MediaAsset | null;
}

export function collectAudibleCandidates({
	tracks,
	mediaAssets,
}: {
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
}): AudibleElementCandidate[] {
	const allTracks = [...tracks.overlay, tracks.main, ...tracks.audio];
	const mediaMap = new Map(mediaAssets.map((a) => [a.id, a]));
	const candidates: AudibleElementCandidate[] = [];
	// muted, or silenced by another track's Solo (sound/solo.ts): the same answer the player gets
	const silenced = silencedBySolo(tracks);

	for (const track of allTracks) {
		if (isTrackSilent(track, silenced)) continue;

		for (const element of track.elements) {
			if (!canElementHaveAudio(element)) continue;
			if (element.duration <= 0) continue;

			const mediaAsset = hasMediaId(element)
				? (mediaMap.get(element.mediaId) ?? null)
				: null;
			if (!doesElementHaveEnabledAudio({ element, mediaAsset })) continue;

			candidates.push({ element, mediaAsset });
		}
	}

	return candidates;
}

export function timelineHasAudio({
	tracks,
	mediaAssets,
}: {
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
}): boolean {
	return collectAudibleCandidates({ tracks, mediaAssets }).some(
		({ element }) => !isElementMuted({ element }),
	);
}

export async function collectAudioElements({
	tracks,
	mediaAssets,
	audioContext,
}: {
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
	audioContext: AudioContext;
}): Promise<CollectedAudioElement[]> {
	const candidates = collectAudibleCandidates({ tracks, mediaAssets });
	await prepareSpeech({ tracks, mediaAssets });
	const voiceRanges = collectVoiceRanges({ tracks, mediaAssets, speech: speechIfReady });
	const mediaMap = new Map<string, MediaAsset>(
		mediaAssets.map((media) => [media.id, media]),
	);
	const pendingElements: Array<Promise<CollectedAudioElement | null>> = [];
	// A long video cut into 50 clips is one source: decoded once, one source at a time. Each clip used to decode the
	// whole file at once, in parallel, which filled the memory ("Array buffer allocation failed") and froze the Mac.
	const decoded = new Map<string, Promise<AudioBuffer | null>>();
	let queue: Promise<unknown> = Promise.resolve();
	const decodeOnce = (key: string, decode: () => Promise<AudioBuffer | null>) => {
		let pending = decoded.get(key);
		if (!pending) {
			pending = queue.then(decode, decode);
			decoded.set(key, pending);
			queue = pending;
		}
		return pending;
	};

	for (const { element, mediaAsset } of candidates) {
		if (element.type === "audio") {
			pendingElements.push(
				decodeOnce(element.sourceType === "upload" ? `asset:${element.mediaId}` : `library:${element.sourceUrl}`, () =>
					resolveAudioBufferForElement({
						element,
						mediaMap,
						audioContext,
					}),
				).then((audioBuffer) => {
					if (!audioBuffer) return null;
					return {
						timelineElement: element,
						buffer: audioBuffer,
						startTime: element.startTime / TICKS_PER_SECOND,
						duration: element.duration / TICKS_PER_SECOND,
						trimStart: element.trimStart / TICKS_PER_SECOND,
						trimEnd: element.trimEnd / TICKS_PER_SECOND,
						volume: resolveEffectiveAudioGain({
							element,
							trackMuted: false,
							localTime: 0,
						}),
						muted: isElementMuted({ element }),
						retime: element.retime,
						envelope: envelopeFor(element, voiceRanges),
					};
				}),
			);
			continue;
		}

		if (element.type === "video") {
			if (!mediaAsset || !mediaSupportsAudio({ media: mediaAsset })) continue;

			pendingElements.push(
				Promise.resolve({
					timelineElement: element,
					buffer: null,
					asset: mediaAsset,
					startTime: element.startTime / TICKS_PER_SECOND,
					duration: element.duration / TICKS_PER_SECOND,
					trimStart: element.trimStart / TICKS_PER_SECOND,
					trimEnd: element.trimEnd / TICKS_PER_SECOND,
					volume: resolveEffectiveAudioGain({
						element,
						trackMuted: false,
						localTime: 0,
					}),
					muted: isElementMuted({ element }),
					retime: element.retime,
					envelope: envelopeFor(element, voiceRanges),
				}),
			);
		}
	}

	const resolvedElements = await Promise.all(pendingElements);
	const audioElements: CollectedAudioElement[] = [];
	for (const element of resolvedElements) {
		if (element) audioElements.push(element);
	}
	// Clips with effects export their processed audio (same file the preview plays).
	const processed = new Map<File, AudioBuffer>();
	for (const collected of audioElements) {
		const el = collected.timelineElement;
		const asset = hasMediaId(el) ? (mediaMap.get(el.mediaId) ?? null) : null;
		const pending = processedAudio(el, asset);
		if (!pending) continue;
		const file = await pending;
		let buffer = processed.get(file);
		if (!buffer) {
			buffer = await audioContext.decodeAudioData(await file.arrayBuffer());
			processed.set(file, buffer);
		}
		collected.buffer = buffer;
	}
	return audioElements;
}

async function resolveAudioBufferForElement({
	element,
	mediaMap,
	audioContext,
}: {
	element: AudioElement;
	mediaMap: Map<string, MediaAsset>;
	audioContext: AudioContext;
}): Promise<AudioBuffer | null> {
	try {
		if (element.sourceType === "upload") {
			const asset = mediaMap.get(element.mediaId);
			if (!asset) return null;
			return await resolveAudioBufferForAsset({ asset, audioContext });
		}

		if (element.buffer) return element.buffer;

		const file = await loadLibraryFile(element.sourceUrl, element.name);
		const arrayBuffer = await file.arrayBuffer();
		return await audioContext.decodeAudioData(arrayBuffer.slice(0));
	} catch (error) {
		console.warn("Failed to decode audio:", error);
		return null;
	}
}

async function resolveAudioBufferForAsset({
	asset,
	audioContext,
}: {
	asset: MediaAsset;
	audioContext: AudioContext;
}): Promise<AudioBuffer | null> {
	if (asset.type === "audio") {
		try {
			const arrayBuffer = await asset.file.arrayBuffer();
			return await audioContext.decodeAudioData(arrayBuffer.slice(0));
		} catch (error) {
			console.warn("Failed to decode audio asset:", error);
			return null;
		}
	}

	const input = new Input({
		source: fileSource(asset.file),
		formats: ALL_FORMATS,
	});

	try {
		const audioTrack = await input.getPrimaryAudioTrack();
		if (!audioTrack) return null;

		const sink = new AudioBufferSink(audioTrack);
		const targetSampleRate = audioContext.sampleRate;
		const seconds = await audioTrack.computeDuration();

		// Straight into one buffer sized for the whole track: an hour is 700 MB once, not four times. Placed from the same
		// zero as the mixdown's windowed reader (audio-gather.ts): a sound that starts late keeps its silence.
		const base = await trackBase(sink.buffers(0, 0.001));
		const got = await gatherChunks(sink.buffers(0), { context: audioContext, base, from: 0, to: seconds, maxChannels: MAX_AUDIO_CHANNELS });
		if (!got) return null;
		const nativeBuffer = got.buffer;
		const nativeSampleRate = nativeBuffer.sampleRate;
		if (nativeSampleRate === targetSampleRate) return nativeBuffer;

		// use OfflineAudioContext for high-quality resampling to target rate
		const offlineContext = new OfflineAudioContext(
			nativeBuffer.numberOfChannels,
			Math.ceil(got.written * (targetSampleRate / nativeSampleRate)),
			targetSampleRate,
		);

		const sourceNode = offlineContext.createBufferSource();
		sourceNode.buffer = nativeBuffer;
		sourceNode.connect(offlineContext.destination);
		sourceNode.start(0);

		return await offlineContext.startRendering();
	} catch (error) {
		console.warn("Failed to decode asset audio:", error);
		return null;
	} finally {
		input.dispose();
	}
}

export interface AudioClipSource {
	timelineElement: AudioCapableElement;
	id: string;
	/** The track the clip plays on (the mixer's meters are per track). */
	trackId?: string;
	sourceKey: string;
	file: File;
	startTime: number;
	duration: number;
	trimStart: number;
	trimEnd: number;
	volume: number;
	muted: boolean;
	retime?: RetimeConfig;
	/** Volume × fades × ducking for preview; same function the export uses. */
	envelope?: ClipEnvelope;
}

// Library sounds are downloaded once per session, not on every Play. When the library can't give one (a build without
// that catalog, a sound taken off it, offline for a remote one), the project's own copy plays; with none either, the
// clip is marked missing (the timeline says so, with Replace) and the export goes on without it.
const libraryFiles = new Map<string, Promise<File>>();

function loadLibraryFile(url: string, name: string): Promise<File> {
	let file = libraryFiles.get(url);
	if (!file) {
		file = fetch(url)
			.then(async (response) => {
				if (!response.ok) throw new Error(`Library audio fetch failed: ${response.status}`);
				const type = response.headers.get("content-type") || "audio/mpeg";
				useMissingLibrary.getState().markFound(url);
				return new File([await response.blob()], name, { type });
			})
			.catch(async (error) => {
				const copy = await libraryCopy(url);
				if (copy) {
					useMissingLibrary.getState().markFound(url);
					return copy;
				}
				useMissingLibrary.getState().markMissing(url);
				throw error;
			});
		libraryFiles.set(url, file);
		file.catch(() => libraryFiles.delete(url));
	}
	return file;
}

async function fetchLibraryAudioClip({
	element,
	muted,
	volume,
}: {
	element: LibraryAudioElement;
	muted: boolean;
	volume: number;
}): Promise<AudioClipSource | null> {
	try {
		// Shared per-session file cache; times in seconds like every other clip source
		// (they used to be raw ticks here, so library sounds never played in preview).
		const file = await loadLibraryFile(element.sourceUrl, element.name);

		return {
			timelineElement: element,
			id: element.id,
			sourceKey: `library:${element.sourceUrl}`,
			file,
			startTime: element.startTime / TICKS_PER_SECOND,
			duration: element.duration / TICKS_PER_SECOND,
			trimStart: element.trimStart / TICKS_PER_SECOND,
			trimEnd: element.trimEnd / TICKS_PER_SECOND,
			volume,
			muted,
			retime: element.retime,
		};
	} catch (error) {
		console.warn("Failed to fetch library audio:", error);
		return null;
	}
}

function collectMediaAudioClip({
	element,
	mediaAsset,
	muted,
	volume,
}: {
	element: AudioCapableElement;
	mediaAsset: MediaAsset;
	muted: boolean;
	volume: number;
}): AudioClipSource {
	return {
		timelineElement: element,
		id: element.id,
		sourceKey: mediaAsset.id,
		file: mediaAsset.file,
		startTime: element.startTime / TICKS_PER_SECOND,
		duration: element.duration / TICKS_PER_SECOND,
		trimStart: element.trimStart / TICKS_PER_SECOND,
		trimEnd: element.trimEnd / TICKS_PER_SECOND,
		volume,
		muted,
		retime: element.retime,
	};
}

export async function collectAudioClips({
	tracks,
	mediaAssets,
}: {
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
}): Promise<AudioClipSource[]> {
	const orderedTracks = [...tracks.overlay, tracks.main, ...tracks.audio];
	const clips: AudioClipSource[] = [];
	const mediaMap = new Map<string, MediaAsset>(
		mediaAssets.map((asset) => [asset.id, asset]),
	);
	const pendingLibraryClips: Array<Promise<AudioClipSource | null>> = [];
	// Never wait here (playback start): use the analysis if it is ready, else duck whole clips.
	const voiceRanges = collectVoiceRanges({ tracks, mediaAssets, speech: speechIfReady });
	const withEnvelope = (
		clip: AudioClipSource | null,
		trackMuted: boolean,
	): AudioClipSource | null => {
		if (!clip) return clip;
		clip.envelope = envelopeFor(clip.timelineElement, voiceRanges, trackMuted);
		const el = clip.timelineElement;
		const fx = processedIfReady(el, hasMediaId(el) ? (mediaMap.get(el.mediaId) ?? null) : null);
		if (fx) {
			clip.file = fx.file;
			clip.sourceKey = fx.key;
		}
		return clip;
	};

	const silenced = silencedBySolo(tracks);
	for (const track of orderedTracks) {
		const isTrackMuted = isTrackSilent(track, silenced);

		for (const element of track.elements) {
			if (!canElementHaveAudio(element)) continue;

			const mediaAsset = hasMediaId(element)
				? (mediaMap.get(element.mediaId) ?? null)
				: null;
			if (!doesElementHaveEnabledAudio({ element, mediaAsset })) continue;

			const muted = isTrackMuted || isElementMuted({ element });
			const volume = resolveEffectiveAudioGain({
				element,
				trackMuted: isTrackMuted,
				localTime: 0,
			});

			if (element.type === "audio") {
				if (element.sourceType === "upload") {
					const mediaAsset = mediaMap.get(element.mediaId);
					if (!mediaAsset) continue;

					clips.push(
						withEnvelope(
							collectMediaAudioClip({
								element,
								mediaAsset,
								muted,
								volume,
							}),
							isTrackMuted,
						) as AudioClipSource,
					);
				} else {
					pendingLibraryClips.push(
						fetchLibraryAudioClip({ element, muted, volume }).then((clip) =>
							withEnvelope(clip, isTrackMuted),
						),
					);
				}
				continue;
			}

			if (element.type === "video") {
				if (mediaAsset && mediaSupportsAudio({ media: mediaAsset })) {
					clips.push(
						withEnvelope(
							collectMediaAudioClip({
								element,
								mediaAsset,
								muted,
								volume,
							}),
							isTrackMuted,
						) as AudioClipSource,
					);
				}
			}
		}
	}

	const resolvedLibraryClips = await Promise.all(pendingLibraryClips);
	for (const clip of resolvedLibraryClips) {
		if (clip) clips.push(clip);
	}

	// the track each clip plays on (the mixer's meters are per track: sound/player.ts)
	const trackOf = new Map<string, string>();
	for (const track of orderedTracks) for (const element of track.elements) trackOf.set(element.id, track.id);
	for (const clip of clips) clip.trackId = trackOf.get(clip.id);

	return clips;
}

export async function createTimelineAudioBuffer({
	tracks,
	mediaAssets,
	duration,
	sampleRate = EXPORT_SAMPLE_RATE,
	audioContext,
	normalize = false,
	targetLufs,
	stage = "master",
}: {
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
	duration: number;
	sampleRate?: number;
	audioContext?: AudioContext;
	/** Bring the mix to −14 LUFS (TikTok / Reels / YouTube loudness) with a peak limiter. */
	normalize?: boolean;
	/** Settings → Edit → Target loudness (default −14 LUFS). */
	targetLufs?: number;
	/** "mix": the bare sum of the clips, before the timeline's master (the loudness measure reads it: sound/measure.ts). */
	stage?: "mix" | "master";
}): Promise<AudioBuffer | null> {
	const context = audioContext ?? createAudioContext({ sampleRate });

	const audioElements = await collectAudioElements({
		tracks,
		mediaAssets,
		audioContext: context,
	});

	if (audioElements.length === 0) return null;

	const outputChannels = 2;
	const durationSeconds = duration / TICKS_PER_SECOND;
	const outputLength = Math.ceil(durationSeconds * sampleRate);
	const outputBuffer = context.createBuffer(
		outputChannels,
		outputLength,
		sampleRate,
	);

	const reader = clipAudioReader(context);
	try {
		for (const element of audioElements) {
			if (element.muted) continue;
			if (element.buffer) {
				await mixDecodedClip({ element, buffer: element.buffer, trimStart: element.trimStart, context, outputBuffer, outputLength, sampleRate });
			} else if (element.asset) {
				await mixClipFromFile({ element, asset: element.asset, reader, context, outputBuffer, outputLength, sampleRate });
			}
		}
	} finally {
		reader.dispose();
	}

	if (stage === "mix") return outputBuffer;
	// The timeline's master (its fader and true-peak limiter): the same arithmetic the player runs (sound/master.ts).
	await applyMasterToBuffer({ buffer: outputBuffer, tracks });

	if (normalize) {
		const channels = Array.from({ length: outputChannels }, (_, c) =>
			outputBuffer.getChannelData(c),
		);
		const result = await normalizeLoudness({ channels, sampleRate, ...(targetLufs ? { targetLufs } : {}) });
		console.info(
			`[audio] loudness ${result.before.lufs.toFixed(1)} → ${result.after.lufs.toFixed(1)} LUFS (${result.gainDb >= 0 ? "+" : ""}${result.gainDb.toFixed(1)} dB), peak ${result.after.peakDb.toFixed(1)} dBFS`,
		);
	}

	return await applyAudioMasteringToBuffer({ audioBuffer: outputBuffer });
}

/** A clip whose source is already decoded, whole. */
async function mixDecodedClip({
	element,
	buffer,
	trimStart,
	context,
	outputBuffer,
	outputLength,
	sampleRate,
}: {
	element: CollectedAudioElement;
	buffer: AudioBuffer;
	trimStart: number;
	context: AudioContext;
	outputBuffer: AudioBuffer;
	outputLength: number;
	sampleRate: number;
}) {
	const renderedBuffer = shouldMaintainPitch({
		rate: element.retime?.rate ?? 1,
		maintainPitch: element.retime?.maintainPitch,
	})
		? await renderRetimedBuffer({
				audioContext: context,
				sourceBuffer: buffer,
				trimStart,
				clipDuration: element.duration,
				retime: element.retime,
				maintainPitch: true,
			})
		: undefined;

	mixAudioChannels({
		element,
		buffer: renderedBuffer ?? buffer,
		trimStart: renderedBuffer ? 0 : trimStart,
		retime: renderedBuffer ? undefined : element.retime,
		outputBuffer,
		outputLength,
		sampleRate,
	});
}

// A video's sound is decoded a minute at a time, only the part on the timeline: a 10-minute edit of a one-hour source
// reads 10 minutes, and an hour-long export holds one minute of the source in memory, not all of it.
const MIX_WINDOW_SECONDS = 60;
/** Extra source each side: resampling and rounding never run off the decoded part. */
const MIX_MARGIN_SECONDS = 0.25;

async function mixClipFromFile({
	element,
	asset,
	reader,
	context,
	outputBuffer,
	outputLength,
	sampleRate,
}: {
	element: CollectedAudioElement;
	asset: MediaAsset;
	reader: ReturnType<typeof clipAudioReader>;
	context: AudioContext;
	outputBuffer: AudioBuffer;
	outputLength: number;
	sampleRate: number;
}) {
	const { duration, retime, trimStart } = element;
	const read = (from: number, to: number) =>
		reader.read(
			asset,
			Math.max(0, trimStart + getSourceTimeAtClipTime({ clipTime: from, retime, duration }) - MIX_MARGIN_SECONDS),
			trimStart + getSourceTimeAtClipTime({ clipTime: to, retime, duration }) + MIX_MARGIN_SECONDS,
		);

	// Pitch-kept speed is stretched as one piece.
	if (shouldMaintainPitch({ rate: retime?.rate ?? 1, maintainPitch: retime?.maintainPitch })) {
		const span = await read(0, duration);
		if (span) await mixDecodedClip({ element, buffer: span.buffer, trimStart: trimStart - span.from, context, outputBuffer, outputLength, sampleRate });
		return;
	}

	const shape = clipShape(element, sampleRate);
	const renderedLength = clipSampleSpan(element, sampleRate).length;
	for (let start = 0; start < duration; start += MIX_WINDOW_SECONDS) {
		const end = start + MIX_WINDOW_SECONDS;
		const span = await read(start, Math.min(end, duration));
		if (!span) return;
		mixAudioChannels({
			element,
			buffer: span.buffer,
			trimStart: trimStart - span.from,
			retime,
			outputBuffer,
			outputLength,
			sampleRate,
			range: [Math.floor(start * sampleRate), end >= duration ? renderedLength : Math.floor(end * sampleRate)],
			shape,
		});
	}
}

/** Parts of the assets' sound tracks, at the context's rate; each asset's file stays open until `dispose`. */
function clipAudioReader(audioContext: AudioContext) {
	const opened = new Map<string, Promise<{ input: Input; sink: AudioBufferSink; base: number } | null>>();
	const open = async (asset: MediaAsset) => {
		const input = new Input({ source: fileSource(asset.file), formats: ALL_FORMATS });
		const track = await input.getPrimaryAudioTrack();
		if (!track) {
			input.dispose();
			return null;
		}
		const sink = new AudioBufferSink(track);
		// Source time 0 is the track's zero (audio-gather.ts), as in the whole-file decode.
		const base = await trackBase(sink.buffers(0, 0.001));
		return { input, sink, base };
	};
	return {
		/** `from` in the answer is the source time of the buffer's first sample. */
		read: async (asset: MediaAsset, from: number, to: number): Promise<{ buffer: AudioBuffer; from: number } | null> => {
			try {
				let source = opened.get(asset.id);
				if (!source) {
					source = open(asset);
					opened.set(asset.id, source);
				}
				const track = await source;
				if (!track) return null;
				const got = await gatherChunks(track.sink.buffers(track.base + from, track.base + to), { context: audioContext, base: track.base, from, to, maxChannels: MAX_AUDIO_CHANNELS });
				if (!got) return null;
				const { buffer: output, from: start, written } = got;
				if (output.sampleRate === audioContext.sampleRate) return { buffer: output, from: start };
				const offline = new OfflineAudioContext(
					output.numberOfChannels,
					Math.ceil(written * (audioContext.sampleRate / output.sampleRate)),
					audioContext.sampleRate,
				);
				const node = offline.createBufferSource();
				node.buffer = output;
				node.connect(offline.destination);
				node.start(0);
				return { buffer: await offline.startRendering(), from: start };
			} catch (error) {
				console.warn("Failed to decode clip audio:", error);
				return null;
			}
		},
		dispose: () => {
			for (const source of opened.values()) void source.then((track) => track?.input.dispose(), () => {});
			opened.clear();
		},
	};
}

export function getSampleBucketRange({
	startSample,
	endSample,
	bucketIndex,
	bucketCount,
}: {
	startSample: number;
	endSample: number;
	bucketIndex: number;
	bucketCount: number;
}): {
	bucketStart: number;
	bucketEnd: number;
} {
	const rangeLength = Math.max(0, endSample - startSample);
	const bucketStart =
		startSample + Math.floor((bucketIndex * rangeLength) / bucketCount);
	const bucketEnd =
		startSample + Math.floor(((bucketIndex + 1) * rangeLength) / bucketCount);
	return {
		bucketStart,
		bucketEnd: Math.max(bucketStart, bucketEnd),
	};
}

export function extractRmsBuckets({
	buffer,
	buckets,
}: {
	buffer: AudioBuffer;
	buckets: SampleBucket[];
}): number[] {
	return computeRmsBuckets({ buffer, buckets });
}

/** A clip's volume and pan over its whole length, worked out once however many pieces it is mixed in. */
function clipShape(element: CollectedAudioElement, sampleRate: number) {
	const renderedLength = clipSampleSpan(element, sampleRate).length;
	return {
		gains: isEnvelopeDynamic(element.envelope) ? renderEnvelopeGains(element.envelope, renderedLength, sampleRate) : null,
		pans: isPanned(element.timelineElement) ? renderPanValues(element.timelineElement, renderedLength, sampleRate) : null,
	};
}

function mixAudioChannels({
	element,
	buffer,
	trimStart,
	retime,
	outputBuffer,
	outputLength,
	sampleRate,
	range,
	shape,
}: {
	element: CollectedAudioElement;
	buffer: AudioBuffer;
	trimStart: number;
	retime?: RetimeConfig;
	outputBuffer: AudioBuffer;
	outputLength: number;
	sampleRate: number;
	/** The clip's samples to mix, when it is mixed in pieces. */
	range?: [number, number];
	shape?: ReturnType<typeof clipShape>;
}): void {
	const { startTime, duration: elementDuration } = element;

	// Whole samples from the clip's tick times (media/clip-samples.ts): clips that touch on the timeline touch in the mix
	// (the first half of a split used to take one sample of the second, summed twice: a click at every other cut).
	const span = clipSampleSpan(element, sampleRate);
	const outputStartSample = span.start;
	const [firstSample, endSample] = range ?? [0, span.length];
	const { gains, pans } = shape ?? clipShape(element, sampleRate);

	// One stereo side of the source: its own channel, or a 5.1 source's down-mix (L + 0.7071·(C + Ls) …, media/audio-gather.ts)
	// whichever decoder gave the buffer — a 5.1 WAV lost its centre, the dialogue, in the export (pro-heavy, 09.11).
	const sample = (sources: Array<[Float32Array, number]>, i: number): number | null => {
		const clipTime = clipTimeAtSample(span, startTime, i, sampleRate);
		const sourceTime = trimStart + getSourceTimeAtClipTime({ clipTime, retime, duration: elementDuration });
		const sourceIndex = Math.max(0, sourceTime * buffer.sampleRate);
		const length = sources[0][0].length;
		if (sourceIndex >= length) return null;
		const lowerIndex = Math.floor(sourceIndex);
		const upperIndex = Math.min(length - 1, lowerIndex + 1);
		const fraction = sourceIndex - lowerIndex;
		let value = 0;
		for (const [data, gain] of sources) value += gain * (data[lowerIndex] * (1 - fraction) + data[upperIndex] * fraction);
		return value;
	};

	// Pan (sounds/mix/pan.ts): the same matrix the preview's pan stage plays; a mono source is L = R first.
	if (isPanned(element.timelineElement)) {
		const sourceLeft = stereoSources(buffer, 0);
		const sourceRight = stereoSources(buffer, 1);
		const outLeft = outputBuffer.getChannelData(0);
		const outRight = outputBuffer.getChannelData(1);
		const m = pans ? { ...CENTRE } : panMatrix(readPan(element.timelineElement));
		for (let i = firstSample; i < endSample; i++) {
			const outputIndex = outputStartSample + i;
			if (outputIndex >= outputLength) break;
			const l = sample(sourceLeft, i);
			const r = sample(sourceRight, i);
			if (l === null || r === null) break;
			const gain = gains ? gains[i] : element.volume;
			if (pans) writePanMatrix(pans[i], m);
			outLeft[outputIndex] += (m.ll * l + m.lr * r) * gain;
			outRight[outputIndex] += (m.rl * l + m.rr * r) * gain;
		}
		return;
	}

	const outputChannels = 2;
	for (let channel = 0; channel < outputChannels; channel++) {
		const outputData = outputBuffer.getChannelData(channel);
		const sourceData = stereoSources(buffer, channel as 0 | 1);

		for (let i = firstSample; i < endSample; i++) {
			const outputIndex = outputStartSample + i;
			if (outputIndex >= outputLength) break;

			const value = sample(sourceData, i);
			if (value === null) break;
			const gain = gains ? gains[i] : element.volume;
			outputData[outputIndex] += value * gain;
		}
	}
}
