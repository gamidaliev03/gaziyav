import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { TScene } from "@/timeline";
import { buildDefaultScene, copySceneAs } from "@/timeline/scenes";

export class CreateSceneCommand extends Command {
	private savedScenes: TScene[] | null = null;
	private createdScene: TScene | null = null;
	private previousActiveId: string | null = null;

	constructor({
		name,
		isMain = false,
		copyOf,
		open = false,
	}: {
		name: string;
		isMain?: boolean;
		/** Duplicate timeline: the new one is a copy of this one, right after it. */
		copyOf?: string;
		/** «+» / Duplicate: the new timeline opens with the step, so ⇧⌘Z opens it again too (a redo left the old one open). */
		open?: boolean;
	}) {
		super();
		this.name = name;
		this.isMain = isMain;
		this.copyOf = copyOf;
		this.open = open;
	}

	private name: string;
	private isMain: boolean;
	private copyOf?: string;
	private open: boolean;

	/** The step opens another timeline: the magnet's ripple / pack of «the step's tracks» must not run across timelines. */
	override get ripplesItself(): boolean {
		return true;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedScenes = [...editor.scenes.getScenes()];
		this.previousActiveId = editor.scenes.getActiveSceneOrNull()?.id ?? null;

		const source = this.copyOf ? this.savedScenes.find((scene) => scene.id === this.copyOf) : undefined;
		// A redo brings back the same timeline (same id): anything that remembered it still finds it.
		this.createdScene ??= source
			? copySceneAs({ source, name: this.name })
			: buildDefaultScene({
					name: this.name,
					isMain: this.isMain,
				});

		const updatedScenes = [...this.savedScenes];
		updatedScenes.splice(source ? updatedScenes.indexOf(source) + 1 : updatedScenes.length, 0, this.createdScene);
		editor.scenes.setScenes({ scenes: updatedScenes });
		if (this.open) void editor.scenes.switchToScene({ sceneId: this.createdScene.id });
		return undefined;
	}

	undo(): void {
		if (this.savedScenes) {
			const editor = EditorCore.getInstance();
			const activeId = editor.scenes.getActiveSceneOrNull()?.id;
			// Undoing the timeline that is open (Add timeline switches to it): the one open before it is active
			// again in the same step, or the editor would be left with no scene at all.
			const leavesCreated = !activeId || activeId === this.createdScene?.id;
			const backTo = leavesCreated ? this.previousActiveId : null;
			editor.scenes.setScenes({ scenes: this.savedScenes, activeSceneId: backTo ?? undefined });
			if (backTo) void editor.scenes.switchToScene({ sceneId: backTo });
		}
	}

	getSceneId(): string {
		return this.createdScene?.id ?? "";
	}
}
