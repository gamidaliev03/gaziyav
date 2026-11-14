// Where a finished export goes (client side of app/api/export/*): the ffmpeg pass for codecs the page can't encode,
// straight into the «Export to» folder, or a file the server holds handed to the Save dialog.
import type { AudioFileFormat, ExportTarget } from "./target";

const HEADERS = { "x-studio": "1" };

/** A step of the server's pass that did not work and was replaced by a plainer one (export/server/files.ts). */
export type ExportFallbackNote = { step: "smooth" | "upscale" | "hardware" | "aac" | "build"; reason: string };

export type TranscodeJob =
	| { target: ExportTarget; upscale?: { scale: 2 | 4 }; smooth?: { factor: number; fps: number; frames?: number; cut?: number; cuts?: number[] }; force?: Array<"smooth" | "upscale" | "hardware"> }
	| { audio: Exclude<AudioFileFormat, "wav"> };

/** The page's master (or WAV mix) → the file; `path` when it went into `folder`, `id` for the Save dialog. */
export async function transcodeOnServer({
	data,
	from,
	job,
	name,
	folder,
	seconds,
	signal,
	onProgress,
	onStage,
}: {
	/** The master in memory, or `from`: its path on this Mac (a long export). */
	data?: ArrayBuffer;
	from?: string;
	job: TranscodeJob;
	name: string;
	folder?: string;
	seconds: number;
	signal?: AbortSignal;
	onProgress?: (progress: number) => void;
	onStage?: (stage: string) => void;
}): Promise<{ path: string; id?: string; bytes: number; fallbacks?: ExportFallbackNote[] }> {
	const query = new URLSearchParams({ job: JSON.stringify(job), name, seconds: String(seconds) });
	if (folder) query.set("folder", folder);
	if (from) query.set("from", from);
	const response = await fetch(`/api/export/transcode?${query}`, { method: "POST", headers: HEADERS, body: from ? undefined : data, signal });
	if (!response.ok || !response.body) throw new Error("The app couldn't start the encoder. Export again.");
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let pending = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		pending += value;
		for (let nl = pending.indexOf("\n"); nl >= 0; nl = pending.indexOf("\n")) {
			const message = JSON.parse(pending.slice(0, nl)) as {
				progress?: number;
				done?: boolean;
				path?: string;
				id?: string;
				bytes?: number;
				error?: string;
				kept?: KeptFile;
				stage?: string;
				fallbacks?: ExportFallbackNote[];
			};
			pending = pending.slice(nl + 1);
			// (`kept`: the file is made, only its place failed — it can be placed again without a new encode)
			if (message.error) throw Object.assign(new Error(message.error), message.kept ? { kept: message.kept } : {});
			if (typeof message.progress === "number") onProgress?.(message.progress);
			if (message.stage) onStage?.(message.stage);
			if (message.done && message.path) return { path: message.path, id: message.id, bytes: message.bytes ?? 0, ...(message.fallbacks?.length ? { fallbacks: message.fallbacks } : {}) };
		}
	}
	throw new Error("The encoder stopped before the file was ready. Export again.");
}

/** A file the server made and holds because its place could not be written. */
export interface KeptFile {
	id: string;
	path: string;
	bytes: number;
}
export const keptFileOf = (error: unknown): KeptFile | null => (error as { kept?: KeptFile } | null)?.kept ?? null;

/** Puts a file the server holds into `folder` (a free name); returns its path. */
export async function placeOnServer({ id, folder, name }: { id: string; folder: string; name: string }): Promise<string> {
	const query = new URLSearchParams({ id, folder, name });
	const response = await fetch(`/api/export/place?${query}`, { method: "POST", headers: HEADERS });
	const result = (await response.json().catch(() => ({}))) as { path?: string; error?: string };
	if (!result.path) throw new Error(result.error ?? "Couldn't save the file.");
	return result.path;
}

/** Saves a file the page made into the «Export to» folder; returns its path. */
export async function saveToFolder({ data, folder, name }: { data: ArrayBuffer | Blob; folder: string; name: string }): Promise<string> {
	const query = new URLSearchParams({ folder, name });
	const response = await fetch(`/api/export/save?${query}`, { method: "POST", headers: HEADERS, body: data });
	const result = (await response.json().catch(() => ({}))) as { path?: string; error?: string };
	if (!result.path) throw new Error(result.error ?? "Couldn't save the file.");
	return result.path;
}

/** The Save dialog for a file the server holds (the same path as any download: «Show in Finder» after). */
export function downloadFromServer(id: string, filename: string) {
	const link = document.createElement("a");
	link.href = `/api/export/file?id=${encodeURIComponent(id)}`;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
}

/** A soft two-note chime (Settings → Edit → Sound for export). */
export function playExportChime() {
	try {
		const context = new AudioContext();
		const now = context.currentTime;
		for (const [index, frequency] of [880, 1318.5].entries()) {
			const osc = context.createOscillator();
			const gain = context.createGain();
			osc.frequency.value = frequency;
			gain.gain.setValueAtTime(0, now + index * 0.14);
			gain.gain.linearRampToValueAtTime(0.18, now + index * 0.14 + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.14 + 0.5);
			osc.connect(gain).connect(context.destination);
			osc.start(now + index * 0.14);
			osc.stop(now + index * 0.14 + 0.55);
		}
		window.setTimeout(() => void context.close(), 1200);
	} catch {}
}
