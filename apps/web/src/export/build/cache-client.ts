// The page's side of the kept stretches (the server's: export/server/build-cache.ts). Every call may fail — a server
// that restarts, a full disk — and a failure only means «not kept»: the stretch is rendered.
import { decodeEntry, type EntryHead, type EntryPacket } from "./entry";

const HEADERS = { "x-studio": "1" };

export interface KeptInfo {
	head: EntryHead;
	bytes: number;
}

export interface BuildCache {
	/** what this app build is: part of every key */
	salt: string;
	have: (keys: readonly string[]) => Promise<Map<string, KeptInfo>>;
	get: (key: string) => Promise<{ head: EntryHead; packets: EntryPacket[]; bytes: number } | null>;
	put: (key: string, entry: Uint8Array) => Promise<boolean>;
}

export interface BuildCacheInfo {
	salt: string;
	bytes: number;
	count: number;
	limit: number;
}

export async function buildCacheInfo(clear?: { days?: number }): Promise<BuildCacheInfo | null> {
	try {
		const query = clear?.days ? `?days=${clear.days}` : "";
		const response = await fetch(`/api/export/cache${query}`, { method: clear ? "DELETE" : "GET", headers: HEADERS });
		if (!response.ok) return null;
		const info = (await response.json()) as BuildCacheInfo;
		return typeof info?.salt === "string" ? info : null;
	} catch {
		return null;
	}
}

/** The cache, or null where there is none (a browser without the app's server, an older app). */
export async function openBuildCache(): Promise<BuildCache | null> {
	const info = await buildCacheInfo();
	if (!info) return null;
	return {
		salt: info.salt,
		have: async (keys) => {
			const out = new Map<string, KeptInfo>();
			try {
				// (asked in parts: a two-hour film has a few thousand stretches)
				for (let at = 0; at < keys.length; at += 2000) {
					const response = await fetch("/api/export/cache", { method: "POST", headers: { ...HEADERS, "content-type": "application/json" }, body: JSON.stringify({ keys: keys.slice(at, at + 2000) }) });
					if (!response.ok) break;
					const { have } = (await response.json()) as { have?: Record<string, KeptInfo> };
					for (const [key, value] of Object.entries(have ?? {})) out.set(key, value);
				}
			} catch {}
			return out;
		},
		get: async (key) => {
			try {
				const response = await fetch(`/api/export/cache?key=${key}`, { headers: HEADERS });
				if (!response.ok) return null;
				const bytes = new Uint8Array(await response.arrayBuffer());
				const entry = decodeEntry(bytes);
				return entry && entry.head.key === key ? { ...entry, bytes: bytes.length } : null;
			} catch {
				return null;
			}
		},
		put: async (key, entry) => {
			try {
				const response = await fetch(`/api/export/cache?key=${key}`, { method: "PUT", headers: HEADERS, body: entry as unknown as BodyInit });
				return response.ok && ((await response.json()) as { kept?: boolean }).kept === true;
			} catch {
				return false;
			}
		},
	};
}
