// Import proxies through the app's local server (ffmpeg / sips). Used when the
// editor can't decode a file itself: iPhone HEVC/HDR, ProRes, HEIC photos,
// MKV/AVI/MTS containers, Opus/WMA audio…
import type { MediaType } from "@/media/types";

const BASE = "/api/studio";

/** Extensions we always convert before import (the editor can't use them directly). */
const ALWAYS_CONVERT: Record<string, MediaType> = {
	heic: "image",
	heif: "image",
	tif: "image",
	tiff: "image",
	dng: "image",
	mkv: "video",
	avi: "video",
	wmv: "video",
	flv: "video",
	mts: "video",
	m2ts: "video",
	"3gp": "video",
	mpg: "video",
	mpeg: "video",
	vob: "video",
	wma: "audio",
	amr: "audio",
	aiff: "audio",
	aif: "audio",
};

/** Extensions the importer recognises even when the OS reports no MIME type. */
const EXTENSION_TYPES: Record<string, MediaType> = {
	...ALWAYS_CONVERT,
	mp4: "video",
	m4v: "video",
	mov: "video",
	webm: "video",
	jpg: "image",
	jpeg: "image",
	png: "image",
	gif: "image",
	webp: "image",
	avif: "image",
	bmp: "image",
	mp3: "audio",
	m4a: "audio",
	wav: "audio",
	aac: "audio",
	ogg: "audio",
	oga: "audio",
	opus: "audio",
	flac: "audio",
};

/** Extensions the file picker lists besides image/*, video/*, audio/* (macOS doesn't file these under audio/*). */
export const CONVERTIBLE_ACCEPT = [...Object.keys(ALWAYS_CONVERT), "opus"]
	.map((ext) => `.${ext}`)
	.join(",");

function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function mediaTypeFromExtension(name: string): MediaType | null {
	return EXTENSION_TYPES[extensionOf(name)] ?? null;
}

export function mustConvertBeforeImport(file: File): MediaType | null {
	return ALWAYS_CONVERT[extensionOf(file.name)] ?? null;
}

export class ConvertUnavailableError extends Error {}

interface ConvertJob {
	id: string;
	status: "running" | "done" | "failed" | "cancelled";
	error?: string;
	stages: Array<{ progress?: number }>;
	result?: { fileId: string; name: string; mime: string };
}

async function readError(res: Response, fallback: string): Promise<string> {
	const data = await res.json().catch(() => null);
	return (data && typeof data.error === "string" && data.error) || fallback;
}

function upload(
	file: File,
	kind: MediaType | "repair" | "still" | "editing",
	onProgress: (value: number) => void,
	signal?: AbortSignal,
): Promise<ConvertJob> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open(
			"POST",
			`${BASE}/convert?name=${encodeURIComponent(file.name)}&kind=${kind}`,
		);
		xhr.setRequestHeader("X-Studio", "1");
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) onProgress(event.loaded / event.total);
		};
		xhr.onload = () => {
			let data: (ConvertJob & { error?: string }) | null = null;
			try {
				data = JSON.parse(xhr.responseText);
			} catch {}
			if (xhr.status >= 200 && xhr.status < 300 && data?.id) {
				resolve(data);
			} else if (xhr.status === 404 || xhr.status === 0) {
				reject(new ConvertUnavailableError("File conversion isn't available here."));
			} else {
				reject(new Error(data?.error || "Couldn't send the file for conversion."));
			}
		};
		xhr.onerror = () =>
			reject(new ConvertUnavailableError("The app's local server isn't responding. Restart the app and try again."));
		signal?.addEventListener("abort", () => xhr.abort(), { once: true });
		xhr.onabort = () => reject(new DOMException("Cancelled", "AbortError"));
		xhr.send(file);
	});
}

/**
 * Converts `file` on the local server into something the editor can decode.
 * `repair`: a video cut off midway is copied up to where its data ends (no re-encode when possible).
 * Progress: 0–0.2 upload, 0.2–0.95 conversion, 0.95–1 download.
 */
export async function convertForImport({
	file,
	kind,
	repair = false,
	still = false,
	editing = false,
	onProgress,
	signal,
}: {
	file: File;
	kind: MediaType;
	repair?: boolean;
	/** An editing copy (preview only; the export renders from the original): made lighter than an export source. */
	editing?: boolean;
	/** A photo made into a still clip (AI avatar → Photo to avatar). */
	still?: boolean;
	onProgress?: (value: number) => void;
	signal?: AbortSignal;
}): Promise<File> {
	const report = (value: number) => onProgress?.(Math.max(0, Math.min(1, value)));
	let job = await upload(file, still ? "still" : repair && kind === "video" ? "repair" : editing && kind === "video" ? "editing" : kind, (v) => report(v * 0.2), signal);

	while (job.status === "running") {
		await new Promise((resolve) => setTimeout(resolve, 500));
		if (signal?.aborted) {
			void fetch(`${BASE}/jobs/${job.id}`, { method: "DELETE", headers: { "X-Studio": "1" } }).catch(() => {});
			throw new DOMException("Cancelled", "AbortError");
		}
		const res = await fetch(`${BASE}/jobs/${job.id}`, { headers: { "X-Studio": "1" } });
		if (!res.ok) throw new Error(await readError(res, "Lost track of the conversion. Try importing again."));
		job = (await res.json()) as ConvertJob;
		report(0.2 + (job.stages[0]?.progress ?? 0) * 0.75);
	}

	if (job.status !== "done" || !job.result) {
		throw new Error(job.error || "Couldn't convert the file.");
	}

	const { fileId, name, mime } = job.result;
	try {
		const res = await fetch(`${BASE}/file/${fileId}`, { signal });
		if (!res.ok) throw new Error(await readError(res, "Couldn't read the converted file."));
		const blob = await res.blob();
		report(1);
		return new File([blob], name, { type: mime, lastModified: file.lastModified });
	} finally {
		void fetch(`${BASE}/file/${fileId}`, { method: "DELETE", headers: { "X-Studio": "1" } }).catch(() => {});
	}
}
