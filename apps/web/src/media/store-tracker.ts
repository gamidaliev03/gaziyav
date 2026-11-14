// An imported file shows in Media (and can go on the timeline) at once; the project's own copy of it is written behind
// (services/storage: the file into the project's folder, then its line in the media list — only then does it survive a
// crash). For a 1 GB source that takes about two seconds on this Mac's disk, and anything else reading the same file
// in those seconds makes it longer: the background brief streamed the whole file to the local server 1.5 s after the
// import, the copy's last part ran at a quarter of its speed, and a crash 3–4 s after the import left the clip
// offline (gaziyav-pro-reliable crash, rc34/rc35: the export refused at 0.0 %, Reverse said the media file is missing).
// This is the one list of the copies still being written, so that work which can wait for them does.

const storing = new Map<string, Promise<void>>();
/** The file each copy is written from (the user's original, or the import itself): what the clip plays meanwhile. */
const writing = new Map<string, File>();
const listeners = new Set<(id: string) => void>();

/** `store` writes the project's copy of asset `id` (from `file`); until it settles the asset counts as being stored. */
export function trackStore(id: string, store: Promise<unknown>, file?: File): void {
	const done = store.then(
		() => true,
		() => false,
	);
	const settled = done.then(() => undefined);
	storing.set(id, settled);
	if (file) writing.set(id, file);
	else writing.delete(id);
	void done.then((ok) => {
		if (storing.get(id) !== settled) return; // stored again meanwhile: that one tells
		storing.delete(id);
		writing.delete(id);
		if (!ok) return;
		for (const listener of [...listeners]) {
			try {
				listener(id);
			} catch {}
		}
	});
}

/** The file the copy of this asset is being written from, while it is (a project opened meanwhile plays it). */
export function fileBeingStored(id: string): File | undefined {
	return writing.get(id);
}

/** The project's copy of this asset is still being written. */
export function isStoring(id: string): boolean {
	return storing.has(id);
}

/** Resolves once the project's copy of this asset is written (or its store failed); at once when none is running. */
export function whenStored(id: string): Promise<void> {
	return storing.get(id) ?? Promise.resolve();
}

/** `listener(id)` each time an asset's copy has been written. Returns the unsubscribe function. */
export function onStored(listener: (id: string) => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
