// The page's side of the projects' disk copies (server/project-files.ts). After each save the project and its media
// list follow to a file on the Mac's disk within two seconds (ten for a copy over a megabyte; the newest state wins);
// when the home page lists the projects, one the browser storage has lost (Chromium threw the IndexedDB away after a
// full disk) is written back from its copy — its media files are still in the project's own folder. Only in the Mac
// app (a plain browser and Web Lite have no app server).
import type { MediaAssetData, SerializedProject } from "./types";

const BASE = "/api/project-files";
const GAP_MS = 2000;
/** A big project (hundreds of clips, many media thumbnails) is copied at most every 10 s. */
const BIG_GAP_MS = 10_000;
const BIG_BYTES = 1_000_000;

export interface ProjectDiskCopy {
	v: 1;
	savedAt: number;
	project: SerializedProject;
	media: MediaAssetData[];
}

function enabled(): boolean {
	return typeof window !== "undefined" && typeof fetch === "function" && "studioApp" in window;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const lastAt = new Map<string, number>();
const lastBytes = new Map<string, number>();
const gone = new Set<string>();

async function write(projectId: string, read: () => Promise<ProjectDiskCopy | null>): Promise<void> {
	lastAt.set(projectId, Date.now());
	const copy = await read().catch(() => null);
	if (!copy || gone.has(projectId)) return;
	const body = JSON.stringify(copy);
	lastBytes.set(projectId, body.length);
	await fetch(`${BASE}/${encodeURIComponent(projectId)}`, {
		method: "POST",
		headers: { "X-Studio": "1", "Content-Type": "text/plain" },
		body,
	}).catch(() => {});
}

/** After a save: the copy is written now, or 2 s after the last one with what is saved by then. */
export function copyToDiskSoon(projectId: string, read: () => Promise<ProjectDiskCopy | null>): void {
	if (!enabled()) return;
	gone.delete(projectId);
	if (timers.has(projectId)) return;
	const gap = (lastBytes.get(projectId) ?? 0) > BIG_BYTES ? BIG_GAP_MS : GAP_MS;
	const wait = Math.max(0, (lastAt.get(projectId) ?? 0) + gap - Date.now());
	timers.set(
		projectId,
		setTimeout(() => {
			timers.delete(projectId);
			void write(projectId, read);
		}, wait),
	);
}

/** The project was deleted for good: its copy goes too (a pending one is never written). */
export function removeDiskCopy(projectId: string): void {
	if (!enabled()) return;
	gone.add(projectId);
	const timer = timers.get(projectId);
	if (timer) clearTimeout(timer);
	timers.delete(projectId);
	void fetch(`${BASE}/${encodeURIComponent(projectId)}`, { method: "DELETE", headers: { "X-Studio": "1" } }).catch(() => {});
}

function parse(raw: string): ProjectDiskCopy | null {
	try {
		const copy = JSON.parse(raw) as ProjectDiskCopy | null;
		return copy?.project?.metadata?.id ? copy : null;
	} catch {
		return null;
	}
}

/** One project's copy, or null. */
export async function readDiskCopy(projectId: string): Promise<ProjectDiskCopy | null> {
	if (!enabled()) return null;
	const raw = await fetch(`${BASE}/${encodeURIComponent(projectId)}`, { cache: "no-store" })
		.then((res) => (res.ok ? res.text() : "null"))
		.catch(() => "null");
	return parse(raw);
}

/** The projects that have a copy on disk; null when the app server can't be asked (then nothing is decided). */
export async function listDiskCopies(): Promise<Set<string> | null> {
	if (!enabled()) return null;
	const list = (await fetch(BASE, { cache: "no-store" })
		.then((res) => (res.ok ? res.json() : null))
		.catch(() => null)) as Array<{ id: string; savedAt: number }> | null;
	return Array.isArray(list) ? new Set(list.map((entry) => entry.id).filter((id) => !gone.has(id))) : null;
}

/** A copy written now (a project from an older version that has none yet). */
export async function writeDiskCopyNow(projectId: string, read: () => Promise<ProjectDiskCopy | null>): Promise<void> {
	if (!enabled() || timers.has(projectId)) return;
	await write(projectId, read);
}
