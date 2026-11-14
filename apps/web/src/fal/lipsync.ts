// Lipsync on fal.ai: the prepared piece and the speech go to the chosen model (LatentSync by default), the result
// comes back as a file. What each model takes: LatentSync loops the video when the speech is longer; Sync has its own
// length modes; Kling takes 2–10 s pieces.
import { StudioError } from "@/studio/server/errors";
import fs from "node:fs";
import { fitBitrate, probe } from "@/studio/server/media";
import { falModel, type FalModel, price } from "./models";
import { type VolcengineOptions, volcengineInput } from "../kie/catalog";
import { provider } from "@/ai/provider";
import { modelFor, type RunOptions } from "./server";
import { type LipOptions, lipsyncInput } from "./wire";

export function lipsyncModel(id?: string): FalModel {
	const m = falModel(id);
	return m && m.task === "lipsync" ? m : modelFor("lipsync");
}

/** kie's page for ByteDance lipsync: the video's bit rate, in bits per second. */
const KIE_BITRATE = { min: 1_000_000, max: 30_000_000 };

/** Seconds of processing on fal per second of video (the progress bar's pace; measured on fal's own examples). */
const PACE: Record<string, number> = { "fal-ai/latentsync": 4, "fal-ai/sync-lipsync": 5, "fal-ai/sync-lipsync/v2": 6, "fal-ai/sync-lipsync/v2/pro": 10, "fal-ai/kling-video/lipsync/audio-to-video": 30 };

export async function falLipsync(
	o: {
		video: string;
		audio: string;
		out: string;
		model?: string;
		kie?: VolcengineOptions;
		/** The take's knobs (seed, lip strength, Sync's mode). */
		options?: LipOptions;
		/** The seconds the plan priced this request at: the charge is the estimate (no rounding of container lengths). */
		billSeconds?: number;
	} & RunOptions,
): Promise<{ cost: number; model: FalModel }> {
	const model = lipsyncModel(o.model);
	const info = await probe(o.video, o.signal);
	const seconds = Math.max(0.5, (await probe(o.audio, o.signal)).duration, info.duration);
	if (model.maxSeconds && info.duration > model.maxSeconds + 0.05) throw new StudioError(`${model.title} takes pieces up to ${model.maxSeconds} s (this one is ${info.duration.toFixed(1)} s). Pick another model.`, { key: "lipsync.too_long", vars: { model: model.title, max: model.maxSeconds, seconds: Number(info.duration.toFixed(1)) } });
	if (model.minSeconds && info.duration < model.minSeconds - 0.05) throw new StudioError(`${model.title} needs a piece of at least ${model.minSeconds} s.`, { key: "lipsync.too_short", vars: { model: model.title, min: model.minSeconds } });
	// kie's page: 240 s in lite, 210 s in basic.
	if (o.kie?.mode === "basic" && seconds > 210) throw new StudioError(`${model.title} in Basic takes up to 210 s (this one is ${seconds.toFixed(0)} s). Pick Lite or mark a shorter piece.`);
	const api = provider(model.api);
	// kie's ByteDance lipsync takes 1–30 Mbit/s of video, and a still talking head is cut at a few hundred kbit/s: it is
	// raised here, before the upload, and said in the job's status, not refused by kie after the upload.
	const fitted = model.api === "kie" ? await fitBitrate(o.video, `${o.video}.kie.mp4`, KIE_BITRATE, o.signal) : undefined;
	if (fitted?.changed) o.onStatus?.(`${model.title} needs video of ${KIE_BITRATE.min / 1e6}–${KIE_BITRATE.max / 1e6} Mbit/s (this was ${(fitted.from / 1e6).toFixed(2)}): encoding it at ${(fitted.to / 1e6).toFixed(1)}`);
	let video_url: string;
	let audio_url: string;
	try {
		o.onStatus?.(`sending the piece to ${api.label}`);
		[video_url, audio_url] = [await api.upload(fitted?.file ?? o.video, o.signal), await api.upload(o.audio, o.signal)];
	} finally {
		if (fitted?.changed) fs.rmSync(fitted.file, { force: true });
	}
	const input = model.api === "kie" ? volcengineInput(video_url, audio_url, o.kie) : lipsyncInput(model.id, video_url, audio_url, o.options);
	const expect = 20 + (PACE[model.id] ?? 6) * seconds;
	// 20 min for a shot (B1: an hour's limit held Claude and the window); a long piece gets twice its usual time.
	const r = await api.run(model.id, input, "video", { ...o, expectSeconds: expect, timeoutSeconds: Math.max(1200, Math.round(2 * expect)) });
	await api.save(r.video?.url, o.out, o.signal);
	const cost = r.usd ?? price(model, o.billSeconds ?? (model.id.includes("kling") ? info.duration : seconds));
	api.spend("lipsync", cost);
	return { cost, model };
}
