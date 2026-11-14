// The user's own file used where it is (src/media/originals.ts): the analysis reads it there — no upload, no copy.
// Only the very file the window imported is taken (the same size and date), and only a media file. It is never noted
// among the uploads (store.ts pruneSources removes those folders) and never written to.
import fs from "node:fs";
import path from "node:path";

const MEDIA =
	/\.(mp4|m4v|mov|qt|webm|mkv|avi|mxf|mts|m2ts|ts|3gp|mpg|mpeg|wmv|flv|mp3|wav|m4a|aac|flac|ogg|oga|opus|aif|aiff|caf|wma|amr|png|jpe?g|gif|webp|heic|heif|avif|bmp|tiff?)$/i;

/** The path of the user's original named by `source` ({ path, size, lastModified }), or null when it isn't that file. */
export function originalFor(source: unknown): string | null {
	if (!source || typeof source !== "object") return null;
	const {
		path: at,
		size,
		lastModified,
	} = source as { path?: unknown; size?: unknown; lastModified?: unknown };
	if (
		typeof at !== "string" ||
		!path.isAbsolute(at) ||
		(!MEDIA.test(at) && !at.startsWith("/.vol/"))
	)
		return null;
	if (typeof size !== "number" || typeof lastModified !== "number") return null;
	try {
		const st = fs.statSync(at);
		if (
			!st.isFile() ||
			st.size !== size ||
			Math.abs(st.mtimeMs - lastModified) > 2000
		)
			return null;
	} catch {
		return null;
	}
	return at;
}
