import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { MediaAsset } from "@/media/types";
import { buildWaveformSourceKey } from "@/media/waveform-summary";
import { storageService } from "@/services/storage/service";
import { videoCache } from "@/services/video-cache/service";
import { waveformCache } from "@/services/waveform-cache/service";
import { hasMediaId } from "@/timeline/element-utils";
import type { SceneTracks } from "@/timeline";

/**
 * Files removed from Media stay on disk until the project is left (flushRemovedMedia): ⌘Z restores the asset from that
 * file. Deleting at once left undo with a File whose bytes were gone — the clip came back black and was lost on reload.
 * The list is kept in localStorage too: after a quit or a crash (no undo any more) they are deleted when the project
 * opens again (purgeRemovedMedia), instead of coming back in Media.
 */
const REMOVED_KEY = "gaziyav.removedMedia";
const removedMedia = new Map<string, Set<string>>();
try {
	const saved = JSON.parse(globalThis.localStorage?.getItem(REMOVED_KEY) ?? "{}") as Record<string, string[]>;
	for (const [projectId, ids] of Object.entries(saved)) if (Array.isArray(ids) && ids.length) removedMedia.set(projectId, new Set(ids));
} catch {}

function persistRemoved() {
	try {
		const out: Record<string, string[]> = {};
		for (const [projectId, ids] of removedMedia) if (ids.size) out[projectId] = [...ids];
		globalThis.localStorage?.setItem(REMOVED_KEY, JSON.stringify(out));
	} catch {}
}

async function deleteRemoved(projectId: string, ids: string[]) {
	await Promise.all(
		ids.map((id) =>
			storageService.deleteMediaAsset({ projectId, id }).catch((error) => {
				console.error("Failed to delete media item:", error);
			}),
		),
	);
}

/** Opening a project (no undo history yet): what was removed from it before a quit or crash goes for good. */
export async function purgeRemovedMedia(projectId: string): Promise<void> {
	const ids = removedMedia.get(projectId);
	if (!ids?.size) return;
	removedMedia.delete(projectId);
	persistRemoved();
	// Never a file a clip still uses: a removal whose clips came back (an undo of something else, a crash half-way)
	// must not leave the timeline pointing at deleted media.
	const result = await storageService.loadProject({ id: projectId }).catch(() => null);
	const used = mediaIdsIn(result?.project.scenes);
	await deleteRemoved(projectId, [...ids].filter((id) => !used.has(id)));
}

/** Every media id a clip in these scenes uses. */
function mediaIdsIn(scenes: unknown): Set<string> {
	const used = new Set<string>();
	const walk = (value: unknown) => {
		if (!value || typeof value !== "object") return;
		if (Array.isArray(value)) {
			for (const item of value) walk(item);
			return;
		}
		for (const [key, item] of Object.entries(value)) {
			if (key === "mediaId" && typeof item === "string") used.add(item);
			else walk(item);
		}
	};
	walk(scenes);
	return used;
}

/** Deletes from disk what was removed from the project's Media and not brought back (called when leaving it). */
export async function flushRemovedMedia(projectId: string): Promise<void> {
	const ids = removedMedia.get(projectId);
	if (!ids?.size) return;
	removedMedia.delete(projectId);
	persistRemoved();
	const editor = EditorCore.getInstance();
	const kept = new Set(editor.media.getAssets().map((a) => a.id));
	for (const id of mediaIdsIn(editor.scenes.getScenes())) kept.add(id);
	await deleteRemoved(projectId, [...ids].filter((id) => !kept.has(id)));
}

export class RemoveMediaAssetCommand extends Command {
	private savedAssets: MediaAsset[] | null = null;
	private savedTracks: SceneTracks | null = null;
	private removedAsset: MediaAsset | null = null;

	constructor({
		projectId,
		assetId,
	}: {
		projectId: string;
		assetId: string;
	}) {
		super();
		this.projectId = projectId;
		this.assetId = assetId;
	}

	private projectId: string;
	private assetId: string;

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const assets = editor.media.getAssets();

		this.savedAssets = [...assets];
		this.savedTracks = editor.scenes.getActiveScene().tracks;

		this.removedAsset =
			assets.find((media) => media.id === this.assetId) ?? null;

		if (!this.removedAsset) {
			console.error("Media asset not found:", this.assetId);
			return;
		}

		if (this.removedAsset.url) {
			URL.revokeObjectURL(this.removedAsset.url);
		}
		if (this.removedAsset.thumbnailUrl) {
			URL.revokeObjectURL(this.removedAsset.thumbnailUrl);
		}

		videoCache.clearVideo({ mediaId: this.assetId });
		waveformCache.clearSource({
			sourceKey: buildWaveformSourceKey({
				kind: "media",
				id: this.assetId,
			}),
		});

		editor.media.setAssets({
			assets: assets.filter((media) => media.id !== this.assetId),
		});

		const elementsToRemove: Array<{ trackId: string; elementId: string }> = [];

		for (const track of [
			...this.savedTracks.overlay,
			this.savedTracks.main,
			...this.savedTracks.audio,
		]) {
			for (const element of track.elements) {
				if (hasMediaId(element) && element.mediaId === this.assetId) {
					elementsToRemove.push({ trackId: track.id, elementId: element.id });
				}
			}
		}

		if (elementsToRemove.length > 0) {
			editor.timeline.deleteElements({ elements: elementsToRemove });
		}

		let pending = removedMedia.get(this.projectId);
		if (!pending) removedMedia.set(this.projectId, (pending = new Set()));
		pending.add(this.assetId);
		// The user's file behind an editing copy goes with it (kept on disk until the project is left, as the copy is).
		const original = editor.media.getEditingOriginal(this.assetId);
		if (original) pending.add(original.id);
		persistRemoved();
	}

	undo(): void {
		const editor = EditorCore.getInstance();

		if (this.savedAssets && this.removedAsset) {
			const restoredAsset: MediaAsset = {
				...this.removedAsset,
				url: URL.createObjectURL(this.removedAsset.file),
			};

			editor.media.setAssets({
				assets: this.savedAssets.map((a) =>
					a.id === this.assetId ? restoredAsset : a,
				),
			});

			// Its file is still on disk (deleted only when the project is left): nothing to write back.
			removedMedia.get(this.projectId)?.delete(this.assetId);
			const original = editor.media.getEditingOriginal(this.assetId);
			if (original) removedMedia.get(this.projectId)?.delete(original.id);
			persistRemoved();
		}

		if (this.savedTracks) {
			editor.timeline.updateTracks(this.savedTracks);
		}
	}
}
