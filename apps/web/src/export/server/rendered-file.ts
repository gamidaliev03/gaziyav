// A long render is a file of the app's on disk (GaziyavShell: studio:export-file-*), read from there and never through
// the page's memory. Only those files can be named: `Gaziyav-export-*/…`.
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

export function isRenderedFile(file: string): boolean {
	return path.isAbsolute(file) && path.basename(path.dirname(file)).startsWith("Gaziyav-export-") && fs.existsSync(file);
}

export function renderedStream(file: string): ReadableStream<Uint8Array> {
	return Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream<Uint8Array>;
}
