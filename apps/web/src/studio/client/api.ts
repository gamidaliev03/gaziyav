// Calls to the app's local pipeline server.
import type { SavedVoice } from "@/studio/server/my-voices";
import type { PublicSettings } from "@/studio/server/settings";
import type { JobState } from "@/studio/server/jobs";
import type { Preflight, Segment } from "@/studio/server/pipeline";
import type { YouTubeHit, YouTubeInfo } from "@/studio/server/youtube";
import type { LocalLipsyncStatus } from "@/studio/server/local-provider";

export type { JobState, LocalLipsyncStatus, Preflight, PublicSettings, SavedVoice, Segment, YouTubeInfo };

export interface StudioState {
	settings: PublicSettings;
	voices: SavedVoice[];
	/** browsers: those a YouTube sign-in can be taken from (Add from a link). */
	tools: { ffmpeg: boolean; ytdlp: boolean; browsers?: string[]; localLipsync?: LocalLipsyncStatus };
}

const BASE = "/api/studio";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`${BASE}/${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), "X-Studio": "1" } });
	} catch (error) {
		if ((error as Error)?.name === "AbortError") throw error;
		throw new Error("Gaziyav's local server is not responding. Restart Gaziyav.");
	}
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.error || `Request failed (HTTP ${res.status})`);
	return data as T;
}

const post = <T>(path: string, body: unknown, signal?: AbortSignal) =>
	request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });

export const studioApi = {
	state: () => request<StudioState>("settings"),
	saveSettings: (patch: Record<string, unknown>) => post<StudioState>("settings", patch),
	checkKey: (field: string) => post<StudioState>("keys/check", { field }),
	renameVoice: (id: string, name: string) => post<StudioState>("voices/rename", { id, name }),
	deleteVoice: (id: string) => post<StudioState>("voices/delete", { id }),
	youtubeInfo: (url: string, signal?: AbortSignal) => post<YouTubeInfo>("youtube/info", { url }, signal),
	youtubeSearch: (query: string, signal?: AbortSignal) => post<YouTubeHit[]>("youtube/search", { query, count: 6 }, signal),
	/** The pre-flight: the checks and THE price (`total` = voice still to make + lipsync). No sound yet: `estimate` + `voice`. */
	preflight: (body: { video?: Segment; audioFileId?: string; estimate?: { seconds: number; length?: number; side?: number; fps?: number }; voice?: { chars: number; clone: boolean }; voiceOnly?: boolean; model: string; fit?: "loop" | "speed" | "pad" | "pingpong" | "freeze" | "cut"; kie?: { mode?: "lite" | "basic"; vocals?: boolean } }, signal?: AbortSignal) =>
		post<Preflight>("preflight", body, signal),
	script: (
		body: { action: { kind: "write"; idea: string } | { kind: "improve" } | { kind: "fit" }; current: string; seconds: number; context: string },
		signal?: AbortSignal,
	) => post<{ text: string }>("ai/script", body, signal),
	startFragment: (body: { url: string; start: number; end: number; title?: string; full?: boolean }) => post<JobState>("jobs/fragment", body),
	startVoiceover: (body: { source?: Segment; voiceId?: string; voiceName?: string; text: string; language?: string }) =>
		post<JobState>("jobs/voiceover", body),
	/** `fresh`: a new take even when this lipsync was made before (else the earlier result comes back free). */
	startLipsync: (body: { video: Segment; audioFileId: string; model: string; fit?: "loop" | "speed" | "pad" | "pingpong" | "freeze" | "cut"; fresh?: boolean; maxUsd?: number; kie?: { mode?: "lite" | "basic"; vocals?: boolean }; mode?: "sample"; sampleModel?: string; seed?: number; guidance?: number }) =>
		post<JobState>("jobs/lipsync", body),
	/** «Your voice»: 10–30 s of someone's speech (an uploaded file or a clip from `start`) becomes one of «My voices». */
	startVoiceClone: (body: { fileId: string; start?: number; name?: string }) => post<JobState>("jobs/voice-clone", body),
	installLocalLipsync: () => post<JobState>("local-lipsync/install", {}),
	/** The voice box got focus: the Mac may load its voice model now, before the job (the server decides). */
	prewarmVoice: (use: "voiceover" | "ready") => post<{ started: boolean }>("prewarm/voice", { use }).catch(() => ({ started: false })),
	job: (id: string) => request<JobState>(`jobs/${id}`),
	cancel: (id: string) => request<{ cancelled: boolean }>(`jobs/${id}`, { method: "DELETE" }),
	fileUrl: (id: string) => `${BASE}/file/${id}`,

	async fetchFile(id: string, name: string, type: string): Promise<File> {
		const res = await fetch(`${BASE}/file/${id}`);
		if (!res.ok) {
			const data = await res.json().catch(() => null);
			throw new Error(data?.error || "Couldn't get the result file");
		}
		return new File([await res.blob()], name, { type });
	},
};

/** Polls a job until it ends; `onUpdate` gets every state. Resolves with the final state. */
export async function followJob(id: string, onUpdate: (s: JobState) => void): Promise<JobState> {
	let misses = 0;
	for (;;) {
		await new Promise((r) => setTimeout(r, 700));
		let s: JobState;
		try {
			s = await studioApi.job(id);
			misses = 0;
		} catch (error) {
			if (++misses >= 5) throw error;
			continue;
		}
		onUpdate(s);
		if (s.status !== "running") return s;
	}
}

// Files sent to the server once per session: the same media is reused for voice, preflight and lipsync.
const uploaded = new Map<string, Promise<{ fileId: string; duration: number; hasAudio: boolean; hasVideo: boolean }>>();

export function uploadOnce(key: string, file: File, onProgress?: (p: number) => void) {
	let p = uploaded.get(key);
	if (!p) {
		p = uploadFile(file, onProgress);
		uploaded.set(key, p);
		p.catch(() => uploaded.delete(key));
	}
	return p;
}

type Uploaded = { fileId: string; duration: number; hasAudio: boolean; hasVideo: boolean };

/** The file's place on this Mac when it is one (an original used where it is: the Mac app's webUtils), else "". */
export function pathOnDisk(file: File): string {
	try {
		const app = (globalThis as { studioApp?: { pathForFile?: (f: File) => string } }).studioApp;
		const found = app?.pathForFile?.(file);
		return typeof found === "string" ? found : "";
	} catch {
		return "";
	}
}

/**
 * perf, 13.11: a clip whose file is on this Mac is handed to the server by its place — the server takes it from there
 * (an APFS clone: no byte copied). Every AI step on a 1 GB talk read the whole file into the page and streamed it to the
 * server only to have it written to disk again. The server takes it under rel3's rule for an original (the very file:
 * same size and date). Anything else (a file made in the page, a changed file, an older server) sends its bytes.
 */
async function uploadFile(file: File, onProgress?: (p: number) => void): Promise<Uploaded> {
	const place = pathOnDisk(file);
	if (place) {
		try {
			const res = await fetch(`${BASE}/upload-path`, {
				method: "POST",
				headers: { "Content-Type": "application/json", "X-Studio": "1" },
				body: JSON.stringify({ path: place, name: file.name, size: file.size, lastModified: file.lastModified }),
			});
			const data = await res.json().catch(() => null);
			if (res.ok && data?.fileId) {
				onProgress?.(1);
				return data as Uploaded;
			}
		} catch {}
	}
	return uploadBytes(file, onProgress);
}

function uploadBytes(file: File, onProgress?: (p: number) => void) {
	return new Promise<{ fileId: string; duration: number; hasAudio: boolean; hasVideo: boolean }>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("POST", `${BASE}/upload?name=${encodeURIComponent(file.name)}`);
		xhr.setRequestHeader("X-Studio", "1");
		xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
		xhr.onload = () => {
			let data: any = null;
			try {
				data = JSON.parse(xhr.responseText);
			} catch {}
			if (xhr.status >= 200 && xhr.status < 300 && data?.fileId) resolve(data);
			else reject(new Error(data?.error || "Couldn't send the clip for processing"));
		};
		xhr.onerror = () => reject(new Error("Gaziyav's local server is not responding. Restart Gaziyav."));
		xhr.send(file);
	});
}
