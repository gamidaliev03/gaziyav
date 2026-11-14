// The end of an export on a phone (mobile, 14.11): the finished file goes to the system share sheet — on iOS its
// «Save Video» puts it in Photos, on Android «Save» / Photos / any app. Where files can't be shared, the editor's own
// download (export/index.ts downloadBuffer) runs as today. Round 2 calls this from the Export window's finish step on a
// phone (one call site, export-button.tsx; the desktop path unchanged).
//
// Rules of the platform (WebKit / Chrome): navigator.share needs a user gesture — an export takes longer than the
// gesture lasts, so the share is offered as a button («Save to Photos») on the finished export, never called by itself.
import { downloadBuffer } from "@/export";

export type ShareOutcome = "shared" | "cancelled" | "downloaded";

export function canShareFiles(file?: File): boolean {
	if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
	try {
		return navigator.canShare({ files: [file ?? new File([new Uint8Array(1)], "probe.mp4", { type: "video/mp4" })] });
	} catch {
		return false;
	}
}

/** Call from a tap. */
export async function shareOrSave({ buffer, filename, mimeType }: { buffer: ArrayBuffer; filename: string; mimeType: string }): Promise<ShareOutcome> {
	const file = new File([buffer], filename, { type: mimeType });
	if (canShareFiles(file)) {
		try {
			await navigator.share({ files: [file] });
			return "shared";
		} catch (error) {
			// AbortError = the visitor closed the sheet: nothing else to do, the file is still there to share again
			if ((error as DOMException)?.name === "AbortError") return "cancelled";
		}
	}
	downloadBuffer({ buffer, filename, mimeType });
	return "downloaded";
}
