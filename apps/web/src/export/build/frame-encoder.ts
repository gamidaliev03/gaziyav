// The picture's encoder, used directly (render, 11.11): frames go in one by one, each stretch's first asked for as a
// key frame; packets come out in the same order, one per frame (the Mac's H.264 encoder through WebCodecs writes no
// B-frames — checked for every packet here, never assumed). The encoder sees one unbroken run of frames at the
// export's rate, whatever stretches of the film it is given: its clock is the count of frames it was handed.
import { BuildFallback } from "./exporter";

// https://en.wikipedia.org/wiki/Advanced_Video_Coding — macroblocks and bit rate each level takes (as mediabunny picks it)
const AVC_LEVELS: ReadonlyArray<readonly [maxMacroblocks: number, maxBitrate: number, level: number]> = [
	[99, 64000, 0x0a],
	[396, 192000, 0x0b],
	[396, 384000, 0x0c],
	[396, 768000, 0x0d],
	[396, 2000000, 0x14],
	[792, 4000000, 0x15],
	[1620, 4000000, 0x16],
	[1620, 10000000, 0x1e],
	[3600, 14000000, 0x1f],
	[5120, 20000000, 0x20],
	[8192, 20000000, 0x28],
	[8192, 50000000, 0x29],
	[8704, 50000000, 0x2a],
	[22080, 135000000, 0x32],
	[36864, 240000000, 0x33],
	[36864, 240000000, 0x34],
	[139264, 240000000, 0x3c],
	[139264, 480000000, 0x3d],
	[139264, 800000000, 0x3e],
];

/** "avc1.64LLLL": High profile at the lowest level that takes the frame size and the bit rate. */
export function avcCodecString(width: number, height: number, bitrate: number): string {
	const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
	const level = (AVC_LEVELS.find(([maxMacroblocks, maxBitrate]) => macroblocks <= maxMacroblocks && bitrate <= maxBitrate) ?? AVC_LEVELS[AVC_LEVELS.length - 1])[2];
	return `avc1.6400${level.toString(16).padStart(2, "0")}`;
}

export interface EncodedFrame {
	/** what `encode` was given for this frame */
	tag: unknown;
	data: Uint8Array;
	key: boolean;
}

/** A copy of a buffer source's bytes. */
export const bytesOf = (source: AllowSharedBufferSource): Uint8Array => (source instanceof ArrayBuffer || (typeof SharedArrayBuffer !== "undefined" && source instanceof SharedArrayBuffer) ? new Uint8Array(source as ArrayBuffer).slice() : new Uint8Array((source as ArrayBufferView).buffer as ArrayBuffer, (source as ArrayBufferView).byteOffset, (source as ArrayBufferView).byteLength).slice());

export class FrameEncoder {
	/** Called for every packet, in the order of the frames. */
	onPacket: (frame: EncodedFrame) => void = () => {};
	private encoder: VideoEncoder | null = null;
	private error: Error | null = null;
	private waiting: Array<{ timestamp: number; key: boolean; tag: unknown }> = [];
	private count = 0;
	/** The decoder configuration (avcC) this encoder writes for. */
	private description: Uint8Array | null = null;
	private readonly frameMicros: number;

	constructor(private readonly options: { config: VideoEncoderConfig; fps: number }) {
		this.frameMicros = 1e6 / options.fps;
	}

	private async open(): Promise<VideoEncoder> {
		if (this.encoder) return this.encoder;
		if (typeof VideoEncoder === "undefined") throw new BuildFallback("no video encoder in this browser");
		const support = await VideoEncoder.isConfigSupported(this.options.config).catch(() => null);
		if (!support?.supported) throw new BuildFallback(`the encoder does not take ${this.options.config.codec} at ${this.options.config.width}×${this.options.config.height}`);
		const encoder = new VideoEncoder({
			output: (chunk, meta) => {
				try {
					const expected = this.waiting.shift();
					// one packet per frame, in order, and a key frame where one was asked for: else the stretches can't be joined
					if (!expected) throw new BuildFallback("the encoder wrote a packet nobody asked for");
					if (chunk.timestamp !== expected.timestamp) throw new BuildFallback("the encoder wrote its packets out of order");
					if (expected.key && chunk.type !== "key") throw new BuildFallback("the encoder did not start a stretch on a key frame");
					const made = meta?.decoderConfig?.description;
					if (made) {
						const bytes = bytesOf(made);
						if (this.description && !sameBytes(this.description, bytes)) throw new BuildFallback("the encoder changed its configuration in the middle");
						this.description = bytes;
					}
					const data = new Uint8Array(chunk.byteLength);
					chunk.copyTo(data);
					this.onPacket({ tag: expected.tag, data, key: chunk.type === "key" });
				} catch (error) {
					this.error ??= error instanceof Error ? error : new Error(String(error));
				}
			},
			error: (error) => {
				this.error ??= new BuildFallback(`the encoder stopped: ${error.message}`);
			},
		});
		encoder.configure(this.options.config);
		this.encoder = encoder;
		return encoder;
	}

	private check() {
		if (this.error) throw this.error;
	}

	/** Hands the canvas's picture, as it is now, to the encoder. `key`: the first frame of a stretch. */
	async encode(canvas: HTMLCanvasElement | OffscreenCanvas, { key, tag }: { key: boolean; tag: unknown }): Promise<void> {
		this.check();
		const timestamp = Math.round(this.count * this.frameMicros);
		// The picture is taken at once: nothing is awaited between the drawing and this (an await there once let a
		// frame slip — the canvas showed the next thing by the time it was read).
		const frame = new VideoFrame(canvas, { timestamp, duration: Math.round(this.frameMicros) });
		this.count++;
		let encoder: VideoEncoder;
		try {
			encoder = this.encoder ?? (await this.open());
			this.waiting.push({ timestamp, key, tag });
			encoder.encode(frame, { keyFrame: key });
		} finally {
			frame.close();
		}
		if (encoder.encodeQueueSize >= 4) await new Promise((resolve) => encoder.addEventListener("dequeue", resolve, { once: true }));
		this.check();
	}

	/** Every frame handed in so far is out as a packet when this returns. */
	async flush(): Promise<void> {
		this.check();
		if (!this.encoder || this.waiting.length === 0) return;
		await this.encoder.flush();
		this.check();
		if (this.waiting.length > 0) throw new BuildFallback("the encoder kept frames back");
	}

	/**
	 * What this encoder writes for (its decoder configuration), found by encoding one frame of the canvas as it is and
	 * throwing the packet away. The encoder then starts anew: the film's first frame meets a fresh one.
	 */
	async describe(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Uint8Array> {
		const taken = this.onPacket;
		this.onPacket = () => {};
		try {
			await this.encode(canvas, { key: true, tag: null });
			await this.flush();
		} finally {
			this.onPacket = taken;
		}
		const description = this.description;
		if (!description) throw new BuildFallback("the encoder gave no decoder configuration");
		this.close();
		this.count = 0;
		return description;
	}

	close(): void {
		try {
			if (this.encoder && this.encoder.state !== "closed") this.encoder.close();
		} catch {}
		this.encoder = null;
		this.waiting = [];
	}
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}
