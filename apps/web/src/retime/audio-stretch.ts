import { clampRetimeRate, shouldMaintainPitch } from "@/retime/rate";
import type { RetimeConfig } from "@/timeline";
import { getRetimeCurveTable, getSourceTimeAtClipTime } from "./resolve";

const RATE_EPSILON = 1e-6;

function sampleLinear({
	channelData,
	position,
}: {
	channelData: Float32Array;
	position: number;
}): number {
	if (position <= 0) {
		return channelData[0] ?? 0;
	}
	const lower = Math.floor(position);
	const upper = Math.min(channelData.length - 1, lower + 1);
	if (lower >= channelData.length) {
		return 0;
	}
	const fraction = position - lower;
	return channelData[lower] * (1 - fraction) + channelData[upper] * fraction;
}

function buildResampledBuffer({
	audioContext,
	sourceBuffer,
	trimStart,
	clipDuration,
	targetSampleRate,
	retime,
}: {
	audioContext: BaseAudioContext;
	sourceBuffer: AudioBuffer;
	trimStart: number;
	clipDuration: number;
	targetSampleRate: number;
	retime?: RetimeConfig;
}): AudioBuffer {
	const outputLength = Math.max(1, Math.ceil(clipDuration * targetSampleRate));
	const numChannels = Math.max(1, Math.min(2, sourceBuffer.numberOfChannels));
	const outputBuffer = audioContext.createBuffer(
		numChannels,
		outputLength,
		targetSampleRate,
	);

	for (let channel = 0; channel < numChannels; channel++) {
		const sourceData = sourceBuffer.getChannelData(
			Math.min(channel, sourceBuffer.numberOfChannels - 1),
		);
		const outputData = outputBuffer.getChannelData(channel);

		for (let i = 0; i < outputLength; i++) {
			const clipTime = i / targetSampleRate;
			const sourceTime =
				trimStart + getSourceTimeAtClipTime({ clipTime, retime, duration: clipDuration });
			outputData[i] = sampleLinear({
				channelData: sourceData,
				position: sourceTime * sourceBuffer.sampleRate,
			});
		}
	}

	return outputBuffer;
}

/**
 * Speed with the pitch kept, constant or a ramp: WSOLA (waveform-similarity overlap-add) driven by the clip→source
 * mapping, so the speed may change continuously and every grain sits where the picture is. A constant speed went
 * through SoundTouch (soundtouchjs), whose latency left the sound 160–200 ms behind the picture at 2× (pro-heavy,
 * 09.11). Grains of ~43 ms, 50 % overlap, each aligned to the previous one by cross-correlation (on a 4× decimated
 * mono mix) — no phasiness, no clicks.
 */
function buildVariablePitchPreservedBuffer({
	audioContext,
	sourceBuffer,
	trimStart,
	clipDuration,
	retime,
	targetSampleRate,
}: {
	audioContext: BaseAudioContext;
	sourceBuffer: AudioBuffer;
	trimStart: number;
	clipDuration: number;
	retime?: RetimeConfig;
	targetSampleRate: number;
}): AudioBuffer {
	const sr = sourceBuffer.sampleRate;
	const numChannels = Math.max(1, Math.min(2, sourceBuffer.numberOfChannels));
	const N = sr > 64000 ? 4096 : 2048;
	const hop = N / 2;
	const tol = N / 4;
	const D = 4;
	const outLen = Math.max(1, Math.ceil(clipDuration * sr));
	const src = Array.from({ length: numChannels }, (_, c) => sourceBuffer.getChannelData(Math.min(c, sourceBuffer.numberOfChannels - 1)));
	const srcLen = src[0].length;
	// Decimated mono for the similarity search.
	const decLen = Math.floor(srcLen / D);
	const dec = new Float32Array(decLen);
	for (let i = 0; i < decLen; i++) {
		let v = 0;
		for (let k = 0; k < D; k++) for (let c = 0; c < numChannels; c++) v += src[c][i * D + k];
		dec[i] = v / (D * numChannels);
	}
	const window = new Float32Array(N);
	for (let n = 0; n < N; n++) window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N);
	const out = Array.from({ length: numChannels }, () => new Float32Array(outLen + N));
	const weight = new Float32Array(outLen + N);
	const L = (N / 2) / D;
	let prev = -1;
	for (let o = 0; o < outLen; o += hop) {
		const centre = (o + N / 2) / sr;
		const want = Math.round((trimStart + getSourceTimeAtClipTime({ clipTime: centre, retime, duration: clipDuration })) * sr - N / 2);
		let pos = want;
		if (prev >= 0) {
			const natural = prev + hop;
			const nd = Math.floor(natural / D);
			let best = 0;
			let bestScore = Number.NEGATIVE_INFINITY;
			for (let d = -tol / D; d <= tol / D; d++) {
				const cd = Math.floor(want / D) + d;
				if (cd < 0 || cd + L >= decLen || nd < 0 || nd + L >= decLen) continue;
				let dot = 0;
				let energy = 1e-9;
				for (let k = 0; k < L; k++) {
					const b = dec[cd + k];
					dot += dec[nd + k] * b;
					energy += b * b;
				}
				const score = dot / Math.sqrt(energy);
				if (score > bestScore) {
					bestScore = score;
					best = d;
				}
			}
			pos = want + best * D;
		}
		for (let c = 0; c < numChannels; c++) {
			const s = src[c];
			const dst = out[c];
			for (let n = 0; n < N; n++) {
				const i = pos + n;
				if (i >= 0 && i < srcLen) dst[o + n] += window[n] * s[i];
			}
		}
		for (let n = 0; n < N; n++) weight[o + n] += window[n];
		prev = pos;
	}
	for (let c = 0; c < numChannels; c++) {
		const dst = out[c];
		for (let i = 0; i < outLen; i++) dst[i] = weight[i] > 1e-3 ? dst[i] / Math.max(weight[i], 0.5) : 0;
	}
	// To the context's rate (linear) when the file's differs.
	const finalLen = Math.max(1, Math.ceil(clipDuration * targetSampleRate));
	const result = audioContext.createBuffer(numChannels, finalLen, targetSampleRate);
	for (let c = 0; c < numChannels; c++) {
		const dst = result.getChannelData(c);
		if (targetSampleRate === sr) {
			dst.set(out[c].subarray(0, finalLen));
			continue;
		}
		const ratio = sr / targetSampleRate;
		for (let i = 0; i < finalLen; i++) dst[i] = sampleLinear({ channelData: out[c], position: i * ratio });
	}
	return result;
}

export async function renderRetimedBuffer({
	audioContext,
	sourceBuffer,
	trimStart,
	clipDuration,
	retime,
	maintainPitch = false,
}: {
	audioContext: BaseAudioContext;
	sourceBuffer: AudioBuffer;
	trimStart: number;
	clipDuration: number;
	retime?: RetimeConfig;
	maintainPitch?: boolean;
}): Promise<AudioBuffer> {
	const targetSampleRate = audioContext.sampleRate;
	const rate = clampRetimeRate({ rate: retime?.rate ?? 1 });
	const usePitchPreservation =
		(maintainPitch && !!getRetimeCurveTable(retime)) ||
		(shouldMaintainPitch({ rate, maintainPitch }) && Math.abs(rate - 1) > RATE_EPSILON);

	if (usePitchPreservation) {
		return buildVariablePitchPreservedBuffer({ audioContext, sourceBuffer, trimStart, clipDuration, retime, targetSampleRate });
	}

	return buildResampledBuffer({
		audioContext,
		sourceBuffer,
		trimStart,
		clipDuration,
		targetSampleRate,
		retime,
	});
}
