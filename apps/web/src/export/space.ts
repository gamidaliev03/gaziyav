// A full disk in an export's words (render, 11.11): how much is missing — before the export starts and at the moment
// the disk fills up — and waiting for the space to come back instead of failing. The numbers come from the Mac app
// (GaziyavShell modules/export-ipc.js: room per volume, free bytes where the file grows).
import { t } from "@/i18n";

/** What a write that hit a full disk says, whoever reports it (Node, Chromium's storage, ffmpeg). */
export const DISK_FULL = /ENOSPC|no space left|QuotaExceeded|disk is full/i;

export const isDiskFull = (error: unknown): boolean => DISK_FULL.test(error instanceof Error ? error.message : typeof error === "string" ? error : "");

/** «640 KB», «48 MB», «1.2 GB». */
export function sizeText(bytes: number): string {
	const b = Math.max(0, bytes);
	if (b < 1_000_000) return `${Math.max(1, Math.round(b / 1000))} KB`;
	if (b < 1_000_000_000) return `${(b / 1_000_000).toFixed(b < 10_000_000 ? 1 : 0)} MB`;
	return `${(b / 1_000_000_000).toFixed(1)} GB`;
}

export interface Room {
	ok: boolean;
	needBytes?: number;
	freeBytes?: number;
	shortBytes?: number;
	folder?: string;
}

/** Before the export starts: what it needs, what is free, how much is missing. */
export function noRoomText(room: Room, fallbackBytes: number): string {
	const need = room.needBytes ?? fallbackBytes;
	const free = room.freeBytes ?? 0;
	const short = room.shortBytes ?? Math.max(0, need - free);
	return t("Not enough space on the disk: this export needs about {need}, {free} is free — {short} more is needed. Free some space, choose another folder or a lower quality, then try again.", {
		need: sizeText(need),
		free: sizeText(free),
		short: sizeText(short),
	});
}

/** The disk filled up while the export ran: the line its job shows while it waits. */
export function waitingForSpaceText(shortBytes: number | null): string {
	return shortBytes && shortBytes > 0
		? t("The disk is full: {short} more is needed. Free some space — the export goes on by itself.", { short: sizeText(shortBytes) })
		: t("The disk is full. Free some space — the export goes on by itself.");
}

/** How much is still missing for an export of about `totalBytes` that has `writtenBytes` on the disk and `freeBytes` left. */
export function shortBytes({ totalBytes, writtenBytes, freeBytes, chunkBytes = 0 }: { totalBytes: number; writtenBytes: number; freeBytes: number | null; chunkBytes?: number }): number | null {
	if (freeBytes === null) return null;
	// what is left to write, with a little air; never less than the piece that just failed
	const left = Math.max(chunkBytes, Math.round(Math.max(0, totalBytes - writtenBytes) * 1.05) + 32 * 1024 * 1024);
	return Math.max(chunkBytes, left - freeBytes);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `attempt` again and again while it fails because the disk is full: the export waits for space instead of ending.
 * `onWaiting(true)` when the wait begins (each failed try), `onWaiting(false)` when it is over. Any other failure, or
 * `isCancelled()`, ends the wait with that error.
 */
export async function whileDiskIsFull<T>(attempt: () => Promise<T>, { onWaiting, isCancelled, retryMs = 2500 }: { onWaiting: (waiting: boolean, error?: unknown) => void | Promise<void>; isCancelled?: () => boolean; retryMs?: number }): Promise<T> {
	let waited = false;
	for (;;) {
		try {
			const value = await attempt();
			if (waited) await onWaiting(false);
			return value;
		} catch (error) {
			if (!isDiskFull(error) || isCancelled?.()) {
				if (waited) await onWaiting(false);
				throw error;
			}
			waited = true;
			await onWaiting(true, error);
			for (let slept = 0; slept < retryMs; slept += 250) {
				if (isCancelled?.()) {
					await onWaiting(false);
					throw error;
				}
				await sleep(250);
			}
		}
	}
}
