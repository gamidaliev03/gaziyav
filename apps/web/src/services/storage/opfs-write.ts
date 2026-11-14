// One way to write a whole file into the origin's private file system (OPFS), for every browser the editor runs in.
// Chrome, Edge, the Mac app and Safari 26+ have FileSystemFileHandle.createWritable: the bytes go to a swap file that
// replaces the old file whole on close(). Safari up to 18 (macOS 15, iOS 18) has no createWritable on a page — only a
// worker's createSyncAccessHandle — so there the bytes go through one small worker and are written in place (the files
// kept this way are written once: an imported clip, a waveform summary; a write cut short is a file that was never
// finished, not a good one replaced by half of itself). Without this path Safari could not keep a clip at all.

export type OpfsPart = Blob | ArrayBuffer | ArrayBufferView | string;

/** Does a page of this browser have the swap-file writer? */
export function hasCreateWritable(): boolean {
	const proto = (globalThis as { FileSystemFileHandle?: { prototype?: object } }).FileSystemFileHandle?.prototype;
	return !!proto && "createWritable" in proto;
}

/** Can this browser write OPFS files one way or the other? (the worker path is only proven by its first write) */
export function canWriteOpfs(): boolean {
	return hasCreateWritable() || typeof Worker === "function";
}

// Plain JavaScript on purpose: the worker is made from this text (a blob), so no bundler has to find and serve a
// second file. Every handle call is awaited: Safari 15.2–16.3 answered truncate / flush / close with promises.
const WORKER_SOURCE = `
self.onmessage = async (event) => {
	const { id, path, name, parts } = event.data;
	try {
		let dir = await navigator.storage.getDirectory();
		for (const segment of path) dir = await dir.getDirectoryHandle(segment, { create: true });
		const handle = await dir.getFileHandle(name, { create: true });
		const access = await handle.createSyncAccessHandle();
		try {
			await access.truncate(0);
			let at = 0;
			for (const part of parts) {
				if (part instanceof Blob) {
					const reader = part.stream().getReader();
					for (;;) {
						const { done, value } = await reader.read();
						if (done) break;
						access.write(value, { at });
						at += value.byteLength;
					}
				} else {
					const bytes =
						typeof part === "string"
							? new TextEncoder().encode(part)
							: ArrayBuffer.isView(part)
								? new Uint8Array(part.buffer, part.byteOffset, part.byteLength)
								: new Uint8Array(part);
					access.write(bytes, { at });
					at += bytes.byteLength;
				}
			}
			await access.flush();
		} finally {
			await access.close();
		}
		self.postMessage({ id, ok: true });
	} catch (error) {
		self.postMessage({ id, ok: false, name: error && error.name, message: String((error && error.message) || error) });
	}
};
`;

type Answer = { id: number; ok: boolean; name?: string; message?: string };

let worker: Worker | null = null;
let sequence = 0;
const waiting = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();

function writer(): Worker {
	if (worker) return worker;
	const made = new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" })));
	made.onmessage = (event: MessageEvent<Answer>) => {
		const entry = waiting.get(event.data.id);
		if (!entry) return;
		waiting.delete(event.data.id);
		if (event.data.ok) return entry.resolve();
		const error = new Error(event.data.message || "The file could not be written");
		// the name is what the callers read («QuotaExceededError» → «no room»)
		if (event.data.name) error.name = event.data.name;
		entry.reject(error);
	};
	made.onerror = () => {
		// the worker itself failed (refused by a policy, out of memory): every waiting write fails, the next starts anew
		const error = new Error("The file writer could not start");
		for (const entry of waiting.values()) entry.reject(error);
		waiting.clear();
		if (worker === made) worker = null;
	};
	worker = made;
	return made;
}

/**
 * Writes `parts`, in order, as the whole content of the OPFS file `name` in the folder `path` (from the root).
 * `handle` is that file's handle, already made by the caller.
 */
export async function writeOpfsFile({
	handle,
	path,
	name,
	parts,
}: {
	handle: FileSystemFileHandle;
	path: readonly string[];
	name: string;
	parts: readonly OpfsPart[];
}): Promise<void> {
	if (typeof (handle as { createWritable?: unknown }).createWritable === "function") {
		// a swap file; close() swaps it in whole, abort() leaves the old file as it was
		const writable = await handle.createWritable();
		try {
			for (const part of parts) await writable.write(part as FileSystemWriteChunkType);
			await writable.close();
		} catch (error) {
			try {
				await writable.abort();
			} catch {}
			throw error;
		}
		return;
	}
	await new Promise<void>((resolve, reject) => {
		const id = ++sequence;
		waiting.set(id, { resolve, reject });
		try {
			writer().postMessage({ id, path, name, parts });
		} catch (error) {
			waiting.delete(id);
			reject(error instanceof Error ? error : new Error(String(error)));
		}
	});
}
