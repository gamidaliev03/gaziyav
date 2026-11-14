"use client";
// «From Photos» (mobile, 14.11): the phone's own picker (iOS: Photos / Files / Camera; Android: the media picker).
// THE SAME IMPORT PATH as the desktop: the picked files are handed to the editor's paste handler (media/use-paste-media:
// known-file dedupe, the upload toast, AddMediaAsset + Insert at the playhead — one undo step) by a paste event that
// carries them. No second importer.
//
// What iOS hands over (to verify on the owner's phone, /check/ «Pick a clip»): with a plain accept="video/*" Safari
// may transcode an HEVC / HDR clip to H.264 «Most Compatible» before the page gets it (slow for long clips, SDR); the
// file then arrives as video/quicktime (.MOV) or video/mp4. Both decode with WebCodecs on iOS 16.4+.
import { useRef } from "react";
import { useT } from "@/i18n";

/** Hands files to the editor's one import path (the paste handler). Returns false where DataTransfer can't be built. */
export function importThroughPaste(files: readonly File[]): boolean {
	if (files.length === 0) return true;
	try {
		const dt = new DataTransfer();
		for (const f of files) dt.items.add(f);
		const event = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
		// the handler skips a paste aimed at a text field: nothing may be focused
		(document.activeElement as HTMLElement | null)?.blur?.();
		document.dispatchEvent(event);
		return true;
	} catch {
		return false;
	}
}

export function PhotosButton() {
	const t = useT();
	const input = useRef<HTMLInputElement>(null);
	return (
		<div className="px-3 pb-2">
			<button type="button" className="gz-hit bg-primary text-primary-foreground w-full rounded-xl py-3 text-base font-medium" onClick={() => input.current?.click()}>
				{t("From Photos")}
			</button>
			<input
				ref={input}
				type="file"
				accept="video/*,image/*,audio/*"
				multiple
				hidden
				onChange={(e) => {
					const files = [...(e.currentTarget.files ?? [])];
					e.currentTarget.value = "";
					importThroughPaste(files);
				}}
			/>
		</div>
	);
}
