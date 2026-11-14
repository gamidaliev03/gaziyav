// The name an export is saved under. Chromium changes some characters of a download's name (its list: " ~ * / : < > ?
// \ | and control / format characters, e.g. the joiner inside an emoji), and the app's reply about the saved file
// carries the changed name: the export button never matched it, so «Export done · Show in Finder» never came. A name
// past the file system's limit made the save fail with a false «check free disk space». Here the name is made the way
// Chromium would keep it, and short enough, with its extension; the reply is matched loosely as well.

/** Bytes (UTF-8) a saved name may take: APFS allows 255, Chromium's «.crdownload» while saving and the folder save's
 * «(2)» need room too. */
export const FILE_NAME_MAX_BYTES = 200;

const CHANGED_BY_CHROMIUM = /["~*/:<>?\\|\p{Cc}\p{Cf}]/gu;
const EXTENSION = /\.[A-Za-z0-9]{1,10}$/;

const bytes = (text: string) => new TextEncoder().encode(text).length;

function graphemes(text: string): string[] {
	const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
	if (!Segmenter) return Array.from(text);
	return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
}

/** `name` («Project.mp4») as it can be saved: the characters Chromium changes as «_», cut to `maxBytes`, extension kept. */
export function exportSaveName(name: string, maxBytes = FILE_NAME_MAX_BYTES): string {
	const whole = name.normalize("NFC");
	const extension = whole.match(EXTENSION)?.[0] ?? "";
	const clean = (text: string) => text.replace(CHANGED_BY_CHROMIUM, "_").replace(/\s+/g, " ");
	// no leading dot (a hidden file) or space, no trailing dot or space before the extension
	let stem = clean(whole.slice(0, whole.length - extension.length)).replace(/^[\s.]+/, "").replace(/[\s.]+$/, "");
	if (!stem) stem = "Video";
	const room = Math.max(1, maxBytes - bytes(extension));
	if (bytes(stem) > room) {
		let used = 0;
		let cut = "";
		for (const g of graphemes(stem)) {
			const size = bytes(g);
			if (used + size > room) break;
			used += size;
			cut += g;
		}
		stem = cut.replace(/[\s._-]+$/, "") || "Video";
	}
	return `${stem}${extension}`;
}

/** The letters and digits of a name: what stays when Chromium (or the folder save) changes the rest. */
function nameKey(name: string): string {
	return name.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Is the app's reply about a saved download (`reported`) the file this export asked to save (`asked`)? */
export function sameSavedName(reported: string, asked: string): boolean {
	if (reported === asked) return true;
	const key = nameKey(asked);
	return key.length > 0 && nameKey(reported) === key;
}
