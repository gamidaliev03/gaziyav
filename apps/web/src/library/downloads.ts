"use client";

// The library rows' downloads as the user sees them (like iCloud Photos: everything looks installed): the rows in view
// ask for their files in the background, a row the pointer rests on comes first, a row shows a short progress ring
// while its file comes down, and the cloud mark shows only offline, on what isn't on this Mac.
import { useEffect, useSyncExternalStore } from "react";

type Snapshot = { downloading: Record<string, number>; cached: ReadonlySet<string>; offline: boolean };
let snap: Snapshot = { downloading: {}, cached: new Set(), offline: false };
const listeners = new Set<() => void>();
const watched = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;

function emit(next: Snapshot) {
	snap = next;
	for (const l of listeners) l();
}

async function poll() {
	timer = null;
	const ids = [...watched.keys()].filter((id) => !snap.cached.has(id));
	if (!ids.length) return;
	try {
		const r = await fetch(`/api/library/progress?ids=${ids.map(encodeURIComponent).join(",")}`);
		const d = (await r.json()) as { downloading?: Record<string, number>; cached?: string[]; offline?: boolean };
		const cached = new Set(snap.cached);
		for (const id of d.cached ?? []) cached.add(id);
		emit({ downloading: d.downloading ?? {}, cached, offline: !!d.offline || (typeof navigator !== "undefined" && navigator.onLine === false) });
	} catch {}
	// Fast while something comes down, slow otherwise; stops when no row in view is in the cloud.
	timer = setTimeout(poll, Object.keys(snap.downloading).length ? 300 : 1500);
}

/** Look again soon (▶ or a double-click just started a download). */
export function kickDownloads() {
	if (timer) clearTimeout(timer);
	timer = setTimeout(poll, 120);
}

const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};

/** A row's download: its progress (0…1) while it comes down, whether it is on this Mac now, and whether offline. */
export function useRowDownload(id: string, remote: boolean): { progress: number | null; cached: boolean; offline: boolean } {
	useEffect(() => {
		if (!remote) return;
		watched.set(id, (watched.get(id) ?? 0) + 1);
		if (!timer) timer = setTimeout(poll, 60);
		return () => {
			const n = (watched.get(id) ?? 1) - 1;
			if (n > 0) watched.set(id, n);
			else watched.delete(id);
		};
	}, [id, remote]);
	const s = useSyncExternalStore(subscribe, () => snap, () => snap);
	return { progress: s.downloading[id] ?? null, cached: s.cached.has(id), offline: s.offline };
}

let pending: string[] = [];
let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
/** The rows now in view, in the background (asked once the list stops moving for a moment). */
export function prefetchInView(ids: string[]) {
	pending = ids;
	if (prefetchTimer) clearTimeout(prefetchTimer);
	prefetchTimer = setTimeout(() => {
		const wanted = pending.filter((id) => !snap.cached.has(id));
		if (!wanted.length) return;
		void fetch("/api/library/prefetch-rows", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Studio": "1" },
			body: JSON.stringify({ ids: wanted }),
		})
			.then(() => kickDownloads())
			.catch(() => {});
	}, 250);
}
