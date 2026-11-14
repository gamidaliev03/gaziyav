// Favourites and recently used sounds, kept next to the app's other data.
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/studio/server/files";
import type { FavouriteEntry, LibraryUserState } from "@/library/types";

const RECENT_MAX = 30;

function file() {
	const dir = path.join(dataDir(), "library");
	fs.mkdirSync(dir, { recursive: true });
	return path.join(dir, "user.json");
}

function read(): { favourites: FavouriteEntry[]; recent: FavouriteEntry[] } {
	try {
		const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
		const list = (v: unknown) =>
			Array.isArray(v) ? (v.filter((e) => typeof e?.id === "string" && typeof e?.url === "string") as FavouriteEntry[]) : [];
		return { favourites: list(raw.favourites), recent: list(raw.recent) };
	} catch {
		return { favourites: [], recent: [] };
	}
}

function write(state: { favourites: FavouriteEntry[]; recent: FavouriteEntry[] }) {
	const f = file();
	fs.writeFileSync(`${f}.tmp`, JSON.stringify(state));
	fs.renameSync(`${f}.tmp`, f);
}

export function getUserState(): LibraryUserState {
	return read();
}

function clean(entry: Partial<FavouriteEntry>): FavouriteEntry | null {
	if (typeof entry?.id !== "string" || typeof entry.url !== "string") return null;
	if (!entry.url.startsWith("/api/library/file/") && !entry.url.startsWith("https://")) return null;
	return {
		id: entry.id.slice(0, 200),
		kind: entry.kind === "music" ? "music" : "sfx",
		name: String(entry.name ?? "").slice(0, 200),
		cat: String(entry.cat ?? "").slice(0, 100),
		dur: Number(entry.dur) || 0,
		url: entry.url.slice(0, 1000),
		addedAt: Date.now(),
	};
}

export function setFavourite(entry: Partial<FavouriteEntry>, on: boolean): LibraryUserState {
	const state = read();
	const e = clean(entry);
	if (e) {
		state.favourites = state.favourites.filter((f) => f.id !== e.id);
		if (on) state.favourites.unshift(e);
		write(state);
	}
	return getUserState();
}

export function addRecent(entry: Partial<FavouriteEntry>): LibraryUserState {
	const state = read();
	const e = clean(entry);
	if (e) {
		state.recent = [e, ...state.recent.filter((f) => f.id !== e.id)].slice(0, RECENT_MAX);
		write(state);
	}
	return getUserState();
}
