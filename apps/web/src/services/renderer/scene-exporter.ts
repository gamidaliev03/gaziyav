import EventEmitter from "eventemitter3";

import {
	Output,
	Mp4OutputFormat,
	MovOutputFormat,
	WebMOutputFormat,
	BufferTarget,
	StreamTarget,
	CanvasSource,
	AudioSample,
	AudioSampleSource,
} from "mediabunny";
import { audioEncodingConfig, encoderDelaySamples, videoEncodingConfig } from "@/export/encoder-config";
import { coverDrawing, exactRate, exportedFrameCount, exportedFrameSpan } from "@/export/frame-count";
import { type PrimingEdit, PrimingEditWriter, withAudioPrimingEdit } from "@/export/mp4-edit-list";
import type { FrameRate } from "opencut-wasm";
import { mediaTimeToSeconds } from "opencut-wasm";
import { TICKS_PER_SECOND } from "@/wasm";
import { frameRateToFloat } from "@/fps/utils";
import type { RootNode } from "./nodes/root-node";
import type { ExportFileWriter, ExportFormat, ExportQuality } from "@/export";
import { CanvasRenderer } from "./canvas-renderer";
import { VideoCache } from "@/services/video-cache/service";

type ExportParams = {
	width: number;
	height: number;
	/** Export → Resolution: every frame is scaled to this size (even numbers) when it is not the canvas. */
	outputSize?: { width: number; height: number };
	/** Video bits per second instead of the quality preset. */
	bitrate?: number;
	/** Written here as it grows instead of being held in memory. */
	toFile?: ExportFileWriter;
	hardwareEncoding?: boolean;
	/** Edit cover: a picture shown for the first frames (filling the frame), the timeline after it. */
	cover?: { image: CanvasImageSource & { width: number; height: number }; seconds: number };
	/** A master for the server's pass: the sound's edit keeps every packet (ExportOptions.master). */
	master?: boolean;
	fps: FrameRate;
	format: ExportFormat;
	quality: ExportQuality;
	shouldIncludeAudio?: boolean;
	audioBuffer?: AudioBuffer;
};

export type SceneExporterEvents = {
	progress: [progress: number];
	/** seconds left by the measured speed of drawing and encoding frames; null while nothing is measured yet */
	eta: [seconds: number | null];
	complete: [result: ArrayBuffer | { bytes: number }];
	error: [error: Error];
	cancelled: [];
};

export class SceneExporter extends EventEmitter<SceneExporterEvents> {
	private renderer: CanvasRenderer;
	private format: ExportFormat;
	private quality: ExportQuality;
	private shouldIncludeAudio: boolean;
	private audioBuffer?: AudioBuffer;
	private outputSize?: { width: number; height: number };
	private bitrate?: number;
	private toFile?: ExportFileWriter;
	private bytesWritten = 0;
	private hardwareEncoding: boolean;
	private cover?: ExportParams["cover"];
	private master: boolean;
	/** The AAC encoder's priming, told to the player through an edit list once the index is written (MP4 / MOV). */
	private primingEdit: PrimingEdit | null = null;

	private isCancelled = false;

	constructor({
		width,
		height,
		outputSize,
		bitrate,
		toFile,
		hardwareEncoding,
		cover,
		master,
		fps,
		format,
		quality,
		shouldIncludeAudio,
		audioBuffer,
	}: ExportParams) {
		super();
		// Own decoder cache: preview seeks/scrubs must never move the export's
		// decoders (that corrupted exported frames).
		this.renderer = new CanvasRenderer({
			width,
			height,
			fps,
			videoCache: new VideoCache(),
		});

		this.format = format;
		this.quality = quality;
		this.shouldIncludeAudio = shouldIncludeAudio ?? false;
		this.audioBuffer = audioBuffer;
		this.outputSize =
			outputSize && (outputSize.width !== width || outputSize.height !== height) ? outputSize : undefined;
		this.bitrate = bitrate;
		this.toFile = toFile;
		this.hardwareEncoding = hardwareEncoding ?? true;
		this.cover = cover;
		this.master = master ?? false;
	}

	cancel(): void {
		this.isCancelled = true;
	}

	async export({
		rootNode,
	}: {
		rootNode: RootNode;
	}): Promise<ArrayBuffer | { bytes: number } | null> {
		// The compositor is a global: hold it for the whole export so the live
		// preview can't render into it (and swap textures) between our frames.
		this.renderer.acquireExclusive();
		try {
			return await this.exportFrames({ rootNode });
		} finally {
			this.renderer.releaseExclusive();
			this.renderer.videoCache.clearAll();
		}
	}

	private async exportFrames({
		rootNode,
	}: {
		rootNode: RootNode;
	}): Promise<ArrayBuffer | { bytes: number } | null> {
		const fps = this.renderer.fps;
		const fpsFloat = frameRateToFloat(fps);
		// a damaged frame rate is repaired when the project opens (project-manager.ts): one here is a caller's mistake
		if (!(Number.isFinite(fpsFloat) && fpsFloat > 0)) {
			this.emit("error", new Error(`The export frame rate ${fps.numerator}/${fps.denominator} is not valid`));
			return null;
		}
		const ticksPerFrame = Math.max(1, Math.round(TICKS_PER_SECOND / fpsFloat));
		const frameCount = exportedFrameCount({
			durationTicks: rootNode.duration,
			ticksPerFrame,
		});

		// The cover's frames come first; the timeline (picture and sound) starts after them. It lasts exactly the seconds
		// asked (whole frames of the final file's rate): in whole frames of this rate, or — in a master drawn at the
		// project's rate for «Smooth frames» at another — one frame that long (export/frame-count.ts coverDrawing).
		const coverDraw = this.cover ? coverDrawing(this.cover.seconds, exactRate(fps)) : null;
		const coverFrames = coverDraw?.frames ?? 0;
		const lead = coverDraw ? coverDraw.frames * coverDraw.frameSeconds : 0;

		// Written to disk, the index can't be moved to the front at the end: its room is kept there, so a player or a
		// site starts the video without reading the whole file.
		const fastStart = this.toFile ? ({ fastStart: "reserve" } as const) : {};
		const outputFormat =
			this.format === "webm"
				? new WebMOutputFormat()
				: this.format === "mov"
					? new MovOutputFormat(fastStart)
					: new Mp4OutputFormat(fastStart);

		const output = new Output({
			format: outputFormat,
			target: this.outputTarget(),
		});

		// Export → Resolution: the frame is composed at canvas size, then drawn scaled onto a canvas of the output size.
		// A cover needs a 2D canvas too: the compositor's canvas can't be drawn on.
		const composed = this.renderer.getOutputCanvas();
		const size = this.outputSize ?? (this.cover ? { width: this.renderer.width, height: this.renderer.height } : null);
		const scaled = size ? document.createElement("canvas") : null;
		const scaledContext = scaled?.getContext("2d") ?? null;
		if (scaled && scaledContext && size) {
			scaled.width = size.width;
			scaled.height = size.height;
			scaledContext.imageSmoothingEnabled = true;
			scaledContext.imageSmoothingQuality = "high";
		}
		const videoSource = new CanvasSource(
			scaled && scaledContext ? scaled : composed,
			videoEncodingConfig({
				format: this.format,
				quality: this.quality,
				bitrate: this.bitrate,
				size: size ?? { width: this.renderer.width, height: this.renderer.height },
				fps: fpsFloat,
				hardwareEncoding: this.hardwareEncoding,
			}),
		);

		// (+32: room in the reserved index for the audio track's edit list, export/mp4-edit-list.ts)
		// (the track counts time in frames of its rate; a cover that is one long frame — a master for «Smooth frames» at
		// another rate, 0.1 s at 24 — would be cut to whole frames there and the timeline would start early: such a master
		// counts in ticks, where every frame and the cover's end are whole numbers)
		const longCover = !!coverDraw && Math.abs(coverDraw.frameSeconds * fpsFloat - 1) > 1e-6;
		output.addVideoTrack(videoSource, { frameRate: longCover ? TICKS_PER_SECOND : fpsFloat, maximumPacketCount: frameCount + coverFrames + 32 });

		let audioSource: AudioSampleSource | null = null;
		let audioSkipSamples = 0;
		if (this.shouldIncludeAudio && this.audioBuffer) {
			const audioConfig = await audioEncodingConfig({
				format: this.format,
				quality: this.quality,
				sampleRate: this.audioBuffer.sampleRate,
				numberOfChannels: this.audioBuffer.numberOfChannels,
			});
			// AAC's priming: MP4 and MOV get an edit list that skips it, so the whole mix is in the file and on time
			// (check-export E7: fed early instead, the first 44 ms of the sound were lost). Opus in WebM needs none.
			const delay = encoderDelaySamples(audioConfig.codec);
			// (the edit also ends the sound where the picture ends: the encoder's last packet is padded to 1024 samples and
			// the file's sound ran 25–40 ms past the last frame — exp, 14.11)
			if (delay > 0 && this.format !== "webm") this.primingEdit = { primingSamples: delay, sampleRate: this.audioBuffer.sampleRate, ...(this.master ? {} : { samples: Math.round((lead + rootNode.duration / TICKS_PER_SECOND) * this.audioBuffer.sampleRate) }) };
			else audioSkipSamples = delay;
			audioSource = new AudioSampleSource(audioConfig);
			output.addAudioTrack(audioSource, { maximumPacketCount: Math.ceil(this.audioBuffer.length / 512) + 64 });
		}

		await output.start();


		// The sound goes to its encoder a few seconds ahead of the picture, not the whole mix at once: fed in one go, an
		// hour of samples queued in the encoder beside the mix itself (final-B D7, 07.11: 4.2 GB for the first minutes).
		const audioFeed =
			audioSource && this.audioBuffer
				? audioFeeder({
						source: audioSource,
						buffer: this.audioBuffer,
						skipSamples: audioSkipSamples,
						leadSamples: Math.round(lead * this.audioBuffer.sampleRate),
					})
				: null;

		if (this.cover && scaled && scaledContext) {
			drawCover(scaledContext, this.cover.image, scaled.width, scaled.height);
			for (let i = 0; i < coverFrames; i++) await videoSource.add(i * (coverDraw?.frameSeconds ?? 0), coverDraw?.frameSeconds ?? 0);
		}

		const loopStarted = performance.now();
		let etaSaid = 0;
		for (let i = 0; i < frameCount; i++) {
			if (this.isCancelled) {
				await output.cancel();
				this.emit("cancelled");
				return null;
			}
			// the time left, from the speed measured so far (said four times a second)
			const now = performance.now();
			if (now - etaSaid > 250) {
				etaSaid = now;
				this.emit("eta", i >= 15 && now - loopStarted > 500 ? ((frameCount - i) * ((now - loopStarted) / i)) / 1000 : null);
			}

			const span = exportedFrameSpan({ index: i, durationTicks: rootNode.duration, ticksPerFrame });
			const timeTicks = span.start;
			const timeSeconds = mediaTimeToSeconds({ time: timeTicks });
			// The sound first, then the frame is drawn and taken at once: an await between the drawing and the take let
			// the first flash slip a frame (check-export [flow], 07.11).
			if (audioFeed) await audioFeed.feedUntil(timeSeconds + lead + AUDIO_AHEAD_SECONDS);
			await this.renderer.render({ node: rootNode, time: timeTicks });
			if (scaled && scaledContext) {
				scaledContext.drawImage(this.renderer.getOutputCanvas(), 0, 0, scaled.width, scaled.height);
			}
			await videoSource.add(timeSeconds + lead, mediaTimeToSeconds({ time: span.length }));

			this.emit("progress", i / frameCount);
		}

		if (this.isCancelled) {
			await output.cancel();
			this.emit("cancelled");
			return null;
		}

		if (audioFeed) {
			await audioFeed.finish();
			audioSource?.close();
		}
		videoSource.close();
		await output.finalize();
		this.emit("progress", 1);

		if (this.toFile) {
			const written = { bytes: this.bytesWritten };
			this.emit("complete", written);
			return written;
		}
		let buffer = (output.target as BufferTarget).buffer;
		if (!buffer) {
			this.emit("error", new Error("Failed to export video"));
			return null;
		}
		if (this.primingEdit) {
			const edited = withAudioPrimingEdit(new Uint8Array(buffer), this.primingEdit);
			if (edited) buffer = edited.buffer as ArrayBuffer;
		}

		this.emit("complete", buffer);
		return buffer;
	}

	/** In memory for what other code needs as bytes; to disk in 16 MB pieces when a file is given. */
	private outputTarget() {
		const file = this.toFile;
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

/** The cover filling the frame (cropped to it, centred), on black. */
export function drawCover(
	context: CanvasRenderingContext2D,
	image: CanvasImageSource & { width: number; height: number },
	width: number,
	height: number,
) {
	context.fillStyle = "#000";
	context.fillRect(0, 0, width, height);
	const scale = Math.max(width / image.width, height / image.height);
	const w = image.width * scale;
	const h = image.height * scale;
	context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

/** How far ahead of the picture the sound is fed (seconds of the file). */
export const AUDIO_AHEAD_SECONDS = 4;

/**
 * Feeds the mix to its encoder in 1 s planar chunks (no second full-length copy in memory), as far as the picture asks
 * for (`feedUntil`), the rest at `finish`. `leadSamples` of silence go first (under a cover); the encoder's priming is
 * taken from them before the mix.
 */
export function audioFeeder({
	source,
	buffer,
	skipSamples,
	leadSamples = 0,
}: {
	source: AudioSampleSource;
	buffer: AudioBuffer;
	skipSamples: number;
	leadSamples?: number;
}): { feedUntil: (fileSeconds: number) => Promise<void>; finish: () => Promise<void> } {
	const { numberOfChannels, sampleRate, length } = buffer;
	const channels = Array.from({ length: numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
	const chunkSize = sampleRate;
	const silence = Math.max(0, leadSamples - skipSamples);
	const mixSkip = Math.max(0, skipSamples - leadSamples);
	let silenceSent = silence <= 0;
	let start = Math.min(mixSkip, length);
	const add = async (sample: AudioSample) => {
		try {
			await source.add(sample);
		} finally {
			sample.close();
		}
	};
	const next = async () => {
		if (!silenceSent) {
			silenceSent = true;
			await add(new AudioSample({ data: new Float32Array(silence * numberOfChannels), format: "f32-planar", numberOfChannels, sampleRate, timestamp: 0 }));
			return;
		}
		const frames = Math.min(chunkSize, length - start);
		const data = new Float32Array(frames * numberOfChannels);
		for (let channel = 0; channel < numberOfChannels; channel++) data.set(channels[channel].subarray(start, start + frames), channel * frames);
		const timestamp = (silence + start - mixSkip) / sampleRate;
		start += frames;
		await add(new AudioSample({ data, format: "f32-planar", numberOfChannels, sampleRate, timestamp }));
	};
	/** File seconds the chunks sent so far reach. */
	const sentUntil = () => (silenceSent ? (silence + start - mixSkip) / sampleRate : 0);
	return {
		feedUntil: async (fileSeconds) => {
			while ((!silenceSent || start < length) && sentUntil() < fileSeconds) await next();
		},
		finish: async () => {
			while (!silenceSent || start < length) await next();
		},
	};
}
