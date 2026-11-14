// Export as a build (render, 11.11): the same file the exporter always made — one press, one file — written stretch by
// stretch. A stretch (build/segments.ts) that was rendered before with the same key (build/key.ts) is not rendered
// again: its packets come from the app's work folder (build/cache-client.ts) and go into the file as they are. So an
// export that was interrupted goes on from what is done, and after a small change only what it touches is rendered.
//
// The file is one continuous stream: every stretch starts on a key frame (a closed group, nothing refers across the
// join), the encoder's settings are the same for all of them, each frame gets the time its place in the film gives it,
// and the sound is one encode of the whole mix — no join in it at all. A kept stretch is trusted only after its first
// frame is drawn again and looks the same (build/fingerprint.ts): the first of every run always, the rest by sample;
// one that does not look the same starts the export again with every kept stretch looked at. Whatever goes wrong with
// a kept stretch — not there, damaged, another encoder's — that stretch is rendered. Whatever goes wrong with this way
// of exporting as a whole ends in BuildFallback: the caller then renders the old way (services/renderer/scene-exporter.ts).
import EventEmitter from "eventemitter3";
import {
	AudioSampleSource,
	BufferTarget,
	EncodedAudioPacketSource,
	EncodedPacket,
	EncodedVideoPacketSource,
	MovOutputFormat,
	Mp4OutputFormat,
	NullTarget,
	Output,
	StreamTarget,
} from "mediabunny";
import type { FrameRate } from "opencut-wasm";
import { mediaTimeToSeconds } from "opencut-wasm";
import type { ExportFileWriter, ExportQuality } from "@/export";
import { audioEncodingConfig, encoderDelaySamples, videoEncodingConfig } from "@/export/encoder-config";
import { exportedFrameCount, exportedFrameSpan } from "@/export/frame-count";
import { type PrimingEdit, PrimingEditWriter, withAudioPrimingEdit } from "@/export/mp4-edit-list";
import { frameRateToFloat } from "@/fps/utils";
import { CanvasRenderer } from "@/services/renderer/canvas-renderer";
import type { RootNode } from "@/services/renderer/nodes/root-node";
import { AUDIO_AHEAD_SECONDS, audioFeeder, drawCover } from "@/services/renderer/scene-exporter";
import { VideoCache } from "@/services/video-cache/service";
import { TICKS_PER_SECOND } from "@/wasm";
import type { BuildCache, KeptInfo } from "./cache-client";
import { type EntryHead, type EntryPacket, encodeEntry, fromBase64, toBase64 } from "./entry";
import { type Fingerprinter, makeFingerprinter, sameFingerprint } from "./fingerprint";
import { FrameEncoder, avcCodecString, bytesOf } from "./frame-encoder";
import type { SegmentRange } from "./segments";

/** This way of exporting can't make this file: the caller renders it the old way. */
export class BuildFallback extends Error {}
/** A kept stretch did not look the same: start again, looking at every kept stretch before it is used. */
class LookAtAll extends Error {}

export interface BuildSegment extends SegmentRange {
	key: string;
}

/**
 * The mix: freshly made (`buffer` — let go of, set to null, once it is encoded), or its packets as an earlier export
 * encoded them.
 */
export type BuildAudio = { key: string; buffer: AudioBuffer | null } | { key: string; head: EntryHead; packets: EntryPacket[] };

export interface BuildParams {
	width: number;
	height: number;
	outputSize?: { width: number; height: number };
	bitrate?: number;
	toFile?: ExportFileWriter;
	hardwareEncoding?: boolean;
	cover?: { image: CanvasImageSource & { width: number; height: number }; seconds: number };
	/** A master for the server's pass: the sound's edit keeps every packet (ExportOptions.master). */
	master?: boolean;
	fps: FrameRate;
	format: "mp4" | "mov";
	quality: ExportQuality;
	audio: BuildAudio | null;
	segments: BuildSegment[];
	cache: BuildCache;
	/** which stretches (and the mix) are kept, as the cache said before the export began */
	kept: Map<string, KeptInfo>;
}

export type BuildEvents = {
	progress: [progress: number];
	/** seconds left by the measured speed, or null while there is nothing measured yet */
	eta: [seconds: number | null];
	complete: [result: ArrayBuffer | { bytes: number }];
	error: [error: Error];
	cancelled: [];
};

/** The sound's packets as they come (kept ones are all there at once), for the file's muxer. */
interface SoundFeed {
	codec: "aac" | "opus";
	priming: PrimingEdit | null;
	/** how many packets the file's index needs room for */
	packetRoom: number;
	packets: Array<{ packet: EncodedPacket; meta?: EncodedAudioChunkMetadata }>;
	/** resolves when every packet before `seconds` is in `packets` */
	ready: (seconds: number) => Promise<void>;
	/** resolves when all packets are in `packets` */
	whole: () => Promise<void>;
}

/** What the export did, for the notes and the tests: stretches rendered and reused, and the time each kind took. */
export interface BuildReport {
	segments: number;
	rendered: number;
	reused: number;
	lookedAt: number;
	framesRendered: number;
	framesReused: number;
	renderMs: number;
	reuseMs: number;
	audio: "none" | "reused" | "encoded";
	restarted: boolean;
}

/**
 * One kept stretch in this many seconds of film is looked at before use (the first of every run always is) — in a
 * long film less often, so that the looks stay about MAX_SPREAD_LOOKS in all: each one is a seek and a drawn frame.
 */
const LOOK_EVERY_SECONDS = 20;
const MAX_SPREAD_LOOKS = 24;
const micros = (seconds: number) => Math.trunc(1e6 * (1 + Number.EPSILON) * seconds);

export class BuildExporter extends EventEmitter<BuildEvents> {
	private renderer: CanvasRenderer;
	private isCancelled = false;
	private bytesWritten = 0;
	private primingEdit: PrimingEdit | null = null;
	private soundFeed: SoundFeed | null = null;
	report: BuildReport = { segments: 0, rendered: 0, reused: 0, lookedAt: 0, framesRendered: 0, framesReused: 0, renderMs: 0, reuseMs: 0, audio: "none", restarted: false };

	constructor(private params: BuildParams) {
		super();
		// Own decoder cache: preview seeks/scrubs must never move the export's decoders (that corrupted exported frames).
		this.renderer = new CanvasRenderer({ width: params.width, height: params.height, fps: params.fps, videoCache: new VideoCache() });
	}

	cancel(): void {
		this.isCancelled = true;
	}

	async export({ rootNode }: { rootNode: RootNode }): Promise<ArrayBuffer | { bytes: number } | null> {
		// The compositor is a global: hold it for the whole export so the live preview can't render into it.
		this.renderer.acquireExclusive();
		try {
			try {
				return await this.run(rootNode, false);
			} catch (error) {
				if (!(error instanceof LookAtAll)) throw error;
				// (the file starts again: every kept stretch is looked at this time; what was rendered meanwhile is kept)
				if (this.params.toFile && !this.params.toFile.reset) throw new BuildFallback("a kept stretch did not look the same");
				await this.params.toFile?.reset?.();
				this.bytesWritten = 0;
				this.primingEdit = null;
				this.report = { ...this.report, rendered: 0, reused: 0, lookedAt: 0, framesRendered: 0, framesReused: 0, renderMs: 0, reuseMs: 0, restarted: true };
				// (what the first try rendered is kept by now: asked again, so it is not rendered twice)
				this.params.kept = await this.params.cache.have(this.params.segments.map((segment) => segment.key));
				return await this.run(rootNode, true);
			}
		} finally {
			this.renderer.releaseExclusive();
			this.renderer.videoCache.clearAll();
		}
	}

	private async run(rootNode: RootNode, lookAtAll: boolean): Promise<ArrayBuffer | { bytes: number } | null> {
		const { params } = this;
		const fpsFloat = frameRateToFloat(params.fps);
		if (!(Number.isFinite(fpsFloat) && fpsFloat > 0)) throw new BuildFallback("the frame rate is not valid");
		const ticksPerFrame = Math.max(1, Math.round(TICKS_PER_SECOND / fpsFloat));
		const frameCount = exportedFrameCount({ durationTicks: rootNode.duration, ticksPerFrame });
		const planned = params.segments.reduce((sum, segment) => sum + segment.frames, 0);
		if (planned !== frameCount || params.segments.some((segment, i) => segment.start !== (i === 0 ? 0 : params.segments[i - 1].start + params.segments[i - 1].frames))) {
			throw new BuildFallback(`the stretches don't cover the film (${planned} of ${frameCount} frames)`);
		}
		this.report.segments = params.segments.length;

		// The picture's canvas: the compositor's, or a 2D one of the output size (Export → Resolution, a cover).
		const composed = this.renderer.getOutputCanvas();
		const outputSize = params.outputSize && (params.outputSize.width !== params.width || params.outputSize.height !== params.height) ? params.outputSize : undefined;
		const size = outputSize ?? (params.cover ? { width: params.width, height: params.height } : null);
		const scaled = size ? document.createElement("canvas") : null;
		const scaledContext = scaled?.getContext("2d") ?? null;
		if (scaled && scaledContext && size) {
			scaled.width = size.width;
			scaled.height = size.height;
			scaledContext.imageSmoothingEnabled = true;
			scaledContext.imageSmoothingQuality = "high";
		}
		const picture = scaled && scaledContext ? scaled : composed;
		const frameSize = size ?? { width: params.width, height: params.height };

		// The encoder's settings, as the old exporter asks for them (export/encoder-config.ts).
		const encoding = videoEncodingConfig({ format: params.format, quality: params.quality, bitrate: params.bitrate, size: frameSize, fps: fpsFloat, hardwareEncoding: params.hardwareEncoding ?? true });
		if (encoding.codec !== "avc" || typeof encoding.bitrate !== "number") throw new BuildFallback("not an H.264 export with a set bit rate");
		const codec = avcCodecString(frameSize.width, frameSize.height, encoding.bitrate);
		const encoder = new FrameEncoder({
			config: {
				codec,
				width: frameSize.width,
				height: frameSize.height,
				bitrate: encoding.bitrate,
				framerate: fpsFloat,
				alpha: "discard",
				...(encoding.hardwareAcceleration ? { hardwareAcceleration: encoding.hardwareAcceleration } : {}),
				avc: { format: "avc" },
			},
			fps: fpsFloat,
		});

		// Which kept stretches can be used: this encoder's own (the same decoder configuration), the right length.
		const hits = new Map<number, KeptInfo>();
		params.segments.forEach((segment, index) => {
			const info = params.kept.get(segment.key);
			if (info && info.head.kind === "video" && info.head.frames === segment.frames && info.head.codec === codec && info.head.width === frameSize.width && info.head.height === frameSize.height) hits.set(index, info);
		});
		/** What this Mac's encoder writes for (its decoder configuration), asked with the film's first frame on the canvas — a canvas nothing was drawn on can't be read. */
		const describe = async () => {
			await this.renderer.render({ node: rootNode, time: 0 });
			if (scaled && scaledContext) scaledContext.drawImage(this.renderer.getOutputCanvas(), 0, 0, scaled.width, scaled.height);
			return toBase64(await encoder.describe(picture));
		};
		const onlyOf = (wanted: string | null) => {
			for (const [index, info] of hits) if (info.head.description !== wanted) hits.delete(index);
		};
		let description: string | null = null;
		if (hits.size < params.segments.length || params.cover) {
			// something is rendered now: kept stretches must be this encoder's (it says what it writes before the first frame)
			description = await describe();
			onlyOf(description);
		} else {
			// everything is kept: the encoder is not even opened, unless the kept stretches disagree among themselves
			description = hits.get(0)?.head.description ?? null;
			onlyOf(description);
			if (hits.size < params.segments.length) {
				description = await describe();
				onlyOf(description);
			}
		}
		if (!description) throw new BuildFallback("the encoder gave no decoder configuration");
		const decoderConfig: VideoDecoderConfig = { codec, codedWidth: frameSize.width, codedHeight: frameSize.height, description: fromBase64(description) };

		// The file.
		const fastStart = params.toFile ? ({ fastStart: "reserve" } as const) : {};
		const output = new Output({ format: params.format === "mov" ? new MovOutputFormat(fastStart) : new Mp4OutputFormat(fastStart), target: this.outputTarget() });
		const video = new EncodedVideoPacketSource("avc");
		const coverFrames = params.cover ? Math.max(1, Math.round(params.cover.seconds * fpsFloat)) : 0;
		const lead = coverFrames / fpsFloat;
		// (+32: room in the reserved index for the audio track's edit list, export/mp4-edit-list.ts)
		output.addVideoTrack(video, { frameRate: fpsFloat, maximumPacketCount: frameCount + coverFrames + 32 });
		// (the sound is prepared once: when the file has to start again, the same packets go into it)
		if (params.audio && !this.soundFeed) this.soundFeed = await this.prepareSound(params.audio, lead);
		const sound = this.soundFeed ? this.attachSound(output, this.soundFeed) : null;
		await output.start();
		try {
			return await this.write({ rootNode, lookAtAll, output, video, sound, encoder, hits, description, decoderConfig, codec, frameSize, frameCount, coverFrames, lead, fpsFloat, ticksPerFrame, picture, scaled, scaledContext });
		} catch (error) {
			// whatever went wrong, the muxer and the encoder are let go of before the caller starts the file again
			await output.cancel().catch(() => {});
			encoder.close();
			throw error;
		}
	}

	private async write({
		rootNode,
		lookAtAll,
		output,
		video,
		sound,
		encoder,
		hits,
		description,
		decoderConfig,
		codec,
		frameSize,
		frameCount,
		coverFrames,
		lead,
		fpsFloat,
		ticksPerFrame,
		picture,
		scaled,
		scaledContext,
	}: {
		rootNode: RootNode;
		lookAtAll: boolean;
		output: Output;
		video: EncodedVideoPacketSource;
		sound: { until: (fileSeconds: number) => Promise<void>; finish: () => Promise<void> } | null;
		encoder: FrameEncoder;
		hits: Map<number, KeptInfo>;
		description: string;
		decoderConfig: VideoDecoderConfig;
		codec: string;
		frameSize: { width: number; height: number };
		frameCount: number;
		coverFrames: number;
		lead: number;
		fpsFloat: number;
		ticksPerFrame: number;
		picture: HTMLCanvasElement;
		scaled: HTMLCanvasElement | null;
		scaledContext: CanvasRenderingContext2D | null;
	}): Promise<ArrayBuffer | { bytes: number } | null> {
		const { params } = this;

		let firstVideoPacket = true;
		const addVideo = async (data: Uint8Array, key: boolean, seconds: number, length: number) => {
			const packet = new EncodedPacket(data, key ? "key" : "delta", micros(seconds) / 1e6, micros(length) / 1e6);
			await video.add(packet, firstVideoPacket ? { decoderConfig } : undefined);
			firstVideoPacket = false;
		};
		/** When frame `index` of the film is shown and for how long (seconds of the file). */
		const timing = (index: number) => {
			const span = exportedFrameSpan({ index, durationTicks: rootNode.duration, ticksPerFrame });
			return { ticks: span.start, seconds: mediaTimeToSeconds({ time: span.start }) + lead, length: mediaTimeToSeconds({ time: span.length }) };
		};

		// Packets leave the encoder a little after their frames go in: they are put into the file in order, and a stretch
		// whose last packet has arrived is kept. The writer may make this wait (a full disk): the frames then wait too.
		const fingerprinter = makeFingerprinter();
		interface Open {
			segment: BuildSegment;
			left: number;
			packets: EntryPacket[];
			first: Uint8Array;
			last: Uint8Array;
		}
		let chain: Promise<void> = Promise.resolve();
		let queued = 0;
		let failed: unknown = null;
		const puts = new Set<Promise<unknown>>();
		const keep = (open: Open) => {
			const head: EntryHead = { v: 1, kind: "video", key: open.segment.key, codec, description, width: frameSize.width, height: frameSize.height, frames: open.segment.frames, first: toBase64(open.first), last: toBase64(open.last), made: Date.now() };
			const put = params.cache.put(open.segment.key, encodeEntry(head, open.packets)).catch(() => false);
			puts.add(put);
			void put.finally(() => puts.delete(put));
		};
		encoder.onPacket = ({ tag, data, key }) => {
			const { open, frame, cover } = tag as { open: Open | null; frame: number; cover?: number };
			queued++;
			chain = chain
				.then(async () => {
					if (failed) return;
					if (cover !== undefined) await addVideo(data, key, cover / fpsFloat, 1 / fpsFloat);
					else {
						const at = timing(frame);
						await addVideo(data, key, at.seconds, at.length);
					}
					if (open) {
						open.packets.push({ key, data, timestamp: 0, duration: 0 });
						if (--open.left === 0) keep(open);
					}
				})
				.catch((error) => {
					failed ??= error;
				})
				.finally(() => {
					queued--;
				});
		};
		const settle = async () => {
			await encoder.flush();
			await chain;
			if (failed) throw failed;
		};
		const backpressure = async () => {
			if (failed) throw failed;
			if (queued > 12) await chain;
			if (puts.size > 3) await Promise.race(puts);
		};

		// Speed as measured: what is left of each kind of work over how fast that kind has gone.
		const started = performance.now();
		let framesLeftToRender = params.segments.reduce((sum, segment, index) => sum + (hits.has(index) ? 0 : segment.frames), 0) + coverFrames;
		let framesLeftToReuse = frameCount - (framesLeftToRender - coverFrames);
		let lastProgress = 0;
		let lastSaid = 0;
		/** when the stretch being rendered now began (its time counts as it goes) */
		let renderingSince: number | null = null;
		const say = (force = false) => {
			const now = performance.now();
			if (!force && now - lastSaid < 250) return;
			lastSaid = now;
			const { report } = this;
			const renderMs = report.renderMs + (renderingSince === null ? 0 : now - renderingSince);
			const perRendered = report.framesRendered >= 15 && renderMs > 500 ? renderMs / report.framesRendered : null;
			const perReused = report.framesReused >= 30 ? report.reuseMs / report.framesReused : 0.15;
			const elapsed = now - started;
			let eta: number | null = null;
			if (framesLeftToRender === 0 || perRendered !== null) eta = (framesLeftToRender * (perRendered ?? 0) + framesLeftToReuse * perReused) / 1000;
			const done = eta === null ? (report.framesRendered + report.framesReused) / Math.max(1, frameCount + coverFrames) : elapsed / Math.max(1, elapsed + eta * 1000);
			lastProgress = Math.min(0.999, Math.max(lastProgress, done));
			this.emit("progress", lastProgress);
			this.emit("eta", eta === null ? null : Math.max(0, eta));
		};

		const cancelled = async () => {
			await output.cancel().catch(() => {});
			encoder.close();
			this.emit("cancelled");
			return null;
		};

		// The cover's frames come first; the timeline (picture and sound) starts after them.
		if (params.cover && scaled && scaledContext) {
			drawCover(scaledContext, params.cover.image, scaled.width, scaled.height);
			for (let i = 0; i < coverFrames; i++) {
				await encoder.encode(picture, { key: i === 0, tag: { open: null, frame: -1, cover: i } });
				await backpressure();
			}
			framesLeftToRender -= coverFrames;
		}

		const lookEvery = Math.max(LOOK_EVERY_SECONDS, frameCount / fpsFloat / MAX_SPREAD_LOOKS);
		let sinceLook = Number.POSITIVE_INFINITY;
		let previousWasReused = false;
		for (let index = 0; index < params.segments.length; index++) {
			if (this.isCancelled) return cancelled();
			const segment = params.segments[index];
			const seconds = segment.frames / fpsFloat;
			const reuseStart = performance.now();
			let entry = hits.has(index) ? await params.cache.get(segment.key) : null;
			if (entry && (entry.head.kind !== "video" || entry.packets.length !== segment.frames || !entry.packets[0]?.key || entry.head.description !== description || !entry.head.first)) entry = null;
			if (entry) {
				// looked at before it is trusted: the first of a run of kept stretches, then one in every `lookEvery` seconds
				const look = lookAtAll || !previousWasReused || sinceLook >= lookEvery;
				if (look) {
					await this.renderer.render({ node: rootNode, time: timing(segment.start).ticks });
					if (scaled && scaledContext) scaledContext.drawImage(this.renderer.getOutputCanvas(), 0, 0, scaled.width, scaled.height);
					this.report.lookedAt++;
					sinceLook = 0;
					if (!sameFingerprint(fingerprinter.of(picture), fromBase64(entry.head.first as string))) {
						// what the key did not know about changed this stretch: nothing kept is used unlooked-at from here
						if (!lookAtAll && this.report.reused > 0) throw new LookAtAll();
						lookAtAll = true;
						entry = null;
					}
				}
			}
			if (entry) {
				await settle();
				for (let i = 0; i < entry.packets.length; i++) {
					const at = timing(segment.start + i);
					if (sound) await sound.until(at.seconds + AUDIO_AHEAD_SECONDS);
					await addVideo(entry.packets[i].data, entry.packets[i].key, at.seconds, at.length);
				}
				this.report.reused++;
				this.report.framesReused += segment.frames;
				this.report.reuseMs += performance.now() - reuseStart;
				framesLeftToReuse -= segment.frames;
				sinceLook += seconds;
				previousWasReused = true;
				say();
				continue;
			}
			// rendered now
			if (hits.has(index)) {
				framesLeftToReuse -= segment.frames;
				framesLeftToRender += segment.frames;
			}
			previousWasReused = false;
			renderingSince = performance.now();
			const open: Open = { segment, left: segment.frames, packets: [], first: new Uint8Array(0), last: new Uint8Array(0) };
			for (let i = 0; i < segment.frames; i++) {
				if (this.isCancelled) return cancelled();
				const frame = segment.start + i;
				const at = timing(frame);
				// The sound first, then the frame is drawn and taken at once (an await between the two let a flash slip a frame).
				if (sound) await sound.until(at.seconds + AUDIO_AHEAD_SECONDS);
				await this.renderer.render({ node: rootNode, time: at.ticks });
				if (scaled && scaledContext) scaledContext.drawImage(this.renderer.getOutputCanvas(), 0, 0, scaled.width, scaled.height);
				if (i === 0) open.first = fingerprinter.of(picture);
				if (i === segment.frames - 1) open.last = segment.frames === 1 ? open.first : fingerprinter.of(picture);
				await encoder.encode(picture, { key: i === 0, tag: { open, frame } });
				await backpressure();
				this.report.framesRendered++;
				framesLeftToRender--;
				say();
			}
			this.report.rendered++;
			this.report.renderMs += performance.now() - renderingSince;
			renderingSince = null;
		}

		if (this.isCancelled) return cancelled();
		await settle();
		if (sound) await sound.finish();
		await output.finalize();
		encoder.close();
		// what was rendered is kept before the export says it is done: the next export finds all of it
		await Promise.allSettled([...puts]);
		this.emit("progress", 1);
		this.emit("eta", 0);

		if (params.toFile) {
			const written = { bytes: this.bytesWritten };
			this.emit("complete", written);
			return written;
		}
		let buffer = (output.target as BufferTarget).buffer;
		if (!buffer) throw new BuildFallback("the muxer gave no file");
		if (this.primingEdit) {
			const edited = withAudioPrimingEdit(new Uint8Array(buffer), this.primingEdit);
			if (edited) buffer = edited.buffer as ArrayBuffer;
		}
		this.emit("complete", buffer);
		return buffer;
	}

	/**
	 * The sound of the film: one encode of the whole mix, made once for this export (also when the file has to start
	 * again). Kept packets are used as they are. A fresh mix is encoded beside the file (the encoder's own output goes
	 * nowhere): all of it at once, in pieces of a second that wait for the encoder — it is done within seconds — and
	 * kept the moment it is whole, so an export killed later finds its sound made. The mix itself is let go of as soon
	 * as it is encoded: an hour of it is 1.4 GB that the long part of the export no longer holds.
	 */
	private async prepareSound(audio: BuildAudio, lead: number): Promise<SoundFeed> {
		const { params } = this;
		if ("packets" in audio) {
			const { head, packets } = audio;
			const codec = head.codec.startsWith("mp4a") ? "aac" : head.codec === "opus" ? "opus" : null;
			if (!codec || !head.sampleRate || !head.channels) throw new BuildFallback("the kept mix can't be read");
			const decoderConfig: AudioDecoderConfig = { codec: head.codec, sampleRate: head.sampleRate, numberOfChannels: head.channels, ...(head.description ? { description: fromBase64(head.description) } : {}) };
			this.report.audio = "reused";
			return {
				codec,
				priming: head.primingSamples ? { primingSamples: head.primingSamples, sampleRate: head.sampleRate } : null,
				packetRoom: packets.length + 64,
				packets: packets.map((packet, index) => ({ packet: new EncodedPacket(packet.data, "key", packet.timestamp, packet.duration), meta: index === 0 ? { decoderConfig } : undefined })),
				ready: async () => {},
				whole: async () => {},
			};
		}
		const mix = audio.buffer;
		if (!mix) throw new BuildFallback("the mix is gone");
		const config = await audioEncodingConfig({ format: params.format, quality: params.quality, sampleRate: mix.sampleRate, numberOfChannels: mix.numberOfChannels });
		// AAC's priming: an edit list skips it, so the whole mix is in the file and on time (as the old exporter does).
		const delay = encoderDelaySamples(config.codec);
		const made: SoundFeed["packets"] = [];
		let decoder: AudioDecoderConfig | null = null;
		let wake: (() => void) | null = null;
		const signal = () => {
			wake?.();
			wake = null;
		};
		const side = new Output({ format: new Mp4OutputFormat(), target: new NullTarget() });
		const encoderSource = new AudioSampleSource({
			...config,
			onEncodedPacket: (packet, meta) => {
				if (meta?.decoderConfig && !decoder) decoder = meta.decoderConfig;
				made.push({ packet, meta });
				signal();
			},
		});
		side.addAudioTrack(encoderSource);
		await side.start();
		const shape = { sampleRate: mix.sampleRate, channels: mix.numberOfChannels, samples: mix.length };
		let done = false;
		let failure: unknown = null;
		const encoding = (async () => {
			try {
				await audioFeeder({ source: encoderSource, buffer: mix, skipSamples: 0, leadSamples: Math.round(lead * mix.sampleRate) }).finish();
				encoderSource.close();
				await side.finalize();
				// (the mix is no longer needed here; the caller mixes again if the export has to be made the old way)
				(audio as { buffer: AudioBuffer | null }).buffer = null;
				const written = decoder as AudioDecoderConfig | null;
				const head: EntryHead = {
					v: 1,
					kind: "audio",
					key: audio.key,
					codec: written?.codec ?? (config.codec === "aac" ? "mp4a.40.2" : "opus"),
					description: toBase64(written?.description ? bytesOf(written.description) : new Uint8Array(0)),
					sampleRate: shape.sampleRate,
					channels: shape.channels,
					primingSamples: delay,
					samples: shape.samples,
					made: Date.now(),
				};
				await params.cache.put(audio.key, encodeEntry(head, made.map(({ packet }) => ({ key: true, data: packet.data, timestamp: packet.timestamp, duration: packet.duration })))).catch(() => false);
			} catch (error) {
				failure = error;
			} finally {
				done = true;
				signal();
			}
		})();
		this.report.audio = "encoded";
		return {
			codec: config.codec,
			priming: delay > 0 ? { primingSamples: delay, sampleRate: shape.sampleRate, ...(params.master ? {} : { samples: shape.samples + Math.round(lead * shape.sampleRate) }) } : null,
			packetRoom: Math.ceil(shape.samples / 512) + 64,
			packets: made,
			ready: async (seconds) => {
				// everything before `seconds` is there once a later packet has come, or the encoder is done
				while (!done && !(made.length > 0 && made[made.length - 1].packet.timestamp >= seconds)) {
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
				}
				if (failure) throw failure;
			},
			whole: async () => {
				await encoding;
				if (failure) throw failure;
			},
		};
	}

	/** The sound's packets put into `output`, in step with the picture. */
	private attachSound(output: Output, feed: SoundFeed): { until: (fileSeconds: number) => Promise<void>; finish: () => Promise<void> } {
		const source = new EncodedAudioPacketSource(feed.codec);
		output.addAudioTrack(source, { maximumPacketCount: feed.packetRoom });
		this.primingEdit = feed.priming;
		let next = 0;
		const add = async (limit: number) => {
			while (next < feed.packets.length && feed.packets[next].packet.timestamp < limit) {
				const item = feed.packets[next];
				await source.add(item.packet, next === 0 ? item.meta : undefined);
				next++;
			}
		};
		return {
			until: async (fileSeconds) => {
				await feed.ready(fileSeconds);
				await add(fileSeconds);
			},
			finish: async () => {
				await feed.whole();
				await add(Number.POSITIVE_INFINITY);
			},
		};
	}

	/** In memory for what other code needs as bytes; to disk in pieces when a file is given. */
	private outputTarget() {
		const file = this.params.toFile;
		if (!file) return new BufferTarget();
		// the index, when the muxer writes it at the end, gets the audio track's edit list on its way to the file
		const priming = new PrimingEditWriter(() => this.primingEdit);
		return new StreamTarget(
			new WritableStream({
				write: async (chunk) => {
					const data = priming.write(chunk.position, chunk.data);
					await file.write(chunk.position, data);
					this.bytesWritten = Math.max(this.bytesWritten, chunk.position + data.byteLength);
				},
			}),
			{ chunked: true },
		);
	}
}
