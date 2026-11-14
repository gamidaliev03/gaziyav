import { useEffect } from "react";
import { useEditor } from "@/editor/use-editor";
import { processMediaAssets } from "@/media/processing";
import { splitKnownFiles } from "@/components/editor/panels/assets/views/known-files";
import { showMediaUploadToast } from "@/media/upload-toast";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { AddMediaAssetCommand } from "@/commands/media";
import { InsertElementCommand } from "@/commands/timeline";
import { BatchCommand } from "@/commands";
import { stillDuration } from "@/timeline/creation";
import { mediaTimeFromSeconds } from "@/wasm";
import { isTypableDOMElement } from "@/utils/browser";
import type { MediaType } from "@/media/types";
import { looksLikeYouTubeVideo, useStudioStore } from "@/studio/client/studio-store";

const MEDIA_MIME_PREFIXES: MediaType[] = ["image", "video", "audio"];

function isMediaMimeType({ type }: { type: string }): boolean {
	return MEDIA_MIME_PREFIXES.some((prefix) => type.startsWith(`${prefix}/`));
}

function extractMediaFilesFromClipboard({
	clipboardData,
}: {
	clipboardData: DataTransfer | null;
}): File[] {
	if (!clipboardData?.items) return [];

	const files: File[] = [];
	for (const item of clipboardData.items) {
		if (item.kind !== "file") continue;
		if (!isMediaMimeType({ type: item.type })) continue;

		const file = item.getAsFile();
		if (file) files.push(file);
	}
	return files;
}

export function usePasteMedia() {
	const editor = useEditor();

	useEffect(() => {
		const handlePaste = async (event: ClipboardEvent) => {
			const activeElement = document.activeElement as HTMLElement;

			if (activeElement && isTypableDOMElement({ element: activeElement })) {
				return;
			}

			const files = extractMediaFilesFromClipboard({
				clipboardData: event.clipboardData,
			});
			if (files.length === 0) {
				event.preventDefault();
				// ⌘V of a YouTube link opens the clip picker with it.
				const pastedText = event.clipboardData?.getData("text/plain")?.trim() ?? "";
				if (looksLikeYouTubeVideo(pastedText)) {
					useStudioStore.getState().setYoutubeOpen(true, pastedText);
					return;
				}
				editor.clipboard.paste();
				return;
			}

			event.preventDefault();

			const activeProject = editor.project.getActive();
			if (!activeProject) return;

			try {
				await showMediaUploadToast({
					filesCount: files.length,
					promise: async () => {
						// A file already in Media (same name and size) goes on the timeline from its asset, not imported again.
						const { fresh, known } = splitKnownFiles({
							files,
							assets: editor.media.getAssets(),
							originalSizeOf: (id) => editor.media.getEditingOriginal(id)?.file.size,
						});
						const processedAssets = await processMediaAssets({ files: fresh });
						const startTime = editor.playback.getCurrentTime();

						for (const { assetId } of known) {
							const existing = editor.media.getAssets().find((asset) => asset.id === assetId);
							if (!existing) continue;
							editor.command.execute({
								command: new InsertElementCommand({
									element: buildElementFromMedia({
										mediaId: existing.id,
										mediaType: existing.type,
										name: existing.name,
										duration:
											existing.duration != null
												? mediaTimeFromSeconds({ seconds: existing.duration })
												: stillDuration(),
										startTime,
									}),
									placement: { mode: "auto", trackType: existing.type === "audio" ? "audio" : "video" },
								}),
							});
						}

						for (const asset of processedAssets) {
							const addMediaCmd = new AddMediaAssetCommand({
								projectId: activeProject.metadata.id,
								asset,
							});
							const assetId = addMediaCmd.getAssetId();
							const duration =
								asset.duration != null
									? mediaTimeFromSeconds({ seconds: asset.duration })
									: stillDuration();
							const trackType = asset.type === "audio" ? "audio" : "video";

							const element = buildElementFromMedia({
								mediaId: assetId,
								mediaType: asset.type,
								name: asset.name,
								duration,
								startTime,
								buffer:
									asset.type === "audio"
										? new AudioBuffer({ length: 1, sampleRate: 44100 })
										: undefined,
							});

							const insertCmd = new InsertElementCommand({
								element,
								placement: { mode: "auto", trackType },
							});
							const batchCmd = new BatchCommand([addMediaCmd, insertCmd]);
							editor.command.execute({ command: batchCmd });
						}

						return {
							uploadedCount: processedAssets.length + known.length,
							assetNames: [...known.map(({ file }) => file.name), ...processedAssets.map((asset) => asset.name)],
						};
					},
				});
			} catch (error) {
				console.error("Failed to paste media:", error);
			}
		};

		window.addEventListener("paste", handlePaste);
		return () => window.removeEventListener("paste", handlePaste);
	}, [editor]);
}
