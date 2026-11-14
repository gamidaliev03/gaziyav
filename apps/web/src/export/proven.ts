// «The file is verified» (render, 11.11; asked for by the «create» department for the premiere of a finished film).
// An export is announced as done only after its saved file was looked at (export/server/verify.ts: not empty, the
// timeline's length, sound where the timeline has sound, its first and last second decode). At that moment — and
// never for a file that failed the look — the window gets:
//
//   window event EXPORT_PROVEN_EVENT («gaziyav:export-proven»), detail: ExportProven
//     { projectId, path, bytes, url }  — `path` is where the file was saved; `url` plays it in a <video>.
//
// `url` (provenExportUrl) is served by the app's own server with byte ranges (seeking works), only for files that
// passed the look in this run of the app, only to the app's own window.
export const EXPORT_PROVEN_EVENT = "gaziyav:export-proven";

export interface ExportProven {
	projectId: string;
	/** where the file was saved */
	path: string;
	bytes: number;
	/** a URL of the saved file a <video> or <audio> of the window can play */
	url: string;
}

/** A URL of a saved, verified export for a <video> of the app's window. */
export const provenExportUrl = (path: string): string => `/api/export/proven?file=${encodeURIComponent(path)}`;

/** Tells the window that an export is saved and verified. */
export function announceProvenExport(proven: Omit<ExportProven, "url">): void {
	try {
		window.dispatchEvent(new CustomEvent<ExportProven>(EXPORT_PROVEN_EVENT, { detail: { ...proven, url: provenExportUrl(proven.path) } }));
	} catch {}
}
