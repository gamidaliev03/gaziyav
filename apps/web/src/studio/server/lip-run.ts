// Lipsync in pieces (lipb, 14.11): the sound the lips follow → where somebody speaks → the plan (lip-plan.ts) → only
// those pieces go to the model, several at once, each one followed by its own paid row and cached the moment it lands
// → ONE clip of the source's length, the face region of each answer composited over our own frames.
// The request and the result keep the shape the page knows (pipeline.ts startLipsync); what is new rides on the job's
// stage data and the pre-flight's answer.
import crypto from "node:crypto";
import path from "node:path";
import { falModel, type FalModel, price } from "@/fal/models";
import { falLipsync } from "@/fal/lipsync";
import { type LipOptions, lipOptionsKey } from "@/fal/wire";
import type { VolcengineOptions } from "@/kie/catalog";
import { LIPSYNC_TAIL_SECONDS } from "@/studio/shared/models";
import { cachedJson, cachedPath, fileHash, putCached, putCachedJson } from "./cache";
import { CancelledError, StudioError } from "./errors";
import { newFile, removeFile } from "./files";
import type { Job } from "./jobs";
import type { FaceMark } from "./lip-compose";
import { judgeFaces, ladder, recommend, sampleModel } from "./lip-ladder";
import { cutRequest, faceMarks, partsOf, type Picture, pictureOf, sceneCuts, soundSpans, type StitchPart, type StitchStats, stitch, videoInfo, type VideoInfo } from "./lip-media";
import { type Plan, PLAN_RULES, planLipsync, type PlanRules, sampleWindow, wholePlan } from "./lip-plan";
import { colourTags, faceCheck, freezeVideo, loopVideo, pingpongVideo, probe, trimVideo } from "./media";
import { loadSettings } from "./settings";
import { findTool, run } from "./tools";

/** Bump when what a piece's answer means changes (its cache entries are not reused across versions). */
const PIECES_VERSION = "p2";

export interface LipSettings {
	/** Send only the speech, in pieces (off: the one request of before). */
	pieces: boolean;
	/** Lay only the face region of the answer over our frames (off: the provider's whole frames in the pieces). */
	composite: boolean;
	/** Several pieces in one request where a per-request floor makes it cheaper. */
	pack: boolean;
	/** Requests at once. */
	parallel: number;
	/** Send 4:4:4 chroma (off: 4:2:0, what every provider decodes). */
	chroma444: boolean;
	/** Tests only: a lossless result, so a decode is the composited frames to the bit. */
	lossless: boolean;
}

export function lipSettings(): LipSettings {
	let s: Record<string, unknown> = {};
	try {
		s = { ...(loadSettings().lipsyncPipeline ?? {}) };
	} catch {}
	if (process.env.STUDIO_TEST === "1" && process.env.STUDIO_TEST_LIP) {
		try {
			Object.assign(s, JSON.parse(process.env.STUDIO_TEST_LIP));
		} catch {}
	}
	return {
		pieces: s.pieces !== false,
		composite: s.composite !== false,
		pack: s.pack !== false,
		parallel: Math.max(1, Math.min(6, Number(s.parallel) || 3)),
		chroma444: s.chroma444 === true,
		lossless: process.env.STUDIO_TEST === "1" && s.lossless === true,
	};
}

const rulesOf = (s: LipSettings): PlanRules => ({ ...PLAN_RULES, pack: s.pack, tail: LIPSYNC_TAIL_SECONDS });

const sha = (...parts: Array<string | number>) => crypto.createHash("sha256").update(parts.join("|")).digest("hex");

// MARK: the sound and the lengths (shared by the pre-flight and the run: the same files, the same plan, the same price)

export type LengthFit = "loop" | "speed" | "pad" | "pingpong" | "freeze" | "cut";

/** What the piece will be: the sound after the length fit, the source seconds kept, the result's length. */
export interface Lengths {
	audio: string;
	audioSeconds: number;
	keep: number;
	wanted: number;
	/** The picture must be made longer than the source piece (loop / ping-pong / freeze). */
	longer: boolean;
}

/** The sound fitted to the piece exactly as the run does it (speed / pad / cut), and the lengths that follow. */
export async function fitLengths(o: { audio: string; pieceSeconds: number; fit: LengthFit; dir: string; signal?: AbortSignal }): Promise<Lengths> {
	const { retimeSpeech, padSpeech, cutSpeech } = await import("./media");
	let audio = o.audio;
	let seconds = (await probe(audio, o.signal)).duration;
	const length = o.pieceSeconds;
	if (o.fit === "speed" && Math.abs(seconds - length) > 0.1) {
		const out = path.join(o.dir, "speech_fit.m4a");
		await retimeSpeech(audio, seconds / length, out, o.signal);
		audio = out;
		seconds = (await probe(audio, o.signal)).duration;
	}
	if (o.fit === "pad" && seconds < length - 0.1) {
		const out = path.join(o.dir, "speech_pad.m4a");
		await padSpeech(audio, length, out, o.signal);
		audio = out;
		seconds = (await probe(audio, o.signal)).duration;
	}
	if (o.fit === "cut" && seconds > length + 0.05) {
		const out = path.join(o.dir, "speech_cut.m4a");
		await cutSpeech(audio, length, out, o.signal);
		audio = out;
		seconds = (await probe(audio, o.signal)).duration;
	}
	const keep = seconds < length - 0.05 ? seconds : length;
	const target = Math.max(seconds, keep < 2.2 ? 2.5 : 0);
	const longer = target > keep + 0.05;
	return { audio, audioSeconds: seconds, keep, wanted: longer ? target : keep, longer };
}

export interface Analysis {
	info: VideoInfo;
	picture: Picture;
	lengths: Lengths;
	speech: Array<{ start: number; end: number }>;
	levels: Float32Array;
	cuts: number[];
	cutsKnown: boolean;
	/** The file the pieces are cut from and the frame of it the piece starts at. */
	base: { file: string; k0: number };
}

/** Everything the plan needs, from the files on this Mac. `scan` = look for the picture's own cuts (a decode of the piece). */
export async function analyse(o: {
	source: string;
	start: number;
	pieceSeconds: number;
	audio: string;
	fit: LengthFit;
	dir: string;
	cuts?: number[];
	scan: boolean;
	chroma444: boolean;
	/** The run: a longer picture (loop / ping-pong / freeze) is made here; the pre-flight only needs its length. */
	build: boolean;
	signal?: AbortSignal;
}): Promise<Analysis> {
	const info = await videoInfo(o.source, o.signal);
	const colour = await colourTags(o.source, o.signal);
	const picture = pictureOf(colour, { chroma444: o.chroma444, zscale: await hasZscale() });
	const lengths = await fitLengths({ audio: o.audio, pieceSeconds: o.pieceSeconds, fit: o.fit, dir: o.dir, signal: o.signal });
	const { speech, levels } = await soundSpans(lengths.audio, o.dir, o.signal);
	let cuts = (o.cuts ?? []).filter((c) => Number.isFinite(c) && c > 0 && c < lengths.wanted);
	let cutsKnown = !!o.cuts;
	if (o.scan) {
		cuts = [...cuts, ...(await sceneCuts(o.source, o.start, lengths.keep, o.signal))];
		cutsKnown = true;
	}
	let base = { file: o.source, k0: Math.round(o.start * info.fps) };
	if (lengths.longer) {
		// a looped picture jumps back at every seam: a cut for the plan
		if (o.fit !== "pingpong" && o.fit !== "freeze") for (let t = lengths.keep; t < lengths.wanted - 0.05; t += lengths.keep) cuts.push(t);
		if (o.build) {
			const once = path.join(o.dir, "video.mp4");
			await trimVideo(o.source, o.start, lengths.keep, once, o.signal, info.fps);
			const longer = path.join(o.dir, "video_long.mp4");
			if (o.fit === "pingpong") await pingpongVideo(once, lengths.wanted, longer, o.signal);
			else if (o.fit === "freeze") await freezeVideo(once, lengths.wanted, longer, o.signal);
			else await loopVideo(once, lengths.wanted, longer, o.signal);
			base = { file: longer, k0: 0 };
		}
	}
	return { info, picture, lengths, speech, levels, cuts: [...new Set(cuts.map((c) => Math.round(c * 1000) / 1000))].sort((a, b) => a - b), cutsKnown, base };
}

let zscale: boolean | null = null;
async function hasZscale(): Promise<boolean> {
	if (zscale != null) return zscale;
	try {
		const r = await run(findTool("ffmpeg"), ["-hide_banner", "-filters"], { timeout: 20 });
		zscale = /\szscale\s/.test(r.stdout);
	} catch {
		zscale = false;
	}
	return zscale;
}

/** The plan for a model and the analysis (no speech found at all: the whole piece, as before). */
export function planFor(a: Analysis, model: FalModel, s: LipSettings, made?: Array<{ a: number; b: number }>): Plan {
	const input = { duration: a.lengths.wanted, fps: a.info.fps, speech: a.speech, cuts: a.cuts, model, rules: rulesOf(s), made };
	if (!s.pieces || !a.speech.length) return wholePlan(input);
	return planLipsync(input);
}

/** The plan as the page reads it (seconds, not frames). */
export function planData(p: Plan, model: FalModel) {
	return {
		model: model.id,
		mode: p.mode,
		requests: p.requests.length,
		secondsSent: p.secondsSent,
		usd: p.usd,
		speechSeconds: p.speechSeconds,
		wholeSeconds: p.wholeSeconds,
		wholeUsd: p.wholeUsd,
		pieces: p.units.map((u) => ({ from: u.a / p.fps, to: u.b / p.fps, made: !!u.made })),
	};
}

// MARK: the pre-flight's new answers

export async function preflightExtras(o: {
	source: string;
	start: number;
	pieceSeconds: number;
	audio: string;
	fit: LengthFit;
	model: FalModel;
	cuts?: number[];
	variant: string;
	sampleAt?: number;
	dir: string;
	signal?: AbortSignal;
}) {
	const s = lipSettings();
	// the picture's cuts are looked for in the pre-flight up to 5 min (a decode); a longer piece is checked by the run
	const a = await analyse({ ...o, scan: o.pieceSeconds <= 300, chroma444: s.chroma444, build: false });
	const made = madeOf(await baseKey(o.source, o.start, o.pieceSeconds, a.lengths.audio, o.variant));
	const plan = planFor(a, o.model, s, made.map((m) => ({ a: m.a, b: m.b })));
	const face = await faceCheck(o.source, { start: o.start, length: a.lengths.keep }, o.signal);
	const faces = judgeFaces(face?.faces ?? [], a.info, face?.frames || 5);
	const side = Math.min(a.info.width, a.info.height);
	const models = ladder({ plan: { duration: a.lengths.wanted, fps: a.info.fps, speech: a.speech, cuts: a.cuts, rules: rulesOf(s) }, pieces: s.pieces && a.speech.length > 0, side });
	const rec = recommend(faces);
	const window = sampleWindow({ duration: a.lengths.wanted, fps: a.info.fps, speech: a.speech, cuts: a.cuts, levels: a.levels, levelStep: 0.01, at: o.sampleAt });
	const sample = window ? sampleOffer(window, a.info.fps, o.model, plan) : null;
	return {
		plan: { ...planData(plan, o.model), cutsKnown: a.cutsKnown, cuts: a.cuts },
		models: models.map((m) => ({ ...m, recommended: m.id === rec.id })),
		recommended: rec,
		faces,
		sample,
		sent: sentData(a),
	};
}

function sampleOffer(w: { a: number; b: number }, fps: number, full: FalModel, plan: Plan) {
	const seconds = (w.b - w.a) / fps + LIPSYNC_TAIL_SECONDS;
	const first = plan.requests[0]?.usd ?? price(full, seconds);
	const cheap = sampleModel(seconds, full, price(full, seconds));
	// no per-second model is cheaper than the full model's floor: the full model's first request is the sample
	if (!cheap) return { from: w.a / fps, to: w.b / fps, model: full.id, usd: first, seconds: plan.requests[0]?.seconds ?? seconds, reuse: true, why: "no_cheaper_per_second" as const };
	return { from: w.a / fps, to: w.b / fps, model: cheap.model.id, usd: price(cheap.model, seconds), seconds, reuse: cheap.model.id === full.id };
}

/** Exactly what leaves the Mac, for the note and the page. */
function sentData(a: Analysis) {
	return { fps: a.info.fps, width: a.info.width, height: a.info.height, pixFmt: a.picture.pixFmt, colour: a.picture.tags, conversion: a.picture.how, codec: "h264 CRF 12 (aq-mode 3), ≤ 25 Mbit/s", audio: "aac 192k" };
}

// MARK: samples made before (rule E: never paid twice)

interface Made {
	a: number;
	b: number;
	request: string;
}

async function baseKey(source: string, start: number, length: number, audio: string, variant: string) {
	return sha(await fileHash(source), start.toFixed(3), length.toFixed(3), await fileHash(audio), variant, PIECES_VERSION);
}

const madeKey = (base: string) => `lipmade-${base}`;
const madeOf = (base: string): Made[] => (cachedJson<Made[]>(madeKey(base)) ?? []).filter((m) => cachedPath(m.request));

// MARK: the run

export interface PiecesResult {
	fileId: string;
	name: string;
	duration: number;
	cost: number;
	/** What happened, for the page and the tests. */
	pieces: ReturnType<typeof planData> & { sent: ReturnType<typeof sentData>; composite: StitchStats & { on: boolean }; submitted: number; fromCache: number; retried: number };
	sample?: { from: number; to: number; model: string };
}

/**
 * The lipsync of a piece in pieces. `mode: "sample"` makes only the sample window (on the cheapest per-second model,
 * or the one named) and remembers it, so the full run of the same model doesn't send those seconds again.
 */
export async function runPieces(job: Job, o: {
	source: string;
	start: number;
	pieceSeconds: number;
	audio: string;
	fit: LengthFit;
	modelId: string;
	variant: string;
	options: LipOptions;
	kie?: VolcengineOptions;
	cuts?: number[];
	mode: "full" | "sample";
	sampleAt?: number;
	sampleModel?: string;
	fresh: boolean;
	dir: string;
	/** The most the run may charge: a plan above it stops here, before anything is sent. */
	maxUsd?: number;
}): Promise<PiecesResult> {
	const s = lipSettings();
	const prep = await job.step("prepare", async (signal) => {
		job.detail("prepare", "finding where somebody speaks");
		const a = await analyse({ source: o.source, start: o.start, pieceSeconds: o.pieceSeconds, audio: o.audio, fit: o.fit, dir: o.dir, cuts: o.cuts, scan: true, chroma444: s.chroma444, build: true, signal });
		let model = falModel(o.modelId) as FalModel;
		const full = model;
		let window: { a: number; b: number } | null = null;
		if (o.mode === "sample") {
			window = sampleWindow({ duration: a.lengths.wanted, fps: a.info.fps, speech: a.speech, cuts: a.cuts, levels: a.levels, levelStep: 0.01, at: o.sampleAt });
			if (!window) throw new StudioError("Nobody speaks in this sound — there is nothing to sample.", { key: "lipsync.sample_no_speech" });
			const named = o.sampleModel ? falModel(o.sampleModel) : undefined;
			const cheap = sampleModel((window.b - window.a) / a.info.fps + LIPSYNC_TAIL_SECONDS, full, price(full, (window.b - window.a) / a.info.fps + LIPSYNC_TAIL_SECONDS));
			model = named?.task === "lipsync" ? named : (cheap?.model ?? full);
		}
		const variant = model.id === full.id ? o.variant : o.variant.replace(full.id, model.id);
		const key = await baseKey(o.source, o.start, o.pieceSeconds, a.lengths.audio, variant);
		const made = o.fresh ? [] : madeOf(key);
		let plan: Plan;
		if (window) {
			const frames = window.b - window.a;
			const seconds = frames / a.info.fps + LIPSYNC_TAIL_SECONDS;
			const already = made.find((m) => m.a === window!.a && m.b === window!.b);
			plan = {
				fps: a.info.fps,
				frames: a.info.fps ? Math.round(a.lengths.wanted * a.info.fps) : frames,
				units: [{ a: window.a, b: window.b, shot: 0, made: !!already }],
				requests: already ? [] : [{ segments: [{ from: window.a, to: window.b, unit: 0 }], frames, seconds, usd: price(model, seconds) }],
				mode: "spans",
				usd: already ? 0 : price(model, seconds),
				secondsSent: already ? 0 : seconds,
				speechSeconds: 0,
				wholeSeconds: 0,
				wholeUsd: 0,
			};
		} else plan = planFor(a, model, s, made.map((m) => ({ a: m.a, b: m.b })));
		if (o.maxUsd != null && plan.usd > o.maxUsd + 1e-9) throw new StudioError(`The lipsync costs ${(plan.usd * 100).toFixed(1)} ¢ — more than agreed (${(o.maxUsd * 100).toFixed(1)} ¢). Nothing was sent.`, { key: "lipsync.over_limit", vars: { usd: plan.usd, max: o.maxUsd } });
		// the plan's price is stated before anything is sent
		job.detail("prepare", `${plan.requests.length} piece(s) · ${plan.secondsSent.toFixed(1)} s of ${a.lengths.wanted.toFixed(1)} s · ${plan.mode}`);
		return { a, model, key, made, plan, window };
	});
	const { a, model, key, made, plan, window } = prep;
	const state = plan.requests.map((r) => ({ from: r.segments[0].from / plan.fps, to: r.segments.at(-1)!.to / plan.fps, seconds: r.seconds, usd: r.usd, state: "waiting" as "waiting" | "sending" | "working" | "done" | "failed" | "cached", tries: 0 }));
	const publish = () => job.data("lipsync", { ...planData(plan, model), requestsState: state, done: state.filter((x) => x.state === "done" || x.state === "cached").length });
	publish();
	const counters = { submitted: 0, fromCache: 0, retried: 0, cost: 0 };
	return await job.step("lipsync", async (signal) => {
		const answers = new Map<number, { file: string; marks?: Array<FaceMark | null> | null }>();
		const requestKey = (ri: number) => sha(key, JSON.stringify(plan.requests[ri].segments.map((g) => [g.from, g.to])), LIPSYNC_TAIL_SECONDS, a.picture.how, a.picture.pixFmt, String(plan.fps));
		const one = async (ri: number) => {
			const r = plan.requests[ri];
			const rk = requestKey(ri);
			const hit = o.fresh ? null : cachedPath(rk);
			if (hit) {
				state[ri].state = "cached";
				counters.fromCache++;
				answers.set(ri, { file: hit, marks: cachedJson<Array<FaceMark | null>>(`${rk}-marks`) });
				publish();
				return;
			}
			const video = path.join(o.dir, `send-${ri}.mp4`);
			const sound = path.join(o.dir, `send-${ri}.m4a`);
			const answer = path.join(o.dir, `answer-${ri}.mp4`);
			state[ri].state = "sending";
			publish();
			await cutRequest({ base: a.base.file, k0: a.base.k0, fps: plan.fps, segments: r.segments, audio: a.lengths.audio, picture: a.picture, tail: LIPSYNC_TAIL_SECONDS, minSeconds: model.minSeconds, video, sound, signal });
			// the face of every sent frame, while the model works (Apple Vision on this Mac)
			const marks = s.composite ? faceMarks(video, signal).catch(() => null) : Promise.resolve(null);
			for (let attempt = 1; ; attempt++) {
				try {
					state[ri].tries = attempt;
					state[ri].state = "working";
					publish();
					counters.submitted++;
					const { cost } = await falLipsync({
						video,
						audio: sound,
						out: answer,
						model: model.id,
						kie: o.kie,
						options: o.options,
						billSeconds: r.seconds,
						resumeKey: rk,
						onStatus: (t) => job.detail("lipsync", `piece ${ri + 1} of ${plan.requests.length} · ${t}`),
						signal,
					});
					counters.cost += cost;
					job.charge(cost);
					break;
				} catch (error) {
					// one more try for this piece alone (the others are not sent again); a refusal, the balance, the key: no. A one-request
					// run fails as before (the error and Retry in the panel; Retry takes the finished pieces from the cache).
					if (error instanceof CancelledError || signal.aborted || attempt >= 2 || plan.requests.length < 2 || /balance|API key|flagged|content checker|HTTP 40[123]/i.test((error as Error).message)) {
						state[ri].state = "failed";
						publish();
						throw error;
					}
					counters.retried++;
				}
			}
			// cached the moment it lands: a restart or a Retry takes it from here, never from fal again
			putCached(rk, answer);
			const m = await marks;
			if (m) putCachedJson(`${rk}-marks`, m);
			answers.set(ri, { file: answer, marks: m });
			state[ri].state = "done";
			publish();
			job.progress("lipsync", state.filter((x) => x.state === "done" || x.state === "cached").length / Math.max(1, state.length));
		};
		// several at once, up to the cap; the first failure stops the queue (the finished pieces stay cached)
		let next = 0;
		let failure: unknown = null;
		const lane = async () => {
			while (next < plan.requests.length && !failure) {
				const ri = next++;
				try {
					await one(ri);
				} catch (error) {
					failure ??= error;
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(s.parallel, plan.requests.length) }, lane));
		if (failure) throw failure;
		// samples made before: their answers lie in the cache
		const extra: StitchPart[] = [];
		for (const u of plan.units.filter((x) => x.made)) {
			const m = made.find((x) => x.a <= u.a && x.b >= u.b);
			const file = m && cachedPath(m.request);
			if (m && file) {
				extra.push({ answer: file, a: u.a, b: u.b, at: u.a - m.a, marks: cachedJson<Array<FaceMark | null>>(`${m.request}-marks`) });
				counters.fromCache++;
			}
		}
		job.detail("lipsync", "stitching the pieces into one clip");
		const parts = [...partsOf(plan, answers), ...extra];
		const slot = newFile(window ? "Lipsync sample.mp4" : "Lipsync.mp4");
		try {
			let audio = a.lengths.audio;
			let frames = Math.round(a.lengths.wanted * plan.fps);
			let k0 = a.base.k0;
			let seconds = a.lengths.wanted;
			let stitchParts = parts;
			if (window) {
				// the sample is the window alone
				audio = path.join(o.dir, "sample.m4a");
				const r = await run(findTool("ffmpeg"), ["-y", "-hide_banner", "-loglevel", "error", "-i", a.lengths.audio, "-af", `atrim=start=${(window.a / plan.fps).toFixed(6)}:end=${(window.b / plan.fps).toFixed(6)},asetpts=PTS-STARTPTS`, "-c:a", "aac", "-b:a", "192k", audio], { timeout: 120, signal });
				if (r.status !== 0) throw new StudioError("Couldn't cut the sample's sound");
				frames = window.b - window.a;
				k0 = a.base.k0 + window.a;
				seconds = frames / plan.fps;
				stitchParts = parts.map((p) => ({ ...p, a: p.a - window.a, b: p.b - window.a }));
			}
			const stats = await stitch({ base: a.base.file, k0, fps: plan.fps, frames, width: a.info.width, height: a.info.height, picture: a.picture, parts: stitchParts, audio, seconds, composite: s.composite, lossless: s.lossless, out: slot.path, signal });
			if (window && plan.requests.length) {
				// remembered: the full run of this model takes these frames from here
				const rk = requestKey(0);
				const list = (cachedJson<Made[]>(madeKey(key)) ?? []).filter((m) => !(m.a === window.a && m.b === window.b));
				putCachedJson(madeKey(key), [...list, { a: window.a, b: window.b, request: rk }]);
			}
			const info = await probe(slot.path, signal);
			if (!info.hasVideo) throw new StudioError("Lipsync produced no video. Press Retry.", { key: "lipsync.no_video" });
			return {
				fileId: slot.id,
				name: slot.name,
				duration: info.duration,
				cost: counters.cost,
				pieces: { ...planData(plan, model), sent: sentData(a), composite: { ...stats, on: s.composite }, submitted: counters.submitted, fromCache: counters.fromCache, retried: counters.retried },
				...(window ? { sample: { from: window.a / plan.fps, to: window.b / plan.fps, model: model.id } } : {}),
			};
		} catch (error) {
			removeFile(slot.id);
			throw error;
		}
	});
}

/** The variant part of the cache names for the pieces path. */
export const piecesVariant = (old: string, options: LipOptions) => [old, PIECES_VERSION, lipOptionsKey(options)].filter(Boolean).join(":");
