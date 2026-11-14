const MASTER_LIMITER_THRESHOLD_DB = -1;
const MASTER_LIMITER_KNEE_DB = 0;
const MASTER_LIMITER_RATIO = 20;
const MASTER_LIMITER_ATTACK_SECONDS = 0.001;
const MASTER_LIMITER_RELEASE_SECONDS = 0.12;
const MASTER_OUTPUT_HEADROOM = 0.98;

export function getAudioBufferPeak({
	audioBuffer,
}: {
	audioBuffer: AudioBuffer;
}): number {
	let peak = 0;

	for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
		const channelData = audioBuffer.getChannelData(channel);
		for (let index = 0; index < channelData.length; index++) {
			const magnitude = Math.abs(channelData[index]);
			if (magnitude > peak) {
				peak = magnitude;
			}
		}
	}

	return peak;
}

export function createAudioMasteringChain({
	audioContext,
	destination,
}: {
	audioContext: AudioContext | OfflineAudioContext;
	destination: AudioNode;
}): {
	input: GainNode;
} {
	const input = audioContext.createGain();
	const limiter = audioContext.createDynamicsCompressor();
	const outputGain = audioContext.createGain();

	limiter.threshold.value = MASTER_LIMITER_THRESHOLD_DB;
	limiter.knee.value = MASTER_LIMITER_KNEE_DB;
	limiter.ratio.value = MASTER_LIMITER_RATIO;
	limiter.attack.value = MASTER_LIMITER_ATTACK_SECONDS;
	limiter.release.value = MASTER_LIMITER_RELEASE_SECONDS;
	outputGain.gain.value = MASTER_OUTPUT_HEADROOM;

	input.connect(limiter);
	limiter.connect(outputGain);
	outputGain.connect(destination);

	return { input };
}

/** Mixes longer than this are limited in place: the Web Audio pass needs a second copy of the whole mix (an hour: 1.4 GB). */
const IN_PLACE_FROM_SECONDS = 600;

/**
 * The same limiter as the chain (threshold −1 dBFS, 1 ms attack, 120 ms release, ×0.98), sample by sample on the
 * buffer itself: a long export held the mix twice while the sound was fed to the encoder (final-B D7, 07.11: 4.2 GB).
 */
export function limitAudioBufferInPlace({ audioBuffer }: { audioBuffer: AudioBuffer }): void {
	const threshold = 10 ** (MASTER_LIMITER_THRESHOLD_DB / 20);
	const attack = Math.exp(-1 / (MASTER_LIMITER_ATTACK_SECONDS * audioBuffer.sampleRate));
	const release = Math.exp(-1 / (MASTER_LIMITER_RELEASE_SECONDS * audioBuffer.sampleRate));
	const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, c) => audioBuffer.getChannelData(c));
	const length = audioBuffer.length;
	let envelope = 0;
	for (let i = 0; i < length; i++) {
		let peak = 0;
		for (const data of channels) {
			const magnitude = Math.abs(data[i]);
			if (magnitude > peak) peak = magnitude;
		}
		// The gain reduction the chain would reach for this level (ratio 20:1 over the threshold), smoothed as its
		// attack and release do: the same gain on every channel keeps the stereo picture.
		const over = peak > threshold ? peak / threshold : 1;
		const wanted = over > 1 ? 1 - 1 / over ** (1 - 1 / MASTER_LIMITER_RATIO) : 0;
		envelope = wanted > envelope ? attack * envelope + (1 - attack) * wanted : release * envelope + (1 - release) * wanted;
		const gain = (1 - envelope) * MASTER_OUTPUT_HEADROOM;
		for (const data of channels) data[i] *= gain;
	}
	clampAudioBufferPeak({ audioBuffer, maxPeak: MASTER_OUTPUT_HEADROOM });
}

export async function applyAudioMasteringToBuffer({
	audioBuffer,
}: {
	audioBuffer: AudioBuffer;
}): Promise<AudioBuffer> {
	if (getAudioBufferPeak({ audioBuffer }) <= MASTER_OUTPUT_HEADROOM) {
		return audioBuffer;
	}
	if (audioBuffer.duration >= IN_PLACE_FROM_SECONDS) {
		limitAudioBufferInPlace({ audioBuffer });
		return audioBuffer;
	}

	const offlineContext = new OfflineAudioContext(
		audioBuffer.numberOfChannels,
		Math.max(1, audioBuffer.length),
		audioBuffer.sampleRate,
	);
	const source = offlineContext.createBufferSource();
	source.buffer = audioBuffer;

	const { input } = createAudioMasteringChain({
		audioContext: offlineContext,
		destination: offlineContext.destination,
	});
	source.connect(input);
	source.start(0);

	const renderedBuffer = await offlineContext.startRendering();
	clampAudioBufferPeak({
		audioBuffer: renderedBuffer,
		maxPeak: MASTER_OUTPUT_HEADROOM,
	});
	return renderedBuffer;
}

function clampAudioBufferPeak({
	audioBuffer,
	maxPeak,
}: {
	audioBuffer: AudioBuffer;
	maxPeak: number;
}): void {
	for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
		const channelData = audioBuffer.getChannelData(channel);
		for (let index = 0; index < channelData.length; index++) {
			channelData[index] = Math.max(
				-maxPeak,
				Math.min(maxPeak, channelData[index]),
			);
		}
	}
}
