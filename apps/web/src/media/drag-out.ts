// A Media tile dragged out of Gaziyav (Finder, the Desktop, a chat) delivers the real file, the way Media → Downloads
// does: a native drag of a file on disk (the Mac app's `startDrag`). The page keeps its media in its own storage, so the
// first move of a pressed tile (a drag, never a click) sends that file once to the app's server, which keeps a copy
// named as Media shows it (studio/server/drag-copy.ts); a drag that starts once the copy is there is the native one. Dropped on the timeline
// or into Media it still lands as the Media item it is: the timeline reads the drag's item (timeline.dragSource), not
// the file, and Media doesn't import a file while an item of its own is being dragged.
// A drag that starts before the copy is ready (a big file pressed and dragged at once) is the in-page drag as before.

interface DragOutItem {
	id: string;
	name: string;
	file: File;
}

/** Larger files are never copied for a drag (seconds of writing on every press). */
const MAX_BYTES = 2 * 1024 ** 3;

const ready = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

type StudioApp = { startDrag?: (file: string) => void };
const studioApp = (): StudioApp | undefined => (typeof window === "undefined" ? undefined : (window as unknown as { studioApp?: StudioApp }).studioApp);

/** «gz.dragOut» = "off": the in-page drag only (a test that drives the timeline's drop with the browser's own drag). */
function switchedOff(): boolean {
	try {
		return localStorage.getItem("gz.dragOut") === "off";
	} catch {
		return false;
	}
}

/** The Mac app can drag a file out of its window. */
export const canDragOut = () => typeof studioApp()?.startDrag === "function" && !switchedOff();

const keyOf = (item: DragOutItem) => `${item.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48) || "item"}-${item.file.size}`;

/** On a drag's first move: the copy for a drag out, sent once per item (later drags find it ready). */
export function prepareDragOut(item: DragOutItem): void {
	if (!canDragOut() || !(item.file instanceof Blob) || item.file.size === 0 || item.file.size > MAX_BYTES) return;
	const key = keyOf(item);
	if (ready.has(key) || pending.has(key)) return;
	const query = new URLSearchParams({ key, name: item.name, size: String(item.file.size), type: item.file.type || "" });
	const job = fetch(`/api/studio/drag-copy?${query}`, {
		method: "POST",
		headers: { "X-Studio": "1", "Content-Type": "application/octet-stream" },
		body: item.file,
	})
		.then((response) => (response.ok ? (response.json() as Promise<{ path?: string }>) : null))
		.then((data) => {
			if (!data?.path) return null;
			ready.set(key, data.path);
			return data.path;
		})
		.catch(() => null)
		.finally(() => pending.delete(key));
	pending.set(key, job);
}

/** The file on disk for this item's drag, when its copy is ready. */
export function dragOutPath(item: DragOutItem): string | null {
	return ready.get(keyOf(item)) ?? null;
}

/** Waits for the copy (tests, and a press held before the drag). */
export async function dragOutReady(item: DragOutItem): Promise<string | null> {
	prepareDragOut(item);
	return ready.get(keyOf(item)) ?? (await pending.get(keyOf(item))) ?? ready.get(keyOf(item)) ?? null;
}

/**
 * Starts the native drag of the file from a `dragstart` (the in-page drag is cancelled); `onEnd` runs once the drag is
 * over — dropped in the page (after its drop handlers), or the pointer back without a button / a key / the window
 * focused again after a drop elsewhere.
 */
export function startDragOut(path: string, event: { preventDefault: () => void }, onEnd: () => void): boolean {
	const app = studioApp();
	if (!app?.startDrag) return false;
	event.preventDefault();
	app.startDrag(path);
	if (typeof window !== "undefined") (window as unknown as { __gzLastDragOut?: string }).__gzLastDragOut = path;
	let done = false;
	const finish = () => {
		if (done) return;
		done = true;
		window.removeEventListener("drop", onDrop, true);
		window.removeEventListener("mousemove", onMove, true);
		window.removeEventListener("pointerdown", finish, true);
		window.removeEventListener("keydown", finish, true);
		window.removeEventListener("focus", finish);
		onEnd();
	};
	const onDrop = () => window.setTimeout(finish, 0);
	const onMove = (e: MouseEvent) => {
		if (e.buttons === 0) finish();
	};
	window.addEventListener("drop", onDrop, true);
	window.addEventListener("mousemove", onMove, true);
	window.addEventListener("pointerdown", finish, true);
	window.addEventListener("keydown", finish, true);
	window.addEventListener("focus", finish);
	return true;
}

if (typeof window !== "undefined") {
	// diagnostics for the e2e test: where an item's drag copy is (null until it is ready)
	(window as unknown as { __gzDragOut?: unknown }).__gzDragOut = { ready: (item: DragOutItem) => dragOutReady(item), path: dragOutPath };
}
