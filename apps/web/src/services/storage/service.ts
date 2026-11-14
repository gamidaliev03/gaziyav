import type { TProject, TProjectMetadata } from "@/project/types";
import { isOpenableProject, projectBackups } from "./recovery";
import { copyToDiskSoon, listDiskCopies, type ProjectDiskCopy, readDiskCopy, removeDiskCopy, writeDiskCopyNow } from "./disk-copies";
import { getProjectDurationFromScenes } from "@/timeline/scenes";
import type { MediaAsset } from "@/media/types";
import { IndexedDBAdapter } from "./indexeddb-adapter";
import { OPFSAdapter } from "./opfs-adapter";
import { forgetDamaged, markDamaged, storedFileDamaged } from "@/relink/damaged";
import { attachOriginals, importSourceOf } from "@/media/originals";
import { fileBeingStored, isStoring, trackStore } from "@/media/store-tracker";
import { cutCopy } from "./cut-copies";
import {
	type StorageCapacityCheckResult,
	StorageQuotaExceededError,
	evaluateStorageCapacity,
	isStorageQuotaExceededError,
	readStorageQuotaStatus,
} from "./quota";
import type {
	ImportSource,
	MediaAssetData,
	StorageConfig,
	SerializedProject,
	SerializedScene,
} from "./types";
import type { SavedSoundsData, SavedSound, SoundEffect } from "@/sounds/types";
import {
	migrations,
	runStorageMigrations,
} from "@/services/storage/migrations";
import type { Bookmark, SceneTracks, TScene } from "@/timeline";
import { roundMediaTime } from "@/wasm";

/** A media file's type by its name's extension ("" when the name doesn't say). */
const MIME_BY_EXT: Record<string, string> = { mp4: "video/mp4", m4v: "video/x-m4v", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", avif: "image/avif", heic: "image/heic" };
export const mimeOfName = (name: string): string => MIME_BY_EXT[/\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ""] ?? "";

/**
 * The stored bytes as the file they were: the app's storage keeps them under the asset's id, with no name and no type,
 * so after a restart every file came back typeless and was taken for something else (K9: MP4 song pieces were sent to an
 * avatar model as MP3). Its name and the type its name says come back; the bytes are not copied.
 */
export function asNamedFile(file: File, name: string): File {
	if (file.type || !name) return file;
	return new File([file], name, { type: mimeOfName(name), lastModified: file.lastModified });
}

function normalizeBookmarks({ raw }: { raw: unknown }): Bookmark[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((item): Bookmark | null => {
			if (typeof item === "number") {
				return { time: roundMediaTime({ time: item }) };
			}
			const obj = item as Record<string, unknown>;
			if (
				typeof obj !== "object" ||
				obj === null ||
				typeof obj.time !== "number"
			) {
				return null;
			}
			return {
				time: roundMediaTime({ time: obj.time }),
				...(typeof obj.note === "string" && { note: obj.note }),
				...(typeof obj.color === "string" && { color: obj.color }),
				...(obj.chapter === true && { chapter: true as const }),
				...(typeof obj.duration === "number" && {
					duration: roundMediaTime({ time: obj.duration }),
				}),
			};
		})
		.filter((b): b is Bookmark => b !== null);
}

class StorageService {
	private projectsAdapter: IndexedDBAdapter<SerializedProject>;
	private savedSoundsAdapter: IndexedDBAdapter<SavedSoundsData>;
	private config: StorageConfig;
	private migrationsPromise: Promise<void> | null = null;

	constructor() {
		this.config = {
			projectsDb: "video-editor-projects",
			mediaDb: "video-editor-media",
			savedSoundsDb: "video-editor-saved-sounds",
			version: 1,
		};

		this.projectsAdapter = new IndexedDBAdapter<SerializedProject>({
			dbName: this.config.projectsDb,
			storeName: "projects",
			version: this.config.version,
		});

		this.savedSoundsAdapter = new IndexedDBAdapter<SavedSoundsData>({
			dbName: this.config.savedSoundsDb,
			storeName: "saved-sounds",
			version: this.config.version,
		});
	}

	private async ensureMigrations(): Promise<void> {
		if (this.migrationsPromise) {
			await this.migrationsPromise;
			return;
		}

		this.migrationsPromise = runStorageMigrations({ migrations }).then(
			() => undefined,
		);
		await this.migrationsPromise;
	}

	private getProjectMediaAdapters({ projectId }: { projectId: string }) {
		const mediaMetadataAdapter = new IndexedDBAdapter<MediaAssetData>({
			dbName: `${this.config.mediaDb}-${projectId}`,
			storeName: "media-metadata",
			version: this.config.version,
		});

		const mediaAssetsAdapter = new OPFSAdapter(`media-files-${projectId}`);

		return { mediaMetadataAdapter, mediaAssetsAdapter };
	}

	async canStoreFile({
		size,
	}: {
		size: number;
	}): Promise<StorageCapacityCheckResult> {
		const quotaStatus = await readStorageQuotaStatus();
		return evaluateStorageCapacity({
			requiredBytes: size,
			quotaStatus,
		});
	}

	isQuotaExceededError({ error }: { error: unknown }): boolean {
		return isStorageQuotaExceededError({ error });
	}

	private stripAudioBuffers({ tracks }: { tracks: SceneTracks }): SceneTracks {
		return {
			...tracks,
			audio: tracks.audio.map((track) => ({
				...track,
				elements: track.elements.map((element) => {
					const { buffer: _buffer, ...rest } = element;
					return rest;
				}),
			})),
		};
	}

	serializeProject({ project }: { project: TProject }): SerializedProject {
		const duration =
			project.metadata.duration ??
			getProjectDurationFromScenes({ scenes: project.scenes });
		const serializedScenes: SerializedScene[] = project.scenes.map((scene) => ({
			id: scene.id,
			name: scene.name,
			isMain: scene.isMain,
			...(scene.nested && { nested: true }),
			...(scene.inMedia && { inMedia: true }),
			...(scene.formerTimeline && { formerTimeline: scene.formerTimeline }),
			tracks: this.stripAudioBuffers({ tracks: scene.tracks }),
			bookmarks: scene.bookmarks,
			createdAt: scene.createdAt.toISOString(),
			updatedAt: scene.updatedAt.toISOString(),
		}));

		return {
			metadata: {
				id: project.metadata.id,
				name: project.metadata.name,
				thumbnail: project.metadata.thumbnail,
				duration,
				createdAt: project.metadata.createdAt.toISOString(),
				updatedAt: project.metadata.updatedAt.toISOString(),
				...(project.metadata.trashedAt && { trashedAt: project.metadata.trashedAt.toISOString() }),
				...(project.metadata.thumbnailAt && { thumbnailAt: project.metadata.thumbnailAt.toISOString() }),
				...(project.metadata.renamed && { renamed: true }),
			},
			scenes: serializedScenes,
			currentSceneId: project.currentSceneId,
			settings: project.settings,
			version: project.version,
			timelineViewState: project.timelineViewState,
			...(project.timelineModel && { timelineModel: project.timelineModel }),
		};
	}

	async saveProject({ project }: { project: TProject }): Promise<void> {
		await this.saveSerializedProject({
			serialized: this.serializeProject({ project }),
		});
	}

	/** Writes an already serialized project; throws StorageQuotaExceededError when the disk quota is full. */
	async saveSerializedProject({
		serialized,
	}: {
		serialized: SerializedProject;
	}): Promise<void> {
		try {
			await this.projectsAdapter.set({
				key: serialized.metadata.id,
				value: serialized,
			});
		} catch (error) {
			if (this.isQuotaExceededError({ error })) {
				throw new StorageQuotaExceededError({ requiredBytes: 0 });
			}
			throw error;
		}
		this.copyToDisk(serialized.metadata.id);
	}

	/** The project's copy on the Mac's disk follows its save (disk-copies.ts): what is in the browser storage now. */
	private copyToDisk(projectId: string): void {
		copyToDiskSoon(projectId, () => this.diskCopyOf(projectId));
	}

	private async diskCopyOf(projectId: string): Promise<ProjectDiskCopy | null> {
		const project = await this.projectsAdapter.get(projectId);
		if (!project) return null;
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({ projectId });
		const media = await mediaMetadataAdapter.getAll().catch(() => []);
		return { v: 1, savedAt: Date.now(), project, media };
	}

	/** Writes a disk copy back into the browser storage: the media list first, then the project. */
	private async restoreDiskCopy(copy: ProjectDiskCopy): Promise<void> {
		const projectId = copy.project.metadata.id;
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({ projectId });
		for (const media of copy.media ?? []) {
			if (media?.id) await mediaMetadataAdapter.set({ key: media.id, value: media });
		}
		await this.projectsAdapter.set({ key: projectId, value: copy.project });
	}

	/**
	 * Projects the browser storage lost (Chromium throws an IndexedDB it takes for damaged away whole: after a full
	 * disk the next start had none) come back from their copies on disk. Returns their names.
	 */
	async restoreLostProjects(): Promise<string[]> {
		const copied = await listDiskCopies();
		if (!copied) return [];
		const have = new Set(await this.projectsAdapter.list());
		const restored: string[] = [];
		for (const id of copied) {
			if (have.has(id)) continue;
			const copy = await readDiskCopy(id);
			if (!copy || !isOpenableProject(copy.project)) continue;
			try {
				await this.restoreDiskCopy(copy);
				restored.push(copy.project.metadata.name);
			} catch (error) {
				console.error("[storage] a project's disk copy couldn't be restored", id, error);
			}
		}
		// projects saved by an older version have no copy yet: one each, in the background, one after another
		const uncopied = [...have].filter((id) => !copied.has(id));
		void (async () => {
			for (const id of uncopied) await writeDiskCopyNow(id, () => this.diskCopyOf(id)).catch(() => {});
		})();
		return restored;
	}

	/** Asks Chromium to keep this app's storage under disk pressure (it may evict a site's data when space runs low). */
	async keepStorage(): Promise<void> {
		try {
			if (typeof navigator !== "undefined" && navigator.storage?.persist && !(await navigator.storage.persisted())) {
				await navigator.storage.persist();
			}
		} catch {}
	}

	deserializeProject({
		serializedProject,
	}: {
		serializedProject: SerializedProject;
	}): TProject {
		const scenes =
			serializedProject.scenes?.map((scene) => ({
				id: scene.id,
				name: scene.name,
				isMain: scene.isMain,
				...(scene.nested && { nested: true }),
				...(scene.inMedia && { inMedia: true }),
				...(scene.formerTimeline && { formerTimeline: scene.formerTimeline }),
				tracks: scene.tracks,
				bookmarks: normalizeBookmarks({ raw: scene.bookmarks }),
				createdAt: new Date(scene.createdAt),
				updatedAt: new Date(scene.updatedAt),
			})) ?? [];

		return {
			metadata: {
				id: serializedProject.metadata.id,
				name: serializedProject.metadata.name,
				thumbnail: serializedProject.metadata.thumbnail,
				duration: roundMediaTime({
					time:
						serializedProject.metadata.duration ??
						getProjectDurationFromScenes({ scenes }),
				}),
				createdAt: new Date(serializedProject.metadata.createdAt),
				updatedAt: new Date(serializedProject.metadata.updatedAt),
				...(serializedProject.metadata.trashedAt && { trashedAt: new Date(serializedProject.metadata.trashedAt) }),
				...(serializedProject.metadata.thumbnailAt && { thumbnailAt: new Date(serializedProject.metadata.thumbnailAt) }),
				...(serializedProject.metadata.renamed && { renamed: true }),
			},
			scenes,
			currentSceneId: serializedProject.currentSceneId || "",
			settings: serializedProject.settings,
			version: serializedProject.version,
			timelineViewState: serializedProject.timelineViewState,
			...(serializedProject.timelineModel && { timelineModel: serializedProject.timelineModel }),
		};
	}

	async loadProject({
		id,
	}: {
		id: string;
	}): Promise<{ project: TProject } | null> {
		await this.ensureMigrations();
		const serializedProject = await this.projectsAdapter.get(id);

		if (!serializedProject) return null;

		if (
			typeof serializedProject !== "object" ||
			serializedProject === null ||
			typeof serializedProject.metadata !== "object" ||
			serializedProject.metadata === null
		) {
			console.warn(
				"[storage] Skipping malformed project entry (missing metadata):",
				{ id, entry: serializedProject },
			);
			return null;
		}

		const project = this.deserializeProject({ serializedProject });

		return { project };
	}

	/** The project's stored document exactly as it is (the one-timeline conversion reads it: project/join-on-open.ts). */
	async readStoredProject({ id }: { id: string }): Promise<unknown> {
		return this.projectsAdapter.get(id);
	}

	/**
	 * The project as saved, or — when the save can't be read (a damaged file) — its newest backup that can, written back
	 * as the project; `fromBackup` says when that copy was made. Null when there is neither.
	 */
	async loadProjectOrBackup({ id }: { id: string }): Promise<{ project: TProject; fromBackup?: number } | null> {
		await this.ensureMigrations();
		let raw: unknown = null;
		try {
			raw = await this.projectsAdapter.get(id);
		} catch (error) {
			console.warn("[storage] the project couldn't be read", { id, error });
		}
		if (raw && isOpenableProject(raw)) {
			try {
				return { project: this.deserializeProject({ serializedProject: raw }) };
			} catch (error) {
				console.warn("[storage] the project couldn't be read", { id, error });
			}
		}
		const backups = await projectBackups.list({ projectId: id }).catch(() => []);
		for (const backup of backups) {
			if (!isOpenableProject(backup.project)) continue;
			try {
				const project = this.deserializeProject({ serializedProject: backup.project });
				await this.saveSerializedProject({ serialized: backup.project });
				return { project, fromBackup: backup.createdAt };
			} catch {
				// this copy is damaged too: the one before it
			}
		}
		// no whole version in the browser storage either: the project's copy on the Mac's disk
		const copy = await readDiskCopy(id);
		if (copy && isOpenableProject(copy.project)) {
			try {
				const project = this.deserializeProject({ serializedProject: copy.project });
				await this.restoreDiskCopy(copy);
				return { project, fromBackup: copy.savedAt };
			} catch {}
		}
		return null;
	}

	async loadAllProjects(): Promise<TProject[]> {
		const projectIds = await this.projectsAdapter.list();
		const projects: TProject[] = [];

		for (const id of projectIds) {
			const result = await this.loadProject({ id });
			if (result?.project) {
				projects.push(result.project);
			}
		}

		return projects.sort(
			(a, b) => b.metadata.updatedAt.getTime() - a.metadata.updatedAt.getTime(),
		);
	}

	async loadAllProjectsMetadata(): Promise<TProjectMetadata[]> {
		await this.ensureMigrations();
		const serializedProjects = await this.projectsAdapter.getAll();

		const metadata: TProjectMetadata[] = [];
		for (const serializedProject of serializedProjects) {
			if (
				typeof serializedProject !== "object" ||
				serializedProject === null ||
				typeof serializedProject.metadata !== "object" ||
				serializedProject.metadata === null
			) {
				console.warn(
					"[storage] Skipping malformed project entry (missing metadata):",
					serializedProject,
				);
				continue;
			}

			metadata.push({
				id: serializedProject.metadata.id,
				name: serializedProject.metadata.name,
				thumbnail: serializedProject.metadata.thumbnail,
				duration: roundMediaTime({
					time:
						serializedProject.metadata.duration ??
						getProjectDurationFromScenes({
							scenes: (serializedProject.scenes ?? []) as unknown as TScene[],
						}),
				}),
				createdAt: new Date(serializedProject.metadata.createdAt),
				updatedAt: new Date(serializedProject.metadata.updatedAt),
				...(serializedProject.metadata.trashedAt && { trashedAt: new Date(serializedProject.metadata.trashedAt) }),
				...(serializedProject.metadata.thumbnailAt && { thumbnailAt: new Date(serializedProject.metadata.thumbnailAt) }),
				...(serializedProject.metadata.renamed && { renamed: true }),
			});
		}

		return metadata.sort(
			(a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
		);
	}

	async deleteProject({ id }: { id: string }): Promise<void> {
		await this.projectsAdapter.remove(id);
		removeDiskCopy(id);
	}

	/**
	 * Puts a file into the project. The user's own file from an ordinary place on this Mac is used where it is: only its
	 * line in the media list is written (milliseconds — no copy, nothing a crash can cut). One that will go away
	 * (removable media, a temporary folder) is copied, listed BEFORE its copy is written, so a copy cut by a crash is
	 * made again from the original at the next open. A file made by the app is written once, then listed.
	 */
	async saveMediaAsset({
		projectId,
		mediaAsset,
	}: {
		projectId: string;
		mediaAsset: MediaAsset;
	}): Promise<{ inPlace: boolean; source?: ImportSource }> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });
		// a file loaded from a project (duplicating it, a version opened as a copy) keeps how it was held there
		const where =
			(await importSourceOf(mediaAsset.file).catch(() => null)) ?? (mediaAsset.source ? { source: mediaAsset.source, inPlace: !!mediaAsset.inPlace } : null);

		const metadata: MediaAssetData = {
			id: mediaAsset.id,
			name: mediaAsset.name,
			type: mediaAsset.type,
			size: mediaAsset.file.size,
			lastModified: mediaAsset.file.lastModified,
			width: mediaAsset.width,
			height: mediaAsset.height,
			duration: mediaAsset.duration,
			fps: mediaAsset.fps,
			hasAudio: mediaAsset.hasAudio,
			thumbnailUrl: mediaAsset.thumbnailUrl,
			ephemeral: mediaAsset.ephemeral,
			origin: mediaAsset.origin,
			attribution: mediaAsset.attribution,
			librarySourceUrl: mediaAsset.librarySourceUrl,
			neural: mediaAsset.neural,
			motionProxy: mediaAsset.motionProxy,
			editingOriginalOf: mediaAsset.editingOriginalOf,
			...(where ? { source: where.source } : {}),
			...(where?.inPlace ? { inPlace: true } : {}),
		};

		// what the list said of this id before (a relink stores under the clip's old id): put back if this fails
		let listedBefore: MediaAssetData | null | undefined;
		try {
			if (where?.inPlace) {
				await mediaMetadataAdapter.set({ key: mediaAsset.id, value: metadata });
				// a relink of a lost copy under this id: whatever is left of that copy goes
				await mediaAssetsAdapter.remove(mediaAsset.id).catch(() => {});
			} else if (where) {
				listedBefore = await mediaMetadataAdapter.get(mediaAsset.id).catch(() => null);
				await mediaMetadataAdapter.set({ key: mediaAsset.id, value: metadata });
				await mediaAssetsAdapter.set({ key: mediaAsset.id, value: mediaAsset.file });
			} else {
				await mediaAssetsAdapter.set({
					key: mediaAsset.id,
					value: mediaAsset.file,
				});
				await mediaMetadataAdapter.set({
					key: mediaAsset.id,
					value: metadata,
				});
			}
			// the media list in the project's copy on disk follows too
			this.copyToDisk(projectId);
			return { inPlace: !!where?.inPlace, ...(where ? { source: where.source } : {}) };
		} catch (error) {
			try {
				await mediaAssetsAdapter.remove(mediaAsset.id);
			} catch {
				// Ignore cleanup failures so the original storage error is preserved.
			}
			if (listedBefore !== undefined) {
				try {
					if (listedBefore) await mediaMetadataAdapter.set({ key: mediaAsset.id, value: listedBefore });
					else await mediaMetadataAdapter.remove(mediaAsset.id);
				} catch {}
			}

			if (this.isQuotaExceededError({ error })) {
				throw new StorageQuotaExceededError({
					requiredBytes: mediaAsset.file.size,
				});
			}

			throw error;
		}
	}

	/** Whether any file is stored for the project (its media list or its folder), whatever is shown on screen. */
	async hasStoredMedia({ projectId }: { projectId: string }): Promise<boolean> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } = this.getProjectMediaAdapters({ projectId });
		if ((await mediaMetadataAdapter.list()).length > 0) return true;
		return (await mediaAssetsAdapter.list()).length > 0;
	}

	/** What the project's media list says of a file (its name and size), also when the file itself is gone (relink). */
	async loadMediaMetadata({ projectId, id }: { projectId: string; id: string }): Promise<MediaAssetData | null> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({ projectId });
		return mediaMetadataAdapter.get(id).catch(() => null);
	}

	/** Rewrites the AI-effect info of a stored asset; its file stays as it is. */
	async updateMediaNeuralInfo({
		projectId,
		id,
		neural,
	}: {
		projectId: string;
		id: string;
		neural: MediaAssetData["neural"];
	}): Promise<void> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({ projectId });
		const current = await mediaMetadataAdapter.get(id);
		if (!current) return;
		await mediaMetadataAdapter.set({ key: id, value: { ...current, neural } });
	}

	/** The media list's entry and the stored copy of one file (the copy null when there is none). */
	private async readMediaEntry({ projectId, id }: { projectId: string; id: string }): Promise<{ metadata: MediaAssetData | null; stored: File | null }> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } = this.getProjectMediaAdapters({ projectId });
		const [stored, metadata] = await Promise.all([mediaAssetsAdapter.get(id), mediaMetadataAdapter.get(id)]);
		return { metadata, stored };
	}

	/** A loaded media file as the editor holds it. */
	private async assetOf(metadata: MediaAssetData, file: File): Promise<MediaAsset> {
		let url: string;
		if (metadata.type === "image" && (!file.type || file.type === "")) {
			try {
				const text = await file.text();
				if (text.trim().startsWith("<svg")) {
					const svgBlob = new Blob([text], { type: "image/svg+xml" });
					url = URL.createObjectURL(svgBlob);
				} else {
					url = URL.createObjectURL(file);
				}
			} catch {
				url = URL.createObjectURL(file);
			}
		} else {
			url = URL.createObjectURL(file);
		}

		return {
			id: metadata.id,
			name: metadata.name,
			type: metadata.type,
			file,
			url,
			width: metadata.width,
			height: metadata.height,
			duration: metadata.duration,
			fps: metadata.fps,
			hasAudio: metadata.hasAudio,
			thumbnailUrl: metadata.thumbnailUrl,
			ephemeral: metadata.ephemeral,
			origin: metadata.origin,
			attribution: metadata.attribution,
			librarySourceUrl: metadata.librarySourceUrl,
			neural: metadata.neural,
			motionProxy: metadata.motionProxy,
			editingOriginalOf: metadata.editingOriginalOf,
			...(metadata.source ? { source: metadata.source } : {}),
			...(metadata.inPlace ? { inPlace: true } : {}),
		};
	}

	/** A stored copy: the file itself, or null when it is left out (none, or damaged — its clips say so). */
	private async storedAsset(metadata: MediaAssetData, stored: File | null): Promise<MediaAsset | null> {
		if (!stored) return null;
		const file = asNamedFile(stored, metadata.name);
		// A stored copy that is there but can't be read is left out: its clips say «damaged» by name (relink/damaged.ts).
		// An original behind an editing copy that is damaged is left out too: the export renders from the copy and says so.
		const originalOf = metadata.editingOriginalOf;
		if (await storedFileDamaged({ file, size: metadata.size, type: metadata.type, name: metadata.name })) {
			console.warn("[storage] the stored media file is damaged", { id: metadata.id, name: metadata.name, size: file.size, stored: metadata.size, originalOf });
			markDamaged(metadata.id, metadata.name, { originalOf });
			return null;
		}
		forgetDamaged(metadata.id, { originalOf });
		return this.assetOf(metadata, file);
	}

	async loadMediaAsset({ projectId, id }: { projectId: string; id: string }): Promise<MediaAsset | null> {
		const [asset] = await this.loadMediaAssetsByIds({ projectId, ids: [id] });
		return asset ?? null;
	}

	/**
	 * Every media file of a project. `opening`: the project is being opened in the editor — what crashes left behind
	 * goes, and copies a crash cut short are made again (a card's picture or a duplicate only reads the files).
	 */
	async loadAllMediaAssets({
		projectId,
		opening = false,
	}: {
		projectId: string;
		opening?: boolean;
	}): Promise<MediaAsset[]> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } = this.getProjectMediaAdapters({ projectId });
		const ids = await mediaMetadataAdapter.list();
		// what copies cut by a crash left behind (Chromium's half-written «<id>.crswap», never used again) goes —
		// never one being written now
		if (opening) await mediaAssetsAdapter.removeLeftovers((name) => !isStoring(name.replace(/\.crswap$/, ""))).catch(() => 0);
		return this.loadMediaAssetsByIds({ projectId, ids, redo: opening });
	}

	/**
	 * Loads these media files. A file used where it is comes from its original; a copy cut by a crash (listed, its copy
	 * missing or short) is used from its original at once and copied again behind it; every other one from its copy.
	 * All the originals come in one round trip to the Mac app. Order kept; a file that can't be had is left out (offline).
	 */
	private async loadMediaAssetsByIds({ projectId, ids, redo = false }: { projectId: string; ids: string[]; redo?: boolean }): Promise<MediaAsset[]> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } = this.getProjectMediaAdapters({ projectId });
		// Parallel (bounded) reading: a project with 100+ files used to open one by one.
		// A single broken file no longer prevents the rest of the project from loading.
		const entries: Array<{ metadata: MediaAssetData | null; stored: File | null }> = new Array(ids.length).fill({ metadata: null, stored: null });
		let next = 0;
		const worker = async () => {
			while (next < ids.length) {
				const index = next++;
				try {
					entries[index] = await this.readMediaEntry({ projectId, id: ids[index] });
				} catch (error) {
					console.error("[storage] Failed to load media asset", ids[index], error);
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(8, ids.length) }, worker));

		const wanted = entries
			.map((entry, index) => ({ ...entry, index }))
			.filter(
				(e): e is { metadata: MediaAssetData; stored: File | null; index: number } =>
					!!e.metadata?.source && !fileBeingStored(e.metadata.id) && (!!e.metadata.inPlace || cutCopy(e.metadata, e.stored)),
			);
		const originals = wanted.length ? await attachOriginals(wanted.map((e) => e.metadata.source as ImportSource)) : [];
		const fromOriginal = new Map(wanted.map((e, k) => [e.index, originals[k]]));

		const results: Array<MediaAsset | null> = new Array(ids.length).fill(null);
		let redone = 0;
		const build = async (index: number) => {
			const { metadata, stored } = entries[index];
			if (!metadata) return;
			try {
				// its copy is being written in this window right now: the clip plays the file it is written from
				const writing = fileBeingStored(metadata.id);
				if (writing) {
					results[index] = await this.assetOf(metadata, asNamedFile(writing, metadata.name));
					return;
				}
				const original = fromOriginal.get(index);
				if (!original) {
					results[index] = await this.storedAsset(metadata, stored);
					return;
				}
				if (!original.file) {
					if (metadata.inPlace) console.warn("[storage] the original is not where it was", { id: metadata.id, name: metadata.name, status: original.status });
					// a cut copy whose original is gone too: what is left of the copy says «damaged», as before
					results[index] = metadata.inPlace ? null : await this.storedAsset(metadata, stored);
					return;
				}
				// a file used in place has no copy: what is there is left by a «Collect» a crash cut short
			if (redo && metadata.inPlace && stored && !isStoring(metadata.id)) void mediaAssetsAdapter.remove(metadata.id).catch(() => {});
			// renamed, moved, or changed in place: the list follows it
				const now: MediaAssetData = original.source ? { ...metadata, source: original.source, size: original.source.size, lastModified: original.source.lastModified } : metadata;
				if (original.source) await mediaMetadataAdapter.set({ key: metadata.id, value: now }).catch(() => {});
				forgetDamaged(metadata.id, { originalOf: metadata.editingOriginalOf });
				const file = asNamedFile(original.file, metadata.name);
				results[index] = await this.assetOf(now, file);
				if (!metadata.inPlace && redo) {
					// the copy a crash cut short is made again from the original, behind the clip that plays now
					redone++;
					const copy = mediaAssetsAdapter.set({ key: metadata.id, value: original.file }).then(() => this.copyToDisk(projectId));
					trackStore(metadata.id, copy, original.file);
					copy.catch((error) => console.warn("[storage] could not copy the original again", metadata.name, error));
				}
			} catch (error) {
				console.error("[storage] Failed to load media asset", metadata.id, error);
			}
		};
		// (bounded again: the check of each stored copy reads its header)
		let at = 0;
		await Promise.all(
			Array.from({ length: Math.min(8, ids.length) }, async () => {
				while (at < ids.length) await build(at++);
			}),
		);
		if (redone) console.info(`[storage] ${redone} copy(ies) cut short by a crash are made again from the originals`);
		return results.filter((item): item is MediaAsset => item !== null);
	}

	/**
	 * «Collect files into the project»: a file used where it is gets a copy in the project, then its line says so. Cut
	 * by a crash, the line still says «where it is» (the original is used) and the half copy is cleared at the next open.
	 */
	async collectMediaAsset({ projectId, asset }: { projectId: string; asset: MediaAsset }): Promise<boolean> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } = this.getProjectMediaAdapters({ projectId });
		const listed = await mediaMetadataAdapter.get(asset.id).catch(() => null);
		if (!listed?.inPlace) return false;
		await mediaAssetsAdapter.set({ key: asset.id, value: asset.file });
		const { inPlace: _inPlace, ...copied } = listed;
		await mediaMetadataAdapter.set({ key: asset.id, value: { ...copied, size: asset.file.size, lastModified: asset.file.lastModified } });
		this.copyToDisk(projectId);
		return true;
	}

	async deleteMediaAsset({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<void> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		await Promise.all([
			mediaAssetsAdapter.remove(id),
			mediaMetadataAdapter.remove(id),
		]);
	}

	async deleteProjectMedia({
		projectId,
	}: {
		projectId: string;
	}): Promise<void> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		await Promise.all([
			mediaMetadataAdapter.clear(),
			mediaAssetsAdapter.clear(),
		]);
	}

	async clearAllData(): Promise<void> {
		await this.projectsAdapter.clear();
		// project-specific media and timelines cleaned up when projects are deleted
	}

	async getStorageInfo(): Promise<{
		projects: number;
		isOPFSSupported: boolean;
		isIndexedDBSupported: boolean;
	}> {
		const projectIds = await this.projectsAdapter.list();

		return {
			projects: projectIds.length,
			isOPFSSupported: this.isOPFSSupported(),
			isIndexedDBSupported: this.isIndexedDBSupported(),
		};
	}

	async getProjectStorageInfo({ projectId }: { projectId: string }): Promise<{
		mediaItems: number;
	}> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({
			projectId,
		});

		const mediaIds = await mediaMetadataAdapter.list();

		return {
			mediaItems: mediaIds.length,
		};
	}

	async loadSavedSounds(): Promise<SavedSoundsData> {
		try {
			const savedSoundsData = await this.savedSoundsAdapter.get("user-sounds");
			return (
				savedSoundsData || {
					sounds: [],
					lastModified: new Date().toISOString(),
				}
			);
		} catch (error) {
			console.error("Failed to load saved sounds:", error);
			return { sounds: [], lastModified: new Date().toISOString() };
		}
	}

	async saveSoundEffect({
		soundEffect,
	}: {
		soundEffect: SoundEffect;
	}): Promise<void> {
		try {
			const currentData = await this.loadSavedSounds();

			if (currentData.sounds.some((sound) => sound.id === soundEffect.id)) {
				return; // Already saved
			}

			const savedSound: SavedSound = {
				id: soundEffect.id,
				name: soundEffect.name,
				username: soundEffect.username,
				previewUrl: soundEffect.previewUrl,
				downloadUrl: soundEffect.downloadUrl,
				duration: soundEffect.duration,
				tags: soundEffect.tags,
				license: soundEffect.license,
				savedAt: new Date().toISOString(),
			};

			const updatedData: SavedSoundsData = {
				sounds: [...currentData.sounds, savedSound],
				lastModified: new Date().toISOString(),
			};

			await this.savedSoundsAdapter.set({
				key: "user-sounds",
				value: updatedData,
			});
		} catch (error) {
			console.error("Failed to save sound effect:", error);
			throw error;
		}
	}

	async removeSavedSound({ soundId }: { soundId: number }): Promise<void> {
		try {
			const currentData = await this.loadSavedSounds();

			const updatedData: SavedSoundsData = {
				sounds: currentData.sounds.filter((sound) => sound.id !== soundId),
				lastModified: new Date().toISOString(),
			};

			await this.savedSoundsAdapter.set({
				key: "user-sounds",
				value: updatedData,
			});
		} catch (error) {
			console.error("Failed to remove saved sound:", error);
			throw error;
		}
	}

	async isSoundSaved({ soundId }: { soundId: number }): Promise<boolean> {
		try {
			const currentData = await this.loadSavedSounds();
			return currentData.sounds.some((sound) => sound.id === soundId);
		} catch (error) {
			console.error("Failed to check if sound is saved:", error);
			return false;
		}
	}

	async clearSavedSounds(): Promise<void> {
		try {
			await this.savedSoundsAdapter.remove("user-sounds");
		} catch (error) {
			console.error("Failed to clear saved sounds:", error);
			throw error;
		}
	}

	isOPFSSupported(): boolean {
		return OPFSAdapter.isSupported();
	}

	isIndexedDBSupported(): boolean {
		return "indexedDB" in window;
	}

	isFullySupported(): boolean {
		return this.isIndexedDBSupported() && this.isOPFSSupported();
	}
}

export const storageService = new StorageService();
export { StorageService };
