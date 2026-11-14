// Crash recovery and backups for projects.
//
// 1. Emergency journal (localStorage, synchronous): written when an autosave fails
//    (e.g. the disk quota is full) and when the window is closed with unsaved
//    edits. localStorage has its own quota and a synchronous API, so it still
//    works during `pagehide` and when IndexedDB is full. Cleared after the next
//    successful save. On the next open of the project the editor offers
//    «Восстановить последнее состояние» when the journal is newer than the save.
// 2. Backups (IndexedDB, last 10 per project): a snapshot when the project is
//    opened, on ⌘S and at most every 2 minutes of editing. Protects against a bad
//    edit or a corrupted save: the home page's «Restore previous version» rolls the
//    project back, and a project that can't be read opens its newest whole copy.
// A save itself is one IndexedDB transaction (one put of the whole project): a crash
// mid-save leaves the previous save, never half of one.
import type { SerializedProject } from "./types";
import { IndexedDBAdapter } from "./indexeddb-adapter";

const JOURNAL_PREFIX = "opencut:recovery:";
export const MAX_BACKUPS_PER_PROJECT = 10;
export const BACKUP_INTERVAL_MS = 2 * 60 * 1000;

export interface RecoveryJournalEntry {
	projectId: string;
	savedAt: number;
	reason: "save-failed" | "unload";
	project: SerializedProject;
}

function hasLocalStorage(): boolean {
	try {
		return typeof localStorage !== "undefined";
	} catch {
		return false;
	}
}

// Durable mirror on the app's local server (fsync'ed file). localStorage is
// synchronous (works during unload) but Chromium persists it lazily, so a
// force-quit of the whole app could lose it; the server copy survives that.
const SERVER_JOURNAL = "/api/studio/journal";
const serverJournalIds = new Set<string>();

function canUseServer(): boolean {
	return typeof window !== "undefined" && typeof fetch === "function";
}

function mirrorToServer({ projectId, raw }: { projectId: string; raw: string }) {
	if (!canUseServer()) return;
	serverJournalIds.add(projectId);
	void fetch(`${SERVER_JOURNAL}/${encodeURIComponent(projectId)}`, {
		method: "POST",
		headers: { "X-Studio": "1", "Content-Type": "text/plain" },
		body: raw,
		// Small journals still arrive while the page unloads.
		keepalive: raw.length < 60_000,
	}).catch(() => {});
}

function parseEntry(raw: string | null): RecoveryJournalEntry | null {
	if (!raw) return null;
	try {
		const entry = JSON.parse(raw) as RecoveryJournalEntry;
		if (!entry?.project?.metadata?.id || typeof entry.savedAt !== "number") {
			return null;
		}
		return entry;
	} catch {
		return null;
	}
}

export function writeRecoveryJournal({
	serialized,
	reason,
}: {
	serialized: SerializedProject;
	reason: RecoveryJournalEntry["reason"];
}): boolean {
	const entry: RecoveryJournalEntry = {
		projectId: serialized.metadata.id,
		savedAt: Date.now(),
		reason,
		project: serialized,
	};
	const raw = JSON.stringify(entry);
	mirrorToServer({ projectId: entry.projectId, raw });
	if (!hasLocalStorage()) return canUseServer();
	try {
		localStorage.setItem(JOURNAL_PREFIX + serialized.metadata.id, raw);
		return true;
	} catch (error) {
		console.error("[recovery] Could not write the recovery journal:", error);
		return canUseServer();
	}
}

/** The newest journal from localStorage or the server copy. */
export async function readRecoveryJournalAnywhere({
	projectId,
}: {
	projectId: string;
}): Promise<RecoveryJournalEntry | null> {
	const local = readRecoveryJournal({ projectId });
	let remote: RecoveryJournalEntry | null = null;
	if (canUseServer()) {
		try {
			const res = await fetch(`${SERVER_JOURNAL}/${encodeURIComponent(projectId)}`, {
				cache: "no-store",
			});
			if (res.ok) {
				remote = parseEntry(await res.text());
				if (remote) serverJournalIds.add(projectId);
			}
		} catch {}
	}
	if (!local) return remote;
	if (!remote) return local;
	return remote.savedAt > local.savedAt ? remote : local;
}

export function readRecoveryJournal({
	projectId,
}: {
	projectId: string;
}): RecoveryJournalEntry | null {
	if (!hasLocalStorage()) return null;
	try {
		return parseEntry(localStorage.getItem(JOURNAL_PREFIX + projectId));
	} catch {
		return null;
	}
}

export function clearRecoveryJournal({ projectId }: { projectId: string }): void {
	if (serverJournalIds.delete(projectId) && canUseServer()) {
		void fetch(`${SERVER_JOURNAL}/${encodeURIComponent(projectId)}`, {
			method: "DELETE",
			headers: { "X-Studio": "1" },
		}).catch(() => {});
	}
	if (!hasLocalStorage()) return;
	try {
		localStorage.removeItem(JOURNAL_PREFIX + projectId);
	} catch {}
}

export interface ProjectBackup {
	projectId: string;
	createdAt: number;
	/** before-join: the project as it was before its timelines became one (project/join-on-open.ts) — never pruned */
	reason: "open" | "periodic" | "save" | "before-restore" | "before-join";
	project: SerializedProject;
}

type BackupRecord = ProjectBackup & { id?: string };

/** In the key of the version kept before joining timelines: never pruned, never the «latest» copy to recover from. */
const JOIN_KEY = "join:";

/** Backup keys are `<project id>:<ms>`: by time, not as text (a 12-digit time sorts before a 13-digit one as text). */
export function byTime(a: string, b: string): number {
	return Number(a.slice(a.lastIndexOf(":") + 1)) - Number(b.slice(b.lastIndexOf(":") + 1));
}

/** Whether a saved project can be opened: its scenes and tracks have the shape the editor needs. */
export function isOpenableProject(serialized: unknown): serialized is SerializedProject {
	const p = serialized as SerializedProject | null;
	if (!p || typeof p !== "object" || !p.metadata || typeof p.metadata.id !== "string") return false;
	// no scenes yet is a project the editor starts (a new one); scenes it has must be whole
	if (p.scenes === undefined || p.scenes === null) return true;
	if (!Array.isArray(p.scenes)) return false;
	return p.scenes.every((scene) => {
		const t = scene?.tracks as { main?: { elements?: unknown }; overlay?: unknown; audio?: unknown } | undefined;
		return !!t && !!t.main && Array.isArray(t.main.elements) && Array.isArray(t.overlay) && Array.isArray(t.audio);
	});
}

class ProjectBackupStore {
	private adapter: IndexedDBAdapter<BackupRecord> | null = null;
	private lastCreatedAt = 0;

	private getAdapter(): IndexedDBAdapter<BackupRecord> {
		if (!this.adapter) {
			this.adapter = new IndexedDBAdapter<BackupRecord>({
				dbName: "opencut-project-backups",
				storeName: "backups",
				version: 1,
			});
		}
		return this.adapter;
	}

	async add({
		serialized,
		reason,
	}: {
		serialized: SerializedProject;
		reason: ProjectBackup["reason"];
	}): Promise<void> {
		const projectId = serialized.metadata.id;
		// two in the same millisecond (⌘S right after opening) would share a key: the later one gets the next one
		const createdAt = Math.max(Date.now(), this.lastCreatedAt + 1);
		this.lastCreatedAt = createdAt;
		const adapter = this.getAdapter();
		await adapter.set({
			key: `${projectId}:${reason === "before-join" ? JOIN_KEY : ""}${createdAt}`,
			value: { projectId, createdAt, reason, project: serialized },
		});
		await this.prune({ projectId });
	}

	async list({ projectId }: { projectId: string }): Promise<ProjectBackup[]> {
		const keys = await this.getAdapter().list();
		const own = keys
			.filter((key) => key.startsWith(`${projectId}:`))
			.sort(byTime)
			.reverse();
		const backups: ProjectBackup[] = [];
		for (const key of own) {
			const record = await this.getAdapter().get(key);
			if (record) {
				const { id: _id, ...backup } = record;
				backups.push(backup);
			}
		}
		return backups;
	}

	async latest({
		projectId,
	}: {
		projectId: string;
	}): Promise<ProjectBackup | null> {
		const keys = (await this.getAdapter().list())
			.filter((key) => key.startsWith(`${projectId}:`) && !key.includes(JOIN_KEY))
			.sort(byTime);
		const last = keys.at(-1);
		if (!last) return null;
		return this.getAdapter().get(last);
	}

	async removeAll({ projectId }: { projectId: string }): Promise<void> {
		const keys = await this.getAdapter().list();
		await Promise.all(
			keys
				.filter((key) => key.startsWith(`${projectId}:`))
				.map((key) => this.getAdapter().remove(key)),
		);
	}

	private async prune({ projectId }: { projectId: string }): Promise<void> {
		// the version kept before the timelines were joined (key `<id>:join:<ms>`) stays: it is the way back from that step
		const keys = (await this.getAdapter().list())
			.filter((key) => key.startsWith(`${projectId}:`) && !key.includes(JOIN_KEY))
			.sort(byTime);
		const excess = keys.length - MAX_BACKUPS_PER_PROJECT;
		if (excess <= 0) return;
		await Promise.all(
			keys.slice(0, excess).map((key) => this.getAdapter().remove(key)),
		);
	}
}

export const projectBackups = new ProjectBackupStore();
