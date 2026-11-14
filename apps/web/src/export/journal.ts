// Exports in flight, remembered by the Mac app (GaziyavShell modules/export-save.js: one small file, replaced whole).
// An entry begins when Export is pressed and ends when the export does: saved, failed with its reason on screen, or
// cancelled. A kill, a crash, a power cut or a reload of the page leaves the entry — the next start says the export
// was interrupted and offers it again (export/interrupted.tsx).
import { appExportFile } from "./disk";

/** This load of the page: entries of another load (or of an app that no longer runs) are the interrupted ones. */
const SESSION = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s${Date.now()}${Math.random()}`;

export interface JournalEntry<Request = unknown> {
	id: string;
	session: string;
	/** when it began (ms) */
	at: number;
	projectId: string;
	/** the project's name, for the notice */
	name: string;
	/** what to run again (the page's own description of the export) */
	request: Request;
}

/** Begins an entry; resolves to its id, or null where there is no journal (a browser, an older app). */
export async function journalBegin<Request>(entry: { projectId: string; name: string; request: Request }): Promise<string | null> {
	const journal = appExportFile()?.journal;
	if (!journal) return null;
	try {
		const id = await journal("begin", { ...entry, session: SESSION });
		return typeof id === "string" ? id : null;
	} catch {
		return null;
	}
}

/** An entry's id, or the promise of it (an export never waits for its entry to be written before it starts). */
export type JournalId = string | null | undefined | Promise<string | null>;

export function journalUpdate(entry: JournalId, patch: Record<string, unknown>): void {
	void Promise.resolve(entry).then((id) => (id ? appExportFile()?.journal?.("update", id, patch) : null)).catch(() => {});
}

export function journalEnd(entry: JournalId): void {
	void Promise.resolve(entry).then((id) => (id ? appExportFile()?.journal?.("end", id) : null)).catch(() => {});
}

/** The exports that never reached their end, the newest of each project and file. */
export async function interruptedExports<Request>(): Promise<JournalEntry<Request>[]> {
	const journal = appExportFile()?.journal;
	if (!journal) return [];
	try {
		const list = await journal("interrupted", SESSION);
		return Array.isArray(list) ? (list as JournalEntry<Request>[]).filter((e) => e && typeof e.id === "string" && typeof e.projectId === "string" && e.request) : [];
	} catch {
		return [];
	}
}

/** The interrupted exports this load of the page was told about, by project (their notices are still on screen). */
const noted = new Map<string, string[]>();

export function noteInterrupted(projectId: string, id: string): void {
	noted.set(projectId, [...(noted.get(projectId) ?? []), id]);
}

/** A new export of the project answers what an earlier run left unfinished: those entries end. Returns their ids. */
export function forgetInterrupted(projectId: string): string[] {
	const ids = noted.get(projectId) ?? [];
	noted.delete(projectId);
	for (const id of ids) journalEnd(id);
	return ids;
}
