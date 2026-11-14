import type { EditorCore } from "@/core";
import type { Bookmark, SceneTracks, TScene } from "@/timeline";
import { storageService } from "@/services/storage/service";
import {
	getMainScene,
	ensureMainScene,
	canDeleteScene,
	findCurrentScene,
	settleNestedScenes,
} from "@/timeline/scenes";
import {
	getBookmarkAtTime,
	getFrameTime,
	isBookmarkAtTime,
} from "@/timeline/bookmarks/index";
import {
	CreateSceneCommand,
	DeleteSceneCommand,
	MoveBookmarkCommand,
	RemoveBookmarkCommand,
	RenameSceneCommand,
	ToggleBookmarkCommand,
	UpdateBookmarkCommand,
} from "@/commands/scene";
import { BatchCommand } from "@/commands/batch-command";
import { type MediaTime, ZERO_MEDIA_TIME } from "@/wasm";

/** The longest timeline name kept (a pasted paragraph would make a tab wider than the window). */
export const SCENE_NAME_MAX = 80;

/** A timeline name as typed: trimmed, inner runs of spaces as one, at most SCENE_NAME_MAX characters. */
export function normalizeSceneName(name: string): string {
	return [...name.replace(/\s+/g, " ").trim()].slice(0, SCENE_NAME_MAX).join("").trim();
}

export class ScenesManager {
	private active: TScene | null = null;
	private list: TScene[] = [];
	private listeners = new Set<() => void>();
	/** CapCut: each timeline keeps its own playhead — back on a timeline, the playhead is where it was left. */
	private playheads = new Map<string, MediaTime>();
	/** …and its own zoom and scroll (written by the timeline as it leaves a timeline, read as it shows one again).
	 * View state only: no undo step, nothing saved, no notify. */
	private views = new Map<string, { zoom: number; scrollLeft: number }>();

	constructor(private editor: EditorCore) {}

	/** Where the playhead was left on that timeline, if it was ever left. */
	playheadOf(sceneId: string): MediaTime | undefined {
		return this.playheads.get(sceneId);
	}

	rememberView(sceneId: string, view: { zoom: number; scrollLeft: number }): void {
		this.views.set(sceneId, { zoom: view.zoom, scrollLeft: view.scrollLeft });
	}

	viewOf(sceneId: string): { zoom: number; scrollLeft: number } | undefined {
		return this.views.get(sceneId);
	}

	async createScene({
		name,
		isMain = false,
		copyOf,
		open,
	}: {
		name: string;
		isMain: boolean;
		/** A copy of this timeline's clips (Duplicate timeline). */
		copyOf?: string;
		/** Open the new timeline as part of the step (⇧⌘Z opens it again too). */
		open?: boolean;
	}): Promise<string> {
		if (!this.editor.project.getActive()) {
			throw new Error("No active project");
		}

		const command = new CreateSceneCommand({ name, isMain, copyOf, open });
		this.editor.command.execute({ command });
		return command.getSceneId();
	}

	async deleteScene({ sceneId }: { sceneId: string }): Promise<void> {
		const sceneToDelete = this.list.find((s) => s.id === sceneId);

		if (!sceneToDelete) {
			throw new Error("Scene not found");
		}

		const { canDelete, reason } = canDeleteScene({ scene: sceneToDelete });
		if (!canDelete) {
			throw new Error(reason);
		}

		if (!this.editor.project.getActive()) {
			throw new Error("No active project");
		}

		const command = new DeleteSceneCommand(sceneId);
		this.editor.command.execute({ command });
	}

	/** Several timelines deleted together (the Timelines window's Select → Delete): one undo step. */
	async deleteScenes({ sceneIds }: { sceneIds: string[] }): Promise<void> {
		if (!this.editor.project.getActive()) {
			throw new Error("No active project");
		}
		const commands: DeleteSceneCommand[] = [];
		for (const sceneId of sceneIds) {
			const scene = this.list.find((s) => s.id === sceneId);
			if (!scene) continue;
			const { canDelete, reason } = canDeleteScene({ scene });
			if (!canDelete) throw new Error(reason);
			commands.push(new DeleteSceneCommand(sceneId));
		}
		if (commands.length === 0) return;
		if (commands.length === 1) {
			this.editor.command.execute({ command: commands[0] });
			return;
		}
		this.editor.command.execute({ command: new BatchCommand(commands) });
	}

	async renameScene({
		sceneId,
		name,
	}: {
		sceneId: string;
		name: string;
	}): Promise<void> {
		if (!this.editor.project.getActive()) {
			throw new Error("No active project");
		}

		// An empty name would leave a blank tab: the timeline keeps the one it had.
		const newName = normalizeSceneName(name);
		const scene = this.list.find((s) => s.id === sceneId);
		if (!newName || !scene || scene.name === newName) return;
		const command = new RenameSceneCommand({
			sceneId,
			newName,
		});
		this.editor.command.execute({ command });
	}

	async switchToScene({ sceneId }: { sceneId: string }): Promise<void> {
		const targetScene = this.list.find((s) => s.id === sceneId);

		if (!targetScene) {
			throw new Error("Scene not found");
		}

		// A preview in progress (a slider held, a text being typed on the frame) belongs to the timeline being left:
		// shown or committed on the next one it would put that timeline's tracks there.
		this.editor.timeline.discardPreview();
		const leaving = this.active;
		if (leaving && leaving.id !== sceneId) this.playheads.set(leaving.id, this.editor.playback.getCurrentTime());

		const activeProject = this.editor.project.getActive();

		if (activeProject) {
			const updatedProject = {
				...activeProject,
				currentSceneId: sceneId,
				metadata: {
					...activeProject.metadata,
					updatedAt: new Date(),
				},
			};

			this.editor.project.setActiveProject({ project: updatedProject });
		}

		this.active = targetScene;
		// the timeline left behind keeps its clips: nothing of it stays selected on this one
		this.editor.selection.keepPresent({ tracks: targetScene.tracks });
		this.notify();
		if (leaving && leaving.id !== sceneId) this.editor.playback.seek({ time: this.playheads.get(sceneId) ?? ZERO_MEDIA_TIME });
	}

	/**
	 * Back to a timeline before something is done on it (⌘Z of a step made there, captions of its speech): opened
	 * visibly when another one is open. False when that timeline is gone.
	 */
	returnTo({ sceneId }: { sceneId: string }): boolean {
		if (!this.list.some((s) => s.id === sceneId)) return false;
		if (this.active?.id !== sceneId) void this.switchToScene({ sceneId });
		return true;
	}

	async toggleBookmark({ time }: { time: MediaTime }): Promise<void> {
		const command = new ToggleBookmarkCommand(time);
		this.editor.command.execute({ command });
	}

	isBookmarked({ time }: { time: MediaTime }): boolean {
		const activeScene = this.getActiveScene();
		const activeProject = this.editor.project.getActive();

		if (!activeScene || !this.active || !activeProject) return false;

		const frameTime = getFrameTime({
			time,
			fps: activeProject.settings.fps,
		});

		return isBookmarkAtTime({ bookmarks: activeScene.bookmarks, frameTime });
	}

	async removeBookmark({ time }: { time: MediaTime }): Promise<void> {
		const command = new RemoveBookmarkCommand(time);
		this.editor.command.execute({ command });
	}

	async updateBookmark({
		time,
		updates,
	}: {
		time: MediaTime;
		updates: Partial<Omit<Bookmark, "time">>;
	}): Promise<void> {
		const command = new UpdateBookmarkCommand({ time, updates });
		this.editor.command.execute({ command });
	}

	async moveBookmark({
		fromTime,
		toTime,
	}: {
		fromTime: MediaTime;
		toTime: MediaTime;
	}): Promise<void> {
		const command = new MoveBookmarkCommand({ fromTime, toTime });
		this.editor.command.execute({ command });
	}

	getBookmarkAtTime({ time }: { time: MediaTime }) {
		const activeScene = this.active;
		const activeProject = this.editor.project.getActive();

		if (!activeScene || !activeProject) return null;

		const frameTime = getFrameTime({
			time,
			fps: activeProject.settings.fps,
		});

		return getBookmarkAtTime({
			bookmarks: activeScene.bookmarks,
			frameTime,
		});
	}

	async loadProjectScenes({ projectId }: { projectId: string }): Promise<void> {
		try {
			const result = await storageService.loadProject({ id: projectId });
			if (result?.project.scenes) {
				const ensuredScenes = result.project.scenes ?? [];
				const currentScene = findCurrentScene({
					scenes: ensuredScenes,
					currentSceneId: result.project.currentSceneId,
				});

				this.list = ensuredScenes;
				this.active = currentScene;
				this.notify();
			}
		} catch (error) {
			console.error("Failed to load project scenes:", error);
			this.list = [];
			this.active = null;
			this.notify();
		}
	}

	initializeScenes({
		scenes,
		currentSceneId,
	}: {
		scenes: TScene[];
		currentSceneId?: string;
	}): void {
		const withMain = ensureMainScene({ scenes });
		const ensuredScenes = settleNestedScenes({ scenes: withMain, keepId: currentSceneId });
		const currentScene = currentSceneId
			? ensuredScenes.find((s) => s.id === currentSceneId)
			: null;

		const fallbackScene = getMainScene({ scenes: ensuredScenes });

		this.playheads.clear();
		this.views.clear();
		this.list = ensuredScenes;
		this.active = currentScene || fallbackScene;
		this.notify();

		const hasAddedMainScene = withMain.length > scenes.length;
		if (ensuredScenes !== scenes) {
			const activeProject = this.editor.project.getActive();

			if (activeProject) {
				const updatedProject = {
					...activeProject,
					scenes: ensuredScenes,
					metadata: {
						...activeProject.metadata,
						updatedAt: new Date(),
					},
				};

				this.editor.project.setActiveProject({ project: updatedProject });
				if (hasAddedMainScene) this.editor.save.markDirty({ force: true });
			}
		}
	}

	clearScenes(): void {
		this.playheads.clear();
		this.views.clear();
		this.list = [];
		this.active = null;
		this.notify();
	}

	getActiveScene(): TScene {
		if (!this.active) {
			throw new Error("No active scene.");
		}
		return this.active;
	}

	getActiveSceneOrNull(): TScene | null {
		return this.active;
	}

	getScenes(): TScene[] {
		return this.list;
	}

	setScenes({
		scenes,
		activeSceneId,
	}: {
		scenes: TScene[];
		activeSceneId?: string;
	}): void {
		this.list = scenes;
		const nextActiveSceneId = activeSceneId ?? this.active?.id ?? null;
		this.active = nextActiveSceneId
			? (scenes.find((scene) => scene.id === nextActiveSceneId) ?? null)
			: null;
		if (this.active) this.editor.selection.keepPresent({ tracks: this.active.tracks });
		this.notify();

		const activeProject = this.editor.project.getActive();
		if (activeProject) {
			const updatedProject = {
				...activeProject,
				scenes,
				metadata: {
					...activeProject.metadata,
					updatedAt: new Date(),
				},
			};
			this.editor.project.setActiveProject({ project: updatedProject });
		}
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

	updateSceneTracks({ tracks }: { tracks: SceneTracks }): void {
		if (!this.active) return;

		const updatedScene: TScene = {
			...this.active,
			tracks,
			updatedAt: new Date(),
		};

		this.list = this.list.map((s) =>
			s.id === this.active?.id ? updatedScene : s,
		);
		this.active = updatedScene;
		this.notify();

		const activeProject = this.editor.project.getActive();
		if (activeProject) {
			const updatedProject = {
				...activeProject,
				scenes: this.list,
				metadata: {
					...activeProject.metadata,
					updatedAt: new Date(),
				},
			};
			this.editor.project.setActiveProject({ project: updatedProject });
		}
	}
}
