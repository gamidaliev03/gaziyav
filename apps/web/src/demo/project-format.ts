// The «.gaziyav» project file's bytes (project-file.ts reads and writes the browser's storage with it): the line
// «GAZIYAV-PROJECT 1\n», a 4-byte length, a JSON header, then the media files' bytes one after another.
import type { SerializedProject } from "@/services/storage/types";
import type { MediaAsset } from "@/media/types";

export const MAGIC = "GAZIYAV-PROJECT 1\n";
export const EXTENSION = ".gaziyav";

export interface Header {
	project: SerializedProject;
	media: Array<{ meta: Omit<MediaAsset, "file" | "url">; name: string; type: string; size: number }>;
}

export function encode(header: Header, files: Blob[]): Blob {
	const json = new TextEncoder().encode(JSON.stringify(header));
	const size = new Uint8Array(4);
	new DataView(size.buffer).setUint32(0, json.byteLength);
	return new Blob([MAGIC, size, json, ...files], { type: "application/octet-stream" });
}

export async function decode(file: Blob): Promise<{ header: Header; files: Blob[] }> {
	const head = new Uint8Array(await file.slice(0, MAGIC.length + 4).arrayBuffer());
	if (new TextDecoder().decode(head.slice(0, MAGIC.length)) !== MAGIC) throw new Error("This is not a Gaziyav project file");
	const length = new DataView(head.buffer).getUint32(MAGIC.length);
	const start = MAGIC.length + 4;
	const header = JSON.parse(await file.slice(start, start + length).text()) as Header;
	let at = start + length;
	const files = header.media.map((m) => {
		const blob = file.slice(at, at + m.size, m.type);
		at += m.size;
		return blob;
	});
	if (at > file.size) throw new Error("The project file is cut short");
	return { header, files };
}

