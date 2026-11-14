import type { EditorCore } from "@/core";
import { purgeRemovedMedia } from "@/commands/media/remove-media-asset";
import { toast } from "sonner";
import type { MediaAsset } from "@/media/types";
import { storageService } from "@/services/storage/service";
import { generateUUID } from "@/utils/id";
import { videoCache } from "@/services/video-cache/service";
import { waveformCache } from "@/services/waveform-cache/service";
import { BatchCommand, RemoveMediaAssetCommand } from "@/commands";
import { canDecodeVideoFile } from "@/media/mediabunny";
import { splitEditingOriginals, withExportOriginals } from "@/media/editing-originals";
import { isStoring, trackStore } from "@/media/store-tracker";

export class MediaManager {
	private assets: MediaAsset[] = [];
	/**
	 * The user's own files behind editing copies, by the copy's asset id (storage: `editingOriginalOf`). Not among
	 * `assets`: nothing but the export sees them — not the media pool, the pickers, the agent or the AI tools.
	 */
	private originals = new Map<string, MediaAsset>();
	private isLoading = false;
	private listeners = new Set<() => void>();

	constructor(private editor: EditorCore) {}

	async addMediaAsset({
		projectId,
		asset,
	}: {
		projectId: string;
		/** `id`: the id its placeholder in Media already shows under (src/jobs/components/pending-media.tsx). */
		asset: Omit<MediaAsset, "id"> & { id?: string; editingOriginal?: File };
	}): Promise<MediaAsset | null> {
		const { editingOriginal, id, ...rest } = asset;
		const newAsset: MediaAsset = {
			...rest,
			id: id && !this.assets.some((a) => a.id === id) ? id : generateUUID(),
		};

		this.assets = [...this.assets, newAsset];
		// The tile shows now and the project's copy is written behind it: whatever else would read the whole file
		// (the background brief's upload) waits until the copy is written (media/store-tracker.ts).
		const stored = (async () => {
			const saved = await storageService.saveMediaAsset({ projectId, mediaAsset: newAsset });
			// used where it is (no copy in the project), or copied with where it came from
			if (saved.source) newAsset.source = saved.source;
			if (saved.inPlace) newAsset.inPlace = true;
			this.editor.project.ratchetFpsForImportedMedia({
				importedAssets: [newAsset],
			});
			if (editingOriginal) await this.keepEditingOriginal({ projectId, of: newAsset, file: editingOriginal });
		})();
		trackStore(newAsset.id, stored, newAsset.file);
		this.notify();

		try {
			await stored;
			return newAsset;
		} catch (error) {
			console.error("Failed to save media asset:", error);
			this.assets = this.assets.filter((asset) => asset.id !== newAsset.id);
			this.notify();

			if (storageService.isQuotaExceededError({ error })) {
				toast.error("Not enough browser storage", {
					description: error instanceof Error ? error.message : undefined,
				});
			}

			return null;
		}
	}

	/** Stores the user's file behind an editing copy; without room for it a reopened project exports from the copy. */
	async keepEditingOriginal({ projectId, of, file }: { projectId: string; of: MediaAsset; file: File }): Promise<void> {
		await this.storeEditingOriginal({ projectId, original: this.rememberEditingOriginal({ of, file }) });
	}

	/**
	 * The user's file behind an editing copy, known to the export at once — before the copy and the original are stored
	 * (586 MB: seconds; a day's footage: minutes), when an export started meanwhile rendered the copy (pro-heavy, 09.11).
	 */
	rememberEditingOriginal({ of, file }: { of: MediaAsset; file: File }): MediaAsset {
		const original: MediaAsset = {
			id: generateUUID(),
			name: file.name,
			type: of.type,
			file,
			url: URL.createObjectURL(file),
			width: of.width,
			height: of.height,
			duration: of.duration,
			fps: of.fps,
			hasAudio: of.hasAudio,
			editingOriginalOf: of.id,
		};
		this.originals.set(of.id, original);
		return original;
	}

	/** Not stored (no room): this session still renders the user's file, a reopened project the copy. */
	async storeEditingOriginal({ projectId, original }: { projectId: string; original: MediaAsset }): Promise<void> {
		try {
			await storageService.saveMediaAsset({ projectId, mediaAsset: original });
		} catch (error) {
			console.warn("The original behind an editing copy wasn't stored (after a reopen the export renders the copy):", error);
		}
	}

	/** An import undone: the user's file behind its copy leaves storage with it. */
	async dropEditingOriginal({ projectId, assetId }: { projectId: string; assetId: string }): Promise<void> {
		const original = this.originals.get(assetId);
		if (!original) return;
		this.originals.delete(assetId);
		if (original.url) URL.revokeObjectURL(original.url);
		await storageService.deleteMediaAsset({ projectId, id: original.id });
	}

	/** For the export quality test: the project as one saved before originals were kept (the export uses the copies). */
	forgetEditingOriginals(): number {
		const count = this.originals.size;
		this.originals = new Map();
		return count;
	}

	/** The user's own file behind this asset's editing copy, when one was kept. */
	getEditingOriginal(assetId: string): MediaAsset | undefined {
		return this.originals.get(assetId);
	}

	/**
	 * The assets as the export renders them: an editing copy gives way to the user's original when this Mac decodes
	 * it (an older project, or an original this machine can't read, keeps the copy — no error).
	 */
	async withExportOriginals(assets: MediaAsset[]): Promise<MediaAsset[]> {
		return withExportOriginals({ assets, originals: this.originals, canDecode: canDecodeVideoFile });
	}

	removeMediaAsset({ projectId, id }: { projectId: string; id: string }): void {
		this.removeMediaAssets({ projectId, ids: [id] });
	}

	removeMediaAssets({
		projectId,
		ids,
	}: {
		projectId: string;
		ids: string[];
	}): void {
		const uniqueIds = [...new Set(ids)];
		if (uniqueIds.length === 0) {
			return;
		}

		const command =
			uniqueIds.length === 1
				? new RemoveMediaAssetCommand({
						projectId,
						assetId: uniqueIds[0],
					})
				: new BatchCommand(
						uniqueIds.map((id) =>
							new RemoveMediaAssetCommand({
								projectId,
								assetId: id,
							}),
						),
					);

		this.editor.command.execute({ command });
	}

	async loadProjectMedia({ projectId }: { projectId: string }): Promise<void> {
		this.isLoading = true;
		this.notify();

		try {
			await purgeRemovedMedia(projectId);
			const mediaAssets = await storageService.loadAllMediaAssets({
				projectId,
				opening: true,
			});
			const { assets, originals } = splitEditingOriginals(mediaAssets);
			this.originals = originals;
			// an import whose copy is still being written (a relink reloads the list meanwhile) stays as it is shown
			const loaded = new Set(assets.map((asset) => asset.id));
			const writing = this.assets.filter((asset) => isStoring(asset.id) && !loaded.has(asset.id));
			this.assets = [...assets, ...writing];
			this.notify();
		} catch (error) {
			console.error("Failed to load media assets:", error);
		} finally {
			this.isLoading = false;
			this.notify();
		}
	}

	async clearProjectMedia({ projectId }: { projectId: string }): Promise<void> {
		waveformCache.clearAll();

		this.assets.forEach((asset) => {
			if (asset.url) {
				URL.revokeObjectURL(asset.url);
			}
			if (asset.thumbnailUrl) {
				URL.revokeObjectURL(asset.thumbnailUrl);
			}
		});

		const mediaIds = [...this.assets, ...this.originals.values()].map((asset) => asset.id);
		for (const original of this.originals.values()) if (original.url) URL.revokeObjectURL(original.url);
		this.assets = [];
		this.originals = new Map();
		this.notify();

		try {
			await Promise.all(
				mediaIds.map((id) =>
					storageService.deleteMediaAsset({ projectId, id }),
				),
			);
		} catch (error) {
			console.error("Failed to clear media assets from storage:", error);
		}
	}

	clearAllAssets(): void {
		videoCache.clearAll();
		waveformCache.clearAll();

		this.assets.forEach((asset) => {
			if (asset.url) {
				URL.revokeObjectURL(asset.url);
			}
			if (asset.thumbnailUrl) {
				URL.revokeObjectURL(asset.thumbnailUrl);
			}
		});

		for (const original of this.originals.values()) if (original.url) URL.revokeObjectURL(original.url);
		this.assets = [];
		this.originals = new Map();
		this.notify();
	}

	/** Files of the project used where they are (no copy in the project), originals behind editing copies included. */
	getInPlaceAssets(): MediaAsset[] {
		return [...this.assets, ...this.originals.values()].filter((asset) => asset.inPlace && !isStoring(asset.id));
	}

	/**
	 * «Collect files into the project» (Project menu): every file used where it is is copied into the project, one by one
	 * (the background brief waits for each copy). Returns how many were collected and the names that could not be.
	 */
	async collectIntoProject({ projectId, onProgress }: { projectId: string; onProgress?: (done: number, total: number) => void }): Promise<{ collected: number; failed: string[] }> {
		const todo = this.getInPlaceAssets();
		let collected = 0;
		const failed: string[] = [];
		for (const [i, asset] of todo.entries()) {
			onProgress?.(i, todo.length);
			const copy = storageService.collectMediaAsset({ projectId, asset });
			trackStore(asset.id, copy, asset.file);
			try {
				if (await copy) {
					asset.inPlace = undefined;
					collected++;
				}
			} catch (error) {
				console.error("[media] could not collect", asset.name, error);
				failed.push(asset.name);
			}
		}
		onProgress?.(todo.length, todo.length);
		return { collected, failed };
	}

	getAssets(): MediaAsset[] {
		return this.assets;
	}

	setAssets({ assets }: { assets: MediaAsset[] }): void {
		this.assets = assets;
		this.notify();
	}

	isLoadingMedia(): boolean {
		return this.isLoading;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}
}
