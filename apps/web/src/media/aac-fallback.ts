// AAC sound in a browser whose pages have no AudioDecoder: Safari up to 18 (macOS 15, iOS 18). Every clip from a
// phone carries AAC, and without a decoder the editor there was silent — no sound in the player, no waveform, no sound
// in the mix. The browser does have the system's decoder behind `decodeAudioData`, which takes a whole stream, so the
// packets are wrapped as an ADTS stream and decoded in runs of about a second.
//
// Measured in WebKit 18.6 (14.11, a known signal through ffmpeg's and Apple's encoders): an ADTS stream of N packets
// decodes to exactly N × 1024 samples, nothing trimmed; a run cut out of the middle gives the same samples as the
// whole stream from its second packet on (the first block has no history to overlap with — as after any seek). So
// each run is decoded with the previous run's last packet in front and that first block is dropped: the runs join
// without a seam.
//
// Registered with mediabunny's custom decoders, so every reader of sound (player, waveform, mix, export) gets it;
// where AudioDecoder exists (Chrome, Edge, the Mac app, Safari 26+) `supports` says no and nothing changes.
import { AudioSample, type AudioCodec, CustomAudioDecoder, type EncodedPacket, registerDecoder } from "mediabunny";

/** Packets per decodeAudioData call: about a second of sound at 48 kHz. */
const RUN_PACKETS = 48;
const FREQUENCIES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export interface AdtsFields {
	/** The object type minus one (1 = AAC-LC). */
	profile: number;
	frequencyIndex: number;
	channelConfig: number;
}

/**
 * What an ADTS header says about this stream: read from the decoder config's AudioSpecificConfig, or — when the stream
 * cannot be read that way — from its rate and channel count as AAC-LC. `null`: this stream cannot be put into ADTS.
 */
export function adtsFieldsFor(config: { sampleRate: number; numberOfChannels: number; description?: AllowSharedBufferSource | undefined }): AdtsFields | null {
	const byRate = (): AdtsFields | null => {
		const frequencyIndex = FREQUENCIES.indexOf(config.sampleRate);
		const channels = config.numberOfChannels;
		if (frequencyIndex < 0 || channels < 1 || channels > 8) return null;
		return { profile: 1, frequencyIndex, channelConfig: channels === 8 ? 7 : channels };
	};
	const description = config.description;
	if (!description) return byRate();
	const bytes = ArrayBuffer.isView(description)
		? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
		: new Uint8Array(description as ArrayBuffer);
	if (bytes.length < 2) return byRate();
	let objectType = bytes[0] >> 3;
	const frequencyIndex = ((bytes[0] & 7) << 1) | (bytes[1] >> 7);
	let channelConfig = (bytes[1] >> 3) & 15;
	// an escaped object type or an explicit frequency: rare, and not what a phone writes
	if (objectType === 31 || frequencyIndex >= FREQUENCIES.length) return byRate();
	// SBR / PS signalled explicitly (HE-AAC): the core is AAC-LC at this frequency; the decoder finds the extension itself
	if (objectType === 5 || objectType === 29) objectType = 2;
	if (objectType < 1 || objectType > 4) return null;
	if (channelConfig === 0) {
		const channels = config.numberOfChannels;
		if (channels < 1 || channels > 8) return null;
		channelConfig = channels === 8 ? 7 : channels;
	}
	return { profile: objectType - 1, frequencyIndex, channelConfig };
}

const isAdts = (data: Uint8Array): boolean => data.length > 7 && data[0] === 0xff && (data[1] & 0xf6) === 0xf0;

/** The packets as one ADTS stream (a 7-byte header before each; a packet that is ADTS already goes in as it is). */
export function adtsStream(packets: readonly Uint8Array[], fields: AdtsFields): ArrayBuffer {
	let total = 0;
	for (const data of packets) total += isAdts(data) ? data.length : data.length + 7;
	const out = new Uint8Array(total);
	let at = 0;
	for (const data of packets) {
		if (!isAdts(data)) {
			const length = data.length + 7;
			out[at] = 0xff;
			out[at + 1] = 0xf1; // MPEG-4, no CRC
			out[at + 2] = (fields.profile << 6) | (fields.frequencyIndex << 2) | (fields.channelConfig >> 2);
			out[at + 3] = ((fields.channelConfig & 3) << 6) | (length >> 11);
			out[at + 4] = (length >> 3) & 0xff;
			out[at + 5] = ((length & 7) << 5) | 0x1f;
			out[at + 6] = 0xfc;
			at += 7;
		}
		out.set(data, at);
		at += data.length;
	}
	return out.buffer;
}

/** Is this the browser the fallback is for? (no AudioDecoder for pages, but the system decoder behind Web Audio) */
export function needsAacFallback(): boolean {
	return typeof AudioDecoder === "undefined" && typeof OfflineAudioContext !== "undefined";
}

class SystemAacDecoder extends CustomAudioDecoder {
	private fields: AdtsFields | null = null;
	private context: OfflineAudioContext | null = null;
	private queue: EncodedPacket[] = [];
	/** The last packet of the run before: decoded again in front of the next run, its block dropped. */
	private lead: EncodedPacket | null = null;

	static override supports(codec: AudioCodec, config: AudioDecoderConfig): boolean {
		return codec === "aac" && needsAacFallback() && adtsFieldsFor(config) !== null;
	}

	init(): void {
		this.fields = adtsFieldsFor(this.config);
		// the context's rate is the stream's: decodeAudioData resamples to its context, and nothing should be resampled here
		this.context = new OfflineAudioContext(Math.min(2, Math.max(1, this.config.numberOfChannels)), 1, this.config.sampleRate);
	}

	async decode(packet: EncodedPacket): Promise<void> {
		const last = this.queue[this.queue.length - 1] ?? this.lead;
		// a jump in time (a seek on the same decoder): what waits is decoded, and the old lead is not this packet's past
		if (last && Math.abs(packet.timestamp - (last.timestamp + last.duration)) > Math.max(last.duration, 0.001) / 2) {
			await this.run();
			this.lead = null;
		}
		this.queue.push(packet);
		if (this.queue.length >= RUN_PACKETS) await this.run();
	}

	async flush(): Promise<void> {
		await this.run();
		this.lead = null;
	}

	close(): void {
		this.queue = [];
		this.lead = null;
		this.context = null;
	}

	private async run(): Promise<void> {
		const packets = this.queue;
		const context = this.context;
		const fields = this.fields;
		if (packets.length === 0 || !context || !fields) return;
		this.queue = [];
		const front = this.lead ? [this.lead] : [];
		this.lead = packets[packets.length - 1];
		const bytes = adtsStream(
			[...front, ...packets].map((p) => p.data),
			fields,
		);
		let decoded: AudioBuffer;
		try {
			decoded = await new Promise<AudioBuffer>((resolve, reject) => {
				// the callback form: every Safari has it
				void context.decodeAudioData(bytes, resolve, reject);
			});
		} catch {
			// a run the system decoder refuses: its length in silence, so what follows stays in step
			const frames = Math.round(packets.reduce((sum, p) => sum + p.duration, 0) * this.config.sampleRate);
			if (frames > 0) {
				const channels = Math.max(1, this.config.numberOfChannels);
				this.onSample(
					new AudioSample({ data: new Float32Array(frames * channels), format: "f32-planar", numberOfChannels: channels, sampleRate: this.config.sampleRate, timestamp: packets[0].timestamp }),
				);
			}
			return;
		}
		const perPacket = decoded.length / (front.length + packets.length);
		const skip = Math.round(perPacket * front.length);
		const frames = decoded.length - skip;
		if (frames <= 0) return;
		const channels = decoded.numberOfChannels;
		const data = new Float32Array(frames * channels);
		for (let channel = 0; channel < channels; channel++) data.set(decoded.getChannelData(channel).subarray(skip), channel * frames);
		this.onSample(new AudioSample({ data, format: "f32-planar", numberOfChannels: channels, sampleRate: decoded.sampleRate, timestamp: packets[0].timestamp }));
	}
}

let registered = false;
/** Once per page; a no-op where the browser decodes AAC itself. */
export function registerAacFallback(): void {
	if (registered || !needsAacFallback()) return;
	registered = true;
	registerDecoder(SystemAacDecoder);
}

registerAacFallback();
