// The desktop server's part, inside the page: uploads into memory, the pre-flight with THE price, the voice job (clone
// from the clip's own sound + speech) and the lipsync job (the used span → the provider → the result file), with the
// same stages and JobState the app's client already follows. Money: every provider request id is parked (park.ts)
// before the page waits on it; after a reload GET jobs/<id> COLLECTS the parked request instead of submitting again,
// and a new run of the same thing follows a request that was paid but not delivered. Other browser modules run their
// own kinds of jobs on the same machinery (register: web/voice, web/faceswap) — one job list, one GET jobs/<id>.
import { falModel, type FalModel } from "@/fal/models";
import { referenceFor } from "@/fal/reference";
import { lipsyncInput, qwenCloneInput, qwenSpeechInput } from "@/fal/wire";
import type { JobState, StageState } from "@/studio/server/jobs";
import type { Preflight, Segment } from "@/studio/server/pipeline";
import { speechText } from "@/studio/server/speech-text";
import type { Media } from "./media";
import type { Park, ParkedJob, StageId } from "./park";
import { CLONE_MODEL, cloneUsd, lipUsd, runPrice, TTS_MODEL, voiceUsd, webLipModel } from "./price";
import type { Provider, QueuedRequest } from "./provider";
import { APP_CHEAPER, keyOf, type Lang, say, WebLipError } from "./sentences";
import { keepClone, knownClone } from "../voice/clones";

export interface EngineDeps {
	provider: Provider;
	park: Park;
	media: Media;
	hasKey: () => boolean;
	lang?: () => Lang;
	/** ms between status polls (the desktop's 1.5 s). */
	pollMs?: number;
	uid?: () => string;
	now?: () => number;
	/** One of «My voices» (`local:<id>`, web/voice/store.ts): its sample, what it says and its hash. */
	myVoice?: (id: string) => Promise<{ blob: Blob; text: string; seconds: number; hash: string } | null>;
}

export interface Held {
	blob: Blob;
	name: string;
	type: string;
}

interface Live {
	rec: ParkedJob;
	abort: AbortController;
	done: Promise<void>;
}

/** What a registered kind's body gets: the engine's own steps (a step done once, a paid request followed once). */
export interface KindTools {
	step<T>(rec: ParkedJob, id: StageId, body: () => Promise<T>): Promise<T>;
	/** `slot`: the request's own name when one stage pays for two (a clone, then the speech). */
	follow<T>(rec: ParkedJob, stage: StageId, signal: AbortSignal, submit: () => Promise<QueuedRequest>, expectSeconds: number, slot?: string): Promise<T>;
	patchStage(rec: ParkedJob, id: StageId, patch: Partial<StageState>): void;
	keepResult(blob: Blob, name: string): Promise<string>;
	getBlob(id: string): Promise<Held | undefined>;
	save(rec: ParkedJob): Promise<void>;
}

export type KindBody = (rec: ParkedJob, signal: AbortSignal, tools: KindTools) => Promise<unknown>;

const CLONE_DAYS = 6;
const READY_TO_QWEN: Record<string, string> = { ryan: "Ryan", aiden: "Aiden", eric: "Eric", dylan: "Dylan", uncle_fu: "Uncle_Fu", vivian: "Vivian", serena: "Serena", ono_anna: "Ono_Anna", sohee: "Sohee" };
const QWEN_LANG: Record<string, string> = { ru: "Russian", en: "English", zh: "Chinese", es: "Spanish", fr: "French", de: "German", it: "Italian", ja: "Japanese", ko: "Korean", pt: "Portuguese" };
const LANG_NAMES: Record<string, string> = { ru: "russian", en: "english", de: "german", fr: "french", es: "spanish", it: "italian", pt: "portuguese", ja: "japanese", ko: "korean", zh: "chinese" };
/** Seconds of provider work per second of video (fal/lipsync.ts PACE): the progress bar's pace. */
const PACE: Record<string, number> = { "fal-ai/latentsync": 4, "fal-ai/sync-lipsync": 5, "fal-ai/sync-lipsync/v2": 6, "fal-ai/sync-lipsync/v2/pro": 10 };

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Who a file is without reading all of it: name, size, date and the first and last 256 KB (a 1 GB talk hashes at once). */
export async function identity(blob: Blob): Promise<string> {
	const f = blob as Partial<File>;
	const edge = 256 * 1024;
	const parts = blob.size <= 2 * edge ? [blob] : [blob.slice(0, edge), blob.slice(blob.size - edge)];
	const bytes = new Uint8Array(await new Blob([`${f.name ?? ""}:${blob.size}:${f.lastModified ?? ""}:`, ...parts]).arrayBuffer());
	return hex(await crypto.subtle.digest("SHA-256", bytes)).slice(0, 32);
}

export const runKeyOf = async (...parts: Array<string | number>) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\n")))).slice(0, 32);

const extOf = (url: string, type: string) => /\.wav(\?|$)/i.test(url) || /wav/.test(type) ? ".wav" : /\.mp3(\?|$)/i.test(url) || /mpeg|mp3/.test(type) ? ".mp3" : /\.(m4a|mp4)(\?|$)/i.test(url) ? ".m4a" : ".wav";

export function createEngine(d: EngineDeps) {
	const lang = () => d.lang?.() ?? "ru";
	const now = d.now ?? (() => Date.now());
	const uid = d.uid ?? (() => crypto.randomUUID());
	const pollMs = d.pollMs ?? 1500;
	const held = new Map<string, Held>();
	const live = new Map<string, Live>();
	/** Counts the test reads: provider submits by stage, collected jobs. */
	const counts = { submits: { sample: 0, speech: 0, lipsync: 0 } as Record<string, number>, collected: 0, reusedPaid: 0, trail: [] as string[] };

	const sleep = (ms: number, signal: AbortSignal) =>
		new Promise<void>((resolve, reject) => {
			if (signal.aborted) return reject(new DOMException("cancelled", "AbortError"));
			const t = setTimeout(resolve, ms);
			signal.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("cancelled", "AbortError"))), { once: true });
		});

	async function getBlob(id: string): Promise<Held | undefined> {
		const h = held.get(id);
		if (h) return h;
		const f = await d.park.getFile(id);
		return f ? { blob: f.blob, name: f.name, type: f.type } : undefined;
	}

	// ── the job's record ──
	function newJob(kind: string, stages: Array<{ id: StageId; title: string; timeout: number }>, runKey: string, input: Record<string, unknown>): ParkedJob {
		const state: JobState = { id: uid(), kind, status: "running", stages: stages.map((s) => ({ ...s, status: "pending" as const })), cost: 0, startedAt: now() };
		return { id: state.id, kind, runKey, at: now(), reqs: {}, input, state };
	}
	const save = (rec: ParkedJob) => d.park.putJob(rec);
	const stageOf = (rec: ParkedJob, id: StageId) => rec.state.stages.find((s) => s.id === id) as StageState;
	function patchStage(rec: ParkedJob, id: StageId, patch: Partial<StageState>) {
		const s = stageOf(rec, id);
		const before = `${s.status}:${s.detail ?? ""}`;
		Object.assign(s, patch);
		// every state the page can show, in order (the browser test reads it; polling may skip the quick ones)
		if (`${s.status}:${s.detail ?? ""}` !== before) counts.trail.push(`${rec.id}|${id}:${s.status}${s.detail ? `:${s.detail}` : ""}`);
	}
	async function step<T>(rec: ParkedJob, id: StageId, body: () => Promise<T>): Promise<T> {
		const s = stageOf(rec, id);
		if (s.status === "done" && rec.input[`out:${id}`] !== undefined) return rec.input[`out:${id}`] as T;
		patchStage(rec, id, { status: "running", startedAt: s.startedAt ?? now(), progress: 0 });
		await save(rec);
		const out = await body();
		patchStage(rec, id, { status: "done", endedAt: now(), progress: 1 });
		rec.input[`out:${id}`] = out === undefined ? null : out;
		await save(rec);
		return out;
	}

	/** A request paid for by another run of the same thing and not delivered yet (a Retry after a failed download). */
	async function paidElsewhere(rec: ParkedJob, stage: string) {
		for (const other of await d.park.jobs()) {
			if (other.id === rec.id || other.runKey !== rec.runKey || other.input.delivered || other.state.status === "cancelled") continue;
			const req = other.reqs[stage];
			if (req && !live.has(other.id)) return { other, req };
		}
		return null;
	}

	/** Submit (once), park the id, poll to the end, park the answer. Every paid request of the page goes through here. */
	async function follow<T>(rec: ParkedJob, stage: StageId, signal: AbortSignal, submit: () => Promise<QueuedRequest>, expectSeconds: number, slot: string = stage): Promise<T> {
		let req = rec.reqs[slot];
		if (req?.answer) return req.answer as T;
		if (!req) {
			const found = await paidElsewhere(rec, slot);
			if (found) {
				counts.reusedPaid++;
				req = { ...found.req };
				found.other.input.delivered = true;
				await save(found.other);
			} else {
				if (signal.aborted) throw new DOMException("cancelled", "AbortError");
				const fresh = await submit();
				counts.submits[slot] = (counts.submits[slot] ?? 0) + 1;
				req = { ...fresh };
			}
			rec.reqs[slot] = req;
			// parked before the first wait: a reload from here on collects this request, never submits again
			await save(rec);
			if (req.answer) return req.answer as T;
		}
		if (signal.aborted) throw new DOMException("cancelled", "AbortError");
		let working = 0;
		let misses = 0;
		for (;;) {
			let s: Awaited<ReturnType<Provider["status"]>>;
			try {
				s = await d.provider.status(req, signal);
				misses = 0;
			} catch (error) {
				if ((error as Error)?.name === "AbortError") throw error;
				if (error instanceof WebLipError && error.key === "web.network" && ++misses <= 40) {
					patchStage(rec, stage, { detail: "waiting for fal.ai (the connection dropped; the job keeps running there)" });
					await sleep(pollMs * 3, signal);
					continue;
				}
				throw new WebLipError(error instanceof WebLipError ? error.key : "web.network", "", true);
			}
			if (s.state === "queued") patchStage(rec, stage, { detail: s.position ? `waiting in the fal.ai queue · ${s.position} ahead` : "waiting in the fal.ai queue" });
			else if (s.state === "working") {
				working ||= now();
				patchStage(rec, stage, { detail: "working on fal.ai", progress: Math.min(0.95, 1 - Math.exp((-1.6 * (now() - working)) / (Math.max(5, expectSeconds) * 1000))) });
			} else if (s.state === "done") break;
			else {
				// the provider failed or stopped it: not billed, nothing to come back to — a Retry is a new request
				delete rec.reqs[slot];
				await save(rec);
				throw new WebLipError(s.state === "failed" && s.refused ? "web.refused" : "web.failed", s.state === "failed" ? s.error : s.status);
			}
			await sleep(pollMs, signal);
		}
		let answer: T | null = null;
		for (let attempt = 1; !answer; attempt++) {
			try {
				answer = await d.provider.answer<T>(req, signal);
			} catch (error) {
				if ((error as Error)?.name === "AbortError" || attempt >= 4) throw error instanceof WebLipError ? new WebLipError("web.no_file", error.details, true) : error;
				await sleep(pollMs * attempt, signal);
			}
		}
		req.answer = answer;
		await save(rec);
		return answer;
	}

	async function keepResult(blob: Blob, name: string): Promise<string> {
		const id = uid();
		await d.park.putFile({ id, name, type: blob.type, blob, at: now() });
		return id;
	}

	/** Runs a job's body, ends its state (done / failed with ONE sentence / cancelled), never throws. */
	function launch(rec: ParkedJob, body: (signal: AbortSignal) => Promise<unknown>): Live {
		const abort = new AbortController();
		const entry: Live = { rec, abort, done: Promise.resolve() };
		live.set(rec.id, entry);
		entry.done = (async () => {
			try {
				const result = await body(abort.signal);
				rec.state.result = result;
				rec.state.status = "done";
				rec.input.delivered = true;
			} catch (error) {
				const key = abort.signal.aborted ? "web.cancelled" : keyOf(error);
				const running = rec.state.stages.find((s) => s.status === "running");
				if (running) patchStage(rec, running.id as StageId, { status: "failed", endedAt: now() });
				rec.state.status = key === "web.cancelled" ? "cancelled" : "failed";
				rec.state.error = say(key, lang());
				rec.state.errorKey = key;
				if (error instanceof WebLipError && error.details) rec.state.errorVars = { details: error.details.slice(0, 300) };
				if (key === "web.cancelled") {
					for (const r of Object.values(rec.reqs)) if (r && !r.answer) void d.provider.cancel(r);
					rec.reqs = {};
				}
			} finally {
				rec.state.endedAt = now();
				counts.trail.push(`${rec.id}|job:${rec.state.status}`);
				await save(rec).catch(() => {});
				live.delete(rec.id);
			}
		})();
		return entry;
	}

	// ── the voice: a clone from the clip's own sound, then the words ──
	const voiceStages = () => [
		{ id: "sample" as const, title: "Cloning the voice", timeout: 900 },
		{ id: "speech" as const, title: "Voicing on fal.ai", timeout: 900 },
		{ id: "words" as const, title: "Timing the words", timeout: 600 },
	];

	async function voiceBody(rec: ParkedJob, signal: AbortSignal) {
		const text = String(rec.input.text ?? "");
		const voice: { url: string; cloned: boolean; reference?: string } = await step(rec, "sample", async () => {
			const given = String(rec.input.voiceId ?? "");
			if (given.startsWith("webclone:")) return { url: given.slice(9), cloned: true };
			if (READY_TO_QWEN[given]) return { url: READY_TO_QWEN[given], cloned: false };
			if (given.startsWith("local:")) {
				// one of «My voices»: cloned from its own sample (and its words) once, shared with AI → Voice (web/voice)
				const mine = await d.myVoice?.(given);
				if (!mine) throw new WebLipError("web.voice_gone");
				const known = await knownClone(d.park, "qwen", mine.hash, now());
				if (known) {
					patchStage(rec, "sample", { detail: "the voice was cloned before — no clone fee" });
					return { url: known, cloned: true, reference: mine.text };
				}
				const answer = await follow<{ speaker_embedding?: { url?: string } }>(
					rec,
					"sample",
					signal,
					async () => {
						patchStage(rec, "sample", { detail: "taking the voice from the sample" });
						const url = await d.provider.upload(mine.blob, `gz_voice_${uid().slice(0, 8)}.wav`, signal);
						return d.provider.submit(CLONE_MODEL, qwenCloneInput(url, mine.text), signal);
					},
					10,
				);
				const url = answer.speaker_embedding?.url;
				if (!url) throw new WebLipError("web.failed", "no voice");
				rec.state.cost += cloneUsd(mine.seconds || 30);
				await keepClone(d.park, "qwen", mine.hash, url, now());
				return { url, cloned: true, reference: mine.text };
			}
			const factKey = `clone:${rec.input.sampleKey}`;
			const known = await d.park.getFact<{ url: string; used: number }>(factKey);
			if (known && now() - known.used < CLONE_DAYS * 86_400_000) {
				patchStage(rec, "sample", { detail: "the voice was cloned before — no clone fee" });
				return { url: known.url, cloned: true };
			}
			const answer = await follow<{ speaker_embedding?: { url?: string } }>(
				rec,
				"sample",
				signal,
				async () => {
					const src = await getBlob(String(rec.input.sourceId));
					if (!src) throw new WebLipError("web.closed_before_send");
					const sample = await d.media.voiceSample(src.blob, Number(rec.input.sampleStart), Number(rec.input.sampleLength));
					rec.input.sampleSeconds = sample.seconds;
					patchStage(rec, "sample", { detail: "taking the voice from the sample" });
					const url = await d.provider.upload(sample.file, `gz_sample_${uid().slice(0, 8)}.wav`, signal);
					return d.provider.submit(CLONE_MODEL, qwenCloneInput(url), signal);
				},
				10,
			);
			const url = answer.speaker_embedding?.url;
			if (!url) throw new WebLipError("web.failed", "no voice");
			rec.state.cost += cloneUsd(Number(rec.input.sampleSeconds) || 30);
			await d.park.putFact(factKey, { url, used: now() });
			return { url, cloned: true };
		});
		const language = String(rec.input.language || (/[а-яё]/i.test(text) ? "ru" : "en"));
		const spoken = speechText(text, LANG_NAMES[language] ?? "english");
		const file = await step(rec, "speech", async () => {
			const answer = await follow<{ audio?: { url?: string; content_type?: string } }>(
				rec,
				"speech",
				signal,
				() => d.provider.submit(TTS_MODEL, qwenSpeechInput({ text: spoken, language: QWEN_LANG[language] ?? "Auto", voice: voice.url, cloned: voice.cloned, reference: referenceFor(spoken, voice.reference) }), signal),
				6 + spoken.length / 25,
			);
			const blob = await d.provider.download(answer.audio?.url, signal);
			const name = `Voice${extOf(String(answer.audio?.url ?? ""), blob.type)}`;
			const typed = new Blob([blob], { type: name.endsWith(".mp3") ? "audio/mpeg" : name.endsWith(".wav") ? "audio/wav" : "audio/mp4" });
			const fileId = await keepResult(typed, name);
			rec.state.cost += voiceUsd(spoken.length, false);
			return { fileId, name, duration: (await d.media.probe(typed)).duration };
		});
		patchStage(rec, "words", { status: "skipped", detail: "no word timings in the browser" });
		const given = String(rec.input.voiceId ?? "");
		return { voiceId: given.startsWith("local:") ? given : voice.cloned ? `webclone:${voice.url}` : given, fileId: file.fileId, name: file.name, duration: file.duration, words: [], text };
	}

	// ── the lipsync: the used span as it is, the sound the lips follow ──
	async function lipBody(rec: ParkedJob, signal: AbortSignal) {
		const model = webLipModel(String(rec.input.model)) as FalModel;
		const sent = await step(rec, "prepare", async () => {
			if (rec.reqs.lipsync) return rec.input["out:prepare"];
			const video = await getBlob(String(rec.input.videoId));
			const audio = await getBlob(String(rec.input.audioId));
			if (!video || !audio) throw new WebLipError("web.closed_before_send");
			const speech = (await d.media.probe(audio.blob)).duration;
			const length = Number(rec.input.length);
			const usd = lipUsd(model, speech, length);
			// the agreed sum: nothing leaves the page above it
			if (rec.input.maxUsd != null && usd > Number(rec.input.maxUsd) + 1e-9) throw new WebLipError("web.over_limit");
			patchStage(rec, "prepare", { detail: "preparing the piece in this browser" });
			const piece = await d.media.prepareSpan(video.blob, Number(rec.input.start), length, (p) => patchStage(rec, "prepare", { progress: Math.min(0.9, p * 0.9) }));
			patchStage(rec, "prepare", { detail: "sending the piece to fal.ai" });
			const videoUrl = await d.provider.upload(piece.file, `gz_${uid().slice(0, 8)}.mp4`, signal);
			const audioUrl = await d.provider.upload(audio.blob, `gz_${uid().slice(0, 8)}${extOf(audio.name, audio.type)}`, signal);
			return { videoUrl, audioUrl, speech, length, usd, bytes: piece.file.size };
		});
		const s = sent as { videoUrl: string; audioUrl: string; speech: number; length: number; usd: number };
		const result = await step(rec, "lipsync", async () => {
			const answer = await follow<{ video?: { url?: string } }>(rec, "lipsync", signal, () => d.provider.submit(model.id, lipsyncInput(model.id, s.videoUrl, s.audioUrl), signal), 20 + (PACE[model.id] ?? 6) * Math.max(s.speech, s.length));
			const blob = new Blob([await d.provider.download(answer.video?.url, signal)], { type: "video/mp4" });
			const name = `Lipsync ${model.title}.mp4`;
			const fileId = await keepResult(blob, name);
			rec.state.cost += s.usd;
			return { fileId, name, duration: (await d.media.probe(blob)).duration };
		});
		return result;
	}

	const kinds = new Map<string, KindBody>();
	const tools: KindTools = { step, follow, patchStage, keepResult, getBlob, save };
	const bodyOf = (rec: ParkedJob) => (signal: AbortSignal) => {
		if (rec.kind === "voiceover") return voiceBody(rec, signal);
		if (rec.kind === "lipsync") return lipBody(rec, signal);
		const body = kinds.get(rec.kind);
		return body ? body(rec, signal, tools) : Promise.reject(new WebLipError("web.unknown_job"));
	};

	return {
		counts,
		/** Another module's kind of job (its body runs with the engine's steps; GET jobs/<id> collects it after a reload too). */
		register(kind: string, body: KindBody) {
			kinds.set(kind, body);
		},
		/** Starts a job of a registered kind; its state at once (the client polls jobs/<id>). */
		async start(kind: string, stages: Array<{ id: StageId; title: string; timeout: number }>, runKey: string, input: Record<string, unknown>): Promise<JobState> {
			const rec = newJob(kind, stages, runKey, input);
			await save(rec);
			launch(rec, bodyOf(rec));
			return rec.state;
		},
		/** The app's upload: kept in this page's memory only (inputs are never stored). */
		async upload(blob: Blob, name: string) {
			const info = await d.media.probe(blob).catch(() => null);
			const id = uid();
			held.set(id, { blob, name, type: blob.type });
			return { fileId: id, duration: info?.duration ?? 0, hasAudio: !!info?.hasAudio, hasVideo: !!info?.hasVideo };
		},
		file: getBlob,
		async deleteFile(id: string) {
			held.delete(id);
			await d.park.deleteFile(id);
		},

		async preflight(body: { video?: Segment; audioFileId?: string; estimate?: { seconds?: number; length?: number }; voice?: { chars?: number; clone?: boolean }; voiceOnly?: boolean; model?: string }): Promise<Preflight> {
			const l = lang();
			const model = webLipModel(body.model);
			const out: Preflight = { checks: [], seconds: 0, typical: "" };
			const voice = body.voice && Number(body.voice.chars) > 0 ? { chars: Math.round(Number(body.voice.chars)), clone: body.voice.clone === true } : undefined;
			if (voice) out.voiceUsd = voiceUsd(voice.chars, voice.clone);
			if (body.voiceOnly) return { ...out, total: out.voiceUsd ?? 0 };
			if (!model) return { ...out, blocking: say("web.model_app_only", l), checks: [{ level: "fail", text: say("web.model_app_only", l) }] };
			if (!d.hasKey()) {
				out.blocking = say("web.no_key", l);
				out.checks.push({ level: "fail", text: out.blocking });
			}
			let span: number;
			let speech: number | undefined;
			if (body.video && body.audioFileId) {
				const v = await getBlob(body.video.fileId);
				const a = await getBlob(body.audioFileId);
				const vi = v ? await d.media.probe(v.blob) : null;
				speech = a ? (await d.media.probe(a.blob)).duration : 0;
				span = Math.max(0, body.video.length ?? (vi?.duration ?? 0) - body.video.start);
				if (vi && !vi.hasVideo) out.blocking ??= say("web.no_video", l);
				if (vi?.hdr) out.checks.push({ level: "warn", text: l === "ru" ? "HDR-клип: в браузере цвета могут сдвинуться" : "HDR clip: colours may shift in the browser" });
			} else span = Number(body.estimate?.length) || 0;
			if (model.maxSeconds && span > model.maxSeconds + 0.05) out.blocking ??= say("web.too_long", l);
			const p = runPrice({ model, span, speech, estimateSeconds: Number(body.estimate?.seconds) || 0, voice, lang: l });
			out.seconds = speech ?? Number(body.estimate?.seconds) ?? 0;
			out.usd = p.lipUsd;
			out.total = p.total;
			out.estimated = p.estimated;
			out.plan = { mode: "whole", requests: 1, secondsSent: span, usd: p.lipUsd, wholeUsd: p.lipUsd } as unknown as Preflight["plan"];
			// the honest difference, one quiet line beside the price
			out.checks.push({ level: "ok", text: APP_CHEAPER[l] });
			if (out.blocking && !out.checks.some((c) => c.text === out.blocking)) out.checks.push({ level: "fail", text: out.blocking });
			return out;
		},

		async startVoiceover(body: { source?: Segment; voiceId?: string; text?: string; language?: string }): Promise<JobState> {
			const text = String(body.text ?? "").trim().slice(0, 5000);
			if (!text) throw new WebLipError("web.no_text");
			if (!d.hasKey()) throw new WebLipError("web.no_key");
			const given = String(body.voiceId ?? "");
			if (!given.startsWith("webclone:") && !given.startsWith("local:") && !READY_TO_QWEN[given] && !body.source) throw new WebLipError("web.no_sound");
			const src = body.source ? await getBlob(body.source.fileId) : undefined;
			const srcId = src ? await identity(src.blob) : "";
			const start = body.source?.start ?? 0;
			const length = Math.min(30, Math.max(3, body.source?.length ?? 30));
			const sampleKey = await runKeyOf(srcId, start, length);
			const rec = newJob("voiceover", voiceStages(), await runKeyOf("voice", sampleKey, given, text, body.language ?? ""), { text, language: body.language ?? "", voiceId: given, sourceId: body.source?.fileId ?? "", sampleStart: start, sampleLength: length, sampleKey });
			await save(rec);
			launch(rec, bodyOf(rec));
			return rec.state;
		},

		async startLipsync(body: { video: Segment; audioFileId: string; model?: string; maxUsd?: number }): Promise<JobState> {
			const model = webLipModel(body.model);
			if (!model) throw new WebLipError("web.model_app_only");
			if (!d.hasKey()) throw new WebLipError("web.no_key");
			const v = await getBlob(body.video.fileId);
			const a = await getBlob(body.audioFileId);
			if (!v || !a) throw new WebLipError("web.closed_before_send");
			const length = Math.max(0, body.video.length ?? (await d.media.probe(v.blob)).duration - body.video.start);
			const runKey = await runKeyOf("lipsync", model.id, await identity(v.blob), body.video.start, length, await identity(a.blob));
			const rec = newJob(
				"lipsync",
				[
					{ id: "prepare", title: "Preparing the video", timeout: 1800 },
					{ id: "lipsync", title: `Lipsync on fal.ai · ${model.title}`, timeout: 3600 },
				],
				runKey,
				{ model: model.id, videoId: body.video.fileId, audioId: body.audioFileId, start: body.video.start, length, ...(body.maxUsd != null ? { maxUsd: body.maxUsd } : {}) },
			);
			await save(rec);
			launch(rec, bodyOf(rec));
			return rec.state;
		},

		/** A job's state; one the page doesn't hold (a reload, a closed tab) is COLLECTED from its parked record, once. */
		async job(id: string): Promise<JobState | null> {
			const l = live.get(id);
			if (l) return l.rec.state;
			const rec = await d.park.getJob(id);
			if (!rec) return null;
			if (rec.state.status === "running" && !live.has(id)) {
				counts.collected++;
				launch(rec, bodyOf(rec));
			}
			return rec.state;
		},

		/** Cancel: polling stops, the provider's job is cancelled, the state says so. */
		async cancel(id: string): Promise<boolean> {
			const l = live.get(id);
			if (!l) return false;
			l.abort.abort();
			await l.done;
			return true;
		},

		/** For tests: waits until a job has ended. */
		settled: (id: string) => live.get(id)?.done ?? Promise.resolve(),
	};
}

export type Engine = ReturnType<typeof createEngine>;
export { falModel };
