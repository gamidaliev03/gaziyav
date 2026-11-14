import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import { toast } from "sonner";
import type { MediaAsset } from "@/media/types";
import { generateUUID } from "@/utils/id";
import { storageService } from "@/services/storage/service";
import type { FrameRate } from "opencut-wasm";
import { hasMediaId } from "@/timeline/element-utils";
import { frameRatesEqual, getHighestImportedVideoFps } from "@/fps/utils";
import { UpdateProjectSettingsCommand } from "@/commands/project";
import { trackStore } from "@/media/store-tracker";

export class AddMediaAssetCommand extends Command {
	private assetId: string;
	private savedAssets: MediaAsset[] | null = null;
	private createdAsset: MediaAsset | null = null;
	private previousProjectFps: FrameRate | null = null;
	private appliedProjectFps: FrameRate | null = null;

	constructor({
		projectId,
		asset,
	}: {
		projectId: string;
		asset: Omit<MediaAsset, "id"> & { editingOriginal?: File };
	}) {
		super();
		const { editingOriginal, ...rest } = asset;
		this.projectId = projectId;
		this.asset = rest;
		this.editingOriginal = editingOriginal;
		this.assetId = generateUUID();
	}

	private projectId: string;
	private asset: Omit<MediaAsset, "id">;
	/** The user's file behind an editing copy (a pasted 4K HEVC): kept beside it for the export, as an import does. */
	private editingOriginal?: File;

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedAssets = [...editor.media.getAssets()];

		this.createdAsset = {
			...this.asset,
			id: this.assetId,
		};

		editor.media.setAssets({
			assets: [...this.savedAssets, this.createdAsset],
		});
		// the original behind an editing copy is the export's at once, not only once both files are stored
		const original =
			this.editingOriginal && this.createdAsset ? editor.media.rememberEditingOriginal({ of: this.createdAsset, file: this.editingOriginal }) : null;
		this.previousProjectFps = editor.project.getActiveOrNull()?.settings.fps ?? null;
		this.appliedProjectFps = editor.project.ratchetFpsForImportedMedia({
			importedAssets: [this.createdAsset],
		});

		const store = storageService
			.saveMediaAsset({
				projectId: this.projectId,
				mediaAsset: this.createdAsset,
			})
			.then(async (saved) => {
				const created = this.createdAsset;
				if (created && saved.source) created.source = saved.source;
				if (created && saved.inPlace) created.inPlace = true;
				if (original) await editor.media.storeEditingOriginal({ projectId: this.projectId, original });
			});
		// shown at once, stored behind: what reads the whole file waits for the copy (media/store-tracker.ts)
		trackStore(this.assetId, store, this.createdAsset.file);
		store
			.catch((error) => {
				console.error("Failed to save media item:", error);
				if (original) void editor.media.dropEditingOriginal({ projectId: this.projectId, assetId: this.assetId }).catch(() => {});

				const currentAssets = editor.media.getAssets();
				editor.media.setAssets({
					assets: currentAssets.filter((asset) => asset.id !== this.assetId),
				});

				const currentTracks = editor.scenes.getActiveScene().tracks;
				const orphanedElements: Array<{ trackId: string; elementId: string }> =
					[];

				for (const track of [
					...currentTracks.overlay,
					currentTracks.main,
					...currentTracks.audio,
				]) {
					for (const element of track.elements) {
						if (hasMediaId(element) && element.mediaId === this.assetId) {
							orphanedElements.push({
								trackId: track.id,
								elementId: element.id,
							});
						}
					}
				}

				if (orphanedElements.length > 0) {
					editor.timeline.deleteElements({ elements: orphanedElements });
				}

				this.restoreProjectFpsAfterFailedSave({ editor });

				if (storageService.isQuotaExceededError({ error })) {
					toast.error("Not enough browser storage", {
						description: error instanceof Error ? error.message : undefined,
					});
				}
			});

		return undefined;
	}

	undo(): void {
		if (this.savedAssets) {
			const editor = EditorCore.getInstance();
			editor.media.setAssets({ assets: this.savedAssets });

			if (this.createdAsset) {
				storageService
					.deleteMediaAsset({ projectId: this.projectId, id: this.assetId })
					.catch((error) => {
						console.error("Failed to delete media item on undo:", error);
					});
				editor.media.dropEditingOriginal({ projectId: this.projectId, assetId: this.assetId }).catch((error) => {
					console.error("Failed to delete the original behind an editing copy on undo:", error);
				});
			}
		}
	}

	getAssetId(): string {
		return this.assetId;
	}

	private restoreProjectFpsAfterFailedSave({
		editor,
	}: {
		editor: EditorCore;
	}): void {
		if (this.previousProjectFps === null || this.appliedProjectFps === null) return;

		const activeProject = editor.project.getActiveOrNull();
		if (!activeProject) return;
		if (
			!this.appliedProjectFps ||
			!frameRatesEqual({
				a: activeProject.settings.fps,
				b: this.appliedProjectFps,
			})
		)
			return;

		const highestRemainingVideoFps = getHighestImportedVideoFps({
			mediaAssets: editor.media.getAssets(),
		});
		const appliedFpsFloat = this.appliedProjectFps.numerator / this.appliedProjectFps.denominator;
		if (
			highestRemainingVideoFps !== null &&
			highestRemainingVideoFps >= appliedFpsFloat
		) {
			return;
		}

		new UpdateProjectSettingsCommand({ fps: this.previousProjectFps }).execute();
	}
}
