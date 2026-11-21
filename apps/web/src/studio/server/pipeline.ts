// The conveyor: YouTube fragment → voice (cloned from the clip, or one of the voices) → pre-flight check → lipsync.
// The voice and the lipsync run on fal.ai with the user's key; the checks and the cutting run on this Mac.
import fs from "node:fs";
import path from "node:path";
import { fitNote, getModel, LIPSYNC_TAIL_SECONDS as TAIL_SECONDS, type LipsyncModelId } from "@/studio/shared/models";
import { hasCached, lipsyncKey, putCached, takeCached } from "./cache";
import { StudioError } from "./errors";
import type { KeptOriginal } from "./local-provider";
import { falLipsync } from "@/fal/lipsync";
import { provider } from "@/ai/provider";
import type { VolcengineOptions } from "@/kie/catalog";
import { falModel, price, usd } from "@/fal/models";
import { getFile, newFile, removeFile, workDir } from "./files";
import { startJob } from "./jobs";
import { faceCheck, loopVideo, padSpeech, probe, trimVideo, colourTags, matchColour, retimeSpeech, pingpongVideo, freezeVideo, cutSpeech, endAt } from "./media";
import { startVoiceoverJob } from "./voiceover";
import { checkVideoLink, downloadSection, ensureCheckedLink } from "./youtube";
import { dubLanguage } from "@/assist/languages";
import { lipOptions, lipOptionsKey } from "@/fal/wire";
import { lipSettings, piecesVariant, preflightExtras, runPieces } from "./lip-run";
import { PLAN_RULES, planLipsync, wholePlan } from "./lip-plan";
import { ladder } from "./lip-ladder";
import { voicePrice } from "@/fal/voice";

/** A piece of an uploaded file: the clip as it sits on the timeline. `length` null = to the end. */
export interface Segment {
	fileId: string;
	start: number;
	length: number | null;
}

export interface FileResult {
	fileId: string;
	name: string;
	duration: number;
	/** Made before: taken from the results cache. */
	cached?: boolean;
	/** Local lipsync: pieces where the original face was kept (side profile, no face, blur, hand over the mouth). */
	kept?: KeptOriginal[];
}

// MARK: YouTube fragment

export function startFragment(body: { url: string; start: number; end: number; title?: string; full?: boolean }) {
	const url = String(body.url ?? "");
	const start = Number(body.start);
	const end = Number(body.end);
	const title = typeof body.title === "string" ? body.title : undefined;
	const full = body.full === true;
	checkVideoLink(url);
	ensureCheckedLink(url);
	if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) throw new StudioError("Invalid clip time");
	if (!full && !(end > start)) throw new StudioError("The end of the piece must be after its start");
	const site = /^https?:\/\/([\w-]+\.)*(youtube\.com|youtu\.be)\//i.test(url.trim()) ? "YouTube" : "web";
	const stage = full ? `Downloading the ${site} video` : `Downloading the ${site} piece`;
	// A whole long video can take a while; a piece is quick.
	return startJob("fragment", [{ id: "download", title: stage, timeout: full ? 3600 : 900 }], async (job) => {
		return job.step("download", async (signal) => {
			job.detail("download", full ? "downloading the whole video" : "downloading only the chosen piece");
			const base = (title || "YouTube").replace(/[/\\:@]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
			const name = full ? base : `${base} ${fmt(start)}-${fmt(end)}`;
			const slot = newFile(`${name}.mp4`);
			let file: string;
			try {
				file = await downloadSection(url, start, end, path.dirname(slot.path), "clip", {
					full,
					signal,
					onProgress: (p) => job.progress("download", p),
					// its real first frame: the client's placeholder turns from the YouTube still to it (stage detail «preview:<file id>»)
					onPreview: (still) => {
						try {
							const shot = newFile("preview.jpg");
							fs.renameSync(still, shot.path);
							job.detail("download", `preview:${shot.id}`);
						} catch {}
					},
				});
			} catch (error) {
				removeFile(slot.id);
				throw error;
			}
			fs.renameSync(file, slot.path);
			const info = await probe(slot.path, signal);
			return { fileId: slot.id, name: slot.name, duration: info.duration } satisfies FileResult;
		});
	});
}

function fmt(s: number) {
	const t = Math.round(s);
	return `${Math.floor(t / 60)}.${String(t % 60).padStart(2, "0")}`;
}

// MARK: Voice on fal.ai (a voice cloned from the clip, one of «My voices», or a ready / trending voice)

export function startVoiceover({
	source,
	voiceId,
	text,
	language,
}: {
	source?: Segment;
	voiceId?: string;
	text: string;
	/** Translate & dub: the language the text is in (ISO code), when it differs from the clip's. */
	language?: string;
}) {
	const dub = dubLanguage(language);
	const words = text.trim();
	if (!words) throw new StudioError("Type the voice-over text (or use AI script)");
	if (!voiceId && !source) throw new StudioError("Select the clip on the timeline to take the voice from, or pick one of your voices");
	return startVoiceoverJob({ source, voiceId, text: words, language: dub?.code });
}

// MARK: Pre-flight check before the lipsync

export interface Check {
	level: "ok" | "warn" | "fail";
	text: string;
	/** A stable name of the check for the page's own words. */
	key?: string;
}

export interface Preflight {
	checks: Check[];
	seconds: number;
	typical: string;
	blocking?: string;
	/** The same lipsync was made before — it is reused at once. */
	cached?: boolean;
	/** The pieces plan for this clip and model (what the run sends and what it costs: the button's price). */
	plan?: Awaited<ReturnType<typeof preflightExtras>>["plan"];
	/** Every lipsync model on fal with its price for THIS clip, cheapest first; `recommended` = what the checks pick and why (a key). */
	models?: Awaited<ReturnType<typeof preflightExtras>>["models"];
	recommended?: Awaited<ReturnType<typeof preflightExtras>>["recommended"];
	/** All faces seen, left to right, each judged (size / angle / occlusion). */
	faces?: Awaited<ReturnType<typeof preflightExtras>>["faces"];
	/** The sample offer (rule E): its window, model and price. */
	sample?: Awaited<ReturnType<typeof preflightExtras>>["sample"];
	/** Exactly what leaves the Mac. */
	sent?: Awaited<ReturnType<typeof preflightExtras>>["sent"];
	/** The plan's price in dollars (null: not known, e.g. kie.ai) — the number the button shows. */
	usd?: number;
	/** The voice still to be made (typed words): its price from the same table the voice job bills by (fal/voice.ts). */
	voiceUsd?: number;
	/** The button's one total: the voice still to make + the lipsync (none when it comes back from the cache). */
	total?: number;
	/** The voice is not made yet: the lipsync is priced on its estimated length, spoken all along (the run plans the real one). */
	estimated?: boolean;
}

/** What a lipsync result is cached under besides its files (":fal": made on fal.ai; ":tail": with room after the last
 * word, the older ones lost it). The pre-flight must ask for the same name: it asked for ":fal" and never found one. */
const lipsyncVariant = (modelId: string, fit: LengthFit, kie?: VolcengineOptions) => `${fit === "loop" ? `${modelId}:fal:tail` : `${modelId}:fal:tail:${fit}`}${kie?.mode === "basic" ? ":basic" : ""}${kie?.vocals ? ":vocals" : ""}`;

export async function preflight({
	video,
	audioFileId,
	model: modelId,
	fit = "loop",
	kie,
	signal,
	cuts,
	sampleAt,
	estimate,
	voice,
	voiceOnly,
	...rest
}: {
	video?: Segment;
	/** The sound the lips follow; absent while the typed words are not voiced yet (then `estimate`). */
	audioFileId?: string;
	/** The typed words' estimated voice length in seconds (no sound yet), the piece's length and smaller side (nothing uploaded). */
	estimate?: { seconds?: unknown; length?: unknown; side?: unknown; fps?: unknown };
	/** The words still to voice: the voice's price joins the total. */
	voice?: { chars?: unknown; clone?: unknown };
	/** «Voice under the clip»: only the voice's price. */
	voiceOnly?: unknown;
	model: LipsyncModelId;
	fit?: LengthFit;
	kie?: VolcengineOptions;
	signal?: AbortSignal;
	cuts?: number[];
	sampleAt?: number;
	seed?: unknown;
	guidance?: unknown;
	syncMode?: unknown;
}): Promise<Preflight> {
	const model = getModel(modelId);
	const out: Preflight = { checks: [], seconds: 0, typical: model.typical };
	const chars = Math.max(0, Math.round(Number(voice?.chars) || 0));
	const voiceUsd = voice && chars > 0 ? voicePrice(chars, voice.clone === true) : 0;
	if (voice) out.voiceUsd = voiceUsd;
	if (voiceOnly === true) {
		out.total = voiceUsd;
		return out;
	}
	if (!audioFileId || !video) return estimatePreflight(out, { model: modelId, fit, seconds: Number(estimate?.seconds) || 0, length: Number(estimate?.length) || 0, side: Number(estimate?.side) || 0, fps: Number(estimate?.fps) || 25, voiceUsd });
	const src = await probe(getFile(video.fileId).path, signal);
	const speech = (await probe(getFile(audioFileId).path, signal)).duration;
	const length = Math.max(0, video.length ?? src.duration - video.start);
	out.seconds = speech;
	out.checks.push({ level: "ok", text: `The result will be ≈ ${speech.toFixed(1)} s (speech length)` });
	const note = fitNote(speech, length, model);
	out.checks.push({ level: note.warn ? "warn" : "ok", text: note.text });

	if (!src.hasVideo) {
		out.blocking = "The chosen clip has no video — pick a video clip";
		out.checks.push({ level: "fail", text: out.blocking });
	} else {
		const face = await faceCheck(getFile(video.fileId).path, { start: video.start, length }, signal);
		if (face?.found) {
			out.checks.push(
				face.size < 0.1
					? { level: "warn", text: "The face is small — lips will look worse. A close-up works better" }
					: { level: "ok", text: "Face found, good size" },
			);
		} else if (face) {
			out.checks.push({ level: "warn", text: "No face found in the frame — lipsync may fail. Pick a piece where the face is clearly visible" });
		}
		const side = Math.min(src.width, src.height);
		if (side > 0 && side < 480) {
			out.checks.push({ level: "warn", text: `Low-quality source (${side}p) — the result will look blurry` });
		}
	}
	const options = lipOptions(rest);
	try {
		const old = lipsyncVariant(model.id, fit, kie);
		const variants = lipOptionsKey(options) ? [piecesVariant(old, options)] : [old, piecesVariant(old, options)];
		const keys = await Promise.all(variants.map((v) => lipsyncKey(getFile(video.fileId).path, video.start, length, getFile(audioFileId).path, v)));
		if (keys.some(hasCached)) {
			out.cached = true;
			out.checks.unshift({ level: "ok", text: "This lipsync was made before — taken from the cache at once, free" });
		}
	} catch {}
	const fal = falModel(model.id);
	const api = provider(fal?.api);
	if (!api.hasKey()) {
		out.blocking = fal?.api === "kie" ? "Add your kie.ai key in Settings → Services" : "Add your fal.ai key in Settings → Services (fal.ai)";
		out.checks.push({ level: "fail", text: out.blocking });
	} else if (fal) {
		// kie's ByteDance lipsync takes 360p–1080p: under that it refuses the job.
		if (fal.api === "kie" && src.hasVideo && Math.min(src.width, src.height) < 360) {
			out.blocking = `${fal.title} takes 360p or better — this clip is ${Math.min(src.width, src.height)}p. Pick another model`;
			out.checks.push({ level: "fail", text: out.blocking });
		}
		// Kling refuses anything under 720 px after the upload: said here, before the wait.
		if (fal.id.includes("kling") && src.hasVideo && Math.min(src.width, src.height) < 720) {
			out.blocking = `${fal.title} takes 720p or 1080p video — this clip is ${Math.min(src.width, src.height)}p. Pick another model`;
			out.checks.push({ level: "fail", text: out.blocking });
		}
		if (fal.maxSeconds && length > fal.maxSeconds + 0.05) {
			out.blocking = `${fal.title} takes pieces up to ${fal.maxSeconds} s — mark a shorter piece with In/Out or pick another model`;
			out.checks.push({ level: "fail", text: out.blocking });
		}
		const bill = Math.max(speech, fal.id.includes("kling") ? length : speech);
		let total = price(fal, bill);
		// the pieces plan: what the run will send and charge (the same function, the same files)
		if (src.hasVideo && lipSettings().pieces) {
			const work = workDir();
			try {
				const x = await preflightExtras({ source: getFile(video.fileId).path, start: video.start, pieceSeconds: Math.max(0.1, length), audio: getFile(audioFileId).path, fit, model: fal, cuts: numbers(cuts), variant: piecesVariant(lipsyncVariant(model.id, fit, kie), options), sampleAt: Number.isFinite(Number(sampleAt)) ? Number(sampleAt) : undefined, dir: work.dir, signal });
				Object.assign(out, x);
				total = x.plan.usd;
				out.checks.push({ level: "ok", key: "lipsync.pieces", text: `Only the speech goes out: ${x.plan.requests} piece(s), ${x.plan.secondsSent.toFixed(1)} s of ${x.plan.wholeSeconds.toFixed(1)} s` });
			} catch (error) {
				// the plan is a saving, never a blocker: the run plans again (and falls back to the whole piece)
				out.checks.push({ level: "warn", key: "lipsync.plan_failed", text: `Couldn't plan the pieces (${(error as Error).message}) — the whole piece will be sent` });
			} finally {
				work.dispose();
			}
		}
		out.usd = total;
		out.checks.push({ level: "ok", text: `${fal.title} on ${api.label} · about ${model.typical} · ≈ ${usd(total)}` });
	}
	out.total = voiceUsd + (out.cached ? 0 : (out.usd ?? 0));
	return out;
}

/**
 * The words are typed, the voice is not made: the lipsync is priced on the voice's estimated length, spoken all along,
 * through the same plan the run uses (lip-plan.ts) — the run then plans the real voice. The button shows «≈».
 */
function estimatePreflight(out: Preflight, o: { model: LipsyncModelId; fit: LengthFit; seconds: number; length: number; side: number; fps: number; voiceUsd: number }): Preflight {
	out.estimated = true;
	const fal = falModel(getModel(o.model).id);
	const length = Math.max(0, o.length);
	const voiced = Math.max(0.5, o.seconds);
	// what goes, as fitLengths makes it from a real voice: the whole piece (pad), the piece (cut / speed), else the voice
	const wanted = o.fit === "pad" ? Math.max(voiced, length) : o.fit === "cut" || o.fit === "speed" ? length || voiced : voiced;
	out.seconds = voiced;
	if (!fal || !provider(fal.api).hasKey()) {
		out.total = o.voiceUsd;
		return out;
	}
	const s = lipSettings();
	const input = { duration: wanted, fps: Math.min(120, Math.max(1, o.fps)), speech: [{ start: 0, end: voiced }], cuts: [], model: fal, rules: { pack: s.pack, tail: TAIL_SECONDS } };
	const plan = s.pieces ? planLipsync(input) : wholePlan(input);
	out.usd = plan.usd;
	// every fal model's price for the same estimate (the model list compares them; lipb's ladder, the same plan)
	out.models = ladder({ plan: { duration: input.duration, fps: input.fps, speech: input.speech, cuts: [], rules: { ...PLAN_RULES, ...input.rules } }, pieces: s.pieces, side: o.side }).map((m) => ({ ...m, recommended: false }));
	out.total = o.voiceUsd + plan.usd;
	return out;
}

const numbers = (xs: unknown): number[] | undefined => (Array.isArray(xs) ? xs.map(Number).filter((x) => Number.isFinite(x)) : undefined);

// MARK: Lipsync (on this Mac)

/**
 * How speech and piece lengths are reconciled, always before anything is sent (the model gets exactly as much video as
 * there is speech): "loop" = a shorter speech cuts the video to its length, a longer one loops the video; "pingpong"
 * = the video plays forward and back; "freeze" = the last frame holds; "cut" = the speech is cut to the video;
 * "speed" = the speech tempo changes (0.8–1.25×) to fit; "pad" = a shorter speech gets silence after it (the whole
 * piece is lipsynced, lips at rest after the voice).
 */
export type LengthFit = "loop" | "speed" | "pad" | "pingpong" | "freeze" | "cut";

export const LENGTH_FITS: readonly LengthFit[] = ["loop", "speed", "pad", "pingpong", "freeze", "cut"];

export function startLipsync({
	video,
	audioFileId,
	model: modelId,
	fit = "loop",
	fresh = false,
	kie,
	mode,
	sampleAt,
	sampleModel,
	cuts,
	maxUsd,
	...rest
}: {
	video: Segment;
	audioFileId: string;
	model: LipsyncModelId;
	/** The most this run may charge (the press agreed to an estimate): a plan above it stops before anything is sent. */
	maxUsd?: unknown;
	fit?: LengthFit;
	/** A new take: the cache is not asked (the new result replaces the cached one). */
	fresh?: boolean;
	kie?: VolcengineOptions;
	/** "sample": only the hardest ~3 s (or the one at `sampleAt`), on the cheapest per-second model or `sampleModel`. */
	mode?: unknown;
	sampleAt?: unknown;
	sampleModel?: unknown;
	/** The clip's own cuts the page knows (seconds from the piece's start), besides the ones the run finds. */
	cuts?: unknown;
	/** The take's knobs: seed (another take), guidance (LatentSync's lip strength 1–2), syncMode (Sync's). */
	seed?: unknown;
	guidance?: unknown;
	syncMode?: unknown;
}) {
	const api = provider(falModel(modelId)?.api);
	if (!api.hasKey()) throw new StudioError(api.id === "kie" ? "Add your kie.ai key first: Settings → Services." : "Add your fal.ai key first: Settings → Services (fal.ai).");
	// Checked before the job starts, so a request without its clip or speech gets a clear 4xx, not a job that fails later.
	if (!video?.fileId || !audioFileId) throw new StudioError("Pick the clip and the speech to lipsync");
	const model = getModel(modelId);
	const options = lipOptions(rest);
	const sample = mode === "sample";
	if (lipSettings().pieces || sample) {
		return startJob(
			"lipsync",
			[
				{ id: "prepare", title: "Preparing the video", timeout: 1800 },
				{ id: "lipsync", title: `Lipsync on ${api.label} · ${model.title}`, timeout: 3600 },
			],
			async (job) => {
				const work = workDir();
				try {
					const source = getFile(video.fileId).path;
					const audio = getFile(audioFileId).path;
					const sourceInfo = await probe(source, job.signal);
					if (!sourceInfo.hasVideo) throw new StudioError("The chosen clip has no video — pick a video clip", { key: "lipsync.no_video_track" });
					const fullLength = Math.max(0.1, video.length ?? sourceInfo.duration - video.start);
					const variant = piecesVariant(lipsyncVariant(model.id, fit, kie), options);
					const key = await lipsyncKey(source, video.start, fullLength, audio, variant);
					if (!sample) {
						// a result made before (by this path, or by the one-request path of before with the same knobs)
						const old = lipOptionsKey(options) ? null : await lipsyncKey(source, video.start, fullLength, audio, lipsyncVariant(model.id, fit, kie));
						const hit = fresh ? null : (takeCached(key, "Lipsync.mp4") ?? (old ? takeCached(old, "Lipsync.mp4") : null));
						if (hit) {
							for (const id of ["prepare", "lipsync"]) job.skip(id, "made before — from the cache");
							const info = await probe(hit.path, job.signal);
							return { fileId: hit.id, name: hit.name, duration: info.duration, cached: true } satisfies FileResult;
						}
					}
					const r = await runPieces(job, { source, start: video.start, pieceSeconds: fullLength, audio, fit, modelId: model.id, variant, options, kie, cuts: numbers(cuts), mode: sample ? "sample" : "full", sampleAt: Number.isFinite(Number(sampleAt)) ? Number(sampleAt) : undefined, sampleModel: typeof sampleModel === "string" ? sampleModel : undefined, fresh, dir: work.dir, maxUsd: Number.isFinite(Number(maxUsd)) && maxUsd !== null && maxUsd !== undefined ? Number(maxUsd) : undefined });
					if (!sample) putCached(key, getFile(r.fileId).path);
					return r;
				} finally {
					work.dispose();
				}
			},
		);
	}
	return startJob(
		"lipsync",
		[
			{ id: "prepare", title: "Preparing the video", timeout: 600 },
			{ id: "lipsync", title: `Lipsync on ${api.label} · ${model.title}`, timeout: 3600 },
		],
		async (job) => {
			const work = workDir();
			try {
				let audio = getFile(audioFileId).path;
				const source = getFile(video.fileId).path;
				const sourceColour = await colourTags(source, job.signal);
				const fullLength = Math.max(0.1, video.length ?? (await probe(source, job.signal)).duration - video.start);
				const key = await lipsyncKey(source, video.start, fullLength, audio, lipsyncVariant(model.id, fit, kie));
				const hit = fresh ? null : takeCached(key, "Lipsync.mp4");
				if (hit) {
					for (const id of ["prepare", "lipsync"]) job.skip(id, "made before — from the cache");
					const info = await probe(hit.path, job.signal);
					return { fileId: hit.id, name: hit.name, duration: info.duration, cached: true } satisfies FileResult;
				}
				const { inputVideo, inputAudio, wanted } = await job.step("prepare", async (signal) => {
					const src = await probe(source, signal);
					let audioSeconds = (await probe(audio, signal)).duration;
					const pieceSeconds = Math.max(0.1, video.length ?? src.duration - video.start);
					if (fit === "speed" && Math.abs(audioSeconds - pieceSeconds) > 0.1) {
						// The speech is sped up / slowed down to the piece: no loop, no cut.
						job.detail("prepare", `fitting the speech to ${pieceSeconds.toFixed(1)} s`);
						const fitted = path.join(work.dir, "speech_fit.m4a");
						await retimeSpeech(audio, audioSeconds / pieceSeconds, fitted, signal);
						audio = fitted;
						audioSeconds = (await probe(audio, signal)).duration;
					}
					if (fit === "pad" && audioSeconds < pieceSeconds - 0.1) {
						// The whole clip is kept: silence after the voice, nothing is cut.
						job.detail("prepare", `keeping all ${pieceSeconds.toFixed(1)} s of the clip`);
						const padded = path.join(work.dir, "speech_pad.m4a");
						await padSpeech(audio, pieceSeconds, padded, signal);
						audio = padded;
						audioSeconds = (await probe(audio, signal)).duration;
					}
					const length = Math.max(0.1, video.length ?? src.duration - video.start);
					if (fit === "cut" && audioSeconds > length + 0.05) {
						// The speech stops with the picture.
						job.detail("prepare", `cutting the speech to ${length.toFixed(1)} s`);
						const cut = path.join(work.dir, "speech_cut.m4a");
						await cutSpeech(audio, length, cut, signal);
						audio = cut;
						audioSeconds = (await probe(audio, signal)).duration;
					}
					// Exactly as much video as there is speech goes out: a longer clip is cut to the speech here, before the
					// upload (the model never lipsyncs silence, and the price is for the speech only).
					const keep = audioSeconds < length - 0.05 ? audioSeconds : length;
					let prepared = path.join(work.dir, "video.mp4");
					job.detail("prepare", `cutting ${keep.toFixed(1)} s`);
					// kie's ByteDance lipsync needs 24–60 fps; its output is 25 fps and follows the audio, so the cut-back below holds.
					await trimVideo(source, video.start, keep, prepared, signal, model.fps ?? (falModel(model.id)?.api === "kie" ? 25 : undefined));
					// A longer speech: the picture is made as long as the speech (loop, ping-pong or a held last frame).
					const target = Math.max(audioSeconds, keep < 2.2 ? 2.5 : 0);
					if (target > keep + 0.05) {
						const longer = path.join(work.dir, "video_long.mp4");
						if (fit === "pingpong") {
							job.detail("prepare", "playing the video forward and back to the speech length");
							await pingpongVideo(prepared, target, longer, signal);
						} else if (fit === "freeze") {
							job.detail("prepare", "holding the last frame to the speech length");
							await freezeVideo(prepared, target, longer, signal);
						} else {
							job.detail("prepare", "looping the video to the speech length");
							await loopVideo(prepared, target, longer, signal);
						}
						prepared = longer;
					}
					// Room after the last word: the models drop the end of a piece (LatentSync works in 16-frame chunks and
					// cut up to 0.6 s — the last word — off every take, 05.11). The piece goes out 0.8 s longer (the last frame
					// held, silence after the speech) and the result is cut back to its own length.
					const wanted = (await probe(prepared, signal)).duration;
					const cap = falModel(model.id)?.maxSeconds;
					const tail = Math.min(TAIL_SECONDS, cap ? cap - wanted - 0.05 : TAIL_SECONDS);
					if (tail < 0.1) return { inputVideo: prepared, inputAudio: audio, wanted };
					const held = path.join(work.dir, "video_tail.mp4");
					await freezeVideo(prepared, wanted + tail, held, signal);
					const roomy = path.join(work.dir, "speech_tail.m4a");
					await padSpeech(audio, wanted + tail, roomy, signal);
					return { inputVideo: held, inputAudio: roomy, wanted };
				});
				return await job.step("lipsync", async (signal) => {
					const slot = newFile("Lipsync.mp4");
					try {
						const { cost } = await falLipsync({
							video: inputVideo,
							audio: inputAudio,
							out: slot.path,
							model: model.id,
							resumeKey: key,
							kie,
							options,
							onStatus: (t) => job.detail("lipsync", t),
							onProgress: (p) => job.progress("lipsync", p),
							signal,
						});
						job.charge(cost);
						await endAt(slot.path, wanted, work.dir, signal);
						await tagColour(slot.path, sourceColour, work.dir, signal);
						const info = await probe(slot.path, signal);
						if (!info.hasVideo) throw new StudioError("Lipsync produced no video. Press Retry.");
						putCached(key, slot.path);
						return { fileId: slot.id, name: slot.name, duration: info.duration, cost } satisfies FileResult & { cost: number };
					} catch (error) {
						removeFile(slot.id); // a failed or cancelled run leaves no half-written video
						throw error;
					}
				});
			} finally {
				work.dispose();
			}
		},
	);
}

/** Puts the source's colour description on the result in place (no re-encode), so the piece matches its neighbours. */
async function tagColour(file: string, colour: Awaited<ReturnType<typeof colourTags>>, dir: string, signal?: AbortSignal) {
	const tagged = path.join(dir, "result_colour.mp4");
	try {
		if (await matchColour(file, colour, tagged, signal)) fs.renameSync(tagged, file);
	} catch {
		// A result without matching tags is still usable; never fail over metadata.
	}
}
