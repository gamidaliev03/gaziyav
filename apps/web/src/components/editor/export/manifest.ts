// Export manifest: what each exported file is (for a batch of ad variants), as <name>.json next to the file and
// one row per export in the folder's exports.csv. Written by the local server (app/api/export/manifest).

export interface ExportManifest {
	file: string;
	project: string;
	platform: string;
	format: string;
	width: number | null;
	height: number | null;
	fps: number | null;
	seconds: number;
	quality: string | null;
	video_kbps: number | null;
	audio: boolean;
	loudness_lufs: number | null;
	captions: boolean;
	range: string;
	bytes: number;
	exported_at: string;
	/** Bits per channel of the file's video stream, and of the picture it carries (a 10-bit file may hold 8-bit content). */
	file_bits?: number | null;
	content_bits?: number | null;
}

export const MANIFEST_COLUMNS = [
	"file",
	"project",
	"platform",
	"format",
	"width",
	"height",
	"fps",
	"seconds",
	"quality",
	"video_kbps",
	"audio",
	"loudness_lufs",
	"captions",
	"range",
	"bytes",
	"exported_at",
] as const satisfies readonly (keyof ExportManifest)[];

/** Files a manifest may sit next to (the server never writes beside anything else). */
export const MANIFEST_MEDIA = /\.(mp4|mov|webm|wav|mp3|m4a|flac|gif)$/i;

function csvCell(value: unknown): string {
	const text = value === null || value === undefined ? "" : String(value);
	return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function manifestCsvHeader(): string {
	return MANIFEST_COLUMNS.join(",");
}

export function manifestCsvRow(manifest: ExportManifest): string {
	return MANIFEST_COLUMNS.map((column) => csvCell(manifest[column])).join(",");
}

/** Saves the manifest beside a file the save dialog just wrote; resolves to false when that didn't work. */
export async function saveManifest(path: string, manifest: ExportManifest): Promise<boolean> {
	try {
		const response = await fetch("/api/export/manifest", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ file: path, manifest }),
		});
		return response.ok;
	} catch {
		return false;
	}
}
