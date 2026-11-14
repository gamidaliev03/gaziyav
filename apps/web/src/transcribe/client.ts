// Calls to the local speech recognizer (/api/transcribe). Everything runs on this Mac, offline and free.
import { DEMO } from "@/demo/flag";
import { requireModel } from "@/ondevice/client";
import type { JobState } from "@/studio/server/jobs";
import type { Span, Word } from "./align";
import { speechRuns } from "./runs";

export type { Span, Word };

export interface Transcript {
	words: Word[];
	speech: Span[];
	language: string;
	duration: number;
	cached?: boolean;
}

export interface EngineStatus {
	available: boolean;
	needsDownload?: boolean;
	model?: string;
	reason?: string;
}

const BASE = "/api/transcribe";
const OFFLINE = "Gaziyav's local server is not responding. Restart Gaziyav.";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`${BASE}/${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), "X-Studio": "1" } });
	} catch (error) {
		if ((error as Error)?.name === "AbortError") throw error;
		throw new Error(OFFLINE);
	}
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
	return data as T;
}

let status: Promise<EngineStatus> | null = null;

/** Whether the local recognizer (whisper-cli + model) is installed; a "yes" is remembered for the session. */
export function engineStatus(): Promise<EngineStatus> {
	// (the browser edition hears speech in the page itself: transcribe/in-page.ts)
	if (DEMO) return Promise.resolve({ available: true, model: "whisper-small" });
	if (!status) {
		const asked = request<EngineStatus>("status").catch((error) => ({ available: false, reason: (error as Error).message }) as EngineStatus);
		status = asked;
		// A missing model gets downloaded later (On-device AI): ask again next time.
		void asked.then((s) => {
			if (!s.available && status === asked) status = null;
		});
	}
	return status;
}

function upload(blob: Blob, name: string, signal?: AbortSignal, onProgress?: (p: number) => void): Promise<string> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("POST", `${BASE}/upload?name=${encodeURIComponent(name)}`);
		xhr.setRequestHeader("X-Studio", "1");
		xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
		const abort = () => xhr.abort();
		signal?.addEventListener("abort", abort, { once: true });
		xhr.onload = () => {
			signal?.removeEventListener("abort", abort);
			let data: any = null;
			try {
				data = JSON.parse(xhr.responseText);
			} catch {}
			if (xhr.status >= 200 && xhr.status < 300 && data?.fileId) resolve(data.fileId);
			else reject(new Error(data?.error || "Could not send the audio for transcription. Try again."));
		};
		xhr.onabort = () => reject(new DOMException("Cancelled", "AbortError"));
		xhr.onerror = () => reject(new Error(OFFLINE));
		xhr.send(blob);
	});
}

const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve) => {
		const t = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(t);
			resolve();
		}, { once: true });
	});

export interface TranscribeOptions {
	/** Audio or video; any format ffmpeg reads. */
	media: Blob;
	name?: string;
	/** "ru", "en"… or "auto". Never translates: the text stays in the spoken language. */
	language?: string;
	signal?: AbortSignal;
	/** Russian stage name and 0..1 progress, for the panel and the job center. */
	onProgress?: (stage: string, progress?: number) => void;
}

/**
 * Word-level transcript of `media`: words with start/end in seconds, aligned to the actual speech
 * (karaoke-ready), plus the stretches where there is speech. Cancel with `signal` (kills whisper-cli).
 */
export async function transcribeWords({ media, name = "audio.wav", language = "auto", signal, onProgress }: TranscribeOptions): Promise<Transcript> {
	if (DEMO) return (await import("./in-page")).transcribeInPage({ media, name, language, signal, onProgress });
	const throwIfAborted = () => {
		if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
	};
	// First use: the speech model is downloaded once (one click, with progress) before anything is sent.
	const engine = await engineStatus();
	if (!engine.available) {
		if (!engine.needsDownload) throw new Error(engine.reason || "Speech recognition is unavailable");
		onProgress?.("Downloading the speech model", 0);
		await requireModel("whisper", { signal, onProgress: (f, label) => onProgress?.(label, f) });
		throwIfAborted();
	}
	onProgress?.("Sending audio", 0);
	const fileId = await upload(media, name, signal, (p) => onProgress?.("Sending audio", p));
	throwIfAborted();
	let job = await request<JobState>("jobs", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ fileId, language }),
		signal,
	});
	const cancel = () => void request(`jobs/${job.id}`, { method: "DELETE" }).catch(() => {});
	signal?.addEventListener("abort", cancel, { once: true });
	try {
		let misses = 0;
		while (job.status === "running") {
			const stage = job.stages.find((s) => s.status === "running");
			if (stage) onProgress?.(stage.detail || stage.title, stage.progress);
			await sleep(350, signal);
			throwIfAborted();
			try {
				job = await request<JobState>(`jobs/${job.id}`, { signal });
				misses = 0;
			} catch (error) {
				if ((error as Error)?.name === "AbortError" || ++misses >= 5) throw error;
			}
		}
		throwIfAborted();
		if (job.status === "cancelled") throw new DOMException("Cancelled", "AbortError");
		if (job.status === "failed") throw new Error(job.error || "Transcription failed. Try again.");
		return job.result as Transcript;
	} finally {
		signal?.removeEventListener("abort", cancel);
		void request(`file/${fileId}`, { method: "DELETE" }).catch(() => {});
	}
}

/** transcribeWords + a run in the job center ("Transcribing speech" with stage, progress and Cancel). */
export async function transcribeTracked(
	options: Omit<TranscribeOptions, "signal"> & { title?: string; signal?: AbortSignal; quietWhenEmpty?: boolean; elements?: string[] },
): Promise<Transcript> {
	const controller = new AbortController();
	const outer = options.signal;
	const relay = () => controller.abort();
	outer?.addEventListener("abort", relay, { once: true });
	const run = speechRuns.start({ title: options.title ?? "Transcribing speech", cancel: () => controller.abort(), elements: options.elements });
	try {
		const result = await transcribeWords({
			...options,
			signal: controller.signal,
			onProgress: (stage, progress) => {
				speechRuns.update(run, { stage, progress });
				options.onProgress?.(stage, progress);
			},
		});
		// No words is not a green «done»: a project without sound said «Captions from speech done».
		if (result.words.length) speechRuns.finish(run, `${result.words.length} words`);
		// The Text view reads every clip with sound: one with music only or silence is not a failure there (its own empty
		// state says so) — its job leaves the header quietly instead of a red «… failed» (polish, 11.11).
		else if (options.quietWhenEmpty) speechRuns.cancelled(run);
		else speechRuns.fail(run, "No speech found");
		return result;
	} catch (error) {
		if ((error as Error)?.name === "AbortError") speechRuns.cancelled(run);
		else speechRuns.fail(run, (error as Error)?.message || "Transcription failed");
		throw error;
	} finally {
		outer?.removeEventListener("abort", relay);
	}
}
