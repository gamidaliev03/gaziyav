import type { EditorCore } from "@/core";
import type {
	TProject,
	TProjectMetadata,
	TProjectSortKey,
	TProjectSortOption,
	TProjectSettings,
	TTimelineViewState,
} from "@/project/types";
import type { ExportOptions, ExportResult, ExportState } from "@/export";
import { storageService } from "@/services/storage/service";
import { toast } from "sonner";
import { t } from "@/i18n";
import { generateUUID } from "@/utils/id";
import { flushRemovedMedia } from "@/commands/media/remove-media-asset";
import { UpdateProjectSettingsCommand } from "@/commands/project";
import { DEFAULT_BACKGROUND_COLOR } from "@/background/color";
import { DEFAULT_CANVAS_SIZE } from "@/canvas/sizes";
import { DEFAULT_FPS } from "@/fps/defaults";
import { appPrefs } from "@/settings/app-prefs";
import { buildDefaultScene, getProjectDurationFromScenes } from "@/timeline/scenes";
import { cardIsOld, firstClipPicture } from "@/project/card-picture";
import { buildScene } from "@/services/renderer/scene-builder";
import { CanvasRenderer } from "@/services/renderer/canvas-renderer";
import {
	CURRENT_PROJECT_VERSION,
	migrations,
	runStorageMigrations,
	type MigrationProgress,
} from "@/services/storage/migrations";
import { loadFonts } from "@/fonts/google-fonts";
import { DEFAULTS } from "@/timeline/defaults";
import { getElementFontFamilies } from "@/timeline/element-utils";
import { getRaisedProjectFpsForImportedMedia } from "@/fps/utils";
import type { MediaAsset } from "@/media/types";
import type { SerializedProject } from "@/services/storage/types";
import type { SceneTracks, TimelineElement, TScene } from "@/timeline/types";
import {
	BACKUP_INTERVAL_MS,
	clearRecoveryJournal,
	projectBackups,
	isOpenableProject,
	type ProjectBackup,
	readRecoveryJournalAnywhere,
	writeRecoveryJournal,
	type RecoveryJournalEntry,
} from "@/services/storage/recovery";
import { isStorageQuotaExceededError, readStorageQuotaStatus } from "@/services/storage/quota";

const SAVE_ERROR_TOAST_ID = "project-save-error";

export interface ProjectRecoveryCandidate {
	projectId: string;
	savedAt: number;
	reason: RecoveryJournalEntry["reason"];
}

export interface MigrationState {
	isMigrating: boolean;
	fromVersion: number | null;
	toVersion: number | null;
	projectName: string | null;
}

export class ProjectManager {
	private active: TProject | null = null;
	private savedProjects: TProjectMetadata[] = [];
	private isLoading = true;
	private isInitialized = false;
	private invalidProjectIds = new Set<string>();
	private storageMigrationPromise: Promise<void> | null = null;
	private listeners = new Set<() => void>();
	private migrationState: MigrationState = {
		isMigrating: false,
		fromVersion: null,
		toVersion: null,
		projectName: null,
	};
	private exportState: ExportState = {
		isExporting: false,
		progress: 0,
		result: null,
	};
	private exportCancelRequested = false;
	private recoveryEntry: RecoveryJournalEntry | null = null;
	private lastBackupAt = 0;
	private saveFailing = false;

	constructor(private editor: EditorCore) {}

	private async ensureStorageMigrations(): Promise<void> {
		if (this.storageMigrationPromise) {
			await this.storageMigrationPromise;
			return;
		}

		this.storageMigrationPromise = (async () => {
			await runStorageMigrations({
				migrations,
				onProgress: (progress: MigrationProgress) => {
					this.migrationState = progress;
					this.notify();
				},
			});
		})();

		await this.storageMigrationPromise;
	}

	/** `canvasSize`: a format the user picked on the start page (kept when the first clip arrives). */
	async createNewProject({ name, canvasSize }: { name: string; canvasSize?: { width: number; height: number } }): Promise<string> {
		const mainScene = buildDefaultScene({ name: "Main scene", isMain: true });
		const newProject: TProject = {
			metadata: {
				id: generateUUID(),
				name,
				duration: getProjectDurationFromScenes({ scenes: [mainScene] }),
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			scenes: [mainScene],
			currentSceneId: mainScene.id,
			settings: {
				fps: newProjectFps(),
				canvasSize: canvasSize ?? DEFAULT_CANVAS_SIZE,
				canvasSizeMode: "preset",
				lastCustomCanvasSize: null,
				originalCanvasSize: canvasSize ?? null,
				background: {
					type: "color",
					color: DEFAULT_BACKGROUND_COLOR,
				},
			},
			version: CURRENT_PROJECT_VERSION,
			// one project, one timeline: a new project is born in that shape (timeline/join-timelines.ts)
			timelineModel: 1,
		};

		// Undo/redo belong to the project they were made in: ⇧⌘Z in a new project redid the last one's edit.
		this.editor.command.clear();
		this.active = newProject;
		this.notify();

		this.editor.media.clearAllAssets();
		this.editor.scenes.initializeScenes({
			scenes: newProject.scenes,
			currentSceneId: newProject.currentSceneId,
		});

		try {
			await storageService.saveProject({ project: newProject });
			this.updateMetadata(newProject);

			return newProject.metadata.id;
		} catch (error) {
			toast.error("Couldn't create the project", {
				description: describeSaveError(error),
			});
			throw error;
		}
	}

	async loadProject({ id }: { id: string }): Promise<void> {
		if (!this.isInitialized) {
			this.isLoading = true;
			this.notify();
		}

		// Undo/redo belong to the project they were made in (cleared before anything else can fail).
		this.editor.command.clear();
		this.editor.save.pause();
		await this.ensureStorageMigrations();
		this.editor.media.clearAllAssets();
		this.editor.scenes.clearScenes();

		try {
			// a project file that can't be read opens its newest whole backup instead, with one line that says so
			const result = await storageService.loadProjectOrBackup({ id });
			if (!result) {
				throw new Error(`Project with id ${id} not found`);
			}
			if (result.fromBackup) {
				toast.info(`The project file was damaged — opened the copy from ${new Date(result.fromBackup).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`, { duration: 8000 });
			}

			// an older project's several timelines become one + compound clips in Media, once (project/join-on-open.ts)
			const { joinTimelinesOnOpen } = await import("@/project/join-on-open");
			const project = withValidFps(await joinTimelinesOnOpen(id, result.project));

			this.active = project;
			this.recoveryEntry = await this.findNewerRecoveryJournal({ project });
			this.notify();
			this.backupInBackground({ project, reason: "open" });

			if (project.scenes && project.scenes.length > 0) {
				this.editor.scenes.initializeScenes({
					scenes: project.scenes,
					currentSceneId: project.currentSceneId,
				});
			}
			this.contentSignature = this.signatureOf(this.editor.scenes.getScenes(), project.settings);

			await this.editor.media.loadProjectMedia({ projectId: id, opening: true });
			// Clips whose file is lost say so at once (they played as black without a word).
			void import("@/relink/offline").then(({ reportOfflineOnOpen }) => reportOfflineOnOpen(this.editor)).catch(() => {});

			await loadFonts({
				families: [
					...new Set(
						(project.scenes ?? []).flatMap((scene) =>
							getElementFontFamilies({ tracks: scene.tracks }),
						),
					),
				],
			});

			if (!project.metadata.thumbnail) {
				try {
					const didUpdateThumbnail = await this.updateThumbnailFromTimeline();
					if (didUpdateThumbnail) {
						await this.saveCurrentProject();
					}
				} catch (error) {
					console.error("Failed to generate project thumbnail:", error);
				}
			}
		} catch (error) {
			console.error("Failed to load project:", error);
			throw error;
		} finally {
			this.isLoading = false;
			this.notify();
			this.editor.save.resume();
		}
	}

	/**
	 * What the project holds (its scenes and settings) when it was opened or last saved: a save that changes nothing of it
	 * (its card's new picture, a look at the project) keeps «Edited» as it was — opening a project and going back moved it
	 * to the top of «Last modified» as «Edited just now» (targeted test 05.11).
	 */
	private contentSignature: string | null = null;
	private signatureOf(scenes: unknown, settings: unknown): string {
		try {
			return JSON.stringify([scenes, settings]);
		} catch {
			return String(Date.now());
		}
	}

	/**
	 * The scenes as they are saved. A title being typed is a preview until the field or the box is left (one ⌘Z step),
	 * so its words were in no save: a crash or a quit two minutes into typing lost them all. Its text goes into every
	 * save as typed; any other gesture still in progress (a drag, a slider) is saved as it was before the gesture.
	 */
	private scenesForSave(): TScene[] {
		const scenes = this.editor.scenes.getScenes();
		const timeline = this.editor.timeline;
		if (!timeline.isPreviewActive()) return scenes;
		const active = this.editor.scenes.getActiveSceneOrNull();
		const preview = timeline.getPreviewTracks();
		if (!active || !preview) return scenes;
		const typed = withTypedText({ committed: active.tracks, preview });
		return typed ? scenes.map((scene) => (scene.id === active.id ? { ...scene, tracks: typed } : scene)) : scenes;
	}

	private buildProjectForSave(): TProject | null {
		if (!this.active) return null;
		const scenes = this.scenesForSave();
		const signature = this.signatureOf(scenes, this.active.settings);
		const changed = signature !== this.contentSignature;
		this.contentSignature = signature;
		return {
			...this.active,
			scenes,
			metadata: {
				...this.active.metadata,
				duration: getProjectDurationFromScenes({ scenes }),
				updatedAt: changed ? new Date() : this.active.metadata.updatedAt,
			},
		};
	}

	/**
	 * Saves the open project. On failure the edits go to the recovery journal
	 * (localStorage) and the user gets a clear message; the error is rethrown
	 * so SaveManager can retry and the close flow knows the disk copy is stale.
	 */
	/** Projects created and left without anything in them are not kept. */
	private discarded = new Set<string>();

	private isActiveEmpty(): boolean {
		if (!this.active) return false;
		// While a project opens its media list is empty until the files are read back: quitting (or going back) in that
		// moment took a project of files with nothing on the timeline yet for an untouched new one and deleted it.
		if (this.isLoading || this.editor.media.isLoadingMedia()) return false;
		if (this.editor.media.getAssets().length > 0) return false;
		// A project the user named is kept, even with nothing in it yet (renamed «План ролика», it vanished — test 05.11).
		if (this.active.metadata.renamed) return false;
		return this.editor.scenes.getScenes().every((scene) => {
			const t = scene.tracks;
			return [t.main, ...t.overlay, ...t.audio].every((track) => !track || track.elements.length === 0);
		});
	}

	async saveCurrentProject(): Promise<void> {
		if (this.active && this.discarded.has(this.active.metadata.id)) return;
		const updatedProject = this.buildProjectForSave();
		if (!updatedProject) return;

		let serialized: SerializedProject | null = null;
		try {
			serialized = storageService.serializeProject({ project: updatedProject });
			await storageService.saveSerializedProject({ serialized });
		} catch (error) {
			console.error("Failed to save project:", error);
			const journaled = serialized
				? writeRecoveryJournal({ serialized, reason: "save-failed" })
				: false;
			void this.reportSaveFailure({ error, journaled });
			throw error;
		}

		const projectId = updatedProject.metadata.id;
		clearRecoveryJournal({ projectId });
		if (this.saveFailing) {
			this.saveFailing = false;
			toast.success("Project saved", { id: SAVE_ERROR_TOAST_ID });
		}
		// The project may have been closed or switched while the write was in
		// flight: never resurrect it, and keep edits made meanwhile.
		if (this.active?.metadata.id === projectId) {
			this.active = {
				...this.active,
				metadata: {
					...this.active.metadata,
					duration: updatedProject.metadata.duration,
					updatedAt: updatedProject.metadata.updatedAt,
				},
			};
		}
		this.updateMetadata(updatedProject);
		if (Date.now() - this.lastBackupAt >= BACKUP_INTERVAL_MS) {
			this.backupInBackground({ project: updatedProject, reason: "periodic" });
		}
	}

	/** Synchronous copy of the open project into the recovery journal. */
	writeRecoveryJournalNow({
		reason,
	}: {
		reason: RecoveryJournalEntry["reason"];
	}): boolean {
		const project = this.buildProjectForSave();
		if (!project) return false;
		try {
			return writeRecoveryJournal({
				serialized: storageService.serializeProject({ project }),
				reason,
			});
		} catch (error) {
			console.error("[recovery] Could not serialize the project:", error);
			return false;
		}
	}

	/** Unsaved edits found from a crash or failed save, newer than the disk copy. */
	getRecoveryCandidate(): ProjectRecoveryCandidate | null {
		const entry = this.recoveryEntry;
		if (!entry || entry.projectId !== this.active?.metadata.id) return null;
		return {
			projectId: entry.projectId,
			savedAt: entry.savedAt,
			reason: entry.reason,
		};
	}

	dismissRecovery(): void {
		const entry = this.recoveryEntry;
		if (!entry) return;
		this.recoveryEntry = null;
		clearRecoveryJournal({ projectId: entry.projectId });
		this.notify();
	}

	/** Replaces the open project with the journal copy; the disk copy is backed up first. */
	async applyRecovery(): Promise<boolean> {
		const entry = this.recoveryEntry;
		const current = this.active;
		if (!entry || !current || entry.projectId !== current.metadata.id) {
			return false;
		}
		this.recoveryEntry = null;
		try {
			await projectBackups.add({
				serialized: storageService.serializeProject({ project: current }),
				reason: "before-restore",
			});
		} catch (error) {
			console.warn("[recovery] backup before restore failed", error);
		}

		// a copy from before one timeline (no mark) is joined before it is shown, as on open (project/join-on-open.ts)
		const { joinedDocument } = await import("@/project/join-on-open");
		const joined = joinedDocument(entry.project);
		if (joined !== entry.project && !(await projectBackups.list({ projectId: entry.projectId }).catch(() => [])).some((b) => b.reason === "before-join"))
			await projectBackups.add({ serialized: entry.project, reason: "before-join" }).catch(() => {});
		const restored = storageService.deserializeProject({
			serializedProject: joined,
		});
		this.active = restored;
		this.editor.command.clear();
		this.editor.scenes.initializeScenes({
			scenes: restored.scenes,
			currentSceneId: restored.currentSceneId,
		});
		this.notify();
		void loadFonts({
			families: [
				...new Set(
					restored.scenes.flatMap((scene) =>
						getElementFontFamilies({ tracks: scene.tracks }),
					),
				),
			],
		}).catch(() => {});

		const saved = await this.editor.save.flush();
		if (saved) {
			clearRecoveryJournal({ projectId: entry.projectId });
			toast.success("Unsaved changes restored");
		}
		return saved;
	}

	private async findNewerRecoveryJournal({
		project,
	}: {
		project: TProject;
	}): Promise<RecoveryJournalEntry | null> {
		const projectId = project.metadata.id;
		const entry = await readRecoveryJournalAnywhere({ projectId });
		if (!entry) return null;
		const isUsable =
			entry.project.version === project.version &&
			Array.isArray(entry.project.scenes) &&
			entry.project.scenes.length > 0 &&
			entry.savedAt > project.metadata.updatedAt.getTime();
		if (!isUsable) {
			clearRecoveryJournal({ projectId });
			return null;
		}
		// A journal written just before a save that did land is not news.
		const onDisk = storageService.serializeProject({ project });
		if (
			JSON.stringify(onDisk.scenes.map((scene) => scene.tracks)) ===
				JSON.stringify(entry.project.scenes.map((scene) => scene.tracks)) &&
			JSON.stringify(onDisk.settings) === JSON.stringify(entry.project.settings)
		) {
			clearRecoveryJournal({ projectId });
			return null;
		}
		return entry;
	}

	/** ⌘S: a copy of the project as it is now goes into its backups (Restore previous version). */
	backupNow(): void {
		const project = this.buildProjectForSave();
		if (project) this.backupInBackground({ project, reason: "save" });
	}

	/** The project's saved versions, newest first (the home page's «Restore previous version»). */
	async listVersions({ id }: { id: string }): Promise<ProjectBackup[]> {
		return projectBackups.list({ projectId: id }).catch(() => []);
	}

	/** Makes a saved version the project again; what it was a moment ago becomes a version of its own first. */
	async restoreVersion({ id, createdAt }: { id: string; createdAt: number }): Promise<boolean> {
		const chosen = (await this.listVersions({ id })).find((backup) => backup.createdAt === createdAt);
		if (!chosen || !isOpenableProject(chosen.project)) return false;
		try {
			const current = await storageService.loadProject({ id });
			if (current) await projectBackups.add({ serialized: storageService.serializeProject({ project: current.project }), reason: "before-restore" });
		} catch (error) {
			console.warn("[recovery] backup before restore failed", error);
		}
		const now = new Date().toISOString();
		await storageService.saveSerializedProject({ serialized: { ...chosen.project, metadata: { ...chosen.project.metadata, updatedAt: now } } });
		await this.loadAllProjects();
		return true;
	}

	private backupInBackground({
		project,
		reason,
	}: {
		project: TProject;
		reason: "open" | "periodic" | "save";
	}): void {
		this.lastBackupAt = Date.now();
		let serialized: SerializedProject;
		try {
			serialized = storageService.serializeProject({ project });
		} catch {
			return;
		}
		void projectBackups.add({ serialized, reason }).catch((error) => {
			console.warn("[recovery] backup failed", error);
		});
	}

	private async reportSaveFailure({
		error,
		journaled,
	}: {
		error: unknown;
		journaled: boolean;
	}): Promise<void> {
		this.saveFailing = true;
		// A full disk fails the write with an «IO error» (UnknownError), not a quota error: the message said only
		// «Couldn't save the project», and promised a recovery copy that sits on the same full disk.
		const isQuota = isStorageQuotaExceededError({ error }) || (await diskLooksFull());
		const title = isQuota
			? "Couldn't save: the disk is full"
			: "Couldn't save the project";
		const description = isQuota
			? "Free up disk space: saving retries by itself. Keep Gaziyav open until it says «Project saved» — your latest edits are not on the disk yet."
			: journaled
				? "Your changes are kept in a recovery copy and saving will retry automatically. You can restore them the next time you open the project."
				: "Keep the window open — saving will retry in a few seconds.";
		toast.error(title, {
			id: SAVE_ERROR_TOAST_ID,
			description,
			duration: 15_000,
		});
	}

	async export({ options }: { options: ExportOptions }): Promise<ExportResult> {
		this.exportCancelRequested = false;
		this.exportState = { isExporting: true, progress: 0, result: null };
		this.notify();

		// Remotion AI Compositions: their AI layers are composited after the normal export (half of the progress bar).
		// The AI layer render starts now, in parallel with OpenCut's export of the clips.
		const { exportLayers, startAiLayers, compositeAiLayers } = await import("@/montage/export");
		// AI layers with clips above them are rendered first and placed in the stack like clips (correct order).
		const { ensureProxies, exportGroups } = await import("@/montage/layer-proxies");
		const { sliceActiveSceneToRange } = await import("@/in-out/slice");
		const exportBase = options.range ? sliceActiveSceneToRange({ editor: this.editor, range: options.range }) : this.editor.scenes.getActiveScene().tracks;
		// A clip whose file is lost would come out black or silent with no word: the export refuses and names it.
		const { damagedOriginalsIn, fromCopyNotice, offlineClips, offlineExportError } = await import("@/relink/offline");
		const wanted = options.elements ? new Set(options.elements.ids) : null;
		const offline = offlineClips({ tracks: exportBase, assets: this.editor.media.getAssets(), rendered: true }).filter((clip) => !wanted || wanted.has(clip.elementId));
		if (offline.length) {
			this.exportState = { isExporting: false, progress: 0, result: { success: false, error: offlineExportError(offline) } };
			this.notify();
			return this.exportState.result as ExportResult;
		}
		// an original behind an editing copy that is damaged: the copy is rendered, and the export says so (polish, 11.11)
		const fromCopy = damagedOriginalsIn(exportBase);
		if (fromCopy.length) toast.warning(fromCopyNotice(fromCopy), { id: "export-from-copy", duration: 12_000 });
		const covered =options.mainTrackOnly || options.elements ? [] : exportGroups(exportBase);
		if (covered.length && !(await ensureProxies(covered, () => this.exportCancelRequested))) {
			const cancelled = this.exportCancelRequested;
			this.exportState = { isExporting: false, progress: 0, result: cancelled ? { success: false, cancelled: true } : { success: false, error: "Rendering an AI layer failed. Try Export again." } };
			this.notify();
			return this.exportState.result as ExportResult;
		}
		const aiInput = options.elements ? null : exportLayers(this.editor, options);
		const aiLayers = aiInput ? await startAiLayers(aiInput) : null;
		if (aiLayers && "error" in aiLayers) {
			this.exportState = { isExporting: false, progress: 0, result: { success: false, error: aiLayers.error } };
			this.notify();
			return this.exportState.result as ExportResult;
		}
		const share = aiLayers ? 0.7 : 1;
		let result = await this.editor.renderer.exportProject({
			// AI layers are composited over the video in memory afterwards
			options: aiLayers ? { ...options, toFile: undefined } : options,
			onProgress: ({ progress, etaSeconds }) => {
				// (the time left is the renderer's own measure; with AI layers still to be laid over, it is not the whole of it)
				this.exportState = { ...this.exportState, progress: progress * share, ...(etaSeconds !== undefined && !aiLayers ? { etaSeconds } : {}) };
				this.notify();
			},
			onCancel: () => this.exportCancelRequested,
		});
		if (aiLayers && !(result.success && result.buffer)) aiLayers.cancel();
		if (aiLayers && result.success && result.buffer) {
			result = await compositeAiLayers({
				buffer: result.buffer,
				layers: aiLayers,
				format: options.format,
				onProgress: (p) => {
					this.exportState = { ...this.exportState, progress: 0.7 + p * 0.3 };
					this.notify();
				},
				isCancelled: () => this.exportCancelRequested,
			});
		}

		this.exportState = {
			isExporting: false,
			progress: this.exportState.progress,
			result,
		};
		this.notify();

		return result;
	}

	cancelExport(): void {
		this.exportCancelRequested = true;
	}

	clearExportState(): void {
		this.exportState = { isExporting: false, progress: 0, result: null };
		this.notify();
	}

	getExportState(): ExportState {
		return this.exportState;
	}

	async loadAllProjects(): Promise<void> {
		if (!this.isInitialized) {
			this.isLoading = true;
			this.notify();
		}

		try {
			await this.ensureStorageMigrations();
			try {
				void storageService.keepStorage();
				// Projects the browser storage lost come back from their copies on the Mac's disk, with one line that says so.
				const restored = await storageService.restoreLostProjects().catch(() => []);
				if (restored.length) {
					toast.info(restored.length === 1 ? t("Restored «{name}» from its copy on disk", { name: restored[0] }) : t("Restored {n} projects from their copies on disk", { n: restored.length }), { duration: 10_000 });
				}
				const metadata = await storageService.loadAllProjectsMetadata();
				this.savedProjects = metadata;
				this.notify();
				// Trash keeps a project 30 days, as in CapCut; after that it goes for good.
				const expired = metadata.filter((project) => trashDaysLeft(project) === 0).map((project) => project.id);
				if (expired.length) void this.deleteProjects({ ids: expired });
				// Cards without a real picture get one in the background (no need to open each project).
				void this.repairThumbnails();
			} catch (error) {
				console.error("Failed to load projects:", error);
			} finally {
				this.isLoading = false;
				this.isInitialized = true;
				this.notify();
			}
		} catch (error) {
			console.error("Failed to run migrations:", error);
			this.isLoading = false;
			this.isInitialized = true;
			this.notify();
		}
	}

	async deleteProjects({ ids }: { ids: string[] }): Promise<void> {
		const uniqueIds = Array.from(new Set(ids));
		if (uniqueIds.length === 0) return;

		try {
			await Promise.all(
				uniqueIds.map((id) =>
					Promise.all([
						storageService.deleteProjectMedia({ projectId: id }),
						storageService.deleteProject({ id }),
					]),
				),
			);

			const idSet = new Set(uniqueIds);
			this.savedProjects = this.savedProjects.filter(
				(project) => !idSet.has(project.id),
			);

			const shouldClearActive =
				this.active && idSet.has(this.active.metadata.id);

			if (shouldClearActive) {
				this.active = null;
				this.editor.command.clear();
				this.editor.media.clearAllAssets();
				this.editor.scenes.clearScenes();
			}

			this.notify();
		} catch (error) {
			console.error("Failed to delete projects:", error);
		}
	}

	/** Move to Trash (CapCut): the project leaves the list but can be restored for 30 days. */
	async trashProjects({ ids }: { ids: string[] }): Promise<void> {
		const open = !!this.active && ids.includes(this.active.metadata.id);
		// The open project's last edits are saved first: Restore brings back exactly what was on screen.
		if (open) await this.editor.save.flush().catch(() => false);
		await this.setTrashed({ ids, trashedAt: new Date() });
		if (open) this.closeProject();
	}

	async restoreProjects({ ids }: { ids: string[] }): Promise<void> {
		await this.setTrashed({ ids, trashedAt: undefined });
	}

	/** Projects in Trash, the most recently moved first. */
	getTrashedProjects(): TProjectMetadata[] {
		return this.savedProjects
			.filter((project) => project.trashedAt)
			.sort((a, b) => trashTime(b) - trashTime(a));
	}

	private async setTrashed({ ids, trashedAt }: { ids: string[]; trashedAt: Date | undefined }): Promise<void> {
		const uniqueIds = Array.from(new Set(ids));
		const results = await Promise.allSettled(
			uniqueIds.map(async (id) => {
				const result = await storageService.loadProject({ id });
				if (!result) throw new Error(`Project not found: ${id}`);
				// Moving to Trash isn't an edit: «Last modified» stays as it was.
				const { trashedAt: _previous, ...metadata } = result.project.metadata;
				const project: TProject = { ...result.project, metadata: trashedAt ? { ...metadata, trashedAt } : metadata };
				await storageService.saveProject({ project });
				// The open copy carries the mark too, so a save that slips in before closing can't undo it.
				if (this.active?.metadata.id === id) this.active = { ...this.active, metadata: project.metadata };
				this.updateMetadata(project);
			}),
		);
		const failed = results.filter((result) => result.status === "rejected");
		if (failed.length) {
			console.error("Failed to move projects:", failed);
			toast.error(trashedAt ? "Couldn't move to Trash" : "Couldn't restore", {
				description: "Refresh the project list and try again.",
			});
		}
	}

	closeProject(): void {
		this.active = null;
		this.editor.command.clear();
		this.notify();

		this.editor.media.clearAllAssets();
		this.editor.scenes.clearScenes();
	}

	async renameProject({
		id,
		name,
	}: {
		id: string;
		name: string;
	}): Promise<void> {
		// Every caller gets the same rule: a blank name keeps the old one (a nameless card, an empty
		// project menu and an export saved as "mp4.mp4" helped nobody).
		const trimmedName = name.trim();
		if (!trimmedName) return;
		try {
			const result = await storageService.loadProject({ id });
			if (!result) {
				toast.error("Project not found", {
					description: "Refresh the project list and try again.",
				});
				return;
			}

			const updatedProject: TProject = {
				...result.project,
				metadata: {
					...result.project.metadata,
					name: trimmedName,
					renamed: true,
					updatedAt: new Date(),
				},
			};

			await storageService.saveProject({ project: updatedProject });

			if (this.active?.metadata.id === id) {
				this.active = updatedProject;
				this.notify();
			}

			this.updateMetadata(updatedProject);
		} catch (error) {
			console.error("Failed to rename project:", error);
			toast.error("Couldn't rename the project", {
				description: describeSaveError(error),
			});
		}
	}

	async duplicateProjects({ ids }: { ids: string[] }): Promise<string[]> {
		const uniqueIds = Array.from(new Set(ids));
		if (uniqueIds.length === 0) return [];

		try {
			// «Name copy», «Name copy 2»… (as Finder names copies; «(1) Name» read like a list number).
			const getDuplicateBaseName = ({ name }: { name: string }) => {
				const match = name.match(/^(.+?) copy(?: (\d+))?$/);
				const number = match ? (match[2] ? Number.parseInt(match[2], 10) : 1) : null;
				const baseName = match ? match[1] : name;
				return { baseName, number };
			};

			const loadResults = await Promise.all(
				uniqueIds.map(async (projectId) => {
					const result = await storageService.loadProject({ id: projectId });
					return { projectId, project: result?.project ?? null };
				}),
			);

			const missingProjectIds = loadResults
				.filter((result) => !result.project)
				.map((result) => result.projectId);

			if (missingProjectIds.length > 0) {
				toast.error(
					missingProjectIds.length === 1
						? "Project not found"
						: "Some projects could not be found",
					{
						description: "Refresh the project list and try again.",
					},
				);
				throw new Error(`Projects not found: ${missingProjectIds.join(", ")}`);
			}

			const projectsToDuplicate = loadResults.flatMap((result) =>
				result.project ? [result.project] : [],
			);

			const maxNumberByBaseName = new Map<string, number>();

			for (const project of this.savedProjects) {
				const { baseName, number } = getDuplicateBaseName({
					name: project.name,
				});

				if (number === null) continue;

				const currentMax = maxNumberByBaseName.get(baseName);
				if (currentMax === undefined || number > currentMax) {
					maxNumberByBaseName.set(baseName, number);
				}
			}

			const nextNumberByBaseName = new Map<string, number>();
			for (const [baseName, maxNumber] of maxNumberByBaseName) {
				nextNumberByBaseName.set(baseName, maxNumber + 1);
			}

			const duplicationPlans = projectsToDuplicate.map((project) => {
				const { baseName } = getDuplicateBaseName({
					name: project.metadata.name,
				});
				const nextNumber = nextNumberByBaseName.get(baseName) ?? 1;
				nextNumberByBaseName.set(baseName, nextNumber + 1);

				const newProjectId = generateUUID();
				const newProject: TProject = {
					...project,
					metadata: {
						...project.metadata,
						id: newProjectId,
						name: nextNumber === 1 ? `${baseName} copy` : `${baseName} copy ${nextNumber}`,
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				};

				return {
					newProjectId,
					newProject,
					sourceProjectId: project.metadata.id,
				};
			});

			await Promise.all(
				duplicationPlans.map(({ newProject }) =>
					storageService.saveProject({ project: newProject }),
				),
			);

			await Promise.all(
				duplicationPlans.map(async ({ sourceProjectId, newProjectId }) => {
					// What was removed from the open project's Media (kept on disk only for ⌘Z) isn't copied.
					if (sourceProjectId === this.active?.metadata.id) await flushRemovedMedia(sourceProjectId).catch(() => {});
					const sourceMediaAssets = await storageService.loadAllMediaAssets({
						projectId: sourceProjectId,
					});

					await Promise.all(
						sourceMediaAssets.map((mediaAsset) =>
							storageService.saveMediaAsset({
								projectId: newProjectId,
								mediaAsset,
							}),
						),
					);
				}),
			);

			for (const { newProject } of duplicationPlans) {
				this.updateMetadata(newProject);
			}

			return duplicationPlans.map((plan) => plan.newProjectId);
		} catch (error) {
			console.error("Failed to duplicate projects:", error);
			toast.error("Couldn't duplicate the project", {
				description: describeSaveError(error),
			});
			throw error;
		}
	}

	async updateSettings({
		settings,
		pushHistory = true,
	}: {
		settings: Partial<TProjectSettings>;
		pushHistory?: boolean;
	}): Promise<void> {
		if (!this.active) return;

		const command = new UpdateProjectSettingsCommand(settings);
		if (pushHistory) {
			this.editor.command.execute({ command });
			return;
		}

		command.execute();
	}

	ratchetFpsForImportedMedia({
		importedAssets,
	}: {
		importedAssets: Array<Pick<MediaAsset, "type" | "fps">>;
	}): import("opencut-wasm").FrameRate | null {
		if (!this.active) return null;

		const nextFps = getRaisedProjectFpsForImportedMedia({
			currentFps: this.active.settings.fps,
			importedAssets,
		});
		if (nextFps === null) return null;

		new UpdateProjectSettingsCommand({ fps: nextFps }).execute();
		return nextFps;
	}

	async updateThumbnail({ thumbnail }: { thumbnail: string }): Promise<void> {
		if (!this.active) return;

		const updatedProject: TProject = {
			...this.active,
			metadata: { ...this.active.metadata, thumbnail, thumbnailAt: new Date() },
		};
		this.active = updatedProject;
		this.notify();
		this.updateMetadata(updatedProject);
		this.editor.save.markDirty();
	}

	/** Before the window closes (the app quit from the editor, no exit step): the card shows the timeline as it is now.
	 * A slow first frame gives up within the time and is left to repairThumbnails on the next visit home. */
	async refreshCard({ within }: { within: number }): Promise<void> {
		if (!this.active || !cardIsOld(this.active.metadata)) return;
		await Promise.race([this.updateThumbnailFromTimeline().catch(() => false), new Promise((done) => setTimeout(done, within))]);
	}

	/** Empty on screen and nothing stored for it either (media that could not be read back is still the user's). */
	private async isActiveEmptyForSure(): Promise<boolean> {
		if (!this.active || !this.isActiveEmpty()) return false;
		const stored = await storageService.hasStoredMedia({ projectId: this.active.metadata.id }).catch(() => true);
		return !stored && this.isActiveEmpty();
	}

	/** Quitting from an untouched new project: it is not kept. True when it was removed. */
	async discardIfEmpty(): Promise<boolean> {
		const id = this.active?.metadata.id;
		if (!id || !(await this.isActiveEmptyForSure()) || this.active?.metadata.id !== id) return false;
		this.discarded.add(id);
		await this.deleteProjects({ ids: [id] }).catch(() => {});
		return true;
	}

	async prepareExit(): Promise<void> {
		if (!this.active) return;
		const id = this.active.metadata.id;
		if ((await this.isActiveEmptyForSure()) && this.active?.metadata.id === id) {
			this.discarded.add(id);
			await this.deleteProjects({ ids: [id] }).catch(() => {});
			return;
		}

		try {
			await this.updateThumbnailFromTimeline();
		} catch (error) {
			console.error("Failed to generate project thumbnail on exit:", error);
		}
		// Always: a sound-only project has no thumbnail, and its last edit was lost when only the thumbnail flushed.
		await this.editor.save.flush().catch(() => false);
		await flushRemovedMedia(this.active?.metadata.id ?? "").catch(() => {});
	}

	getFilteredAndSortedProjects({
		searchQuery,
		sortOption,
	}: {
		searchQuery: string;
		sortOption: TProjectSortOption;
	}): TProjectMetadata[] {
		const filteredProjects = this.savedProjects.filter(
			(project) => !project.trashedAt && project.name.toLowerCase().includes(searchQuery.toLowerCase()),
		);

		const [key, order] = sortOption.split("-") as [
			TProjectSortKey,
			"asc" | "desc",
		];

		const sortedProjects = [...filteredProjects].sort((a, b) => {
			// Names sort the way people read them: "alpha" between "Alpha" and "Bravo", not after every
			// capitalised name (a raw UTF-16 compare put all lower-case names last).
			if (key === "name") {
				const byName = compareProjectNames({ a: a.name, b: b.name });
				return order === "asc" ? byName : -byName;
			}

			const aValue = a[key];
			const bValue = b[key];

			if (order === "asc") {
				if (aValue < bValue) return -1;
				if (aValue > bValue) return 1;
				return 0;
			}
			if (aValue > bValue) return -1;
			if (aValue < bValue) return 1;
			return 0;
		});

		return sortedProjects;
	}

	isInvalidProjectId({ id }: { id: string }): boolean {
		return this.invalidProjectIds.has(id);
	}

	markProjectIdAsInvalid({ id }: { id: string }): void {
		this.invalidProjectIds.add(id);
		this.notify();
	}

	clearInvalidProjectIds(): void {
		this.invalidProjectIds.clear();
		this.notify();
	}

	getActive(): TProject {
		if (!this.active) {
			throw new Error("No active project");
		}
		return this.active;
	}

	/**
	 * for agents:
	 * in most cases, the project is guaranteed to be active, in which getActive() should be used instead.
	 * for very rare cases, this function may be used.
	 */
	getActiveOrNull(): TProject | null {
		return this.active;
	}

	getTimelineViewState(): TTimelineViewState {
		return this.active?.timelineViewState ?? DEFAULTS.timeline.viewState;
	}

	/**
	 * Zoom / scroll / playhead of the timeline, saved with the project. Only the timeline reads it (when it
	 * mounts), so this does not notify: every zoom step and scroll save used to re-render everything that
	 * watches the project (the editor root, header, export button...).
	 */
	setTimelineViewState({ viewState }: { viewState: TTimelineViewState }): void {
		if (!this.active) return;
		const current = this.active.timelineViewState;
		if (
			current &&
			viewState &&
			current.zoomLevel === viewState.zoomLevel &&
			current.scrollLeft === viewState.scrollLeft &&
			current.playheadTime === viewState.playheadTime
		) {
			return;
		}
		this.active = {
			...this.active,
			timelineViewState: viewState ?? undefined,
		};
		// perf, 13.11: not a save of its own (each scroll, zoom and play rewrote the whole project): it goes with the next one
		this.editor.save.markViewDirty();
	}

	getSavedProjects(): TProjectMetadata[] {
		return this.savedProjects;
	}

	getIsLoading(): boolean {
		return this.isLoading;
	}

	getIsInitialized(): boolean {
		return this.isInitialized;
	}

	getMigrationState(): MigrationState {
		return this.migrationState;
	}

	setActiveProject({ project }: { project: TProject }): void {
		this.active = project;
		this.notify();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private repairingThumbnails = false;

	/** Projects saved with no picture, a black one or one older than their last change get the picture of their timeline's first clip, one at a time. */
	async repairThumbnails(): Promise<void> {
		if (this.repairingThumbnails || typeof window === "undefined") return;
		this.repairingThumbnails = true;
		try {
			const emptyIds: string[] = [];
			for (const meta of [...this.savedProjects].slice(0, 60)) {
				const needsPicture = !meta.thumbnail || (await isBlackImage(meta.thumbnail));
				// Left by quitting from the editor or a crash: the card still shows what was there before (user, 06.11 and 07.11).
				if (!needsPicture && !cardIsOld(meta)) continue;
				// The project just left without its exit step (browser Back, a swipe): its timeline is still loaded, so its
				// card gets the timeline's own first frame now, as a normal exit gives it (blind test 05.11: no picture
				// until a restart).
				if (meta.id === this.active?.metadata.id) {
					if (await this.updateThumbnailFromTimeline().catch(() => false)) await this.saveCurrentProject().catch(() => {});
					continue;
				}
				const assets = await storageService.loadAllMediaAssets({ projectId: meta.id }).catch(() => null);
				if (!assets) continue;
				// Created and left untouched (no media, nothing on any timeline): not kept, wherever it was left from.
				if (needsPicture && assets.length === 0) {
					const loaded = await storageService.loadProject({ id: meta.id }).catch(() => null);
					if (loaded && countElements(loaded.project) === 0) {
						emptyIds.push(meta.id);
						continue;
					}
				}
				const loaded = await storageService.loadProject({ id: meta.id }).catch(() => null);
				if (!loaded) continue;
				const scene = loaded.project.scenes.find((s) => s.id === loaded.project.currentSceneId) ?? loaded.project.scenes[0];
				const fromClip = scene ? firstClipPicture({ tracks: scene.tracks, assets }) : undefined;
				const firstMedia = assets.find((a) => (a.type === "video" || a.type === "image") && a.thumbnailUrl)?.thumbnailUrl;
				const picture = fromClip ?? (needsPicture ? firstMedia : meta.thumbnail);
				if (!picture) continue;
				// Opened while this one was reading: the open project saves its own card.
				if (meta.id === this.active?.metadata.id) continue;
				const thumbnailAt = new Date();
				const project = { ...loaded.project, metadata: { ...loaded.project.metadata, thumbnail: picture, thumbnailAt } };
				await storageService.saveProject({ project });
				this.savedProjects = this.savedProjects.map((p) => (p.id === meta.id ? { ...p, thumbnail: picture, thumbnailAt } : p));
				this.notify();
			}
			if (emptyIds.length) await this.deleteProjects({ ids: emptyIds });
		} catch (error) {
			console.error("Thumbnail repair stopped:", error);
		} finally {
			this.repairingThumbnails = false;
		}
	}

	private async updateThumbnailFromTimeline(): Promise<boolean> {
		if (!this.active) return false;

		const tracks = this.editor.scenes.getActiveScene().tracks;
		const mediaAssets = this.editor.media.getAssets();
		const duration = this.editor.timeline.getTotalDuration();
		const { canvasSize, background } = this.active.settings;

		const scene = buildScene({
			tracks,
			mediaAssets,
			duration: duration || 1,
			canvasSize,
			background,
		});

		const renderer = new CanvasRenderer({
			width: canvasSize.width,
			height: canvasSize.height,
			fps: this.active.settings.fps,
		});

		const tempCanvas = document.createElement("canvas");
		tempCanvas.width = canvasSize.width;
		tempCanvas.height = canvasSize.height;

		// The card shows the first frame of the timeline; a black one (fade-in, AI intro, not decoded yet)
		// falls through to later moments.
		const total = Math.max(0, Number(duration) || 0);
		const moments = [0, total * 0.25, total * 0.5].filter((t, i, all) => all.indexOf(t) === i);
		let picked = false;
		for (const time of moments) {
			await renderer.renderToCanvas({ node: scene, time: time as typeof duration, targetCanvas: tempCanvas });
			if (!isMostlyBlack(tempCanvas)) {
				picked = true;
				break;
			}
		}

		// Small and light: the projects page shows ~240 px cards.
		const scale = Math.min(1, 480 / Math.max(canvasSize.width, canvasSize.height));
		const small = document.createElement("canvas");
		small.width = Math.max(1, Math.round(canvasSize.width * scale));
		small.height = Math.max(1, Math.round(canvasSize.height * scale));
		small.getContext("2d")?.drawImage(tempCanvas, 0, 0, small.width, small.height);
		let thumbnailDataUrl = picked ? small.toDataURL("image/jpeg", 0.82) : "";
		// Still nothing visible: the picture of the first clip, then the first in the project's media, is better than a black card.
		if (!thumbnailDataUrl) {
			thumbnailDataUrl =
				firstClipPicture({ tracks, assets: mediaAssets }) ??
				mediaAssets.find((a) => (a.type === "video" || a.type === "image") && a.thumbnailUrl)?.thumbnailUrl ??
				"";
		}
		if (!thumbnailDataUrl) return false;

		await this.updateThumbnail({ thumbnail: thumbnailDataUrl });
		return true;
	}

	private updateMetadata(project: TProject): void {
		const index = this.savedProjects.findIndex(
			(p) => p.id === project.metadata.id,
		);

		if (index !== -1) {
			this.savedProjects = this.savedProjects.with(index, project.metadata);
		} else {
			this.savedProjects = [project.metadata, ...this.savedProjects];
		}

		this.notify();
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}
}

/** Project names in reading order: case and accents don't split the list, "Video 2" comes before "Video 10". */
export function compareProjectNames({ a, b }: { a: string; b: string }): number {
	const byBase = a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
	// Names equal but for case ("alpha" / "Alpha") still get one fixed order.
	return byBase !== 0 ? byBase : a.localeCompare(b, undefined, { numeric: true });
}

/** Next to nothing left for the app on its disk (the estimate the import checks too). */
async function diskLooksFull(): Promise<boolean> {
	const status = await readStorageQuotaStatus().catch(() => null);
	return !!status && status.headroomBytes !== null && status.headroomBytes < 64 * 1024 * 1024;
}

function describeSaveError(error: unknown): string {
	if (isStorageQuotaExceededError({ error })) {
		return "The disk is full. Free up some space and try again.";
	}
	return "Please try again. If it keeps failing, restart the app.";
}

/** True when a canvas shows (almost) nothing: a black or empty frame. */
function isMostlyBlack(canvas: HTMLCanvasElement): boolean {
	const probe = document.createElement("canvas");
	probe.width = 24;
	probe.height = 24;
	const ctx = probe.getContext("2d", { willReadFrequently: true });
	if (!ctx) return false;
	ctx.drawImage(canvas, 0, 0, 24, 24);
	const data = ctx.getImageData(0, 0, 24, 24).data;
	let lit = 0;
	for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 60 && data[i + 3] > 0) lit++;
	return lit < 24 * 24 * 0.04;
}

/** True when an image (data URL) is (almost) black — an old first-frame thumbnail. */
function isBlackImage(src: string): Promise<boolean> {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => {
			const c = document.createElement("canvas");
			c.width = 16;
			c.height = 16;
			const ctx = c.getContext("2d", { willReadFrequently: true });
			if (!ctx) return resolve(false);
			ctx.drawImage(img, 0, 0, 16, 16);
			const d = ctx.getImageData(0, 0, 16, 16).data;
			let lit = 0;
			for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60 && d[i + 3] > 0) lit++;
			resolve(lit < 16 * 16 * 0.04);
		};
		img.onerror = () => resolve(true);
		img.src = src;
	});
}

/**
 * The committed tracks with the words of the titles being typed in `preview` (only a text clip's `content` is taken
 * from it: a drag or a slider in progress is not an edit yet). Null when no title's words differ.
 */
export function withTypedText({ committed, preview }: { committed: SceneTracks; preview: SceneTracks }): SceneTracks | null {
	const typed = new Map<string, unknown>();
	for (const track of [preview.main, ...preview.overlay, ...preview.audio]) {
		for (const element of track.elements as TimelineElement[]) {
			if (element.type === "text") typed.set(element.id, element.params?.content);
		}
	}
	let changed = false;
	const apply = <T extends { elements: readonly unknown[] }>(track: T): T => {
		let own = false;
		const elements = (track.elements as TimelineElement[]).map((element) => {
			if (element.type !== "text" || !typed.has(element.id)) return element;
			const content = typed.get(element.id);
			if (typeof content !== "string" || content === element.params?.content) return element;
			own = true;
			return { ...element, params: { ...element.params, content } };
		});
		if (!own) return track;
		changed = true;
		return { ...track, elements } as T;
	};
	const tracks: SceneTracks = { ...committed, main: apply(committed.main), overlay: committed.overlay.map(apply), audio: committed.audio.map(apply) };
	return changed ? tracks : null;
}

/** All timeline elements in a saved project (every scene, every track). */
function countElements(value: unknown): number {
	if (!value || typeof value !== "object") return 0;
	if (Array.isArray(value)) return value.reduce((n, v) => n + countElements(v), 0);
	let n = 0;
	for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
		if (key === "elements" && Array.isArray(v)) n += v.length;
		else if (key !== "metadata") n += countElements(v);
	}
	return n;
}

const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** When a project went to Trash, in ms; 0 for a missing or damaged date (it sorts last). */
function trashTime(project: Pick<TProjectMetadata, "trashedAt">): number {
	const time = project.trashedAt instanceof Date ? project.trashedAt.getTime() : Number.NaN;
	return Number.isFinite(time) ? time : 0;
}

/** Whole days a project in Trash has left (0 = due for deletion); null when it isn't in Trash. */
export function trashDaysLeft(project: Pick<TProjectMetadata, "trashedAt">, now = Date.now()): number | null {
	if (!project.trashedAt) return null;
	const trashedAt = project.trashedAt instanceof Date ? project.trashedAt.getTime() : Number.NaN;
	// A damaged date must not turn the badge (and the 30-day cleanup) into NaN: the project stays, visibly in Trash.
	if (!Number.isFinite(trashedAt) || !Number.isFinite(now)) return null;
	return Math.max(0, Math.ceil((trashedAt + TRASH_DAYS * DAY_MS - now) / DAY_MS));
}

/** A project whose frame rate is damaged (0, negative, not a number) plays, shows and exports at 30 fps — the same rate
 * everywhere instead of the preview guessing one and the export another; the next save keeps it. */
export function withValidFps(project: TProject): TProject {
	const fps = project.settings?.fps;
	const ok = !!fps && Number.isInteger(fps.numerator) && Number.isInteger(fps.denominator) && fps.numerator > 0 && fps.denominator > 0;
	return ok ? project : { ...project, settings: { ...project.settings, fps: DEFAULT_FPS } };
}

/** Settings → Edit → Frame rate: what a new project starts with (30 fps unless chosen). */
function newProjectFps() {
	const fps = appPrefs().projectFps;
	return Number.isInteger(fps) && fps > 0 && fps !== DEFAULT_FPS.numerator ? { numerator: fps, denominator: 1 } : DEFAULT_FPS;
}
