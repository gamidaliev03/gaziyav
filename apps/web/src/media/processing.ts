import { toast } from "sonner";
import { getMediaTypeFromFile } from "@/media/media-utils";
import { formatStorageBytes } from "@/services/storage/quota";
import { storageService } from "@/services/storage/service";
import type { MediaAsset, MediaType } from "@/media/types";
import { jobCenter, useJobsStore } from "@/jobs/store";
import {
	ConvertUnavailableError,
	convertForImport,
	mediaTypeFromExtension,
	mustConvertBeforeImport,
} from "./convert";
import { needsEditingProxy } from "./editing-proxy";
import { importSourceOf } from "./originals";
import { NoVideoTrackError, readAudioFile, readVideoFile } from "./mediabunny";
import type { VideoFileData } from "./mediabunny";
import { renderThumbnailDataUrl } from "./thumbnail";
import { normalizeMediaFps } from "@/fps/utils";
import { t } from "@/i18n";

export interface ProcessedMediaAsset extends Omit<MediaAsset, "id"> {
	/** The user's own file when `file` is an editing copy of it: the export renders from it (MediaManager keeps it). */
	editingOriginal?: File;
}

const getUnsupportedVideoDescription = ({
	codec,
}: {
	codec: VideoFileData["codec"];
}): string => {
	return codec
		? t("{codec} can't be decoded here and the automatic conversion didn't work, so this clip may not preview correctly. Convert it to H.264 MP4 and import it again.", { codec: codec.toUpperCase() })
		: t("This video codec can't be decoded here and the automatic conversion didn't work, so this clip may not preview correctly. Convert it to H.264 MP4 and import it again.");
};

const getStorageLimitDescription = ({
	fileSize,
	availableBytes,
}: {
	fileSize: number;
	availableBytes: number | null;
}): string => {
	const fileSizeLabel = formatStorageBytes({ bytes: fileSize });

	if (availableBytes === null) {
		return t("The file is {size}. Free up disk space and try again.", { size: fileSizeLabel });
	}

	return t("The file is {size}, but only {free} is free for the app. Free up disk space and try again.", { size: fileSizeLabel, free: formatStorageBytes({ bytes: availableBytes }) });
};

async function generateImageThumbnail({
	imageFile,
}: {
	imageFile: File;
}): Promise<{ thumbnailUrl: string; width: number; height: number }> {
	return new Promise((resolve, reject) => {
		const image = new window.Image();
		const objectUrl = URL.createObjectURL(imageFile);

		image.addEventListener("load", () => {
			try {
				const thumbnailUrl = renderThumbnailDataUrl({
					width: image.naturalWidth,
					height: image.naturalHeight,
					draw: ({ context, width, height }) => {
						context.drawImage(image, 0, 0, width, height);
					},
				});
				resolve({
					thumbnailUrl,
					width: image.naturalWidth,
					height: image.naturalHeight,
				});
			} catch (error) {
				reject(
					error instanceof Error ? error : new Error("Could not render image"),
				);
			} finally {
				URL.revokeObjectURL(objectUrl);
				image.remove();
			}
		});

		image.addEventListener("error", () => {
			URL.revokeObjectURL(objectUrl);
			image.remove();
			reject(new Error("Could not load image"));
		});

		image.src = objectUrl;
	});
}

const UNSUPPORTED_DESCRIPTION =
	"This format isn't supported. Use MP4, MOV, MP3, WAV, M4A, PNG, JPG or HEIC and try again.";
const DAMAGED_DESCRIPTION = "The file couldn't be read. It may be damaged or not fully downloaded: try another copy of it.";
const KNOWN_EXTENSION = /\.(mp4|m4v|mov|webm|mkv|mp3|wav|m4a|aac|flac|ogg|png|jpe?g|heic|gif|webp)$/i;

/** What to tell the user when a file fails: a known format that won't read is damaged, not «unsupported». */
function importFailure(file: File, error?: unknown): string {
	if (!KNOWN_EXTENSION.test(file.name)) return t(UNSUPPORTED_DESCRIPTION);
	const message = error instanceof Error ? error.message : "";
	// A short, plain reason (disk full…) is kept; raw converter output with internal paths is not.
	return message && message.length < 160 && !/[\n/\\]/.test(message) ? t(message) : t(DAMAGED_DESCRIPTION);
}

/** The user was already told why this file failed (no second toast). */
class ReportedError extends Error {}

const seconds = (value: number) => t("{n} s", { n: value < 10 ? value.toFixed(1) : Math.round(value) });

async function convertWithJob({
	file,
	kind,
	repair = false,
	editing = false,
	job,
}: {
	file: File;
	kind: MediaType;
	repair?: boolean;
	/** An editing copy (the original is kept for the export), not the file the export will render from. */
	editing?: boolean;
	/** The job of the file's placeholder in Media: the conversion shows on it (its caller ends it). */
	job?: string;
}): Promise<File | null> {
	// One job center for all background work: conversion shows in the header
	// chip (progress, ETA, Cancel) and as a dot on the Media tab.
	const controller = new AbortController();
	const own = !job;
	const jobId =
		job ??
		jobCenter.start({
			kind: "other",
			title: t("Import"),
			stage: t("Converting {name}", { name: file.name }),
			progress: 0,
			tab: "media",
			cancel: () => controller.abort(),
		});
	if (job) jobCenter.update(job, { stage: t("Converting {name}", { name: file.name }), progress: 0, cancel: () => controller.abort() });
	let lastPercent = -1;
	try {
		const converted = await convertForImport({
			file,
			kind,
			repair,
			editing,
			signal: controller.signal,
			onProgress: (value) => {
				const percent = Math.floor(value * 100);
				if (percent === lastPercent) return;
				lastPercent = percent;
				jobCenter.update(jobId, { progress: value });
			},
		});
		if (own) jobCenter.finish(jobId, t("{name} is ready to edit", { name: file.name }));
		else jobCenter.update(jobId, { cancel: undefined });
		return converted;
	} catch (error) {
		if (controller.signal.aborted) {
			if (own) jobCenter.cancelled(jobId);
			return null;
		}
		const message = error instanceof ConvertUnavailableError ? t(UNSUPPORTED_DESCRIPTION) : importFailure(file, error);
		if (own) jobCenter.fail(jobId, t("Couldn't import {file}: {reason}", { file: file.name, reason: message }));
		else jobCenter.update(jobId, { cancel: undefined });
		toast.error(t("Couldn't import {name}", { name: file.name }), { description: message });
		return null;
	}
}

/** A placeholder's still, once there is one (the first frame of the file being read). */
function showStill(jobId: string, still: string) {
	const job = useJobsStore.getState().jobs.find((j) => j.id === jobId);
	const media = job?.place?.media;
	if (job && media && !media.still) jobCenter.update(jobId, { place: { ...job.place, media: { ...media, still } } });
}

export async function processMediaAssets({
	files,
	onProgress,
	job,
}: {
	files: FileList | File[];
	onProgress?: ({ progress }: { progress: number }) => void;
	/** The job of the file's placeholder in Media (one file): conversions show on it, its still becomes the first frame. */
	job?: string;
}): Promise<ProcessedMediaAsset[]> {
	const fileArray = Array.from(files);
	const processedAssets: ProcessedMediaAsset[] = [];

	const total = fileArray.length;
	let completed = 0;

	for (const originalFile of fileArray) {
		let file = originalFile;
		let fileType =
			getMediaTypeFromFile({ file }) ?? mediaTypeFromExtension(file.name);
		let wasConverted = false;

		if (!fileType) {
			toast.error(t("Couldn't import {name}", { name: file.name }), {
				description: t(UNSUPPORTED_DESCRIPTION),
			});
			continue;
		}

		// Formats the editor can't decode at all go through the local proxy first.
		const forcedKind = mustConvertBeforeImport(file);
		if (forcedKind) {
			const converted = await convertWithJob({ file, kind: forcedKind, job });
			if (!converted) continue;
			file = converted;
			fileType = forcedKind;
			wasConverted = true;
		}

		// the user's file from an ordinary place is used where it is: the import needs no room for it (a copy does)
		const inPlace = !wasConverted && (await importSourceOf(file).catch(() => null))?.inPlace === true;
		const storageCheck = inPlace
			? null
			: await storageService.canStoreFile({
					size: file.size,
				});

		if (storageCheck && !storageCheck.canStore) {
			toast.error(t("Not enough disk space for {name}", { name: file.name }), {
				description: getStorageLimitDescription({
					fileSize: file.size,
					availableBytes: storageCheck.availableBytes,
				}),
			});
			continue;
		}

		let url = URL.createObjectURL(file);
		let thumbnailUrl: string | undefined;
		let duration: number | undefined;
		let width: number | undefined;
		let height: number | undefined;
		let fps: number | undefined;
		let hasAudio: boolean | undefined;
		let editingOriginal: File | undefined;

		// Swaps in a converted copy when the editor can't read the original.
		const fallBackToProxy = async (kind: MediaType, repair = false, editing = false): Promise<boolean> => {
			if (wasConverted) return false;
			const converted = await convertWithJob({ file, kind, repair, editing, job });
			if (!converted) return false;
			URL.revokeObjectURL(url);
			file = converted;
			url = URL.createObjectURL(file);
			wasConverted = true;
			return true;
		};

		try {
			if (fileType === "image") {
				let result: Awaited<ReturnType<typeof generateImageThumbnail>>;
				try {
					result = await generateImageThumbnail({ imageFile: file });
				} catch (error) {
					if (!(await fallBackToProxy("image"))) throw error;
					result = await generateImageThumbnail({ imageFile: file });
				}
				thumbnailUrl = result.thumbnailUrl;
				width = result.width;
				height = result.height;
			}
			if (fileType === "video") {
				let videoData: VideoFileData | null = null;
				try {
					videoData = await readVideoFile({ file });
					// Its placeholder shows the real first frame from now on (a proxy may still be made).
					if (job && videoData?.thumbnailUrl) showStill(job, videoData.thumbnailUrl);
				} catch (error) {
					// An .mp4/.mov with sound only (voice memos, audio downloads) is a sound file, not a broken video.
					if (error instanceof NoVideoTrackError && error.hasAudio) fileType = "audio";
					else console.warn("[import] can't read video, converting", error);
				}
				// HEVC/HDR, ProRes and odd containers: make an H.264 proxy automatically.
				if (fileType === "video" && (!videoData || !videoData.canDecode) && (await fallBackToProxy("video"))) {
					// The converter found sound only (a picture stream that was cover art): import the sound.
					if (file.type.startsWith("audio/")) fileType = "audio";
					else videoData = await readVideoFile({ file });
				}
				if (fileType === "video") {
					if (!videoData) {
						throw new Error("unreadable video");
					}
					// Cut off midway (interrupted download or copy): the picture froze where the data ends.
					// Keep the part that is there, and say so.
					const cut = videoData.readableUntil;
					if (cut !== null) {
						const full = videoData.duration;
						if (cut < 0.1) throw new Error("no readable picture");
						if (!(await fallBackToProxy("video", true))) throw new ReportedError("incomplete");
						videoData = await readVideoFile({ file });
						toast.warning(t("{name} is incomplete", { name: originalFile.name }), {
							description: t("Only the first {cut} of {full} are in the file: the download or copy was cut off. That part was imported.", { cut: seconds(cut), full: seconds(full) }),
						});
					}
					// Decoded in software (AV1 on M1/M2, H.264 10-bit): seeks took up to 1.6 s. Edit an H.264 copy the graphics
					// chip decodes, with a key frame every half second. Cancelling the conversion keeps the original.
					// The user's file stays for the export (CapCut: the copy is for the preview only).
					// Quiet (perf round B, the owner: no «proxy / not proxy» to think about): the conversion is the tile's own
					// progress, nothing is asked and nothing is announced; the export renders from the user's file.
					const userFile = file;
					if (needsEditingProxy(videoData) && (await fallBackToProxy("video", false, true))) {
						editingOriginal = userFile;
						videoData = await readVideoFile({ file });
					}
					duration = videoData.duration;
					width = videoData.width;
					height = videoData.height;
					fps = normalizeMediaFps(videoData.fps);
					hasAudio = videoData.hasAudio;
					thumbnailUrl = videoData.thumbnailUrl ?? undefined;

					if (!videoData.canDecode) {
						toast.error(t("Can't preview {name}", { name: file.name }), {
							description: getUnsupportedVideoDescription({
								codec: videoData.codec,
							}),
						});
					}
				}
			}
			if (fileType === "audio") {
				// Played and mixed through the same decoder: what it can't read (WMA, AMR, AIFF…) gets an AAC copy.
				let audioData = await readAudioFile({ file }).catch(() => null);
				if (!audioData?.canDecode && (await fallBackToProxy("audio"))) {
					audioData = await readAudioFile({ file }).catch(() => null);
				}
				if (!audioData?.canDecode) {
					throw new Error("unreadable audio");
				}
				duration = audioData.duration;
				if (audioData.readableUntil !== null) {
					toast.warning(t("{name} is incomplete", { name: file.name }), {
						description: t("The sound stops after {at} of {full}: the download or copy was cut off.", { at: seconds(audioData.readableUntil), full: seconds(audioData.duration) }),
					});
				}
			}

			processedAssets.push({
				name: file.name,
				type: fileType,
				file,
				url,
				thumbnailUrl,
				duration,
				width,
				height,
				fps,
				hasAudio,
				...(editingOriginal ? { editingOriginal } : {}),
			});

			await new Promise((resolve) => setTimeout(resolve, 0));

			completed += 1;
			if (onProgress) {
				const percent = Math.round((completed / total) * 100);
				onProgress({ progress: percent });
			}
		} catch (error) {
			console.error("Error processing file:", file.name, error);
			if (!(error instanceof ReportedError)) {
				toast.error(t("Couldn't import {name}", { name: file.name }), {
					description: importFailure(file),
				});
			}
			URL.revokeObjectURL(url);
		}
	}

	return processedAssets;
}
