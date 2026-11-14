"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { resolveInOutRange, useInOutStore } from "@/in-out/store";
import { TICKS_PER_SECOND } from "@/wasm";
import { ArrowDown01Icon, TransitionTopIcon } from "@hugeicons/core-free-icons";
import { fold, HugeiconsIcon } from "@/components/ui/icon";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type CaptionFileFormat, captionCues, captionFileText } from "@/subtitles/export-file";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Checkbox } from "@/components/ui/checkbox";
import { frameRateToFloat } from "@/fps/utils";
import { cn } from "@/utils/ui";
import { downloadBuffer, type ExportOptions } from "@/export";
import { Copy01Icon, Download04Icon, Edit03Icon, FolderOpenIcon, RefreshIcon, Tick02Icon, Video01Icon } from "@hugeicons/core-free-icons";
import type { ExportQuality } from "@/export";
import { useEditor } from "@/editor/use-editor";
import type { EditorCore } from "@/core";
import { Input } from "@/components/ui/input";
import { EXPORT_PLATFORMS, type ExportPlatform, type ExportPlatformId, platformsFor } from "@/export/defaults";
import { type ExportFallbackNote, downloadFromServer, keptFileOf, placeOnServer, playExportChime, saveToFolder, type TranscodeJob, transcodeOnServer } from "@/export/deliver";
import { coverFrames, coverSeconds, exactRate, framesAt } from "@/export/frame-count";
import { type AppExportFile, type DiskWaiting, diskWriter } from "@/export/disk";
import { forgetInterrupted, journalBegin, journalEnd, type JournalId, journalUpdate } from "@/export/journal";
import { announceProvenExport } from "@/export/proven";
import { DISK_FULL, isDiskFull, noRoomText, shortBytes, sizeText, waitingForSpaceText, whileDiskIsFull } from "@/export/space";
import { renderStillFrame, type StillFramePainter, stillFramePainter } from "@/export/still-frame";
import {
	AUDIO_EXTENSION,
	AUDIO_MIME,
	type AudioFileFormat,
	EXPORT_CODECS,
	EXPORT_RESOLUTIONS,
	type ExportCodec,
	type ExportColor,
	type ExportContainer,
	type ExportTarget,
	contentBits,
	encodedInPage,
	fileExtension,
	isProRes,
	masterBitrate,
	normalizeTarget,
	outputSize,
	pageEncode,
	resolutionLabel,
	resolutionOf,
} from "@/export/target";
import { t, useLang, useT } from "@/i18n";
import { etaSeconds, formatDuration, type Job, jobCenter, useJobsStore } from "@/jobs/store";
import { shotCuts } from "@/export/shot-cuts";
import { takeEncoderFallbacks } from "@/export/encoder-config";
import { sizeInFormat } from "@/preview/canvas-format";
import { appPrefs } from "@/settings/app-prefs";
import { insertCaptionChunksAsTextTrack } from "@/subtitles/insert";
// The caption editor in the right panel registers with the editor (this header loads with every project).
import "@/subtitles/inspector";
import type { TimelineElement } from "@/timeline";
import { generateLocalCaptions } from "@/transcribe/captions";
import { adLabelText, isEridToken, placeAdLabel } from "./export/ad-label";
import { estimateWavBytes, renderTimelineWav } from "./export/audio-wav";
import { exportSaveName, sameSavedName } from "./export/file-name";
import { type ExportManifest, saveManifest } from "./export/manifest";
import { rememberExport } from "./share-button";
import { useShellStore } from "./shell-store";
import { lookAtWrittenExport } from "./export/check-written";
import {
	type ExportPrefs,
	estimateExportBytes,
	exportFileBase,
	formatBytes,
	formatLength,
	NAME_TOKENS,
	type PlatformIssues,
	platformIssues,
	readExportPrefs,
	resolveFileName,
	suggestPlatform,
	videoBitrate,
	writeExportPrefs,
} from "./export-prefs";

const EXPORT_JOB = "export";

interface DownloadInfo {
	name: string;
	path: string;
	state: "completed" | "cancelled" | "interrupted";
	/** an interrupted save: "folder" when the folder can't be written, "space" when its disk is full (the shell's export-ipc.js) */
	reason?: "folder" | "space";
	/** a full disk: what the file needs there and what is free */
	needBytes?: number;
	freeBytes?: number;
}

/** What the manifest knows before the file exists; its name and size are added once it is saved. */
// probeOnly: no manifest file was asked for; the draft only tells the check of the written file what to expect
type ManifestDraft = Omit<ExportManifest, "file" | "bytes"> & { probeOnly?: boolean };

type StudioApp = {
	onDownload?: (cb: (info: DownloadInfo) => void) => () => void;
	reveal?: (file: string) => void;
	platform?: string;
	notify?: (title: string, body: string) => void;
	pickFolder?: (title: string) => Promise<string | null>;
	exportFile?: Partial<AppExportFile>;
};

/** A render that went straight to a file of the app (a long video doesn't fit in the page's memory). */
type DiskRender = { disk: string; bytes: number };
const studioApp = () => (typeof window === "undefined" ? undefined : (window as unknown as { studioApp?: StudioApp }).studioApp);

/** The journal entry (export/journal.ts) of the export a line belongs to: ended when the export ends, whatever the end. */
type Journal = JournalId;

/**
 * No silent fallback (exp2, 14.11): a step of the export that did not work and was replaced by a plainer one — «Smooth
 * frames», AI upscale, the hardware encoder, the AAC encoder, the fast assembly — writes one flight-recorder line and
 * the finished export says it in one short sentence (the done window and the job line). Per job line.
 */
const fallbackNotes = new Map<string, ExportFallbackNote[]>();
const FALLBACK_TEXT: Record<ExportFallbackNote["step"], string> = {
	smooth: "Smooth frames didn't work — simple interpolation",
	upscale: "AI upscale didn't work — ordinary enlargement",
	hardware: "Hardware encoding didn't work — software encoder",
	aac: "AAC isn't available — the sound is Opus",
	build: "Fast assembly didn't work — full render",
};
export const fallbackSentences = (jobId: string): Array<{ step: ExportFallbackNote["step"]; text: string }> =>
	(fallbackNotes.get(jobId) ?? []).map((note) => ({ step: note.step, text: t(FALLBACK_TEXT[note.step]) }));
function noteFallbacks(list: ExportFallbackNote[] | undefined, jobId = EXPORT_JOB) {
	if (!list?.length) return;
	const had = fallbackNotes.get(jobId) ?? [];
	const fresh = list.filter((note) => !had.some((h) => h.step === note.step));
	if (!fresh.length) return;
	fallbackNotes.set(jobId, [...had, ...fresh]);
	const app = typeof window === "undefined" ? undefined : (window as unknown as { studioApp?: { diag?: (batch: unknown[]) => void } }).studioApp;
	try {
		app?.diag?.(fresh.map((note) => ({ k: "job-failed", job: `export-${note.step}`, reason: `fallback: ${note.reason}` })));
	} catch {}
	for (const note of fresh) console.warn(`[export] fallback ${note.step}: ${note.reason}`);
}
/** Test harness: steps made to fail on purpose (honoured by the server only in a test app). */
const forcedFallbacks = (): Array<"smooth" | "upscale" | "hardware"> => {
	const list = typeof window === "undefined" ? null : (window as unknown as { __exportForce?: unknown }).__exportForce;
	return Array.isArray(list) ? list.filter((x): x is "smooth" | "upscale" | "hardware" => x === "smooth" || x === "upscale" || x === "hardware") : [];
};

/** The file is on disk: the job says where, with Show in Finder; Share learns of it; the chime and the Mac notification (Settings). */
function exportSaved(projectId: string, filePath: string, bytes: number, manifest?: ManifestDraft, jobId = EXPORT_JOB, journal?: Journal) {
	// the written file is looked at first: «Done» only for a file that is whole (IDEAL reliable §4). The line stays as it
	// is meanwhile — running, its bar full — and ends once, at the look's answer: finished first and set running again
	// here, the Dock bar went full → gone → full → gone at the end of every export (exp, 14.11).
	if (useJobsStore.getState().jobs.find((j) => j.id === jobId)?.status === "running") jobCenter.update(jobId, { stage: "Checking the file", progress: 1, eta: null, cancel: undefined });
	void lookAtWrittenExport(filePath, manifest).then(({ problem, verified }) => {
		journalEnd(journal);
		if (!problem) return exportDone(projectId, filePath, bytes, manifest, jobId, verified);
		const app = studioApp();
		jobCenter.update(jobId, {
			status: "error",
			message: t("The exported file is not right: {what}", { what: problem }),
			messageDetail: filePath,
			messageTitle: filePath,
			reveal: () => app?.reveal?.(filePath),
			revealLabel: app?.platform === "win32" ? t("Show in Explorer") : t("Show in Finder"),
			endedAt: Date.now(),
		});
	});
}
function exportDone(projectId: string, filePath: string, bytes: number, manifest?: ManifestDraft, jobId = EXPORT_JOB, verified = false) {
	const app = studioApp();
	const windows = app?.platform === "win32";
	const slash = windows ? Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")) : filePath.lastIndexOf("/");
	const file = filePath.slice(slash + 1);
	const said = fallbackSentences(jobId).map((note) => note.text);
	const detail = `${t("in {folder}", { folder: windows ? shortWindowsFolder(filePath.slice(0, slash)) : shortFolder(filePath.slice(0, slash)) })}${bytes ? ` · ${formatBytes(bytes)}` : ""}${said.length ? ` · ${said.join(" · ")}` : ""}`;
	if (manifest && !manifest.probeOnly) {
		const { probeOnly: _probe, ...fields } = manifest;
		void saveManifest(filePath, { ...fields, file, bytes }).then((saved) =>
			jobCenter.update(jobId, { messageDetail: `${detail} · ${saved ? t("manifest saved") : t("manifest not saved")}` }),
		);
	}
	// Video and sound saved by one export: the job names both (the sound's line replaced the video's — targeted test
	// 05.11). A new export starts the job again (running), so an earlier run's file is never joined in.
	const earlier = useJobsStore.getState().jobs.find((job) => job.id === jobId);
	const earlierFile = earlier?.status === "done" && earlier.messageTitle && earlier.messageTitle !== filePath ? earlier.messageTitle.split(/[\\/]/).pop() : null;
	jobCenter.update(jobId, {
		status: "done",
		message: earlierFile ? t("Saved {file}", { file: `${earlierFile} + ${file}` }) : t("Saved {file}", { file }),
		messageDetail: detail,
		messageTitle: filePath,
		reveal: () => app?.reveal?.(filePath),
		revealLabel: windows ? t("Show in Explorer") : t("Show in Finder"),
		retry: undefined,
		cancel: undefined,
		stage: undefined,
		progress: 1,
		seen: false,
		endedAt: Date.now(),
	});
	rememberExport(projectId, filePath);
	announceExport(file);
	// The file is saved AND looked at (checkWrittenExport passed): whatever celebrates a finished film — a premiere of
	// the saved file, retain-2026-11 B1 — starts from here, never from a file that failed its check (export/proven.ts).
	if (verified) announceProvenExport({ projectId, path: filePath, bytes });
}

function announceExport(file: string) {
	const prefs = appPrefs();
	if (prefs.exportSound) playExportChime();
	if (prefs.notifications) studioApp()?.notify?.("Export done", file);
}

/**
 * Exports whose Save dialog is still open (or whose chosen place waits for room on its disk), each with the job line it
 * writes to. The next export moves a finished job's line aside (keepFinishedExport), and the dialog's answer must
 * follow it there — not land in the new export's line (check-export E4: the first export stayed at «Choose where to
 * save…» for ever, the second got its «Saved»).
 */
const pendingSaves = new Set<{ jobId: string }>();

/**
 * The Save dialog's answer for `filename`: saved (Show in Finder) or closed (Save again, no re-render). A place on a
 * full disk is not an end: the line says how much is missing and the file is saved there by itself when there is room.
 * `again(true)` saves to the place chosen last time, with no dialog.
 */
function watchDownload(projectId: string, filename: string, bytes: number, again: (samePlace?: boolean) => void, manifest?: ManifestDraft, jobId = EXPORT_JOB, journal?: Journal, waiting = false) {
	const line = { jobId };
	// The file is made: the line is «done» while the dialog is open — also after «Save again» on a closed dialog (the
	// line was «error», and the chip kept saying «Export failed» while the person was saving); the chip's own Retry
	// removes the line before it calls back, so it is made again here.
	if (!waiting) jobCenter.upsert(line.jobId, { kind: "export", title: "Export", status: "done", message: t("Choose where to save {file}", { file: filename }), messageDetail: undefined, retry: undefined });
	const app = studioApp();
	if (!app?.onDownload) {
		journalEnd(journal);
		jobCenter.update(line.jobId, { message: t("Saved {file}", { file: filename }), messageDetail: formatBytes(bytes) });
		announceExport(filename);
		return;
	}
	pendingSaves.add(line);
	const saveAgain = () => {
		again();
		watchDownload(projectId, filename, bytes, again, manifest, line.jobId, journal);
	};
	const off = app.onDownload((info) => {
		// Chromium's own version of the name (" * ? < > | become _): still this export
		if (!sameSavedName(info.name, filename)) return;
		off();
		pendingSaves.delete(line);
		if (info.state === "completed") exportSaved(projectId, info.path, bytes, manifest, line.jobId, journal);
		else if (info.state === "interrupted" && info.reason === "space") {
			// The disk of the chosen place is full: the made file is kept, and tried again every few seconds.
			const short = Math.max(0, (info.needBytes ?? bytes) - (info.freeBytes ?? 0));
			let stopped = false;
			// (the line is still this export's while it waits: a new export moves it aside, see keepFinishedExport)
			pendingSaves.add(line);
			const timer = window.setTimeout(() => {
				pendingSaves.delete(line);
				if (stopped) return;
				again(true);
				watchDownload(projectId, filename, bytes, again, manifest, line.jobId, journal, true);
			}, SPACE_RETRY_MS);
			jobCenter.upsert(line.jobId, {
				kind: "export",
				title: "Export",
				status: "running",
				stage: waitingForSpaceText(short || null),
				progress: undefined,
				message: undefined,
				messageDetail: undefined,
				retry: undefined,
				cancel: () => {
					stopped = true;
					window.clearTimeout(timer);
					pendingSaves.delete(line);
					journalEnd(journal);
					jobCenter.fail(line.jobId, t("The video wasn't saved: the disk is full."));
					jobCenter.update(line.jobId, { retry: saveAgain });
				},
			});
		} else {
			journalEnd(journal);
			jobCenter.fail(
				line.jobId,
				info.state === "cancelled"
					? t("The video wasn't saved: the save dialog was closed.")
					: info.reason === "folder"
						? t("That folder can't be written — save the video to another folder.")
						: t("Saving the file failed — check free disk space and save again."),
			);
			jobCenter.update(line.jobId, { retry: saveAgain });
		}
	});
}
/** How often a save that found its disk full is tried again. */
const SPACE_RETRY_MS = 3000;

/**
 * Runs a step of saving (a move to another disk, the encoder's pass); while it fails because the disk is full, the job
 * says how much is missing and the step is tried again by itself. Cancel ends the wait.
 */
function throughFullDisk<T>(step: () => Promise<T>, { bytes, folder, signal, stage }: { bytes: number; folder?: string; signal?: AbortSignal; stage: string }): Promise<T> {
	return whileDiskIsFull(step, {
		isCancelled: () => !!signal?.aborted,
		retryMs: SPACE_RETRY_MS,
		onWaiting: async (waiting) => {
			if (!waiting) {
				jobCenter.update(EXPORT_JOB, { stage });
				return;
			}
			const room = await studioApp()
				?.exportFile?.room?.(bytes, folder ?? null)
				.catch(() => null);
			const short = room?.freeBytes != null ? Math.max(0, bytes - room.freeBytes) : 0;
			jobCenter.update(EXPORT_JOB, { stage: waitingForSpaceText(short || null) });
		},
	});
}

/** A file the page holds in memory, written to a file of the Mac app (so it is saved like a long render: one rename). */
async function bufferToDisk(file: Partial<AppExportFile>, buffer: ArrayBuffer, where: { folder: string; filename: string } | null, signal?: AbortSignal): Promise<DiskRender | null> {
	if (!file.open || !file.write || !file.discard) return null;
	let id: string | null = null;
	try {
		id = await file.open(where);
		const writer = diskWriter({
			id,
			app: { write: file.write, space: file.space },
			isCancelled: () => !!signal?.aborted,
			onWaiting: (waiting) => jobCenter.update(EXPORT_JOB, { stage: waiting ? waitingForSpaceText(shortBytes({ totalBytes: buffer.byteLength, ...waiting })) : "Saving the file" }),
		});
		const PIECE = 16 * 1024 * 1024;
		for (let at = 0; at < buffer.byteLength; at += PIECE) await writer.write(at, new Uint8Array(buffer.slice(at, Math.min(buffer.byteLength, at + PIECE))));
		return { disk: id, bytes: buffer.byteLength };
	} catch (error) {
		if (id) void file.discard(id).catch(() => {});
		if (signal?.aborted || isDiskFull(error)) throw error;
		return null;
	}
}

/**
 * Hands a file the page made to its place: the «Export to» folder, or the Save dialog. The Mac app reports where it
 * went: the job then offers "Show in Finder". A closed dialog keeps the file, so "Save again" does not render again.
 * The file is never written under its final name: it gets it by one rename when it is whole (export/disk.ts).
 */
async function saveRendered(projectId: string, rendered: ArrayBuffer | DiskRender, asked: string, mimeType: string, manifest?: ManifestDraft, folder?: string, extra: { journal?: Journal; signal?: AbortSignal } = {}) {
	// as it can be saved: no characters Chromium changes, within the file-name limit, its extension kept
	const filename = exportSaveName(asked);
	const file = studioApp()?.exportFile;
	let buffer = rendered;
	if (buffer instanceof ArrayBuffer && file && (folder ? file.moveTo : file.save)) {
		jobCenter.update(EXPORT_JOB, { stage: "Saving the file" });
		buffer = (await bufferToDisk(file, buffer, folder ? { folder, filename } : null, extra.signal)) ?? buffer;
	}
	if (!(buffer instanceof ArrayBuffer)) {
		const { disk, bytes } = buffer;
		if (folder && file?.moveTo) {
			const moveTo = file.moveTo;
			jobCenter.update(EXPORT_JOB, { stage: "Saving the file" });
			const saved = await throughFullDisk(() => moveTo(disk, folder, filename), { bytes, folder, signal: extra.signal, stage: "Saving the file" });
			exportSaved(projectId, saved, bytes, manifest, EXPORT_JOB, extra.journal);
			return;
		}
		jobCenter.finish(EXPORT_JOB);
		const again = (samePlace?: boolean) => void file?.save?.(disk, filename, samePlace);
		again();
		watchDownload(projectId, filename, bytes, again, manifest, EXPORT_JOB, extra.journal);
		return;
	}
	if (folder) {
		jobCenter.update(EXPORT_JOB, { stage: "Saving the file" });
		const saved = await saveToFolder({ data: buffer, folder, name: filename });
		exportSaved(projectId, saved, buffer.byteLength, manifest, EXPORT_JOB, extra.journal);
		return;
	}
	jobCenter.finish(EXPORT_JOB);
	const held = buffer;
	const again = () => downloadBuffer({ buffer: held, filename, mimeType });
	again();
	watchDownload(projectId, filename, buffer.byteLength, again, manifest, EXPORT_JOB, extra.journal);
}

/** What a second pass makes, as a name: its speed on this Mac is remembered under it. */
function passKindOf(job: TranscodeJob): string {
	if ("audio" in job) return `audio:${job.audio}`;
	const { target } = job;
	return `${target.container}:${target.codec}:${target.width}x${target.height}:${target.fps}:${target.bitDepth}:${target.hardware ? "hw" : "sw"}`;
}
const PASS_SPEED_KEY = "gaziyav.export.passSpeed";
/** Seconds the pass took per second of video, the last time this Mac made such a file; null: never measured. */
function passSpeed(kind: string): number | null {
	try {
		const value = (JSON.parse(localStorage.getItem(PASS_SPEED_KEY) || "{}") as Record<string, number>)[kind];
		return typeof value === "number" && value > 0 ? value : null;
	} catch {
		return null;
	}
}
function notePassSpeed(kind: string, value: number) {
	try {
		const all = JSON.parse(localStorage.getItem(PASS_SPEED_KEY) || "{}") as Record<string, number>;
		localStorage.setItem(PASS_SPEED_KEY, JSON.stringify({ ...all, [kind]: Math.round(value * 10000) / 10000 }));
	} catch {}
}

/** The ffmpeg pass (HEVC, AV1, ProRes, GIF, HDR, MP3 …): into the folder, or held by the app for the Save dialog. */
async function transcodeAndSave(input: {
	projectId: string;
	data: ArrayBuffer | DiskRender;
	job: Parameters<typeof transcodeOnServer>[0]["job"];
	filename: string;
	stage: string;
	share: number;
	seconds: number;
	folder?: string;
	signal: AbortSignal;
	manifest?: ManifestDraft;
	journal?: Journal;
}) {
	jobCenter.update(EXPORT_JOB, { stage: input.stage, progress: 1 - input.share, eta: null });
	const filename = exportSaveName(input.filename);
	const file = studioApp()?.exportFile;
	// The pass's time left from its own speed (the encoder reports how far into the film it is). With AI upscale or
	// frame interpolation before it the steps differ in speed: no time is said rather than a guessed one.
	const steady = "audio" in input.job || !(input.job.upscale || input.job.smooth);
	let passStarted = performance.now();
	const master = input.data instanceof ArrayBuffer ? null : input.data;
	const from = master ? await file?.path?.(master.disk) : undefined;
	// A full disk under the encoder's own file: the pass waits for room and runs again from the master. A file that is
	// made and only can't reach its folder (that disk is full) is kept by the server and placed when there is room —
	// never encoded twice.
	let kept: ReturnType<typeof keptFileOf> = null;
	const folder = input.folder;
	const result = await throughFullDisk<{ path: string; id?: string; bytes: number }>(
		async () => {
			if (kept && folder) return { path: await placeOnServer({ id: kept.id, folder, name: filename }), bytes: kept.bytes };
			try {
				const force = "target" in input.job ? forcedFallbacks() : [];
				const made = await transcodeOnServer({
					onStage: (stage) => jobCenter.update(EXPORT_JOB, { stage }),
					data: input.data instanceof ArrayBuffer ? input.data : undefined,
					from,
					job: force.length && "target" in input.job ? { ...input.job, force } : input.job,
					name: filename,
					folder,
					seconds: input.seconds,
					signal: input.signal,
					onProgress: (p) => {
						const elapsed = (performance.now() - passStarted) / 1000;
						jobCenter.update(EXPORT_JOB, { progress: 1 - input.share + p * input.share, eta: steady && p > 0.03 && p < 1 && elapsed > 2 ? { seconds: (elapsed / p) * (1 - p), at: Date.now() } : null });
					},
				});
				noteFallbacks(made.fallbacks);
				return made;
			} catch (error) {
				kept = keptFileOf(error);
				// (a pass that runs again after a full disk is timed from its own start)
				passStarted = performance.now();
				throw error;
			}
		},
		{ bytes: master?.bytes ?? (input.data instanceof ArrayBuffer ? input.data.byteLength : 0), folder, signal: input.signal, stage: input.stage },
	);
	if (steady && !kept && input.seconds > 0) notePassSpeed(passKindOf(input.job), (performance.now() - passStarted) / 1000 / input.seconds);
	if (master) void file?.discard?.(master.disk);
	if (!result.id) {
		exportSaved(input.projectId, result.path, result.bytes, input.manifest, EXPORT_JOB, input.journal);
		return;
	}
	jobCenter.finish(EXPORT_JOB);
	const id = result.id;
	const held = result.path;
	// (the Mac app places the server's file by one rename; a browser downloads it)
	const again = (samePlace?: boolean) => (file?.saveFrom ? void file.saveFrom(held, filename, samePlace) : downloadFromServer(id, filename));
	again();
	watchDownload(input.projectId, filename, result.bytes, again, input.manifest, EXPORT_JOB, input.journal);
}

/** C:\Users\Name\Videos → "Videos": the last folder, full path in the tooltip. */
function shortWindowsFolder(folder: string): string {
	const text = folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;
	return text.length <= 32 ? text : `${text.slice(0, 12)}…${text.slice(-18)}`;
}

/** "~/Movies", "Downloads", "…/Client A/June" — short enough for one line, full path in the tooltip. */
function shortFolder(folder: string): string {
	const home = folder.match(/^\/Users\/[^/]+/)?.[0];
	let text = home ? `~${folder.slice(home.length)}` : folder;
	if (!home) text = folder.split("/").filter(Boolean).pop() ?? folder;
	if (text.length <= 32) return text;
	return `${text.slice(0, 12)}…${text.slice(-18)}`;
}

function exportErrorText(error: string | undefined): string {
	const reason = error?.trim();
	if (reason && DISK_FULL.test(reason)) return "The disk is full: free some space or choose another folder, then export again.";
	if (!reason || /^unknown/i.test(reason)) {
		return "Couldn't render the video. Check that every clip on the timeline still plays, then export again.";
	}
	return reason
		? `Couldn't render the video: ${reason}`
		: "Couldn't render the video. Make sure the timeline has clips, then try again.";
}

/** The video is made, only saving it failed (a folder that is gone with its disk, a full disk). */
function saveErrorText(error: string | undefined): string {
	const reason = error?.trim();
	if (reason && DISK_FULL.test(reason)) return "The disk is full: free some space or choose another folder, then export again.";
	return reason ? `Couldn't save the video: ${reason}` : "Couldn't save the video. Try again.";
}

/**
 * CapCut's background export: one export renders at a time; the next waits («Waiting to export») and starts by
 * itself. Each finished one keeps its own line in the job chip (Show in Finder).
 */
interface QueuedExport {
	id: string;
	projectId: string;
	name: string;
	run: (journal: Journal) => Promise<void>;
	/** Its entry in the journal of exports in flight (export/journal.ts), from the press of Export. */
	journal: Journal;
}
const waiting: QueuedExport[] = [];
let exportRunning = false;
/** The line's stage while the project is saved before an export starts. */
const SAVING_FIRST = "Saving the project";
let queueCount = 0;

/**
 * What an export was asked to make, as plain data: kept in the journal while it runs, so an export cut short by a
 * kill, a crash or a power cut can be offered again at the next start exactly as it was (runExportRequest).
 */
export type ExportRequest =
	| { kind: "video"; options: Omit<ExportOptions, "cover" | "toFile">; cover?: { dataUrl: string; seconds: number }; delivery: Delivery; captions: boolean; manifest?: ManifestDraft }
	| { kind: "audio"; input: { range?: { start: number; end: number }; normalize: boolean; targetLufs?: number }; fileBase: string; format: AudioFileFormat; folder?: string; manifest?: ManifestDraft };

/** The cover's picture as text (it lives only in memory): a PNG, or a JPEG when the PNG is too large for the journal. */
function coverData(cover: NonNullable<ExportOptions["cover"]>): { dataUrl: string; seconds: number } | undefined {
	try {
		const canvas = document.createElement("canvas");
		canvas.width = cover.image.width;
		canvas.height = cover.image.height;
		canvas.getContext("2d")?.drawImage(cover.image, 0, 0);
		const tooLong = (text: string) => text.length > 6_000_000;
		let dataUrl = canvas.toDataURL("image/png");
		if (tooLong(dataUrl)) dataUrl = canvas.toDataURL("image/jpeg", 0.95);
		if (tooLong(dataUrl)) return undefined;
		return { dataUrl, seconds: cover.seconds };
	} catch {
		return undefined;
	}
}

function videoRequest(options: ExportOptions, delivery: Delivery, captions: boolean, manifest?: ManifestDraft): ExportRequest {
	const { cover, toFile: _toFile, ...plain } = options;
	return { kind: "video", options: plain, ...(cover ? { cover: coverData(cover) } : {}), delivery, captions, manifest };
}

function enqueueExport(editor: EditorCore, name: string, run: (journal: Journal) => Promise<void>, { quiet = false, request }: { quiet?: boolean; request?: ExportRequest } = {}) {
	const projectId = editor.project.getActiveOrNull()?.metadata.id ?? "";
	// (written in the background: the export itself never waits for its entry)
	const journal: Journal = request ? journalBegin({ projectId, name, request }) : null;
	const item: QueuedExport = { id: `export-wait-${++queueCount}`, projectId, name, run, journal };
	// this project's exports that an earlier run left unfinished are answered by this one (their notices go)
	for (const id of forgetInterrupted(projectId)) toast.dismiss(`export-interrupted-${id}`);
	if (!exportRunning && !editor.project.getExportState().isExporting) {
		sweepOlderExports();
		void runQueued(editor, item);
		return;
	}
	waiting.push(item);
	jobCenter.start({
		id: item.id,
		kind: "export",
		title: `Export · ${name}`,
		stage: "Waiting to export",
		cancel: () => {
			const index = waiting.indexOf(item);
			if (index >= 0) waiting.splice(index, 1);
			jobCenter.remove(item.id);
			journalEnd(journal);
		},
	});
	if (!quiet) toast("Waiting to export", { description: "It starts by itself once the current export is done." });
}

async function runQueued(editor: EditorCore, item: QueuedExport) {
	exportRunning = true;
	const journal = item.journal;
	try {
		if ((editor.project.getActiveOrNull()?.metadata.id ?? "") !== item.projectId) {
			jobCenter.remove(item.id);
			keepFinishedExport();
			jobCenter.start({ id: EXPORT_JOB, kind: "export", title: "Export" });
			jobCenter.fail(EXPORT_JOB, `Open «${item.name}» to export it.`);
			journalEnd(journal);
		} else {
			// The project is on disk before the long part: a crash or a force quit during the export keeps every edit.
			// The export's line is there from the press, through that save (exp2, 14.11): the save takes 20 ms on a quiet Mac, seconds
			// at a load of 50, and meanwhile nothing said an export was coming — the Export button did not fill, and the GIF of
			// «video + sound + GIF» came after the queue had looked finished.
			jobCenter.remove(item.id);
			keepFinishedExport();
			let cancelled = false;
			jobCenter.start({
				id: EXPORT_JOB,
				kind: "export",
				title: "Export",
				stage: SAVING_FIRST,
				progress: 0,
				cancel: () => {
					cancelled = true;
					journalEnd(journal);
					jobCenter.cancelled(EXPORT_JOB);
				},
			});
			await editor.save.flush().catch(() => false);
			if (!cancelled) await item.run(journal);
			// (an export that did not start — another one runs, the project closed — leaves no line saying it saves)
			const left = useJobsStore.getState().jobs.find((job) => job.id === EXPORT_JOB);
			if (left?.status === "running" && left.stage === SAVING_FIRST) jobCenter.remove(EXPORT_JOB);
		}
	} catch (error) {
		// (an export that threw outside its own handling still ends in the journal: it is not «interrupted»)
		journalEnd(journal);
		throw error;
	} finally {
		exportRunning = false;
		const next = waiting.shift();
		if (next) void runQueued(editor, next);
	}
}

/**
 * An export started on its own (nothing running, nothing waiting) sweeps the lines of the exports before the previous
 * one: the chip holds this export, the one before it (keepFinishedExport moves it aside with its own name) and every
 * export of one queue — not a night's worth of «Saved …» lines (check-export [queue]: eight of them, KEEP_FINISHED).
 * A line whose Save dialog is still open stays: its answer lands there.
 */
function sweepOlderExports() {
	const pending = new Set([...pendingSaves].map((line) => line.jobId));
	for (const job of useJobsStore.getState().jobs) {
		if (job.kind === "export" && job.id.startsWith("export-done-") && job.status === "done" && !pending.has(job.id)) jobCenter.remove(job.id);
	}
}

/**
 * A finished export keeps its line (Show in Finder) when the next one starts — and so does one whose file is made and
 * waits for room where it is saved. A failed one does not: the export now starting is its «Save again» / «Try again»
 * (or replaces it), and its red «Export failed» stayed in the header chip after the retry had saved the file
 * (acceptance on rc13, 07.11).
 */
function keepFinishedExport() {
	const previous = useJobsStore.getState().jobs.find((job) => job.id === EXPORT_JOB);
	jobCenter.remove(EXPORT_JOB);
	// (the notes of a line go with it, or with the line it moved to below; a new export starts without any)
	const notes = fallbackNotes.get(EXPORT_JOB);
	fallbackNotes.delete(EXPORT_JOB);
	const saving = [...pendingSaves].some((line) => line.jobId === EXPORT_JOB);
	if (previous && (previous.status === "done" || (saving && previous.status === "running"))) {
		const id = `export-done-${++queueCount}`;
		jobCenter.start({ ...previous, id });
		if (notes) fallbackNotes.set(id, notes);
		// a Save dialog still open for that export answers into its moved line
		for (const line of pendingSaves) if (line.jobId === EXPORT_JOB) line.jobId = id;
	}
}

interface Delivery {
	filename: string;
	/** The choices of the Video section; the page encodes the file itself or a master for ffmpeg. */
	target: ExportTarget;
	/** The server's part (codec, AI upscale, frame interpolation); none when the page's file is the export. */
	job?: TranscodeJob;
	folder?: string;
	seconds: number;
	label: string;
	/** About how large the file the page writes will be (its own file, or the master of the server's part). */
	bytes?: number;
}

/**
 * Runs the export as a background job: it keeps going when the window closes and shows up in the header job chip
 * with progress, time left and Cancel.
 */
async function runExport(editor: EditorCore, options: ExportOptions, delivery: Delivery, captions = false, manifest?: ManifestDraft, journal?: Journal) {
	const project = editor.project.getActiveOrNull();
	if (!project || editor.project.getExportState().isExporting) {
		journalEnd(journal);
		return;
	}
	const name = project.metadata.name;
	const projectId = project.metadata.id;
	dismissedAt = 0;
	// Captions are added once: a retry after a failed render must not add a second track.
	let withCaptions = captions;
	const abort = new AbortController();
	// The job chip is shared by every project: a retry from another project must not export that one instead.
	const retry = () => {
		if (editor.project.getActiveOrNull()?.metadata.id !== projectId) {
			jobCenter.fail(EXPORT_JOB, `Open «${name}» to export it again.`);
			return;
		}
		enqueueExport(editor, name, (again) => runExport(editor, options, delivery, withCaptions, manifest, again), { request: videoRequest(options, delivery, withCaptions, manifest) });
	};
	keepFinishedExport();
	// The server's part takes the last part of the bar (more of it with AI upscale or frame interpolation).
	const share = !delivery.job ? 0 : "target" in delivery.job && (delivery.job.upscale || delivery.job.smooth) ? 0.5 : 0.2;
	jobCenter.start({
		id: EXPORT_JOB,
		kind: "export",
		title: "Export",
		stage: captions ? "Writing captions" : options.includeAudio ? "Mixing the sound" : "Rendering frames",
		progress: 0,
		cancel: () => {
			abort.abort();
			editor.project.cancelExport();
		},
	});
	let last = 0;
	// (the disk is full and the export waits for room: the line says so until the write goes through)
	let waitingForSpace = false;
	const stageAt = (progress: number) => (options.includeAudio && progress < 0.15 ? "Mixing the sound" : progress > 0.99 ? "Finishing the file" : "Rendering frames");
	// The time left is the renderer's own measure (frames left over the speed so far), not a guess from the bar. With a
	// second pass its time is added by the speed measured the last time this Mac made such a file — never measured yet:
	// the line says «at least».
	const passKind = share > 0 && delivery.job ? passKindOf(delivery.job) : null;
	const passPerSecond = passKind ? passSpeed(passKind) : null;
	let lastEta = Number.NaN;
	const stop = editor.project.subscribe(() => {
		const state = editor.project.getExportState();
		if (!state.isExporting) return;
		let eta: Job["eta"];
		if (state.etaSeconds === null) eta = null;
		else if (state.etaSeconds !== undefined) {
			const pass = share > 0 ? (passPerSecond === null ? null : passPerSecond * delivery.seconds) : 0;
			eta = { seconds: state.etaSeconds + (pass ?? 0), at: Date.now(), ...(pass === null ? { atLeast: true } : {}) };
		}
		const moved = state.progress - last >= 0.01;
		const etaValue = eta === undefined ? Number.NaN : eta === null ? -1 : eta.seconds;
		const etaMoved = eta !== undefined && !(Math.abs(etaValue - lastEta) < 1);
		if (!moved && !etaMoved) return;
		if (moved) last = state.progress;
		if (eta !== undefined) lastEta = etaValue;
		// The renderer mixes the sound in its first 15 %, then draws and encodes the frames.
		jobCenter.update(EXPORT_JOB, { progress: last * (1 - share), ...(eta !== undefined && !waitingForSpace ? { eta } : {}), ...(waitingForSpace ? {} : { stage: stageAt(last) }) });
	});
	if (captions) {
		// The Captions tab's on-device whisper: one captions track (one ⌘Z), burned in like any text on the timeline.
		try {
			const chunks = await generateLocalCaptions({
				editor,
				signal: abort.signal,
				onStep: (step) => jobCenter.update(EXPORT_JOB, { stage: `Captions: ${step}` }),
			});
			if (abort.signal.aborted) throw new Error("cancelled");
			if (!chunks) throw new Error("Speech recognition isn't on this Mac yet: set it up in Text → Captions, then export again.");
			insertCaptionChunksAsTextTrack({ editor, captions: chunks });
			withCaptions = false;
			// (the captions are on the timeline now: the same export run again after a kill must not add them twice)
			journalUpdate(journal, { request: videoRequest(options, delivery, false, manifest) });
		} catch (error) {
			stop();
			journalEnd(journal);
			if (abort.signal.aborted) {
				jobCenter.cancelled(EXPORT_JOB);
				return;
			}
			jobCenter.fail(EXPORT_JOB, `No captions: ${error instanceof Error ? error.message : "speech recognition failed"}`);
			jobCenter.update(EXPORT_JOB, { retry });
			return;
		}
	}
	// In the Mac app the file grows on disk, not in memory: a long video filled it and froze the Mac (05.11). With an
	// «Export to» folder and no second pass it grows beside its place (a hidden part name) and gets its name by one
	// rename at the end; else in the app's temp folder.
	const file = studioApp()?.exportFile;
	const beside = share === 0 && delivery.folder ? { folder: delivery.folder, filename: exportSaveName(delivery.filename) } : null;
	const disk = file?.open && file.write ? await file.open(beside).catch(() => null) : null;
	const dropDisk = () => {
		if (disk) void file?.discard?.(disk);
	};
	try {
		const write = file?.write;
		const toFile =
			disk && write
				? diskWriter({
						id: disk,
						app: { write, space: file?.space, reset: file?.reset },
						isCancelled: () => abort.signal.aborted,
						// A full disk does not end the export: it waits, says how much is missing and goes on by itself.
						onWaiting: (state: DiskWaiting) => {
							waitingForSpace = !!state;
							jobCenter.update(EXPORT_JOB, { stage: state ? waitingForSpaceText(shortBytes({ totalBytes: delivery.bytes ?? 0, ...state })) : stageAt(last), ...(state ? { eta: null } : {}) });
						},
					})
				: undefined;
		const renderStarted = Date.now();
		takeEncoderFallbacks();
		const result = await editor.project.export({ options: toFile ? { ...options, toFile } : options });
		stop();
		if (result.cancelled || abort.signal.aborted) {
			dropDisk();
			journalEnd(journal);
			editor.project.clearExportState();
			jobCenter.cancelled(EXPORT_JOB);
			return;
		}
		if (result.success && (result.buffer || (disk && result.bytes))) {
			editor.project.clearExportState();
			// the page's own steps that fell back (the AAC encoder, the fast assembly): said like the server's
			const build = (globalThis as { __exportBuild?: { fallback?: string; at?: number } }).__exportBuild;
			noteFallbacks([
				...takeEncoderFallbacks(),
				...(build?.fallback && (build.at ?? 0) >= renderStarted ? [{ step: "build" as const, reason: build.fallback }] : []),
			]);
			if (result.buffer) dropDisk();
			const buffer: ArrayBuffer | DiskRender = result.buffer ?? { disk: disk as string, bytes: result.bytes ?? 0 };
			try {
				if (share > 0) {
					await transcodeAndSave({
						projectId,
						data: buffer,
						job: delivery.job ?? { target: delivery.target },
						filename: delivery.filename,
						stage: `Encoding ${delivery.label}`,
						share,
						seconds: delivery.seconds,
						folder: delivery.folder,
						signal: abort.signal,
						manifest,
						journal,
					});
				} else {
					await saveRendered(projectId, buffer, delivery.filename, MIME[delivery.target.container], manifest, delivery.folder, { journal, signal: abort.signal });
				}
			} catch (error) {
				dropDisk();
				journalEnd(journal);
				if (abort.signal.aborted) {
					jobCenter.cancelled(EXPORT_JOB);
					return;
				}
				jobCenter.fail(EXPORT_JOB, saveErrorText(error instanceof Error ? error.message : undefined));
				jobCenter.update(EXPORT_JOB, { retry });
			}
			return;
		}
		dropDisk();
		journalEnd(journal);
		jobCenter.fail(EXPORT_JOB, exportErrorText(result.error));
		jobCenter.update(EXPORT_JOB, { retry });
	} catch (error) {
		dropDisk();
		journalEnd(journal);
		editor.project.clearExportState();
		if (abort.signal.aborted) {
			jobCenter.cancelled(EXPORT_JOB);
			return;
		}
		jobCenter.fail(EXPORT_JOB, exportErrorText(error instanceof Error ? error.message : undefined));
		jobCenter.update(EXPORT_JOB, { retry });
	} finally {
		stop();
	}
}

const MIME: Record<ExportContainer, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", gif: "image/gif" };

/** Export → the sound alone (WAV from the mix; MP3, AAC or FLAC through ffmpeg), no frames rendered. */
async function runAudioExport(
	editor: EditorCore,
	input: { range?: { start: number; end: number }; normalize: boolean; targetLufs?: number },
	fileBase: string,
	format: AudioFileFormat,
	folder?: string,
	manifest?: ManifestDraft,
	journal?: Journal,
) {
	const project = editor.project.getActiveOrNull();
	if (!project || editor.project.getExportState().isExporting) {
		journalEnd(journal);
		return;
	}
	const projectId = project.metadata.id;
	dismissedAt = 0;
	const abort = new AbortController();
	keepFinishedExport();
	jobCenter.start({
		id: EXPORT_JOB,
		kind: "export",
		title: "Export",
		stage: "Mixing the sound",
		cancel: () => {
			abort.abort();
			journalEnd(journal);
			jobCenter.cancelled(EXPORT_JOB);
		},
	});
	const filename = `${exportFileBase(fileBase)}${AUDIO_EXTENSION[format]}`;
	try {
		const wav = await renderTimelineWav({ editor, ...input });
		if (abort.signal.aborted) return;
		if (!wav) {
			journalEnd(journal);
			jobCenter.fail(EXPORT_JOB, "Nothing on the timeline makes a sound.");
			return;
		}
		const seconds = input.range ? (input.range.end - input.range.start) / TICKS_PER_SECOND : editor.timeline.getTotalDuration() / TICKS_PER_SECOND;
		if (format === "wav") await saveRendered(projectId, wav, filename, AUDIO_MIME.wav, manifest, folder, { journal, signal: abort.signal });
		else
			await transcodeAndSave({
				projectId,
				data: wav,
				job: { audio: format },
				filename,
				stage: `Encoding ${format.toUpperCase()}`,
				share: 0.4,
				seconds,
				folder,
				signal: abort.signal,
				manifest,
				journal,
			});
	} catch (error) {
		journalEnd(journal);
		if (abort.signal.aborted) return;
		jobCenter.fail(EXPORT_JOB, `Couldn't make the sound file: ${error instanceof Error ? error.message : "unknown error"}`);
		jobCenter.update(EXPORT_JOB, {
			retry: () => enqueueExport(editor, fileBase, (again) => runAudioExport(editor, input, fileBase, format, folder, manifest, again), { request: { kind: "audio", input, fileBase, format, folder, manifest } }),
		});
	}
}

/**
 * An export described as plain data (the journal's entry of one cut short) run again, as it was: the same file name,
 * folder and settings. The project it belongs to must be the open one.
 */
export async function runExportRequest(editor: EditorCore, name: string, request: ExportRequest) {
	if (request.kind === "audio") {
		const { input, fileBase, format, folder, manifest } = request;
		enqueueExport(editor, name, (journal) => runAudioExport(editor, input, fileBase, format, folder, manifest, journal), { request });
		return;
	}
	let cover: ExportOptions["cover"];
	if (request.cover) {
		const image = new Image();
		image.src = request.cover.dataUrl;
		await image.decode().catch(() => {});
		if (image.naturalWidth > 0) cover = { image, seconds: request.cover.seconds };
	}
	const options: ExportOptions = { ...request.options, ...(cover ? { cover } : {}) };
	enqueueExport(editor, name, (journal) => runExport(editor, options, request.delivery, request.captions, request.manifest, journal), { request });
}

/** 0:03.8 style time for the In→Out label. */
function formatRangeTime(ticks: number): string {
	const seconds = ticks / TICKS_PER_SECOND;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}`;
}

/** 0:12, 1:12.5 — the marks as the person reads them (whole seconds without «.0»; blind3 F22). */
function formatMark(ticks: number): string {
	const tenths = Math.round((ticks / TICKS_PER_SECOND) * 10);
	const minutes = Math.floor(tenths / 600);
	const rest = (tenths - minutes * 600) / 10;
	const secs = Number.isInteger(rest) ? String(rest).padStart(2, "0") : rest.toFixed(1).padStart(4, "0");
	return `${minutes}:${secs}`;
}

/** Opens the Export window on «Export selected clips» (CapCut: right-click on clips, or Media). */
export function openExportClips() {
	openInClipsMode = true;
	useShellStore.getState().setExportOpen(true);
}
let openInClipsMode = false;

/** Opens the Export window with «Edit cover» open (CapCut: «Cover» at the head of the main track). */
export function openExportCover() {
	openWithCover = true;
	useShellStore.getState().setExportOpen(true);
}
let openWithCover = false;

/** A running export fills the Export button from the left (its own progress; it breathes while nothing is measured). */
function ExportFill() {
	const p = useJobsStore((s) => {
		const job = s.jobs.find((j) => j.id === EXPORT_JOB && j.status === "running");
		return job ? (job.progress ?? -1) : null;
	});
	// The moment it ends: one soft sweep over the button (CRAFT.md §4), once per export.
	const ended = useJobsStore((s) => {
		const job = s.jobs.find((j) => j.id === EXPORT_JOB && j.status === "done");
		return job?.endedAt && Date.now() - job.endedAt < 1500 ? job.endedAt : null;
	});
	if (p === null) return ended ? <span key={ended} aria-hidden data-export-done className="gz-sweep pointer-events-none absolute inset-0 -z-10 overflow-hidden" /> : null;
	return (
		<span
			aria-hidden
			data-export-fill={p < 0 ? "" : Math.round(p * 1000) / 1000}
			className={cn("pointer-events-none absolute inset-0 -z-10 origin-left bg-white/30", p < 0 && "animate-[gz-breathe_1.6s_ease-in-out_infinite]")}
			// transform only (CRAFT.md §8): no layout while it fills
			style={{ transform: `scaleX(${p < 0 ? 1 : Math.max(0, Math.min(1, p))})`, transition: "transform var(--gz-t3) var(--gz-ease)" }}
		/>
	);
}

export function ExportButton() {
	const isExportOpen = useShellStore((s) => s.exportOpen);
	const setIsExportOpen = useShellStore((s) => s.setExportOpen);
	const editor = useEditor();
	const hasProject = useEditor(
		(e) => e.project.getActiveOrNull() !== null,
		["project"],
	);
	const activeId = useEditor((e) => e.project.getActiveOrNull()?.metadata.id ?? null, ["project"]);
	// A failed export belongs to the project it was made from: another project opened doesn't show its red chip
	// (targeted test 05.11). A running or finished one stays (its Show in Finder is still useful).
	const exportOf = useRef(activeId);
	useEffect(() => {
		if (exportOf.current && activeId && exportOf.current !== activeId) {
			const job = useJobsStore.getState().jobs.find((candidate) => candidate.id === EXPORT_JOB);
			if (job?.status === "error") jobCenter.remove(EXPORT_JOB);
		}
		exportOf.current = activeId;
	}, [activeId]);

	const handleOpenChange = ({ open }: { open: boolean }) => {
		// Closing the window never stops a running export: it continues in the job chip.
		if (!open && !editor.project.getExportState().isExporting) {
			editor.project.clearExportState();
			// Seen and closed: the next open starts at the settings (the job chip still has Show in Finder).
			// An export still running when the window closes shows its result on the next open.
			if (useJobsStore.getState().jobs.find((job) => job.id === EXPORT_JOB)?.status !== "running") dismissedAt = Date.now();
		}
		if (!open) {
			openInClipsMode = false;
			openWithCover = false;
		}
		setIsExportOpen(open);
	};

	return (
		<>
			<Hint label="Export the video" shortcut="⌘E">
				<button
					type="button"
					data-testid="export-button"
					className={cn(
						"bg-primary text-primary-foreground hover:bg-primary/90 relative isolate flex h-[22px] items-center gap-1 overflow-hidden rounded-[5px] px-2 text-[13px] font-semibold transition-colors focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden",
						!hasProject && "cursor-not-allowed opacity-50",
					)}
					onClick={hasProject ? () => setIsExportOpen(true) : undefined}
					disabled={!hasProject}
				>
					<ExportFill />
					<HugeiconsIcon icon={TransitionTopIcon} className="size-3.5" />
					<span>Export</span>
				</button>
			</Hint>
			<Dialog open={isExportOpen && hasProject} onOpenChange={(open) => handleOpenChange({ open })}>
				{/* Mounted per opening: it starts from the saved choices and the current selection every time. */}
				{hasProject && isExportOpen && <ExportDialog onClose={() => handleOpenChange({ open: false })} clipsMode={openInClipsMode} coverOpenAtStart={openWithCover} />}
			</Dialog>
		</>
	);
}

type PlatformChoice = ExportPlatformId | "custom";
const OTHER_ITEM = { value: "custom", label: "Other", title: "Your own settings" } as const;
/** The UI language's platforms (VK, Telegram, Dzen, RuTube in Russian; TikTok, Reels, Shorts in English) + Other. */
const platformItems = (lang: "ru" | "en", value: PlatformChoice): Array<{ value: PlatformChoice; label: string; title?: string }> => [
	...platformsFor(lang, value).map((platform) => ({ value: platform.id, label: platform.label })),
	OTHER_ITEM,
];

// CapCut's export choices (docs/capcut-study.md §d).
/** CapCut's three bit-rate steps over our quality presets (the old "Low" reads as Lower), and Custom. */
const BITRATES: { value: ExportQuality | "custom"; label: string }[] = [
	{ value: "medium", label: "Lower" },
	{ value: "high", label: "Recommended" },
	{ value: "very_high", label: "Higher" },
	{ value: "custom", label: "Custom" },
];
/** CapCut's Format list: mov, then mp4 (ProRes and RLE are mov only). */
const FORMATS: { value: ExportContainer; label: string }[] = [
	{ value: "mov", label: "mov" },
	{ value: "mp4", label: "mp4" },
];
const FRAME_RATES = ["23.976", "24", "25", "29.97", "30", "50", "59.94", "60"];
const COLOR_SPACES: { value: ExportColor; label: string }[] = [
	{ value: "sdr", label: "Rec. 709 SDR" },
	{ value: "hlg", label: "Rec. 2020 HLG" },
	{ value: "pq", label: "Rec. 2100 PQ" },
];
/** CapCut's Audio → Format list, in its order. */
const AUDIO_FORMATS: { value: AudioFileFormat; label: string }[] = [
	{ value: "mp3", label: "MP3" },
	{ value: "wav", label: "WAV" },
	{ value: "aac", label: "AAC" },
	{ value: "flac", label: "FLAC" },
];
/** Export GIF → Resolution: CapCut's 240P, 320P and 640P (the long side). */
const GIF_SIZES = [240, 320, 640];

/** CapCut's «Duration: 10s» (a minute or longer: 1:05; an hour or longer: 1:01:40). */
function durationText(seconds: number): string {
	const whole = Math.round(seconds);
	if (whole < 60) return t("{s}s", { s: whole });
	const h = Math.floor(whole / 3600);
	const m = Math.floor((whole % 3600) / 60);
	const s = String(whole % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** 29.97 → 30000/1001 (NTSC rates are exact fractions). */
function frameRateOf(value: number) {
	const ntsc = [23.976, 29.97, 59.94].find((rate) => Math.abs(rate - value) < 0.01);
	return ntsc ? { numerator: Math.round(ntsc * 1.001) * 1000, denominator: 1001 } : { numerator: Math.round(value), denominator: 1 };
}

/** The finished export the window last showed; "Export again" hides it (module scope: survives closing the window). */
let dismissedAt = 0;

function ExportRow({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<span className="text-muted-foreground text-xs">{label}</span>
			{children}
			{hint && <p className="text-muted-foreground text-[11px] leading-tight">{hint}</p>}
		</div>
	);
}

/** One CapCut field: the name on the left, the control filling the rest of the row. */
function ExportField({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
	return (
		<div className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
			{/* a long name («Цветовое пространство») wraps to a second line instead of ending in «…» (check-export E8) */}
			<span className="text-muted-foreground text-xs leading-tight break-words">{label}</span>
			<div className="min-w-0">{children}</div>
			{hint && <p className="text-muted-foreground col-start-2 text-[11px] leading-tight">{hint}</p>}
		</div>
	);
}

function ExportSelect({
	label,
	value,
	items,
	onChange,
	disabled = false,
}: {
	label: string;
	value: string;
	items: { value: string; label: string; note?: string }[];
	onChange: (value: string) => void;
	disabled?: boolean;
}) {
	return (
		<Select value={value} onValueChange={onChange} disabled={disabled}>
			<SelectTrigger size="sm" className="w-full" aria-label={label} data-export-field={label}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{items.map((item) => (
					// CapCut's line under H.264, HEVC and RLE in the list.
					<SelectItem key={item.value} value={item.value} data-export-option={item.value} note={item.note}>
						{item.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/**
 * A CapCut section: ☐ name ▴. Its fields stay in view, greyed out while the box is off; ▴ / ▾ folds them away.
 */
function ExportSection({
	id,
	label,
	checked,
	onCheckedChange,
	children,
	disabled = false,
	hint,
}: {
	id: string;
	label: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	children: React.ReactNode;
	disabled?: boolean;
	/** Why the box can't be used right now, next to its name (a dead box with no word was check-export E6). */
	hint?: string | null;
}) {
	const t = useT();
	const [open, setOpen] = useState(true);
	return (
		<section className="border-foreground/[0.07] flex flex-col gap-2.5 border-t pt-3.5 first:border-t-0 first:pt-0" aria-labelledby={`export-section-${id}`}>
			<div className="flex items-center gap-2">
				<Checkbox
					id={`export-section-${id}-box`}
					data-testid={`export-section-${id}`}
					checked={checked}
					disabled={disabled}
					title={hint ?? undefined}
					onCheckedChange={(c) => onCheckedChange(c === true)}
				/>
				<Label id={`export-section-${id}`} htmlFor={`export-section-${id}-box`} className="text-sm font-medium">
					{label}
				</Label>
				<button
					type="button"
					className="text-muted-foreground hover:text-foreground -ml-1 flex size-5 items-center justify-center rounded-sm"
					aria-label={open ? t("Fold {section}", { section: t(label) }) : t("Unfold {section}", { section: t(label) })}
					aria-expanded={open}
					data-export-fold={id}
					onClick={() => setOpen((value) => !value)}
				>
					<HugeiconsIcon icon={ArrowDown01Icon} className={cn("size-3.5", fold(open))} />
				</button>
				{hint && (
					<span className="text-muted-foreground min-w-0 truncate text-[11px]" data-export-section-hint={id} title={hint}>
						{hint}
					</span>
				)}
			</div>
			{open && (
				<fieldset disabled={!checked} data-export-fields={id} className={cn("m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0", !checked && "opacity-45")}>
					{children}
				</fieldset>
			)}
		</section>
	);
}

/**
 * The saved prefs; with no platform picked yet, the one that fits the video's shape is named (its warnings apply) and
 * nothing else changes: the bit rate and the loudness stay what the window shows. (Applying the preset here turned
 * on «Even loudness» under a folded «More options» and «Higher» on every fresh profile — check-export E1.)
 */
function initialPrefs(canvasSize: { width: number; height: number }): ExportPrefs {
	const saved = readExportPrefs();
	if (saved.platform) return saved;
	const suggested = suggestPlatform(canvasSize);
	return suggested ? { ...saved, platform: suggested } : saved;
}

/** Timeline clips «Export selected clips» can make files of (pictures and video). */
function selectedClips(editor: EditorCore): TimelineElement[] {
	return editor.selection
		.getSelectedElements()
		.map((ref) => editor.timeline.getTrackById({ trackId: ref.trackId })?.elements.find((e) => e.id === ref.elementId))
		.filter((element): element is TimelineElement => !!element && (element.type === "video" || element.type === "image"))
		.sort((a, b) => a.startTime - b.startTime);
}

/** Edit cover: the chosen picture per project while the app runs (CapCut: «Select a cover»). */
interface Cover {
	url: string;
	image: ImageBitmap;
	/** «Add video cover at the beginning». */
	atStart: boolean;
}
const covers = new Map<string, Cover>();
/** How long the cover shows at the start: a tenth of a second in whole frames of the file's exact rate, at least one. */
const coverLead = (fps: number) => coverSeconds(exactRate(fps));
/**
 * «Smooth frames»: the server's pass is told how many frames the file holds — the timeline's frames at the file's exact
 * rate (ceil, on integers) plus the cover's — and where the cover ends (nothing is interpolated across it). Counted here
 * from ticks, never from the master's float length (exp, 14.11).
 */
function withExactFrames(job: TranscodeJob | undefined, durationTicks: number, lead: number, cuts: number[] = []): TranscodeJob | undefined {
	if (!job || "audio" in job || !job.smooth) return job;
	const rate = exactRate(job.target.fps);
	const cover = lead > 0 ? coverFrames(rate) : 0;
	// the film's cuts in the master's seconds (after the cover): «Smooth frames» never blends two shots (exp2, 14.11)
	const inMaster = cuts.map((t) => Math.round((lead + t) * 1e6) / 1e6);
	return { ...job, smooth: { ...job.smooth, frames: framesAt({ durationTicks, rate, ticksPerSecond: TICKS_PER_SECOND }) + cover, ...(cover ? { cut: lead } : {}), ...(inMaster.length ? { cuts: inMaster } : {}) } };
}

/** A smaller copy of `size` with its long side at `long` px (previews of the cover). */
const scaledTo = (size: { width: number; height: number }, long: number) => {
	const scale = Math.min(1, long / Math.max(size.width, size.height));
	return { width: Math.max(2, Math.round((size.width * scale) / 2) * 2), height: Math.max(2, Math.round((size.height * scale) / 2) * 2) };
};

/** No cover picked: the edit's first frame (CapCut's default cover), drawn once on a canvas. */
function FirstFrame({ editor, size }: { editor: EditorCore; size: { width: number; height: number } }) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const box = scaledTo(size, 380);
	// biome-ignore lint/correctness/useExhaustiveDependencies: drawn again only when the canvas size changes
	useEffect(() => {
		const painter = stillFramePainter(editor, box);
		if (canvas.current) void painter.paint(canvas.current, 0).catch(() => {});
		return () => painter.dispose();
	}, [editor, box.width, box.height]);
	return <canvas ref={canvas} width={box.width} height={box.height} className="absolute inset-0 size-full object-contain" data-export-first-frame />;
}

/**
 * The filmstrip: eight frames across the video. Painted by its own effect, which runs once its canvases are in the
 * window — the dialog's content is mounted a render after the dialog itself, so an effect of the dialog ran before
 * the canvases existed and never again, and the strip stayed black (check-export E3). Mounted again when «Select
 * from video» comes back: new canvases, painted again.
 */
function CoverStrip({ painter, duration, size }: { painter: StillFramePainter; duration: number; size: { width: number; height: number } }) {
	const canvases = useRef<Array<HTMLCanvasElement | null>>([]);
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			for (let i = 0; i < 8 && !cancelled; i++) {
				const canvas = canvases.current[i];
				if (!canvas) continue;
				try {
					await painter.paint(canvas, Math.round((duration * (i + 0.5)) / 8));
				} catch {
					break;
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [painter, duration]);
	return (
		<>
			{Array.from({ length: 8 }, (_, i) => (
				<canvas
					// biome-ignore lint/suspicious/noArrayIndexKey: eight fixed places along the strip
					key={i}
					ref={(canvas) => {
						canvases.current[i] = canvas;
					}}
					width={size.width}
					height={size.height}
					className="h-full min-w-0 flex-1 object-cover"
				/>
			))}
		</>
	);
}

/**
 * CapCut's «Select a cover» window: the cover large, «Select from video» (a filmstrip of the video with a handle to
 * drag to the frame) or «Local» (click or drag a picture in). Save makes it the cover. CapCut's «Create new cover» and
 * its cover designer are online templates: not here.
 */
function CoverDialog({ editor, size, onClose, onPick }: { editor: EditorCore; size: { width: number; height: number }; onClose: () => void; onPick: (picture: Blob) => void }) {
	const duration = editor.timeline.getTotalDuration();
	const [from, setFrom] = useState<"video" | "local">("video");
	const [at, setAt] = useState(() => Math.min(editor.playback.getCurrentTime(), duration));
	const [frameShown, setFrameShown] = useState(false);
	const [picture, setPicture] = useState<{ file: File; url: string } | null>(null);
	const [busy, setBusy] = useState(false);
	const [over, setOver] = useState(false);
	const file = useRef<HTMLInputElement>(null);
	const strip = useRef<HTMLDivElement>(null);
	const frameCanvas = useRef<HTMLCanvasElement>(null);
	const frameSize = scaledTo(size, 960);
	const thumbSize = scaledTo(size, 160);
	// The frames go straight onto the canvases below (stillFramePainter): one painter for the frame under the handle,
	// one for the filmstrip, so a drag of the handle never waits for the strip.
	const painters = useRef<{ frame: StillFramePainter; strip: StillFramePainter } | null>(null);
	painters.current ??= { frame: stillFramePainter(editor, frameSize), strip: stillFramePainter(editor, thumbSize) };
	useEffect(
		() => () => {
			painters.current?.frame.dispose();
			painters.current?.strip.dispose();
		},
		[],
	);
	// The frame under the handle, drawn a moment after it stops moving.
	useEffect(() => {
		const id = window.setTimeout(() => {
			const canvas = frameCanvas.current;
			if (canvas) void painters.current?.frame.paint(canvas, at).then(() => setFrameShown(true), () => {});
		}, 120);
		return () => window.clearTimeout(id);
	}, [at]);
	const timeAt = (clientX: number) => {
		const box = strip.current?.getBoundingClientRect();
		if (!box || box.width === 0) return at;
		return Math.round(Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * duration);
	};
	const choosePicture = (picked: File | undefined) => {
		if (!picked || !picked.type.startsWith("image/")) return;
		if (picture) URL.revokeObjectURL(picture.url);
		setPicture({ file: picked, url: URL.createObjectURL(picked) });
	};
	const save = async () => {
		if (from === "local") {
			if (picture) onPick(picture.file);
			onClose();
			return;
		}
		setBusy(true);
		try {
			onPick((await renderStillFrame(editor, size, at)).blob);
			onClose();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Couldn't take the frame.");
		} finally {
			setBusy(false);
		}
	};
	const frameOn = from === "video" && frameShown;
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="flex w-[min(94vw,724px)] max-w-none flex-col gap-0 overflow-hidden p-0" data-export-cover-editor>
				<DialogHeader className="border-b px-4 py-3">
					<DialogTitle className="text-[15px]">Select a cover</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col items-center gap-3 px-4 pt-4 pb-3">
					<div className="relative flex h-[300px] w-full items-center justify-center overflow-hidden rounded-md bg-black/40">
						{/* kept while «Local» is shown: the frame is there again when the video side comes back */}
						<canvas
							ref={frameCanvas}
							width={frameSize.width}
							height={frameSize.height}
							className={cn("max-h-full max-w-full object-contain", !frameOn && "hidden")}
							data-export-cover-preview={frameOn ? "" : undefined}
						/>
						{from === "video" ? (
							!frameShown && <Spinner />
						) : !picture ? (
							<button
								type="button"
								onClick={() => file.current?.click()}
								onDragOver={(event) => {
									event.preventDefault();
									setOver(true);
								}}
								onDragLeave={() => setOver(false)}
								onDrop={(event) => {
									event.preventDefault();
									setOver(false);
									choosePicture(event.dataTransfer.files[0]);
								}}
								className={cn("bg-foreground/[0.05] flex h-[150px] w-[226px] flex-col items-center justify-center gap-2 rounded-lg", over && "ring-primary ring-2")}
								data-export-cover-drop
							>
								<span className="bg-primary text-primary-foreground grid size-6 place-items-center rounded-full text-lg leading-none">+</span>
								<span className="text-sm">Click or drag image to this area</span>
								<span className="text-muted-foreground text-[11px]">{t("(recommended ratio {ratio})", { ratio: size.width >= size.height ? "16:9" : "9:16" })}</span>
							</button>
						) : (
							// biome-ignore lint/performance/noImgElement: a blob URL of the picture
							<img src={picture.url} alt="Cover" className="max-h-full max-w-full object-contain" data-export-cover-preview />
						)}
					</div>
					<div className="bg-foreground/[0.06] flex rounded-md p-0.5 text-xs">
						{(["video", "local"] as const).map((value) => (
							<button
								key={value}
								type="button"
								data-export-cover-from={value}
								aria-pressed={from === value}
								onClick={() => setFrom(value)}
								className={cn("h-6 rounded px-3", from === value ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
							>
								{value === "video" ? "Select from video" : "Local"}
							</button>
						))}
					</div>
					{from === "video" ? (
						<div
							ref={strip}
							className="relative flex h-12 w-full cursor-pointer touch-none overflow-hidden rounded-md bg-black/40 select-none"
							role="slider"
							tabIndex={0}
							aria-label="Cover frame"
							aria-valuemin={0}
							aria-valuemax={duration}
							aria-valuenow={at}
							aria-valuetext={formatRangeTime(at)}
							data-export-cover-strip
							onPointerDown={(event) => {
								event.currentTarget.setPointerCapture(event.pointerId);
								setAt(timeAt(event.clientX));
							}}
							onPointerMove={(event) => {
								if (event.buttons & 1) setAt(timeAt(event.clientX));
							}}
							onKeyDown={(event) => {
								const frame = TICKS_PER_SECOND / 30;
								if (event.key === "ArrowRight") setAt((value) => Math.min(duration, value + frame));
								if (event.key === "ArrowLeft") setAt((value) => Math.max(0, value - frame));
							}}
						>
							{painters.current && <CoverStrip painter={painters.current.strip} duration={duration} size={thumbSize} />}
							<span
								className="bg-foreground pointer-events-none absolute top-0 bottom-0 w-0.5 -translate-x-1/2"
								style={{ left: `${duration > 0 ? (at / duration) * 100 : 0}%` }}
								data-export-cover-handle
							/>
						</div>
					) : (
						<div className="flex w-full items-center gap-2">
							<span className="text-muted-foreground text-xs">From</span>
							<p className="bg-foreground/[0.05] h-7 min-w-0 flex-1 truncate rounded-md px-2 text-xs leading-7">{picture?.file.name ?? "…"}</p>
							<Button variant="outline" size="icon" className="size-7" onClick={() => file.current?.click()} aria-label="Choose a picture" data-export-cover-local>
								<HugeiconsIcon icon={FolderOpenIcon} className="size-3.5" />
							</Button>
							<input
								ref={file}
								type="file"
								accept="image/png,image/jpeg,image/webp,image/heic"
								className="hidden"
								data-export-cover-file
								onChange={(event) => {
									choosePicture(event.target.files?.[0]);
									event.target.value = "";
								}}
							/>
						</div>
					)}
				</div>
				<DialogFooter className="flex flex-row items-center justify-end gap-2 border-t px-4 py-3">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={() => void save()} disabled={busy || (from === "local" && !picture)} data-export-cover-use>
						{busy ? "Taking the frame…" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** CapCut's export window: cover on the left; Title, Export to, then the Video / Audio / Captions sections; size and
 * Export at the bottom. «Export selected clips» makes one numbered file per selected clip. Our extras (platform
 * presets, name tokens, In→Out, burned-in captions, ad marking) sit under «More options». */
function ExportDialog({ onClose, clipsMode = false, coverOpenAtStart = false }: { onClose: () => void; clipsMode?: boolean; coverOpenAtStart?: boolean }) {
	const t = useT();
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActive());
	const exportState = useEditor((e) => e.project.getExportState());
	const { isExporting, progress, result: exportResult } = exportState;
	const job = useJobsStore((s) => s.jobs.find((j) => j.id === EXPORT_JOB));
	const queued = useJobsStore((s) => s.jobs.filter((j) => j.id.startsWith("export-wait-")).length);
	const canvasSize = activeProject.settings.canvasSize;
	const [prefs, setPrefs] = useState<ExportPrefs>(() => initialPrefs(canvasSize));
	const update = (patch: Partial<ExportPrefs>) =>
		setPrefs((previous) => {
			const next = { ...previous, ...patch };
			writeExportPrefs(next);
			return next;
		});
	const { quality } = prefs;
	// CapCut's four sections. Video carries its sound; Audio is the sound as a file of its own (the only file when
	// Video is off); Export GIF makes a GIF beside the video; Captions a caption file. At least one stays on.
	const [sections, setSectionsState] = useState(() => ({
		video: !(prefs.audioOnly ?? false),
		audio: prefs.audioOnly ?? false,
		gif: false,
		captions: false,
	}));
	const { video: videoOn, audio: audioOn, gif: gifOn, captions: captionsOn } = sections;
	const [captionsFormat, setCaptionsFormat] = useState<CaptionFileFormat>("srt");
	// The section whose box was refused because it was the last one on: said next to it (check-export E6).
	const [lastOn, setLastOn] = useState<keyof typeof sections | null>(null);
	// From the latest state (the ref moves at once), so two quick clicks can't undo each other; the last section on stays on.
	const sectionsNow = useRef(sections);
	const setSections = (patch: Partial<typeof sections>) => {
		const next = { ...sectionsNow.current, ...patch };
		if (!(next.video || next.audio || next.gif || next.captions)) {
			setLastOn((Object.keys(patch) as Array<keyof typeof sections>)[0] ?? null);
			return;
		}
		sectionsNow.current = next;
		setLastOn(null);
		setSectionsState(next);
	};
	const lastOnHint = (id: keyof typeof sections) => (lastOn === id ? t("One section stays on: turn another on first.") : undefined);
	// Video off + Audio on (the sound alone) is remembered.
	useEffect(() => {
		writeExportPrefs({ ...readExportPrefs(), audioOnly: !videoOn && audioOn });
	}, [videoOn, audioOn]);
	const audioOnly = !videoOn && audioOn;
	const audioFormat = prefs.audioFormat ?? "mp3";
	const platform: PlatformChoice = prefs.platform ?? "custom";
	// CapCut: the video always carries its sound (the Audio section adds a sound file).
	const shouldIncludeAudio = true;
	// Off unless asked (or a platform preset picks it): on by default the file came out ~11 dB louder than the player and a
	// clip's −6 dB was evened away (targeted test 05.11) — what is heard while editing is what is exported.
	const shouldNormalize = prefs.normalizeLoudness ?? false;
	const targetLufs = appPrefs().targetLufs;
	const inPoint = useInOutStore((s) => s.inPoint);
	const outPoint = useInOutStore((s) => s.outPoint);
	const timelineDuration = useEditor((e) => e.timeline.getTotalDuration());
	const inOutRange = resolveInOutRange({ inPoint, outPoint, duration: timelineDuration });
	// Marks set by the person are an intention (the lead, 14.11; blind3 F9): with In and Out marked the window opens on
	// that range — said on its first screen, one box back to the whole film; the summary, the size and the file follow it.
	const [exportRangeOnly, setExportRangeOnly] = useState(() => !!inOutRange);
	const captionCount = useEditor((e) => captionCues(e.scenes.getActiveScene().tracks).length);
	// The name field holds plain text or a template with tokens; only a template is remembered.
	const [fileBase, setFileBase] = useState(() => prefs.nameTemplate ?? exportFileBase(activeProject.metadata.name));
	// The project's own rate as the exact value (23.976, not 23.98), so the list and the file say the same number.
	const projectFps = (() => {
		const exact = frameRateToFloat(activeProject.settings.fps);
		const ntsc = [23.976, 29.97, 59.94].find((rate) => Math.abs(rate - exact) < 0.01);
		return ntsc ?? Math.round(exact * 100) / 100;
	})();
	const fpsChoice = prefs.fps ?? "project";
	const [burnCaptions, setBurnCaptions] = useState(false);
	const [adMarked, setAdMarked] = useState(false);
	const [advertiser, setAdvertiser] = useState("");
	const [erid, setErid] = useState("");
	const [moreOpen, setMoreOpen] = useState(false);
	// Export selected clips: one file per clip, named «Title_1», «Title_2» … (CapCut).
	const clips = useEditor((e) => selectedClips(e));
	const [mode, setMode] = useState<"video" | "clips">(clipsMode && clips.length > 0 ? "clips" : "video");
	const [includeAllChanges, setIncludeAllChanges] = useState(true);
	const projectId = activeProject.metadata.id;
	const [cover, setCoverState] = useState<Cover | null>(() => covers.get(projectId) ?? null);
	const [coverOpen, setCoverOpen] = useState(coverOpenAtStart && !clipsMode);
	const setCover = (next: Cover | null) => {
		if (next) covers.set(projectId, next);
		else covers.delete(projectId);
		setCoverState(next);
	};
	const pickCover = async (picture: Blob) => {
		try {
			const image = await createImageBitmap(picture);
			if (cover) URL.revokeObjectURL(cover.url);
			setCover({ url: URL.createObjectURL(picture), image, atStart: cover?.atStart ?? true });
			setCoverOpen(false);
		} catch {
			toast.error("This picture can't be read. Choose a PNG or JPEG.");
		}
	};
	const clipMode = mode === "clips" && clips.length > 0;
	const adBlocked = adMarked && videoOn && !isEridToken(erid);
	const fps = fpsChoice === "project" ? projectFps : Number(fpsChoice);
	const fpsItems = [
		...FRAME_RATES.filter((value) => Math.abs(Number(value) - projectFps) > 0.01).map((value) => ({ value, label: `${value}fps` })),
		{ value: "project", label: `${projectFps}fps` },
	].sort((a, b) => Number.parseFloat(a.label) - Number.parseFloat(b.label));

	// The Video section's choices as one target (codec fits the container, HDR / 10-bit where the codec carries it).
	// CapCut's window has mov and mp4 only (a GIF is its own section): an older WebM / GIF / AV1 / VP9 choice opens as H.264.
	const savedCodec = EXPORT_CODECS.find((c) => c.value === prefs.codec && !c.hidden)?.value ?? "h264";
	const container: ExportContainer = prefs.container === "mov" ? "mov" : "mp4";
	const resolution = prefs.resolution != null && prefs.resolution >= 480 ? prefs.resolution : resolutionOf(canvasSize);
	const size = outputSize(canvasSize, resolution);
	const { width, height } = size;
	// Custom is on while its Mbit/s is set: picking a preset clears it. (An extra «very high» case hid the field, so
	// choosing Custom after Higher silently fell back to Higher.)
	const customBitrate = prefs.customMbps != null;
	// The frame rate picks the table's column (12 Mbit/s above 30 fps at 1080p), as the encoder's config does.
	const bitrate = customBitrate ? Math.round((prefs.customMbps ?? 10) * 1_000_000) : videoBitrate({ width, height, fps, format: "mp4", quality });
	const target = normalizeTarget({
		container,
		codec: savedCodec,
		width,
		height,
		fps,
		bitrate,
		color: prefs.color ?? "sdr",
		bitDepth: prefs.bitDepth ?? 8,
		hardware: appPrefs().hardwareEncoding,
	});
	const codecInfo = EXPORT_CODECS.find((c) => c.value === target.codec) ?? EXPORT_CODECS[0];
	const codecLabel = codecInfo.label;
	// Bigger than the project → the AI upscaler (MetalFX) instead of stretching; a higher frame rate → frame
	// interpolation instead of repeated frames. Both run on this Mac after the frames are drawn, each can be turned off.
	const growth = Math.max(width / canvasSize.width, height / canvasSize.height);
	const upscaling = growth > 1.01;
	const aiUpscale = upscaling && (prefs.aiUpscale ?? true);
	const smoothing = fps > projectFps + 0.5;
	const smoothFps = smoothing && (prefs.smoothFps ?? true);
	const serverJob: TranscodeJob | undefined =
		aiUpscale || smoothFps || !encodedInPage(target)
			? {
					target,
					...(aiUpscale ? { upscale: { scale: growth > 2.01 ? 4 : 2 } as const } : {}),
					...(smoothFps ? { smooth: { factor: Math.round((fps / projectFps) * 1000) / 1000, fps: projectFps } } : {}),
				}
			: undefined;
	const resolutionItems = EXPORT_RESOLUTIONS.filter((value) => value < 4320 || isProRes(target.codec)).map((value) => ({ value: String(value), label: resolutionLabel(value) }));
	const formatItems = FORMATS.filter((item) => codecInfo.containers.includes(item.value));
	// Export GIF: its own file at 240P / 320P / 640P (the long side), drawn small and turned into a GIF on this Mac.
	const gifResolution = GIF_SIZES.includes(prefs.gifResolution ?? 0) ? (prefs.gifResolution as number) : 240;
	const gifSize = outputSize(canvasSize, Math.round((gifResolution * Math.min(canvasSize.width, canvasSize.height)) / Math.max(canvasSize.width, canvasSize.height)));
	const gifTarget = normalizeTarget({ ...target, container: "gif", width: gifSize.width, height: gifSize.height });
	const chooseContainer = (value: ExportContainer) => update({ container: value, format: value === "mov" ? "mov" : "mp4", platform: "custom" });
	const chooseCodec = (value: ExportCodec) => {
		const codec = EXPORT_CODECS.find((c) => c.value === value);
		const next = codec && !codec.containers.includes(container) ? codec.containers[0] : container;
		update({ codec: value, container: next, format: next === "mov" ? "mov" : "mp4", platform: "custom" });
	};
	const chooseColor = (value: ExportColor) => {
		const next = normalizeTarget({ ...target, color: value, bitDepth: value === "sdr" ? 8 : 10 });
		update({ color: next.color, bitDepth: next.bitDepth, codec: next.codec, platform: "custom" });
	};

	const length = clipMode
		? clips.reduce((sum, clip) => sum + clip.duration, 0)
		: exportRangeOnly && inOutRange
			? inOutRange.end - inOutRange.start
			: timelineDuration;
	// «Add video cover at the beginning» makes the video that much longer.
	const lead = !clipMode && videoOn && cover?.atStart ? coverLead(fps) : 0;
	const seconds = length / TICKS_PER_SECOND + lead;
	const isEmpty = timelineDuration <= 0;
	// ProRes and RLE have no bit rate to choose: the list is greyed and says so (check-export E9).
	const fixedBitrate = isProRes(target.codec) || target.codec === "rle";
	// bits per pixel per frame of each ProRes profile as the Mac's encoder makes them (check-export E9: measured on
	// 720p footage; Proxy came out 1.6× the old guess) and of RLE on a busy picture (a flat one is far smaller)
	const videoBytes = fixedBitrate
		? Math.round((width * height * fps * seconds * (target.codec === "rle" ? 12 : target.codec === "prores_422hq" ? 2.1 : target.codec === "prores_4444" ? 2.75 : target.codec === "prores_4444xq" ? 3.0 : target.codec === "prores_422lt" ? 1.1 : target.codec === "prores_proxy" ? 0.56 : 1.5)) / 8)
		: estimateExportBytes({ width, height, fps, seconds, format: "mp4", quality, includeAudio: shouldIncludeAudio }) *
			(customBitrate ? bitrate / videoBitrate({ width, height, fps, format: "mp4", quality }) : 1);
	const audioBytes =
		audioFormat === "wav" || audioFormat === "flac" ? estimateWavBytes(seconds) * (audioFormat === "flac" ? 0.6 : 1) : (seconds * (audioFormat === "mp3" ? 320_000 : 256_000)) / 8;
	const gifBytes = Math.round(gifSize.width * gifSize.height * Math.min(15, fps) * seconds * 0.12);
	const bytes = (videoOn ? videoBytes : 0) + (audioOn ? audioBytes : 0) + (gifOn ? gifBytes : 0);
	// What the page itself writes for the video: its own file, or — with the server's part — the H.264 master that part
	// starts from (its bit rate over the length, and the sound). Room on the disk is counted with it; a disk that fills
	// up in the middle says how much of it is still missing.
	const pageBytes = serverJob
		? Math.round(((masterBitrate(aiUpscale ? { ...canvasSize, bitrate } : { width, height, bitrate }) + (shouldIncludeAudio ? 320_000 : 0)) * seconds) / 8)
		: Math.round(videoBytes);
	const issues = platform === "custom" ? null : platformIssues(platform, canvasSize, seconds);
	const platformInfo = EXPORT_PLATFORMS.find((p) => p.id === platform);
	const [, setShown] = useState(0);
	const [showSettings, setShowSettings] = useState(false);
	const busy = !showSettings && (isExporting || job?.status === "running");
	const finished = !showSettings && !isEmpty && !busy && job && job.status !== "running" && (job.endedAt ?? 0) > dismissedAt && !(exportResult && !exportResult.success);
	// An export that ended while the window was closed: its result is a line over the settings, not a page that
	// needs «Export again» before anything can be changed (a finished export watched here keeps its own page).
	const openedAt = useRef(Date.now());
	const finishedEarlier = !!finished && !!job && (job.endedAt ?? 0) < openedAt.current;
	// «More below» at the foot of the options when they don't fit (at 1024×640 GIF, Captions and More options sit
	// under the fold; a wheel is the only way there and nothing said so). The scroller lives in the dialog's portal,
	// which mounts a render after the dialog: a callback ref sees it arrive (an effect of this component ran before it
	// existed and never again — the same trap as the cover's filmstrip, E3).
	const scroller = useRef<HTMLDivElement | null>(null);
	const [moreBelow, setMoreBelow] = useState(false);
	const stopWatching = useRef<(() => void) | null>(null);
	const watchScroller = useCallback((el: HTMLDivElement | null) => {
		stopWatching.current?.();
		stopWatching.current = null;
		scroller.current = el;
		if (!el) {
			setMoreBelow(false);
			return;
		}
		const look = () => setMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 6);
		look();
		el.addEventListener("scroll", look, { passive: true });
		const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(look);
		watch?.observe(el);
		stopWatching.current = () => {
			el.removeEventListener("scroll", look);
			watch?.disconnect();
		};
	}, []);
	// what the scroller holds changes with the window's state (More options, sections): looked at after every render
	useEffect(() => {
		const el = scroller.current;
		if (el) setMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 6);
	});
	const bitrateValue = customBitrate ? "custom" : quality === "low" ? "medium" : quality;
	// a platform the person chose (saved), not the one suggested by the shape (initialPrefs): a suggestion changes nothing
	// hidden, so it opens nothing (exp2, 14.11 — every 16:9 project on a fresh profile opened «More options» by itself)
	const [chosenPlatform] = useState(() => readExportPrefs().platform ?? "custom");
	// Nothing active hides under the fold (the lead, 14.11): a choice under «More options» that is on or not its default
	// when the window opens — a second file (sound, GIF, captions), even loudness, a chosen platform, a name template, the
	// manifest, a custom bit rate, another codec, frame rate or colour, «Smooth frames» off — opens it by itself.
	const activeBelow =
		!clipMode &&
		(audioOn ||
			gifOn ||
			captionsOn ||
			shouldNormalize ||
			chosenPlatform !== "custom" ||
			fileBase.includes("{") ||
			!!prefs.manifest ||
			customBitrate ||
			savedCodec !== "h264" ||
			fpsChoice !== "project" ||
			(prefs.color ?? "sdr") !== "sdr" ||
			(smoothing && prefs.smoothFps === false));
	const openedBelow = useRef(false);
	useEffect(() => {
		if (openedBelow.current) return;
		openedBelow.current = true;
		if (activeBelow) setMoreOpen(true);
	}, [activeBelow]);
	const folder = prefs.folder;
	const app = studioApp();

	const choosePlatform = (value: PlatformChoice) => {
		const preset = EXPORT_PLATFORMS.find((p) => p.id === value);
		if (preset) {
			setSections({ video: true });
			update({ platform: preset.id, format: "mp4", container: "mp4", codec: "h264", color: "sdr", bitDepth: 8, resolution: undefined, customMbps: undefined, quality: preset.quality, includeAudio: true, normalizeLoudness: true, audioOnly: false });
		} else update({ platform: "custom" });
	};

	const chooseFolder = async () => {
		const picked = await app?.pickFolder?.("Export to");
		if (picked) update({ folder: picked });
	};

	const nameValues = { project: exportFileBase(activeProject.metadata.name), platform: platformInfo?.label, width, height, fps };
	const resolvedName = resolveFileName(fileBase, { ...nameValues, now: new Date() });
	const keepName = (value: string) => update({ nameTemplate: value.includes("{") ? value : undefined });

	const exportOptions = (range?: { start: number; end: number }): ExportOptions => {
		const encode = pageEncode(target);
		// With the server's part the page draws a master: at the project's size before an AI upscale, at the
		// project's frame rate before frame interpolation.
		const master = serverJob
			? { format: "mp4" as const, bitrate: masterBitrate(aiUpscale ? { ...canvasSize, bitrate } : { width, height, bitrate }) }
			: encode;
		return {
			format: master.format,
			quality,
			fps: fpsChoice === "project" || smoothFps ? activeProject.settings.fps : frameRateOf(fps),
			includeAudio: shouldIncludeAudio,
			...(range ? { range } : {}),
			normalizeLoudness: shouldNormalize,
			targetLufs,
			size: !aiUpscale && (width !== canvasSize.width || height !== canvasSize.height) ? size : undefined,
			bitrate: customBitrate || serverJob ? master.bitrate : undefined,
			hardwareEncoding: target.hardware,
			...(lead > 0 && cover ? { cover: { image: cover.image, seconds: lead } } : {}),
			...(serverJob ? { master: true } : {}),
		};
	};
	/** Export GIF: a small H.264 master at the GIF's size, turned into the GIF (palette, ≤ 15 frames a second) on this Mac. */
	const gifOptions = (range?: { start: number; end: number }): ExportOptions => ({
		format: "mp4",
		quality,
		fps: activeProject.settings.fps,
		includeAudio: false,
		...(range ? { range } : {}),
		normalizeLoudness: false,
		targetLufs,
		size: gifSize,
		bitrate: masterBitrate(gifTarget),
		hardwareEncoding: target.hardware,
	});

	const handleExportClips = async () => {
		let into = folder;
		if (!into) into = (await app?.pickFolder?.("Export clips to")) ?? undefined;
		if (!into) {
			toast("Choose a folder for the clips", { description: "Each clip becomes its own file in it." });
			return;
		}
		if (!folder) update({ folder: into });
		const base = exportFileBase(resolvedName);
		clips.forEach((clip, index) => {
			const filename = `${base}_${index + 1}${fileExtension(target.container)}`;
			const clipOptions: ExportOptions = {
				...exportOptions({ start: clip.startTime, end: clip.startTime + clip.duration }),
				elements: { ids: [clip.id], plain: !includeAllChanges },
			};
			const clipDelivery: Delivery = { filename, target, job: withExactFrames(serverJob, clip.duration, 0), folder: into, seconds: clip.duration / TICKS_PER_SECOND, label: codecLabel, bytes: Math.round((pageBytes * clip.duration) / Math.max(1, length)) };
			enqueueExport(editor, `${base}_${index + 1}`, (journal) => runExport(editor, clipOptions, clipDelivery, false, undefined, journal), { quiet: true, request: videoRequest(clipOptions, clipDelivery, false) });
		});
		toast.success(`${clips.length} ${clips.length === 1 ? "clip" : "clips"} exporting`, { description: `Into ${shortFolder(into)}` });
		setShowSettings(false);
	};

	const checkingRoom = useRef(false);
	const [roomError, setRoomError] = useState<string | null>(null);
	const handleExport = async () => {
		if (!activeProject || checkingRoom.current) return;
		if (clipMode) {
			void handleExportClips();
			return;
		}
		// Room on the disk first: a full disk is said before the export starts, not as a failed file at its end.
		// one check at a time: a double-click must not queue the export twice
		checkingRoom.current = true;
		// (counted per volume: where the file grows and where it lands; with a second pass, its master too)
		const room = await studioApp()
			?.exportFile?.room?.(bytes, folder ?? null, videoOn && serverJob ? { masterBytes: pageBytes } : null)
			.catch(() => null)
			.finally(() => {
				checkingRoom.current = false;
			});
		// Said in the window itself, by its Export button: a toast's own button can't be clicked while this window is open.
		setRoomError(room && !room.ok ? noRoomText(room, bytes) : null);
		if (room && !room.ok) return;
		const name = resolveFileName(fileBase, { ...nameValues, now: new Date() });
		const range = exportRangeOnly && inOutRange ? { range: inOutRange } : {};
		if (captionsOn) {
			const text = captionFileText(captionCues(editor.scenes.getActiveScene().tracks, range.range), captionsFormat);
			const buffer = new TextEncoder().encode(text).buffer as ArrayBuffer;
			const filename = exportSaveName(`${name}.${captionsFormat}`);
			if (folder) {
				void saveToFolder({ data: buffer, folder, name: filename }).then(
					(saved) => !videoOn && !audioOn && !gifOn && toast.success(`Saved ${saved.split("/").pop()}`),
					(error) => toast.error(error instanceof Error ? error.message : "Couldn't save the captions."),
				);
			} else downloadBuffer({ buffer, filename, mimeType: captionsFormat === "srt" ? "application/x-subrip" : "text/plain" });
			if (!videoOn && !audioOn && !gifOn) {
				onClose();
				return;
			}
		}
		const manifest: ManifestDraft | undefined = (() => ({
					project: activeProject.metadata.name,
					platform: audioOnly ? "" : (platformInfo?.label ?? ""),
					format: audioOnly ? audioFormat : container,
					width: audioOnly ? null : width,
					height: audioOnly ? null : height,
					fps: audioOnly ? null : fps,
					seconds: Math.round(seconds * 100) / 100,
					quality: audioOnly ? null : quality,
					video_kbps: audioOnly ? null : Math.round(bitrate / 1000),
					audio: audioOnly || shouldIncludeAudio,
					loudness_lufs: (audioOnly || shouldIncludeAudio) && shouldNormalize ? targetLufs : null,
					captions: !audioOnly && burnCaptions,
					file_bits: audioOnly ? null : target.bitDepth,
					content_bits: audioOnly ? null : contentBits(target),
					range: inOutRange && exportRangeOnly ? `${formatRangeTime(inOutRange.start)}-${formatRangeTime(inOutRange.end)}` : "whole",
					exported_at: new Date().toISOString(),
					probeOnly: !prefs.manifest,
				}))();
		// Each checked section is a file of its own, made one after another: the video, its sound, the GIF.
		if (videoOn) {
			if (adMarked) {
				if (adBlocked) return;
				placeAdLabel(editor, adLabelText({ advertiser, erid }));
			}
			const delivery: Delivery = { filename: `${exportFileBase(name)}${fileExtension(target.container)}`, target, job: withExactFrames(serverJob, length, lead, smoothFps ? shotCuts(editor.scenes.getActiveScene().tracks, TICKS_PER_SECOND, range.range) : []), folder, seconds, label: codecLabel, bytes: pageBytes };
			const videoOptions = exportOptions(range.range);
			enqueueExport(editor, name, (journal) => runExport(editor, videoOptions, delivery, burnCaptions, manifest, journal), { request: videoRequest(videoOptions, delivery, burnCaptions, manifest) });
		}
		if (audioOn) {
			const audioInput = { ...range, normalize: shouldNormalize, targetLufs };
			const audioManifest = audioOnly ? manifest : manifest && { ...manifest, probeOnly: true, format: audioFormat, width: null, height: null, fps: null, audio: true };
			enqueueExport(editor, `${name} · ${audioFormat.toUpperCase()}`, (journal) => runAudioExport(editor, audioInput, name, audioFormat, folder, audioManifest, journal), {
				quiet: videoOn,
				request: { kind: "audio", input: audioInput, fileBase: name, format: audioFormat, folder, manifest: audioManifest },
			});
		}
		if (gifOn) {
			const gifDelivery: Delivery = { filename: `${exportFileBase(name)}.gif`, target: gifTarget, job: { target: gifTarget }, folder, seconds, label: "GIF" };
			const gifRender = gifOptions(range.range);
			enqueueExport(editor, `${name} · GIF`, (journal) => runExport(editor, gifRender, gifDelivery, false, undefined, journal), { quiet: videoOn || audioOn, request: videoRequest(gifRender, gifDelivery, false) });
		}
		setShowSettings(false);
	};

	const handleStillFrame = async () => {
		try {
			const { blob, seconds: at } = await renderStillFrame(editor, size);
			const stamp = `${Math.floor(at / 60)}-${String(Math.floor(at % 60)).padStart(2, "0")}`;
			const filename = exportSaveName(`${exportFileBase(resolvedName)}_${stamp}.png`);
			if (folder) {
				const saved = await saveToFolder({ data: blob, folder, name: filename });
				toast.success("Still frame exported", { description: saved.split("/").pop(), action: app?.reveal ? { label: "Show", onClick: () => app.reveal?.(saved) } : undefined });
			} else {
				downloadBuffer({ buffer: await blob.arrayBuffer(), filename, mimeType: "image/png" });
				toast.success("Still frame exported", { description: filename });
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Couldn't export the frame.");
		}
	};

	const exportAgain = () => {
		dismissedAt = Date.now();
		setShown((n) => n + 1);
	};

	// The job chip's progress (it includes the ffmpeg pass); the renderer's own while the job has none yet.
	const barProgress = job?.progress ?? (isExporting ? progress : 0);

	return (
		<DialogContent className="flex max-h-[min(92vh,700px)] w-[min(94vw,800px)] max-w-none flex-col gap-0 overflow-hidden p-0" data-testid="export-dialog" data-export-mode={clipMode ? "clips" : "video"}>
			<DialogHeader className="px-5 py-4">
				<DialogTitle className="text-[15px]">{busy ? "Exporting" : clipMode ? "Export clips" : "Export"}</DialogTitle>
			</DialogHeader>
			{!showSettings && exportResult && !exportResult.success && !exportResult.cancelled ? (
				<ExportError error={exportErrorText(exportResult.error)} onRetry={handleExport} />
			) : finished && job && !finishedEarlier ? (
				<ExportFinished job={job} onExportAgain={exportAgain} />
			) : busy ? (
				<div className="space-y-4 p-5">
					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between gap-2">
							<p className="text-sm tabular-nums" data-export-stage>
								{job?.stage ?? "Rendering frames"}
								{barProgress > 0 && ` · ${Math.round(barProgress * 100)}%`}
							</p>
							<p className="text-muted-foreground text-xs tabular-nums">
								{job && etaSeconds(job) != null
									? t(job.eta?.atLeast ? "at least {time} left" : "{time} left", { time: formatDuration(etaSeconds(job) ?? 0) })
									: job?.progress != null
										? "Estimating…"
										: ""}
							</p>
						</div>
						<Progress value={barProgress * 100} className="w-full" />
						<p className="text-muted-foreground text-xs">
							{t("Your export will continue in the background, so you can keep editing.")}
							{queued > 0 && ` ${t("{n} more waiting to export.", { n: queued })}`}
						</p>
					</div>
					<div className="flex gap-2">
						<Button variant="outline" className="flex-1 rounded-md" onClick={() => job?.cancel?.()} data-testid="export-cancel">
							Cancel
						</Button>
						<Button variant="outline" className="flex-1 rounded-md" onClick={() => setShowSettings(true)} data-testid="export-another">
							Export another
						</Button>
					</div>
				</div>
			) : (
				<>
					{finishedEarlier && job && (
						<div className="bg-constructive/10 text-constructive flex items-center gap-2 border-b px-5 py-2 text-xs" data-export-done-bar>
							<HugeiconsIcon icon={Tick02Icon} className="size-3.5 shrink-0" />
							<p className="text-foreground min-w-0 flex-1 truncate" title={job.messageTitle}>
								<span className="font-medium">{t("Export done")}</span>
								{job.message && ` · ${job.message}`}
							</p>
							{job.reveal && (
								<Button variant="outline" size="sm" className="h-6 shrink-0 px-2 text-[11px]" onClick={job.reveal} data-testid="export-reveal">
									{job.revealLabel ?? "Show"}
								</Button>
							)}
							<button type="button" className="text-muted-foreground hover:text-foreground shrink-0 px-1" aria-label={t("Hide")} onClick={exportAgain}>
								×
							</button>
						</div>
					)}
					<div className="flex min-h-0 flex-1 gap-5 overflow-hidden px-5 py-4">
						<div className="flex w-[11.5rem] shrink-0 flex-col items-center gap-2.5">
							<div
								className="bg-foreground/[0.04] relative flex w-full items-center justify-center overflow-hidden rounded-lg"
								style={{ aspectRatio: `${canvasSize.width} / ${canvasSize.height}`, maxHeight: "17rem" }}
							>
								{cover ? (
									// biome-ignore lint/performance/noImgElement: a blob URL of the chosen cover (next/image can't load it)
									<img src={cover.url} alt="Cover" className="absolute inset-0 size-full object-cover" data-export-cover />
								) : !isEmpty ? (
									// the edit as it is now: the project card's picture can be from an older version of it
									<FirstFrame editor={editor} size={canvasSize} />
								) : (
									<HugeiconsIcon icon={TransitionTopIcon} className="text-muted-foreground size-6" />
								)}
								{/* CapCut: «✎ Edit cover» on the picture's top-left corner opens «Select a cover». */}
								{!clipMode && (
									<button
										type="button"
										className="bg-primary text-primary-foreground absolute top-1.5 left-1.5 flex h-5 items-center gap-1 rounded-[4px] px-1.5 text-[11px] font-medium shadow disabled:opacity-50"
										onClick={() => setCoverOpen(true)}
										disabled={isEmpty}
										data-export-edit-cover
									>
										<HugeiconsIcon icon={Edit03Icon} className="size-3" />
										Edit cover
									</button>
								)}
							</div>
							{!clipMode && coverOpen && <CoverDialog editor={editor} size={size} onClose={() => setCoverOpen(false)} onPick={(picture) => void pickCover(picture)} />}
							{!clipMode && cover && (
								<div className="flex w-full items-start gap-1.5">
									<Checkbox
										id="export-cover-start"
										data-testid="export-cover-start"
										checked={cover.atStart}
										onCheckedChange={(checked) => setCover({ ...cover, atStart: checked === true })}
									/>
									<Label htmlFor="export-cover-start" className="text-[11px] leading-tight font-normal">
										Add video cover at the beginning
										{/* unticked, the cover changes nothing in the file — said, not left to be found out (check-export) */}
										{!cover.atStart && <span className="text-muted-foreground block text-[10px]">{t("Unticked: the cover is not in the file.")}</span>}
									</Label>
									<Hint label="Remove the cover">
										<button
											type="button"
											className="text-muted-foreground hover:text-foreground ml-auto text-xs"
											aria-label="Remove the cover"
											data-export-cover-remove
											onClick={() => {
												URL.revokeObjectURL(cover.url);
												setCover(null);
											}}
										>
											×
										</button>
									</Hint>
								</div>
							)}
							{clips.length > 0 && (
								<Button
									variant="ghost"
									size="sm"
									className="h-7 w-full text-xs"
									onClick={() => setMode(clipMode ? "video" : "clips")}
									data-testid="export-clips-toggle"
								>
									{clipMode ? "Export the whole video" : `Export selected clips (${clips.length})`}
								</Button>
							)}
						</div>
						<div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3.5">
							{moreBelow && (
								<div className="from-background pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-10 items-end justify-center bg-gradient-to-t to-transparent pb-0.5" data-export-more-below>
									<span className="text-muted-foreground flex items-center gap-1 text-[11px]">
										<HugeiconsIcon icon={ArrowDown01Icon} className="size-3" />
										{t("More below")}
									</span>
								</div>
							)}
							<div className="flex shrink-0 flex-col gap-3">
								<ExportField label={clipMode ? "Title" : "Name"}>
									<Input
										size="sm"
										value={fileBase}
										onChange={(event) => setFileBase(event.target.value)}
										onBlur={() => {
											const value = exportFileBase(fileBase);
											setFileBase(value);
											keepName(value);
										}}
										aria-label="File name"
										data-testid="export-name"
										className="min-w-0 flex-1"
									/>
								</ExportField>
								{clipMode && <p className="text-muted-foreground -mt-2 text-right text-[11px]">The exported file will be named with this title followed by a sequential number.</p>}
								{fileBase.includes("{") && (
									<p className="text-muted-foreground -mt-2 truncate text-right text-[11px]" data-export-resolved-name title={resolvedName}>
										→ {resolvedName}
									</p>
								)}
								{inOutRange && !clipMode && (
									<div className="flex items-center gap-2" data-export-range={exportRangeOnly ? "marked" : "whole"}>
										<Checkbox id="export-in-out" data-testid="export-in-out" checked={exportRangeOnly} onCheckedChange={(checked) => setExportRangeOnly(!!checked)} />
										<Label htmlFor="export-in-out" className="text-xs tabular-nums">
											{t("Only the marked part: {from}–{to}", { from: formatMark(inOutRange.start), to: formatMark(inOutRange.end) })}
										</Label>
									</div>
								)}
								<ExportField label="Export to">
									<div className="flex items-center gap-1" data-export-folder={folder ?? ""}>
										<p
											className="bg-foreground/[0.05] text-muted-foreground h-7 min-w-0 flex-1 truncate rounded-md px-2 text-xs leading-7"
											title={folder ?? "The Mac asks where to save when the file is ready"}
										>
											{folder ? shortFolder(folder) : "Asked when saving"}
										</p>
										{app?.pickFolder && (
											<Hint label="Choose a folder">
												<Button variant="outline" size="icon" className="size-7 shrink-0" onClick={() => void chooseFolder()} data-testid="export-choose-folder" aria-label="Choose a folder">
													<HugeiconsIcon icon={FolderOpenIcon} className="size-3.5" />
												</Button>
											</Hint>
										)}
										{folder && (
											<Hint label="Ask where to save each time">
												<Button variant="ghost" size="sm" className="h-7 shrink-0 px-1.5 text-[11px]" onClick={() => update({ folder: undefined })} aria-label="Ask where to save each time" data-testid="export-folder-clear">
													×
												</Button>
											</Hint>
										)}
									</div>
								</ExportField>
							</div>
							{/* Sections keep their height in the scroller (as flex items they were squeezed and the last, Captions, came out
							    cut at the bottom: design review 05.11), and the end has room below it. */}
							<div ref={watchScroller} className="scrollbar-thin border-foreground/[0.07] flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto border-t pt-3 pr-1 pb-4 [&>*]:shrink-0" data-export-sections>
							{clipMode && (
								<div className="flex flex-col gap-2" data-export-clips>
									<p className="text-xs">
										No. of clips: <span className="tabular-nums">{clips.length}</span>
									</p>
									<div className="flex items-start gap-2">
										<Checkbox id="export-all-changes" data-testid="export-all-changes" checked={includeAllChanges} onCheckedChange={(checked) => setIncludeAllChanges(checked === true)} />
										<Label htmlFor="export-all-changes" className="text-xs leading-snug">
											Include all changes when exporting
											<span className="text-muted-foreground block text-[11px] font-normal">
												Effects, filters, and other changes will be included. When turned off, only the position, size, and speed changes will be included.
											</span>
										</Label>
									</div>
								</div>
							)}
							<ExportSection id="video" label="Video" checked={videoOn || clipMode} onCheckedChange={(on) => setSections({ video: on })} hint={lastOnHint("video")}>
								<ExportField label="Resolution">
									<ExportSelect label="Resolution" value={String(resolution)} items={resolutionItems} onChange={(value) => update({ resolution: Number(value), platform: "custom" })} />
								</ExportField>
								{upscaling && (
									<div className="flex items-start gap-2">
										<Checkbox id="export-ai-upscale" data-testid="export-ai-upscale" checked={aiUpscale} onCheckedChange={(checked) => update({ aiUpscale: checked === true })} />
										<Label htmlFor="export-ai-upscale" className="text-xs leading-snug font-normal">
											AI upscale
											<span className="text-muted-foreground block text-[11px] tabular-nums">
												{`${canvasSize.width}×${canvasSize.height} → ${width}×${height}`}
											</span>
										</Label>
									</div>
								)}
								<ExportField label="Format">
									<ExportSelect label="Format" value={target.container} items={formatItems} onChange={(value) => chooseContainer(value as ExportContainer)} />
								</ExportField>
								{/* The few choices first (resolution, format); bit rate, codec, frame rate and colour open with the one
								    */}
								{(moreOpen || clipMode) && (
								<>
								<ExportField label="Bit rate" hint={fixedBitrate ? t("{codec} sets its own bit rate.", { codec: codecLabel }) : undefined}>
									<ExportSelect
										label="Bit rate"
										value={bitrateValue}
										items={BITRATES.map((b) => ({ value: b.value, label: b.label }))}
										disabled={fixedBitrate}
										onChange={(value) =>
											value === "custom"
												? update({ customMbps: Math.round(bitrate / 100_000) / 10, platform: "custom" })
												: update({ quality: value as ExportQuality, customMbps: undefined })
										}
									/>
								</ExportField>
								{customBitrate && !fixedBitrate && (
									<ExportField label="Mbit/s">
										<Input
											size="sm"
											type="number"
											min={0.5}
											max={800}
											step={0.5}
											value={prefs.customMbps ?? 10}
											onChange={(event) => {
												const value = Number(event.target.value);
												if (value > 0 && value <= 800) update({ customMbps: value });
											}}
											aria-label="Bit rate in Mbit/s"
											data-testid="export-custom-bitrate"
										/>
									</ExportField>
								)}
								<ExportField label="Codec">
									<ExportSelect
										label="Codec"
										value={target.codec}
										items={EXPORT_CODECS.filter((c) => !c.hidden).map((c) => ({ value: c.value, label: c.label, note: c.note }))}
										onChange={(value) => chooseCodec(value as ExportCodec)}
									/>
								</ExportField>
								<ExportField label="Frame rate">
									<ExportSelect label="Frame rate" value={fpsChoice} items={fpsItems} onChange={(value) => update({ fps: value })} />
								</ExportField>
								{smoothing && (
									<div className="flex items-start gap-2">
										<Checkbox id="export-smooth" data-testid="export-smooth" checked={smoothFps} onCheckedChange={(checked) => update({ smoothFps: checked === true })} />
										<Label htmlFor="export-smooth" className="text-xs leading-snug font-normal">
											Smooth frames (optical flow)
											<span className="text-muted-foreground block text-[11px]">
												{t("{from} → {to} fps: the frames in between are drawn by Apple frame interpolation, no repeated frames.", { from: projectFps, to: fps })}{" "}
												{t("Several times slower than a plain export.")}
											</span>
										</Label>
									</div>
								)}
								<ExportField
									label="Color space"
									// The truth about depth: the frames are drawn in 8 bits, so a 10-bit, ProRes or HDR file carries 8-bit
									// content until the picture path itself is deeper (export/target.ts PICTURE_BITS).
									hint={contentBits(target) < target.bitDepth ? <span data-export-depth-note>{t("This export carries 8-bit content: frames are drawn in 8 bits.")}</span> : undefined}
								>
									{/* CapCut shows the colour space as text; HEVC and ProRes can also carry the picture as HDR (10-bit). */}
									{codecInfo.hdr ? (
										<ExportSelect label="Color space" value={target.color} items={COLOR_SPACES} onChange={(value) => chooseColor(value as ExportColor)} />
									) : (
										// A fixed field, drawn like the selects above it (disabled) so the row lines up with theirs.
										<p className="border-border bg-accent/50 text-muted-foreground flex h-7 items-center rounded-sm border px-2.5 text-sm opacity-70" data-export-color-space aria-disabled="true">
											Rec. 709 SDR
										</p>
									)}
								</ExportField>
								</>
								)}
							</ExportSection>
							{!clipMode && (
								<button
									type="button"
									className="text-muted-foreground hover:text-foreground border-foreground/[0.07] flex items-center justify-between border-t pt-3 text-left text-xs"
									onClick={() => setMoreOpen((open) => !open)}
									aria-expanded={moreOpen}
									data-testid="export-more"
								>
									More options
									<HugeiconsIcon icon={ArrowDown01Icon} aria-hidden="true" className={cn("size-3.5", fold(moreOpen))} />
								</button>
							)}
							{/* the other files (sound alone, GIF, captions) are «More options» too (12.11): one video is the default */}
							{!clipMode && moreOpen && (
								<ExportSection id="audio" label="Audio" checked={audioOn} onCheckedChange={(on) => setSections({ audio: on })} hint={lastOnHint("audio")}>
									<ExportField label="Format">
										<ExportSelect label="Audio format" value={audioFormat} items={AUDIO_FORMATS} onChange={(value) => update({ audioFormat: value as AudioFileFormat })} />
									</ExportField>
								</ExportSection>
							)}
							{!clipMode && moreOpen && (
								<ExportSection id="gif" label="Export GIF" checked={gifOn} onCheckedChange={(on) => setSections({ gif: on })} hint={lastOnHint("gif")}>
									<ExportField label="Resolution">
										<ExportSelect
											label="GIF resolution"
											value={String(gifResolution)}
											items={GIF_SIZES.map((value) => ({ value: String(value), label: `${value}P` }))}
											onChange={(value) => update({ gifResolution: Number(value) })}
										/>
									</ExportField>
								</ExportSection>
							)}
							{!clipMode && moreOpen && (
								<ExportSection id="captions" label="Captions" checked={captionsOn} disabled={captionCount === 0} onCheckedChange={(on) => setSections({ captions: on })} hint={captionCount === 0 ? t("No captions on the timeline yet") : lastOnHint("captions")}>
									<ExportField label="Format">
										<ExportSelect
											label="Captions format"
											value={captionsFormat}
											items={[
												{ value: "srt", label: "SRT" },
												{ value: "txt", label: "TXT" },
											]}
											onChange={(value) => setCaptionsFormat(value as CaptionFileFormat)}
										/>
									</ExportField>
								</ExportSection>
							)}
							{moreOpen && !clipMode && (
								<div className="flex flex-col gap-3.5">
									<div className="flex items-start gap-2">
										<Checkbox id="normalize-loudness" checked={shouldNormalize} onCheckedChange={(checked) => update({ normalizeLoudness: !!checked })} />
										<Label htmlFor="normalize-loudness" className="text-xs leading-snug">
											{t("Even loudness ({lufs} LUFS)", { lufs: targetLufs })}
											<span className="text-muted-foreground block text-[11px] font-normal">Settings → Edit → Target loudness</span>
										</Label>
									</div>
									<Button variant="outline" size="sm" className="h-7 w-fit text-xs" onClick={() => void handleStillFrame()} disabled={isEmpty} data-testid="export-still-frame" title="The frame under the playhead as a PNG">
										Export still frame
									</Button>
									{videoOn && (
										<ExportRow
											label="For"
											hint={
												platformInfo &&
												`${platformInfo.aspect} · ${platformInfo.maxSeconds ? t("up to {length}", { length: formatLength(platformInfo.maxSeconds * TICKS_PER_SECOND) }) : t("any length")} · MP4${shouldNormalize ? `, ${t("even loudness")}` : ""}`
											}
										>
											<PlatformGrid value={platform} onChange={choosePlatform} />
										</ExportRow>
									)}
									{videoOn && issues && platformInfo && (issues.aspect || issues.tooLong || issues.lowRes) && (
										<PlatformWarnings
											label={platformInfo.label}
											issues={issues}
											length={length}
											hasInOut={!!inOutRange}
											onFix={(aspect) =>
												void editor.project.updateSettings({
													settings: { canvasSize: sizeInFormat(canvasSize, aspect), canvasSizeMode: "preset" },
												})
											}
										/>
									)}
									<ExportRow label="Name tokens">
										<div className="flex flex-wrap gap-1">
											{NAME_TOKENS.map((token) => (
												<Hint key={token} label={`Add ${token} to the name`}>
													<button
														type="button"
														className="bg-muted text-foreground/75 hover:text-foreground focus-visible:ring-ring rounded px-1.5 py-0.5 font-mono text-[10px] focus-visible:ring-1 focus-visible:outline-hidden"
														data-name-token={token}
														onClick={() => {
															// Plain text becomes {project}_<token>: a token on its own is rarely what anyone wants.
															const value = fileBase.includes("{") ? `${fileBase}_${token}` : token === "{project}" ? "{project}" : `{project}_${token}`;
															setFileBase(value);
															keepName(value);
														}}
													>
														{token}
													</button>
												</Hint>
											))}
										</div>
										<div className="flex items-center gap-2">
											<Checkbox id="export-manifest" data-testid="export-manifest" checked={prefs.manifest ?? false} onCheckedChange={(checked) => update({ manifest: !!checked })} />
											<Label htmlFor="export-manifest" className="text-xs">
												Save a manifest beside it (.json + exports.csv)
											</Label>
										</div>
									</ExportRow>
									{videoOn && (
										<div className="flex items-start gap-2">
											<Checkbox id="export-captions" data-testid="export-captions" checked={burnCaptions} onCheckedChange={(checked) => setBurnCaptions(!!checked)} />
											<Label htmlFor="export-captions" className="text-xs leading-snug">
												Burn in captions from speech
												<span className="text-muted-foreground block text-[11px] font-normal">On this Mac. Adds an editable captions track first (⌘Z removes it)</span>
											</Label>
										</div>
									)}
									{videoOn && (
										<ExportRow label="Ad marking (Russia)">
											<div className="flex items-center gap-2">
												<Checkbox id="export-ad" data-testid="export-ad" checked={adMarked} onCheckedChange={(checked) => setAdMarked(!!checked)} />
												<Label htmlFor="export-ad" className="text-xs">
													This video is an ad
												</Label>
											</div>
											{adMarked && (
												<>
													<Input size="sm" value={advertiser} onChange={(event) => setAdvertiser(event.target.value)} placeholder="Advertiser (optional)" aria-label="Advertiser" data-testid="export-advertiser" />
													<Input size="sm" value={erid} onChange={(event) => setErid(event.target.value)} placeholder="erid token" aria-label="erid token" data-testid="export-erid" className="font-mono" />
													<p className={cn("text-[11px] leading-tight", adBlocked && erid ? "text-caution" : "text-muted-foreground")}>
														{adBlocked && erid
															? "An erid is 6–64 letters and digits, as the ad registry gives it"
															: `Adds «${adLabelText({ advertiser, erid: erid || "…" })}» on the whole video as a text track (⌘Z removes it)`}
													</p>
												</>
											)}
										</ExportRow>
									)}
								</div>
							)}
						</div>
						</div>
					</div>
					{roomError && (
						<div className="text-destructive flex items-center gap-3 border-t px-5 py-2 text-xs" role="alert" data-testid="export-room">
							<p className="min-w-0 flex-1">{roomError}</p>
							<Button variant="outline" size="sm" className="h-7 shrink-0 text-xs" onClick={() => void handleExport()}>
								<HugeiconsIcon icon={RefreshIcon} />
								Try again
							</Button>
						</div>
					)}
					<DialogFooter className="flex flex-row items-center justify-between gap-3 border-t px-5 py-3">
						{/* CapCut: «🎞 Duration: 10s | Size: about 15 MB». */}
						<p className="text-muted-foreground flex items-center gap-1.5 text-xs tabular-nums" data-export-summary>
							<HugeiconsIcon icon={Video01Icon} className="size-3.5" />
							{t("Duration: {d}", { d: durationText(seconds) })}
							{!isEmpty && bytes > 0 && <> {t("| Size: about {size}", { size: formatBytes(bytes) })}</>}
						</p>
						<div className="flex items-center gap-2">
							<Button variant="ghost" onClick={() => (showSettings ? setShowSettings(false) : onClose())}>
								Cancel
							</Button>
							<Button
								onClick={handleExport}
								className="gap-2"
								data-testid="export-start"
								disabled={isEmpty || (adBlocked && !clipMode)}
								title={isEmpty ? "Add a clip to the timeline first" : adBlocked ? "Enter the ad's erid token" : undefined}
							>
								<HugeiconsIcon icon={TransitionTopIcon} className="size-4" />
								Export
							</Button>
						</div>
					</DialogFooter>
				</>
			)}
		</DialogContent>
	);
}

/** Eight places don't fit one segmented row at 24rem: the same look as a 4 × 2 grid. */
function PlatformGrid({ value, onChange }: { value: PlatformChoice; onChange: (value: PlatformChoice) => void }) {
	const lang = useLang((s) => s.lang);
	return (
		<fieldset className="bg-muted m-0 grid min-w-0 grid-cols-4 gap-0.5 rounded-md border-0 p-0.5" aria-label="Platform">
			{platformItems(lang, value).map((item) => {
				const active = item.value === value;
				return (
					<button
						key={item.value}
						type="button"
						aria-pressed={active}
						title={item.title}
						data-export-platform={item.value}
						onClick={() => onChange(item.value)}
						className={cn(
							"focus-visible:ring-ring h-7 min-w-0 cursor-pointer truncate rounded-[5px] px-1.5 text-[13px] font-medium transition-colors focus-visible:ring-1 focus-visible:outline-hidden",
							active ? "bg-background text-foreground shadow-sm" : "text-foreground/65 hover:text-foreground",
						)}
					>
						{item.label}
					</button>
				);
			})}
		</fieldset>
	);
}

/** What doesn't fit the platform, each with the way out (Make 9:16 is one undo step). */
function PlatformWarnings({
	label,
	issues,
	length,
	hasInOut,
	onFix,
}: {
	label: string;
	issues: PlatformIssues;
	length: number;
	hasInOut: boolean;
	onFix: (aspect: ExportPlatform["aspect"]) => void;
}) {
	const t = useT();
	return (
		<div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs" data-export-warning>
			{issues.aspect && (
				<div className="flex items-center justify-between gap-2">
					<span>
						{t("{platform} plays {aspect}. This video shows with bars.", { platform: label, aspect: issues.aspect ?? "" })}
					</span>
					<Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-xs" onClick={() => issues.aspect && onFix(issues.aspect)}>
						{t("Make {aspect}", { aspect: issues.aspect ?? "" })}
					</Button>
				</div>
			)}
			{issues.tooLong && (
				<span>
					{label} takes up to {formatLength(issues.tooLong * TICKS_PER_SECOND)}; this is {formatLength(length)}.
					{hasInOut ? " Export only In→Out, or trim it." : " Trim it, or set In/Out (I, O)."}
				</span>
			)}
			{issues.lowRes && <span className="text-muted-foreground">{t("Under 1080p: {platform} shows it soft.", { platform: label })}</span>}
		</div>
	);
}

/** Done: where the file went, Show in Finder, Export again; a closed save dialog offers Save again (no re-render). */
function ExportFinished({ job, onExportAgain }: { job: Job; onExportAgain: () => void }) {
	const failed = job.status === "error";
	// A render that failed is exported again; a made video that was not saved (a closed Save dialog, a folder gone) is
	// saved again.
	const renderFailed = failed && /^(Couldn't render|No captions|The disk is full)/.test(job.message ?? "");
	// the Save dialog is still open: nothing to show yet and no size line (a saved file has one or the other)
	const waiting = !failed && !job.reveal && !job.messageDetail;
	return (
		<div className="flex flex-col gap-3 p-3" data-export-done={failed ? "unsaved" : waiting ? "saving" : "saved"}>
			<div className="flex items-start gap-2.5">
				<span
					className={cn(
						"mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
						failed ? "bg-amber-500/15 text-amber-500" : "bg-constructive/15 text-constructive",
					)}
				>
					{failed ? <HugeiconsIcon icon={RefreshIcon} className="size-3.5" /> : <HugeiconsIcon icon={Tick02Icon} className="size-3.5" />}
				</span>
				<div className="flex min-w-0 flex-col gap-0.5">
					<p className="text-sm font-medium">{renderFailed ? "Export failed" : failed ? "Not saved yet" : waiting ? "Rendered" : "Export done"}</p>
					<p className="text-muted-foreground truncate text-xs" title={job.messageTitle}>
						{job.message}
					</p>
					{job.messageDetail && <p className="text-muted-foreground truncate text-xs tabular-nums">{job.messageDetail.split(" · ").filter((part) => !fallbackSentences(job.id).some((note) => note.text === part)).join(" · ")}</p>}
					{!failed &&
						fallbackSentences(job.id).map((note) => (
							<p key={note.step} className="text-xs text-amber-500" data-export-fallback={note.step}>
								{note.text}
							</p>
						))}
				</div>
			</div>
			<div className="flex gap-2">
				{failed && job.retry ? (
					<Button size="sm" className="h-8 flex-1 text-xs" onClick={job.retry} data-testid="export-save-again">
						{renderFailed ? <HugeiconsIcon icon={RefreshIcon} /> : <HugeiconsIcon icon={Download04Icon} />}
						{renderFailed ? "Try again" : "Save again"}
					</Button>
				) : (
					job.reveal && (
						<Button size="sm" className="h-8 flex-1 text-xs" onClick={job.reveal} data-testid="export-reveal">
							{job.revealLabel ?? "Show"}
						</Button>
					)
				)}
				<Button variant="outline" size="sm" className="h-8 flex-1 text-xs" onClick={onExportAgain} data-testid="export-again">
					<HugeiconsIcon icon={RefreshIcon} />
					Export again
				</Button>
			</div>
		</div>
	);
}

function ExportError({
	error,
	onRetry,
}: {
	error: string;
	onRetry: () => void;
}) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(error);
		setCopied(true);
		setTimeout(() => setCopied(false), 1000);
	};

	return (
		<div className="space-y-4 p-3">
			<div className="flex flex-col gap-1.5">
				<p className="text-destructive text-sm font-medium">Export failed</p>
				<p className="text-muted-foreground text-xs">{error}</p>
			</div>

			<div className="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={handleCopy}
				>
					{copied ? <HugeiconsIcon icon={Tick02Icon} className="text-constructive" /> : <HugeiconsIcon icon={Copy01Icon} />}
					Copy
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={onRetry}
				>
					<HugeiconsIcon icon={RefreshIcon} />
					Retry
				</Button>
			</div>
		</div>
	);
}
