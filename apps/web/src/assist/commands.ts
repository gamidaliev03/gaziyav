// Undo steps of the Assist actions. Each computes its result once and keeps before/after, so ⌘Z and ⇧⌘Z
// restore exactly the same timeline (same element ids) however many times they are pressed.
import { Command, type CommandResult, createElementSelectionResult } from "@/commands/base-command";
import { SplitElementsCommand } from "@/commands/timeline/element/split-elements";
import { EditorCore } from "@/core";
import { buildDefaultEffectInstance } from "@/effects";
import { COLOR_EFFECT_TYPE } from "@/effects/definitions/studio/color";
import type { ParamValues } from "@/params";
import type { Bookmark, SceneTracks, TimelineElement, TScene } from "@/timeline";
import { isVisualElement } from "@/timeline";
import { updateSceneInArray } from "@/timeline/scenes";
import type { MediaTime } from "@/wasm";
import type { ClipRef } from "./target";

const tracksNow = () => EditorCore.getInstance().scenes.getActiveScene().tracks;
const setTracks = (t: SceneTracks) => EditorCore.getInstance().timeline.updateTracks(t);

/** Splits `targets` at every time (ticks) in one step; the pieces of the first target end up selected. */
export class SplitAtTimesCommand extends Command {
	private before: SceneTracks | null = null;
	private after: SceneTracks | null = null;
	private pieces: ClipRef[] = [];

	constructor(
		private readonly targets: ClipRef[],
		private readonly times: MediaTime[],
	) {
		super();
	}

	execute(): CommandResult | undefined {
		this.before = tracksNow();
		// Last cut first: the left part keeps the original id, so every earlier cut still finds it.
		const right: ClipRef[] = [];
		for (const time of [...this.times].sort((a, b) => (b as number) - (a as number))) {
			const split = new SplitElementsCommand({ elements: this.targets, splitTime: time });
			split.execute();
			right.push(...split.getRightSideElements());
		}
		this.after = tracksNow();
		const main = this.targets[0];
		this.pieces = main ? [main, ...right.filter((r) => r.trackId === main.trackId)] : [];
		return createElementSelectionResult(this.pieces);
	}

	undo(): void {
		if (this.before) setTracks(this.before);
	}

	redo(): CommandResult | undefined {
		if (!this.after) return this.execute();
		setTracks(this.after);
		return createElementSelectionResult(this.pieces);
	}
}

/** Merges colour params into each clip's Color effect (added when missing) — the one the Color tab edits. */
export class SetColorParamsCommand extends Command {
	private before: SceneTracks | null = null;
	private after: SceneTracks | null = null;

	constructor(private readonly changes: Array<ClipRef & { params: ParamValues }>) {
		super();
	}

	execute(): CommandResult | undefined {
		this.before = tracksNow();
		const byId = new Map(this.changes.map((c) => [c.elementId, c]));
		const patch = (el: TimelineElement): TimelineElement => {
			const change = byId.get(el.id);
			if (!change || !isVisualElement(el)) return el;
			const effects = el.effects ?? [];
			const existing = effects.find((e) => e.type === COLOR_EFFECT_TYPE);
			const next = existing
				? effects.map((e) => (e.id === existing.id ? { ...e, enabled: true, params: { ...e.params, ...change.params } } : e))
				: [...effects, (() => {
						const fx = buildDefaultEffectInstance({ effectType: COLOR_EFFECT_TYPE });
						return { ...fx, params: { ...fx.params, ...change.params } };
					})()];
			return { ...el, effects: next } as TimelineElement;
		};
		const patchTrack = <T extends { elements: TimelineElement[] }>(t: T): T => ({ ...t, elements: t.elements.map(patch) }) as T;
		const b = this.before;
		this.after = { overlay: b.overlay.map(patchTrack), main: patchTrack(b.main), audio: b.audio };
		setTracks(this.after);
		return undefined;
	}

	undo(): void {
		if (this.before) setTracks(this.before);
	}

	redo(): CommandResult | undefined {
		if (!this.after) return this.execute();
		setTracks(this.after);
		return undefined;
	}
}

/** Replaces the active scene's markers (adding beat markers, removing them) in one step. */
export class SetBookmarksCommand extends Command {
	private before: TScene[] | null = null;
	private after: TScene[] | null = null;

	constructor(private readonly build: (current: Bookmark[]) => Bookmark[]) {
		super();
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const scene = editor.scenes.getActiveScene();
		const scenes = editor.scenes.getScenes();
		this.before = [...scenes];
		const bookmarks = this.build(scene.bookmarks).sort((a, b) => (a.time as number) - (b.time as number));
		this.after = updateSceneInArray({ scenes, sceneId: scene.id, updates: { bookmarks } });
		editor.scenes.setScenes({ scenes: this.after });
		return undefined;
	}

	undo(): void {
		if (this.before) EditorCore.getInstance().scenes.setScenes({ scenes: this.before });
	}

	redo(): CommandResult | undefined {
		if (!this.after) return this.execute();
		EditorCore.getInstance().scenes.setScenes({ scenes: this.after });
		return undefined;
	}
}
