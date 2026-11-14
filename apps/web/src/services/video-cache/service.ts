import {
	EncodedPacketSink,
	VideoSampleSink,
	type Input,
	type Rotation,
	type VideoSample,
	type WrappedCanvas,
} from "mediabunny";
import { openVideoForDecoding, reportDecodeFailure } from "./decoder-config";
import { byTier } from "@/platform/hardware-client";
import { budgetLimit, joinBudget, noteUse, type BudgetMember } from "@/platform/memory-budget";
import { backCapacity, findBackFrame, isReverseStep } from "./back-frames";

interface VideoSinkData {
	/** The decoder key (failures are reported under it). */
	key: string;
	input: Input;
	samples: VideoSampleSink;
	/** Key-frame lookups (sample table only, no data read) to choose between decoding on and seeking. */
	packets: EncodedPacketSink;
	/** The track's display size; width/height are the frame canvases' (capped by maxDecodeSize). */
	sourceWidth: number;
	sourceHeight: number;
	width: number;
	height: number;
	rotation: Rotation;
	alpha: boolean;
	/** Canvases the frames are drawn into, reused in turn (the compositor uploads them right away). */
	pool: Array<HTMLCanvasElement | OffscreenCanvas | null>;
	poolIndex: number;
	iterator: AsyncGenerator<VideoSample, void, unknown> | null;
	/** Timestamp of the last sample taken from the iterator: where the decoder stands. */
	lastTime: number;
	currentFrame: WrappedCanvas | null;
	/** The sample after currentFrame, decoded ahead and not drawn yet (drawn only if it is shown). */
	nextSample: VideoSample | null;
	prefetching: boolean;
	prefetchPromise: Promise<void> | null;
	lastUsed: number;
	/** Playing backwards (back-frames.ts): the frames of the group just behind, drawn, in time order. */
	back: WrappedCanvas[] | null;
}

/** Decoders not used for this long are closed (VideoToolbox sessions are scarce). */
const IDLE_SINK_TTL_MS = 10_000;
/** An 8 GB Mac (platform/hardware.ts "base") keeps fewer decoders open, and not as long: each holds frames in memory. */
const idleSinkTtlMs = () => byTier({ base: 5_000, standard: IDLE_SINK_TTL_MS, pro: IDLE_SINK_TTL_MS });
/** At most this many live decoders (platform/memory-budget.ts «video.decoders»: 3 on an 8 GB Mac, 6 on 16 GB); the least
 * recently used idle one is closed first. */
const maxLiveSinks = () => budgetLimit("video.decoders");
/** A sink used within this window is considered busy and never evicted. */
const BUSY_WINDOW_MS = 1_000;
/** Over the memory budget, a decoder not drawn for this long may close too (the frames on screen keep theirs). */
const RECENT_FRAME_MS = 150;
/** Over the decoder budget, how long a new decoder waits for a busy one to free. */
const OPEN_WAIT_MS = 400;
/**
 * A target this close ahead of the decoder is reached by decoding on. Farther ahead, the decoder decodes on only
 * when the target's key frame is behind it (same group of pictures); otherwise it seeks to that key frame and skips
 * everything in between (decoding on through 2 s of 4K frames, each one drawn, froze the preview for up to 300 ms).
 */
const DECODE_ON_MAX_S = 0.25;
/** Timestamps closer than this are the same moment (container rounding). */
const TIME_EPS = 1e-4;
/** Memory the frames kept for playing backwards may take, all decoders together («video.back»: an 8 GB Mac keeps a third). */
const backBudgetBytes = () => budgetLimit("video.back");

export class VideoCache {
	private sinks = new Map<string, VideoSinkData>();
	private initPromises = new Map<string, Promise<void>>();
	private frameChain = new Map<string, Promise<unknown>>();
	private seekGenerations = new Map<string, number>();
	/**
	 * Frame requests in flight per decoder (polish3, 11.11). An eviction must never close a decoder a frame is being
	 * read from: the main clip's request closed the B-roll's decoder (idle > 10 s) between the B-roll's own ensureSink
	 * and its read, the B-roll's request came back empty and the paused preview showed the picture without the B-roll.
	 */
	private inFlight = new Map<string, number>();
	private lastEvictionCheck = 0;
	private maxDecodeSize: { width: number; height: number } | null = null;

	/**
	 * Frames no larger than needed to cover this size (the preview's picture on screen).
	 * A 4K phone clip in a 1080x1920 project is drawn at 1080x1920: 4x fewer
	 * pixels to draw, copy and upload every frame. Export keeps full size.
	 * Decoders stay open: only the frame canvases change size (the next frame is decoded anew).
	 */
	setMaxDecodeSize(size: { width: number; height: number } | null): boolean {
		const same =
			size === this.maxDecodeSize ||
			(size &&
				this.maxDecodeSize &&
				size.width === this.maxDecodeSize.width &&
				size.height === this.maxDecodeSize.height);
		if (same) return false;
		this.maxDecodeSize = size;
		let resized = false;
		for (const sinkData of this.sinks.values()) {
			const next = this.getFrameSize(sinkData.sourceWidth, sinkData.sourceHeight);
			if (next.width === sinkData.width && next.height === sinkData.height) continue;
			sinkData.width = next.width;
			sinkData.height = next.height;
			sinkData.pool = [null, null, null];
			sinkData.poolIndex = 0;
			// The shown frame has the old size: the next request decodes it again.
			sinkData.currentFrame = null;
			sinkData.nextSample?.close();
			sinkData.nextSample = null;
			sinkData.back = null;
			resized = true;
		}
		return resized;
	}

	/**
	 * Pre-roll: open the decoder of a clip that starts soon and decode its first
	 * frame, so the cut doesn't stall playback. Errors are ignored here; the
	 * real render reports them.
	 */
	preroll({
		mediaId,
		file,
		time,
	}: {
		mediaId: string;
		file: File;
		time: number;
	}): void {
		const existing = this.sinks.get(mediaId);
		if (existing?.currentFrame && this.isFrameValid({ frame: existing.currentFrame, time })) {
			// Ready for the cut: keep it from being closed as idle (after a long pause it was, and the cut froze).
			existing.lastUsed = performance.now();
			return;
		}
		if (this.initPromises.has(mediaId)) return;
		void this.getFrameAt({ mediaId, file, time }).catch(() => {});
	}

	/** The frame this decoder shows now (its last decoded one), without decoding: null when it has none yet. */
	shownFrame(mediaId: string): WrappedCanvas | null {
		return this.sinks.get(mediaId)?.currentFrame ?? null;
	}

	async getFrameAt({
		mediaId,
		file,
		time,
	}: {
		mediaId: string;
		file: File;
		time: number;
	}): Promise<WrappedCanvas | null> {
		// In flight from the first line (before any await): a parallel request's eviction leaves this decoder alone.
		this.inFlight.set(mediaId, (this.inFlight.get(mediaId) ?? 0) + 1);
		try {
			return await this.frameAt({ mediaId, file, time });
		} finally {
			const left = (this.inFlight.get(mediaId) ?? 1) - 1;
			if (left > 0) this.inFlight.set(mediaId, left);
			else this.inFlight.delete(mediaId);
		}
	}

	private async frameAt({
		mediaId,
		file,
		time,
	}: {
		mediaId: string;
		file: File;
		time: number;
	}): Promise<WrappedCanvas | null> {
		await this.ensureSink({ mediaId, file });

		let sinkData = this.sinks.get(mediaId);
		// Closed between its opening and this read (memory pressure, a media change): opened again, once.
		if (!sinkData) {
			await this.ensureSink({ mediaId, file });
			sinkData = this.sinks.get(mediaId);
		}
		if (!sinkData) return null;
		sinkData.lastUsed = performance.now();
		this.evictIdleSinks({ keep: mediaId });

		const generation = (this.seekGenerations.get(mediaId) ?? 0) + 1;
		this.seekGenerations.set(mediaId, generation);

		const previous = this.frameChain.get(mediaId) ?? Promise.resolve();
		const current = previous.then(() => {
			if (this.seekGenerations.get(mediaId) !== generation) {
				return sinkData.currentFrame ?? null;
			}
			return this.resolveFrame({ sinkData, time });
		});
		this.frameChain.set(
			mediaId,
			current.catch(() => {}),
		);
		return current;
	}

	private async resolveFrame({
		sinkData,
		time,
	}: {
		sinkData: VideoSinkData;
		time: number;
	}): Promise<WrappedCanvas | null> {
		if (sinkData.prefetching && sinkData.prefetchPromise) {
			await sinkData.prefetchPromise;
		}

		const next = sinkData.nextSample;
		if (next && this.isSampleValid({ sample: next, time })) {
			sinkData.nextSample = null;
			sinkData.currentFrame = this.draw({ sinkData, sample: next });
			this.startPrefetch({ sinkData });
			return sinkData.currentFrame;
		}

		const current = sinkData.currentFrame;
		// The shown frame is still right: inside its duration, or before the next one (variable frame rate gaps).
		if (
			current &&
			(this.isFrameValid({ frame: current, time }) ||
				(next && time >= current.timestamp - TIME_EPS && time < next.timestamp - TIME_EPS))
		) {
			this.startPrefetch({ sinkData });
			return current;
		}

		const backward = await this.backwardFrame({ sinkData, time });
		if (backward) return backward;

		if (sinkData.iterator && (await this.shouldDecodeOn({ sinkData, time }))) {
			const frame = await this.decodeOnTo({ sinkData, time });
			if (frame) {
				this.startPrefetch({ sinkData });
				return frame;
			}
		}

		const frame = await this.seekToTime({ sinkData, time });
		if (frame) this.startPrefetch({ sinkData });
		return frame;
	}

	/**
	 * Playing backwards: the frame from the kept group, or — a step just behind the frame on screen — the group decoded
	 * once from its key frame up to that frame and kept (back-frames.ts). Null: not a backward step; any other request
	 * lets the kept frames go.
	 */
	private async backwardFrame({ sinkData, time }: { sinkData: VideoSinkData; time: number }): Promise<WrappedCanvas | null> {
		const kept = sinkData.back ? findBackFrame(sinkData.back, time, TIME_EPS) : null;
		if (kept) {
			sinkData.currentFrame = kept;
			return kept;
		}
		const shown = sinkData.currentFrame?.timestamp ?? null;
		const frameDuration = sinkData.currentFrame?.duration ?? 0;
		if (!isReverseStep({ shown, frameDuration, time, eps: TIME_EPS }) || shown === null) {
			sinkData.back = null;
			return null;
		}
		let start = time;
		try {
			const key = await sinkData.packets.getKeyPacket(time, { metadataOnly: true });
			if (key) start = key.timestamp;
		} catch {}
		if (sinkData.prefetching && sinkData.prefetchPromise) await sinkData.prefetchPromise;
		// The decoder goes back to the key frame: the forward iterator and its frame decoded ahead are dropped.
		this.dropIterator({ sinkData });
		const capacity = backCapacity({ width: sinkData.width, height: sinkData.height, budgetBytes: backBudgetBytes() });
		const onScreen = sinkData.currentFrame?.canvas;
		const spare = (sinkData.back ?? []).map((f) => f.canvas).filter((c) => c !== onScreen && c.width === sinkData.width && c.height === sinkData.height);
		const frames: WrappedCanvas[] = [];
		const iterator = sinkData.samples.samples(start, shown);
		try {
			for await (const sample of iterator) {
				if (sample.timestamp >= shown - TIME_EPS) {
					sample.close();
					break;
				}
				// a group longer than the memory allows: only its last frames (the next ones played) are kept
				if (frames.length >= capacity) {
					const old = frames.shift();
					if (old && old.canvas !== onScreen) spare.push(old.canvas);
				}
				frames.push(this.drawInto({ sinkData, sample, canvas: spare.pop() ?? null }));
			}
		} catch (error) {
			reportDecodeFailure({ mediaId: sinkData.key, time, stage: "decode", error });
		}
		sinkData.back = frames.length ? frames : null;
		sinkData.lastTime = -1;
		// the others' stores give way first (least recently used decoder first)
		this.backMember.shrink(backBudgetBytes(), sinkData);
		noteUse(this.backMember);
		const frame = findBackFrame(frames, time, TIME_EPS);
		if (frame) sinkData.currentFrame = frame;
		return frame;
	}

	private isFrameValid({
		frame,
		time,
	}: {
		frame: WrappedCanvas;
		time: number;
	}): boolean {
		return time >= frame.timestamp - TIME_EPS && time < frame.timestamp + frame.duration - TIME_EPS;
	}

	private isSampleValid({ sample, time }: { sample: VideoSample; time: number }): boolean {
		return time >= sample.timestamp - TIME_EPS && time < sample.timestamp + sample.duration - TIME_EPS;
	}

	/** Decode on (ahead, same group of pictures) or seek (behind, or a key frame lies between). */
	private async shouldDecodeOn({ sinkData, time }: { sinkData: VideoSinkData; time: number }): Promise<boolean> {
		const position = sinkData.nextSample?.timestamp ?? sinkData.lastTime;
		if (time < position - TIME_EPS) return false;
		if (time - position <= DECODE_ON_MAX_S) return true;
		try {
			const key = await sinkData.packets.getKeyPacket(time, { metadataOnly: true });
			return !key || key.timestamp <= position + TIME_EPS;
		} catch {
			return false;
		}
	}

	/** Takes samples from the iterator up to `time`; the skipped ones are closed undrawn. */
	private async decodeOnTo({
		sinkData,
		time,
	}: {
		sinkData: VideoSinkData;
		time: number;
	}): Promise<WrappedCanvas | null> {
		const iterator = sinkData.iterator;
		if (!iterator) return null;

		let best: VideoSample | null = null;
		try {
			while (true) {
				let sample = sinkData.nextSample;
				sinkData.nextSample = null;
				if (!sample) {
					const result = await iterator.next();
					if (result.done || !result.value) break;
					sample = result.value;
					sinkData.lastTime = sample.timestamp;
				}

				if (sample.timestamp > time + TIME_EPS) {
					// Past `time` (a frame-rate gap): the previous sample is the picture; this one is kept for next.
					if (best) {
						sinkData.nextSample = sample;
					} else {
						best = sample;
					}
					break;
				}
				best?.close();
				best = sample;
				if (this.isSampleValid({ sample, time })) break;
			}
		} catch (error) {
			// The iterator is restarted (a seek) on the next request.
			reportDecodeFailure({ mediaId: sinkData.key, time, stage: "decode", error });
			best?.close();
			this.dropIterator({ sinkData });
			return null;
		}

		if (!best) return null;
		sinkData.currentFrame = this.draw({ sinkData, sample: best });
		return sinkData.currentFrame;
	}

	private async seekToTime({
		sinkData,
		time,
	}: {
		sinkData: VideoSinkData;
		time: number;
	}): Promise<WrappedCanvas | null> {
		try {
			if (sinkData.prefetching && sinkData.prefetchPromise) {
				await sinkData.prefetchPromise;
			}
			this.dropIterator({ sinkData });

			// Starts at the key frame before `time` and skips the samples before it without drawing them.
			sinkData.iterator = sinkData.samples.samples(time);
			sinkData.lastTime = time;

			const { value: sample } = await sinkData.iterator.next();
			if (sample) {
				sinkData.lastTime = sample.timestamp;
				sinkData.currentFrame = this.draw({ sinkData, sample });
				return sinkData.currentFrame;
			}
		} catch (error) {
			reportDecodeFailure({ mediaId: sinkData.key, time, stage: "decode", error });
		}

		return null;
	}

	private dropIterator({ sinkData }: { sinkData: VideoSinkData }): void {
		sinkData.nextSample?.close();
		sinkData.nextSample = null;
		if (sinkData.iterator) {
			void sinkData.iterator.return().catch(() => {});
			sinkData.iterator = null;
		}
	}

	/** Draws a sample into the next pool canvas (contain fit, track rotation) and closes the sample. */
	private draw({ sinkData, sample }: { sinkData: VideoSinkData; sample: VideoSample }): WrappedCanvas {
		const index = sinkData.poolIndex;
		sinkData.poolIndex = (sinkData.poolIndex + 1) % sinkData.pool.length;
		const drawn = this.drawInto({ sinkData, sample, canvas: sinkData.pool[index] });
		sinkData.pool[index] = drawn.canvas;
		return drawn;
	}

	/** Draws a sample into `canvas` (a new one when null) and closes the sample. */
	private drawInto({
		sinkData,
		sample,
		canvas: given,
	}: {
		sinkData: VideoSinkData;
		sample: VideoSample;
		canvas: HTMLCanvasElement | OffscreenCanvas | null;
	}): WrappedCanvas {
		try {
			let canvas = given;
			if (!canvas) {
				if (typeof document !== "undefined") {
					canvas = document.createElement("canvas");
					canvas.width = sinkData.width;
					canvas.height = sinkData.height;
				} else {
					canvas = new OffscreenCanvas(sinkData.width, sinkData.height);
				}
			}

			const context = canvas.getContext("2d", { alpha: sinkData.alpha }) as
				| CanvasRenderingContext2D
				| OffscreenCanvasRenderingContext2D
				| null;
			if (!context) throw new Error("Failed to get a 2D context for a video frame");
			context.resetTransform();
			context.clearRect(0, 0, sinkData.width, sinkData.height);
			sample.drawWithFit(context, { fit: "contain", rotation: sinkData.rotation });
			return { canvas, timestamp: sample.timestamp, duration: sample.duration };
		} finally {
			sample.close();
		}
	}

	private startPrefetch({ sinkData }: { sinkData: VideoSinkData }): void {
		if (sinkData.prefetching || !sinkData.iterator || sinkData.nextSample) {
			return;
		}

		sinkData.prefetching = true;
		sinkData.prefetchPromise = this.prefetchNextFrame({ sinkData });
	}

	private async prefetchNextFrame({
		sinkData,
	}: {
		sinkData: VideoSinkData;
	}): Promise<void> {
		const iterator = sinkData.iterator;
		try {
			if (!iterator) return;
			const { value: sample, done } = await iterator.next();
			if (done || !sample) return;
			if (sinkData.iterator !== iterator) {
				sample.close();
				return;
			}
			sinkData.nextSample = sample;
			sinkData.lastTime = sample.timestamp;
		} catch (error) {
			reportDecodeFailure({ mediaId: sinkData.key, time: sinkData.lastTime, stage: "decode", error });
			if (sinkData.iterator === iterator) sinkData.iterator = null;
		} finally {
			sinkData.prefetching = false;
			sinkData.prefetchPromise = null;
		}
	}

	private async ensureSink({
		mediaId,
		file,
	}: {
		mediaId: string;
		file: File;
	}): Promise<void> {
		if (this.sinks.has(mediaId)) return;

		if (this.initPromises.has(mediaId)) {
			await this.initPromises.get(mediaId);
			return;
		}

		// The decoder budget (perfb): a fast scrub across sources asked for a new decoder while every open one was still
		// decoding — 7 open on an 8 GB Mac's 3. A new one now waits for a busy one to finish and close (≤ 400 ms; the
		// scrub's later positions replace this one meanwhile), then opens anyway: a frame is never refused.
		for (let waited = 0; this.sinks.size + this.initPromises.size >= maxLiveSinks() && waited < OPEN_WAIT_MS; waited += 20) {
			this.shrinkDecoders(maxLiveSinks() - 1 - this.initPromises.size);
			if (this.sinks.size + this.initPromises.size < maxLiveSinks()) break;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		if (this.sinks.has(mediaId)) return;
		if (this.initPromises.has(mediaId)) {
			await this.initPromises.get(mediaId);
			return;
		}

		const initPromise = this.initializeSink({ mediaId, file });
		this.initPromises.set(mediaId, initPromise);

		try {
			await initPromise;
		} finally {
			this.initPromises.delete(mediaId);
		}
	}

	private async initializeSink({
		mediaId,
		file,
	}: {
		mediaId: string;
		file: File;
	}): Promise<void> {
		try {
			const { input, track: videoTrack, alpha } = await openVideoForDecoding(file);
			const size = this.getFrameSize(videoTrack.displayWidth, videoTrack.displayHeight);

			this.sinks.set(mediaId, {
				key: mediaId,
				input,
				samples: new VideoSampleSink(videoTrack),
				packets: new EncodedPacketSink(videoTrack),
				sourceWidth: videoTrack.displayWidth,
				sourceHeight: videoTrack.displayHeight,
				width: size.width,
				height: size.height,
				rotation: videoTrack.rotation,
				alpha,
				pool: [null, null, null],
				poolIndex: 0,
				iterator: null,
				lastTime: -1,
				currentFrame: null,
				nextSample: null,
				prefetching: false,
				prefetchPromise: null,
				lastUsed: performance.now(),
				back: null,
			});
			this.evictIdleSinks({ keep: mediaId, force: true });
			noteUse(this.decodersMember);
		} catch (error) {
			reportDecodeFailure({ mediaId, stage: "open", error });
			throw error;
		}
	}

	/**
	 * LRU: close decoders idle for IDLE_SINK_TTL_MS, and keep at most
	 * MAX_LIVE_SINKS open (closing the least recently used idle ones). A closed
	 * sink is simply re-created on next use.
	 */
	private evictIdleSinks({
		keep,
		force = false,
	}: {
		keep: string;
		force?: boolean;
	}): void {
		const now = performance.now();
		if (!force && now - this.lastEvictionCheck < 1000) return;
		this.lastEvictionCheck = now;

		const idle = [...this.sinks.entries()]
			.filter(
				([mediaId, data]) =>
					mediaId !== keep &&
					!this.inFlight.has(mediaId) &&
					!data.prefetching &&
					now - data.lastUsed > BUSY_WINDOW_MS,
			)
			.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
		let live = this.sinks.size;
		for (const [mediaId, data] of idle) {
			if (now - data.lastUsed > idleSinkTtlMs() || live > maxLiveSinks()) {
				this.closeSink({ key: mediaId });
				live--;
			}
		}
	}

	/** Every decoder not in use right now closes, and the frames kept for playing backwards go. */
	trim(): number {
		this.backMember.shrink(0);
		return this.shrinkDecoders(0);
	}

	/**
	 * Closes the least recently used decoders until at most `limit` are open. Idle ones go first; then, still over
	 * (a scrub opens a decoder per source it crosses, each «busy» for a second: 9 open on an 8 GB budget of 3, perfb),
	 * any not decoding right now and not drawn in the last frames. A decoder in flight or prefetching always stays.
	 */
	shrinkDecoders(limit: number): number {
		const now = performance.now();
		let closed = 0;
		const free = [...this.sinks.entries()]
			.filter(([mediaId, data]) => !data.prefetching && !this.inFlight.has(mediaId))
			.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
		for (const recent of [BUSY_WINDOW_MS, RECENT_FRAME_MS]) {
			for (const [mediaId, data] of free) {
				if (this.sinks.size <= limit) return closed;
				if (!this.sinks.has(mediaId) || now - data.lastUsed <= recent) continue;
				this.closeSink({ key: mediaId });
				closed++;
			}
		}
		return closed;
	}

	/** Tests: each decoder's frame on screen, its time and its RGB at `points` (fractions of the frame). */
	readShown(points: Array<[number, number]>): Array<{ key: string; time: number; rgb: number[][] }> {
		const out: Array<{ key: string; time: number; rgb: number[][] }> = [];
		for (const [key, data] of this.sinks) {
			const frame = data.currentFrame;
			if (!frame) continue;
			const canvas = frame.canvas as HTMLCanvasElement | OffscreenCanvas;
			const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
			if (!context) continue;
			const rgb = points.map(([fx, fy]) => {
				const d = context.getImageData(Math.min(canvas.width - 1, Math.floor(fx * canvas.width)), Math.min(canvas.height - 1, Math.floor(fy * canvas.height)), 1, 1).data;
				return [d[0], d[1], d[2]];
			});
			out.push({ key, time: frame.timestamp, rgb });
		}
		return out;
	}

	/** Bytes of the frames kept for playing backwards, all decoders. */
	backBytes(): number {
		let bytes = 0;
		for (const data of this.sinks.values()) if (data.back) for (const f of data.back) bytes += f.canvas.width * f.canvas.height * 4;
		return bytes;
	}

	/** Bytes of every frame canvas the decoders hold (their pools and the backwards stores): the table's estimate. */
	frameBytes(): number {
		let bytes = this.backBytes();
		for (const data of this.sinks.values()) for (const c of data.pool) if (c) bytes += c.width * c.height * 4;
		return bytes;
	}

	/** platform/memory-budget.ts: the decoders («video.decoders», a count) and their backwards stores («video.back»). */
	readonly decodersMember: BudgetMember = { name: "video.decoders", used: () => this.sinks.size, shrink: (limit) => void this.shrinkDecoders(limit) };
	readonly backMember = {
		name: "video.back" as const,
		used: () => this.backBytes(),
		shrink: (limit: number, keep?: VideoSinkData) => {
			if (this.backBytes() <= limit) return;
			for (const data of [...this.sinks.values()].sort((a, b) => a.lastUsed - b.lastUsed)) {
				if (data === keep || !data.back) continue;
				data.back = null;
				if (this.backBytes() <= limit) return;
			}
			if (keep?.back && this.backBytes() > limit) keep.back = null;
		},
	};

	/** Display size of the frames (rotation applied), capped by maxDecodeSize. */
	private getFrameSize(width: number, height: number): { width: number; height: number } {
		return capFrameSize({ width, height, max: this.maxDecodeSize });
	}

	/**
	 * Closes the decoders of this media: its own key and the keys derived from it (decoder lanes `id#b`, per-track
	 * `id@track`, transitions `id#transition-in`, smooth-motion files `key~id`).
	 */
	clearVideo({ mediaId }: { mediaId: string }): void {
		for (const key of new Set([...this.sinks.keys(), ...this.initPromises.keys(), mediaId])) {
			if (keyBelongsTo(key, mediaId)) this.closeSink({ key });
		}
	}

	private closeSink({ key }: { key: string }): void {
		const sinkData = this.sinks.get(key);
		if (sinkData) {
			this.dropIterator({ sinkData });
			sinkData.input.dispose();
			this.sinks.delete(key);
		}

		this.initPromises.delete(key);
		this.frameChain.delete(key);
		this.seekGenerations.delete(key);
	}

	clearAll(): void {
		for (const key of [...this.sinks.keys()]) {
			this.closeSink({ key });
		}
	}

	getStats() {
		return {
			totalSinks: this.sinks.size,
			activeSinks: Array.from(this.sinks.values()).filter((s) => s.iterator)
				.length,
			cachedFrames: Array.from(this.sinks.values()).filter(
				(s) => s.currentFrame,
			).length,
			frameBytes: this.frameBytes(),
		};
	}
}

/**
 * Frame size of a `width`×`height` source drawn to cover `max` (untouched when it is close to the source already or
 * there is no cap). Cover, not contain: a landscape clip filling a portrait frame keeps detail.
 *
 * The frame keeps the source's proportions exactly wherever whole pixels allow it (1920×1080 at ⅜ is 720×405): the
 * layer is laid out from this size. Rounded to even numbers it was 720×406 — the picture was then drawn 0.25 %
 * narrower in the player, with black hairlines left and right and darkened top and bottom rows (found by the colour
 * scopes, 11.11: 0.9 % of a flat grey frame's pixels were not grey).
 */
export function capFrameSize({
	width,
	height,
	max,
}: {
	width: number;
	height: number;
	max: { width: number; height: number } | null;
}): { width: number; height: number } {
	if (!max || width <= 0 || height <= 0) return { width, height };
	const scale = Math.max(max.width / width, max.height / height);
	if (scale >= 0.9) return { width, height };
	// the nearest size with exactly the source's proportions, when one is within a tenth of the wanted scale
	if (Number.isInteger(width) && Number.isInteger(height)) {
		let a = width;
		let b = height;
		while (b) [a, b] = [b, a % b];
		// never smaller than asked for (the frame must cover the picture on screen)
		const steps = Math.ceil(a * scale - 1e-9);
		if (steps >= 1 && steps / a - scale <= scale * 0.1 && (width / a) * steps >= 2 && (height / a) * steps >= 2) {
			return { width: (width / a) * steps, height: (height / a) * steps };
		}
	}
	return {
		width: Math.max(2, Math.round(width * scale)),
		height: Math.max(2, Math.round(height * scale)),
	};
}

function keyBelongsTo(key: string, mediaId: string): boolean {
	return (
		key === mediaId ||
		key.startsWith(`${mediaId}#`) ||
		key.startsWith(`${mediaId}@`) ||
		key.startsWith(`${mediaId}~`) ||
		key.endsWith(`~${mediaId}`)
	);
}

export const videoCache = new VideoCache();
// The memory budget (platform/memory-budget.ts): on the pressure signal both drop to their floor at once (the decoders
// in use stay, the backwards stores go); a closed decoder opens again on its next frame.
joinBudget(videoCache.decodersMember);
joinBudget(videoCache.backMember);

if (typeof window !== "undefined") {
	// The app's self-tests (test/perf-memory.mjs): the decoders open and the frame each shows, read at given points
	// (fractions of the frame) — the right frame after the budget closed and reopened a decoder.
	(window as unknown as { __studioVideoCache: object }).__studioVideoCache = {
		stats: () => videoCache.getStats(),
		shown: (points: Array<[number, number]>) => videoCache.readShown(points),
	};
}
