"use client";

// Client side of the sound library: favourites / recent (kept by the local server next to
// the app data) and building timeline clips from library entries — shared by the «+» button
// and drag-and-drop onto the timeline.
import { useSyncExternalStore } from "react";
import type { CreateLibraryAudioElement, SceneTracks } from "@/timeline";
import { buildLibraryAudioElement } from "@/timeline/element-utils";
import { type MediaTime, mediaTimeFromSeconds, TICKS_PER_SECOND } from "@/wasm";
import type { FavouriteEntry, LibraryKind, LibraryUserState } from "./types";

/** What a list row needs; FavouriteEntry without the timestamp. */
export type LibraryEntry = Omit<FavouriteEntry, "addedAt">;

let state: LibraryUserState = { favourites: [], recent: [] };
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: LibraryUserState) {
	state = next;
	for (const fn of listeners) fn();
}

function ensureLoaded() {
	if (loaded) return;
	loaded = fetch("/api/library/state")
		.then((r) => (r.ok ? r.json() : null))
		.then((data: LibraryUserState | null) => {
			if (data && Array.isArray(data.favourites)) set(data);
		})
		.catch(() => {
			loaded = null; // retry on the next subscriber
		});
}

function subscribe(fn: () => void) {
	listeners.add(fn);
	ensureLoaded();
	return () => listeners.delete(fn);
}

export function useLibraryUserState(): LibraryUserState {
	return useSyncExternalStore(subscribe, () => state, () => state);
}

async function post(path: string, body: unknown) {
	try {
		const r = await fetch(`/api/library/${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Studio": "1" },
			body: JSON.stringify(body),
		});
		const data = (await r.json()) as LibraryUserState & { error?: string };
		if (r.ok && Array.isArray(data.favourites)) set(data);
	} catch {
		// Favourites are a convenience: a failed save must never block editing.
	}
}

export const isFavourite = (s: LibraryUserState, id: string) => s.favourites.some((f) => f.id === id);

export function toggleFavourite(entry: LibraryEntry) {
	const on = !isFavourite(state, entry.id);
	// Optimistic: the star reacts instantly, the server confirms.
	set({
		...state,
		favourites: on
			? [{ ...entry, addedAt: Date.now() }, ...state.favourites]
			: state.favourites.filter((f) => f.id !== entry.id),
	});
	void post("favourite", { entry, on });
}

export function rememberRecent(entry: LibraryEntry) {
	set({
		...state,
		recent: [{ ...entry, addedAt: Date.now() }, ...state.recent.filter((f) => f.id !== entry.id)].slice(0, 30),
	});
	void post("recent", { entry });
}

/** Where the picture ends (seconds): the end of the last video/image/text/graphic clip. */
export function visualEndSeconds(tracks: SceneTracks): number {
	let end = 0;
	for (const track of [tracks.main, ...tracks.overlay]) {
		for (const el of track.elements) end = Math.max(end, el.startTime + el.duration);
	}
	return end / TICKS_PER_SECOND;
}

/**
 * A timeline clip for a library sound. Music ducks under voice by default (UGC ads: the
 * talking head must stay intelligible) and is cut to the end of the video with a short
 * fade-out, so adding a 2-minute track never makes the ad 2 minutes long (drag the clip's
 * edge to get the rest back). Sound effects keep their length and level.
 */
export function buildLibraryClip({
	entry,
	startTime,
	tracks,
}: {
	entry: { url: string; name: string; dur: number; kind: LibraryKind; gain?: number };
	startTime: MediaTime;
	tracks?: SceneTracks;
}): CreateLibraryAudioElement {
	const full = entry.dur > 0 ? entry.dur : 3;
	const element = buildLibraryAudioElement({
		sourceUrl: entry.url,
		name: entry.name,
		duration: mediaTimeFromSeconds({ seconds: full }),
		startTime,
	});
	// the library\'s level (library/gain.ts): the clip\'s volume carries it, so the export has it too
	if (entry.gain) element.params = { ...element.params, volume: entry.gain };
	if (entry.kind !== "music") return element;
	element.params = { ...element.params, duckUnderVoice: true };
	return cutToVideoEnd(element, tracks);
}

/** An imported sound this long is a song, not an effect: it is cut to the video like library music. */
export const SONG_SECONDS = 30;

/**
 * A song ends where the video does, with a 1 s fade-out (drag the clip's edge for the rest). Left whole when there is no
 * video after it (under 2 s of room) or it already fits.
 */
export function cutToVideoEnd<T extends { startTime: MediaTime; duration: MediaTime; trimEnd: MediaTime; params?: Record<string, unknown> }>(
	element: T,
	tracks: SceneTracks | undefined,
): T {
	if (!tracks) return element;
	const full = element.duration / TICKS_PER_SECOND;
	const room = visualEndSeconds(tracks) - element.startTime / TICKS_PER_SECOND;
	if (room < 2 || room >= full - 0.05) return element;
	return {
		...element,
		duration: mediaTimeFromSeconds({ seconds: room }),
		trimEnd: mediaTimeFromSeconds({ seconds: element.trimEnd / TICKS_PER_SECOND + full - room }),
		// fitted to the film: its end follows the film's end from now on (timeline/placement/fit-film.ts, rule D)
		params: { ...element.params, fadeOut: 1, fitFilm: true },
	};
}
