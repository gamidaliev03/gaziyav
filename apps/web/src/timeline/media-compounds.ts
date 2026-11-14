// Compound clips kept in Media (an older project's extra timelines: timeline/join-timelines.ts). They are placed nowhere
// until the user puts one on the timeline: a drag or a double-click places a compound clip that opens that same inner
// timeline (one ⌘Z); «Open» opens it like a compound clip (Back / ⌘↑ / the breadcrumb lead to the main timeline).
import { autoPlacement } from "@/commands/timeline/element/insert-element";
import { InsertElementCommand } from "@/commands";
import type { EditorCore } from "@/core";
import { COMPOSITION_DEF, isComposition } from "@/montage/flatten";
import { ScenesSnapshotCommand } from "@/montage/compositions";
import { calculateTotalDuration } from "@/timeline";
import type { DropHint } from "@/timeline/drag";
import type { CreateGraphicElement, TimelineElement, TScene } from "@/timeline/types";
import { type MediaTime, mediaTime, TICKS_PER_SECOND } from "@/wasm";

export function mediaCompounds(scenes: TScene[]): TScene[] {
	return scenes.filter((scene) => scene.inMedia === true);
}

export function compoundLength(scene: TScene): MediaTime {
	return calculateTotalDuration({ tracks: scene.tracks });
}

/** The scenes `sceneId` plays inside it (its compound clips, theirs, …), itself included. */
function inside(scenes: TScene[], sceneId: string): Set<string> {
	const seen = new Set<string>();
	const walk = (id: string) => {
		if (seen.has(id)) return;
		seen.add(id);
		const scene = scenes.find((s) => s.id === id);
		if (!scene) return;
		for (const track of [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio])
			for (const element of track.elements as TimelineElement[]) if (isComposition(element) && typeof element.params.sceneId === "string") walk(element.params.sceneId);
	};
	walk(sceneId);
	return seen;
}

/** Whether the compound can go on the open timeline: never into itself or into a timeline it plays. */
export function canPlaceMediaCompound(editor: EditorCore, sceneId: string): boolean {
	const active = editor.scenes.getActiveSceneOrNull();
	const scenes = editor.scenes.getScenes();
	return !!active && scenes.some((s) => s.id === sceneId && s.inMedia) && !inside(scenes, sceneId).has(active.id);
}

/** Puts the Media compound on the open timeline at `at` seconds (the playhead when not given): one ⌘Z. */
export function placeMediaCompound(editor: EditorCore, sceneId: string, at?: number, hint?: DropHint): boolean {
	if (!canPlaceMediaCompound(editor, sceneId)) return false;
	const scene = editor.scenes.getScenes().find((s) => s.id === sceneId) as TScene;
	const length = compoundLength(scene);
	if (length <= 0) return false;
	const start = Math.round((at ?? editor.playback.getCurrentTime() / TICKS_PER_SECOND) * TICKS_PER_SECOND);
	const element: CreateGraphicElement = {
		type: "graphic",
		name: scene.name,
		definitionId: COMPOSITION_DEF,
		startTime: mediaTime({ ticks: Math.max(0, start) }),
		duration: length,
		trimStart: mediaTime({ ticks: 0 }),
		trimEnd: mediaTime({ ticks: 0 }),
		params: { sceneId, alpha: true, style: "clean", compound: true, compoundLength: length },
	};
	editor.command.execute({ command: new InsertElementCommand({ element, placement: autoPlacement(hint) }) });
	return true;
}

/** Opens the Media compound's own timeline (navigation, no undo step). */
export async function openMediaCompound(editor: EditorCore, sceneId: string): Promise<void> {
	if (!editor.scenes.getScenes().some((s) => s.id === sceneId)) return;
	editor.playback.pause();
	editor.selection.clearSelection();
	await editor.scenes.switchToScene({ sceneId });
	editor.playback.seek({ time: mediaTime({ ticks: 0 }) });
}

/** Clips anywhere in the project that open `sceneId`. */
function usersOf(scenes: TScene[], sceneId: string): number {
	let n = 0;
	for (const scene of scenes)
		for (const track of [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio])
			for (const element of track.elements as TimelineElement[]) if (isComposition(element) && element.params.sceneId === sceneId) n++;
	return n;
}

/**
 * Takes the compound out of Media (Delete, the tile's menu): one ⌘Z. While clips use it only the Media listing goes —
 * its timeline stays with them; with no clip it goes whole (⌘Z brings it back as it was). Inside it, the main
 * timeline opens first.
 */
export function removeMediaCompound(editor: EditorCore, sceneId: string): "unlisted" | "removed" | null {
	const before = editor.scenes.getScenes();
	const scene = before.find((s) => s.id === sceneId && s.inMedia);
	if (!scene) return null;
	const used = usersOf(before, sceneId) > 0;
	const after = used
		? before.map((s) => {
				if (s.id !== sceneId) return s;
				// still played by clips: an inner timeline from now on (nested), no longer listed in Media
				const { inMedia: _inMedia, ...rest } = s;
				return { ...rest, nested: true } as TScene;
			})
		: before.filter((s) => s.id !== sceneId);
	const activeBefore = editor.scenes.getActiveScene().id;
	const main = before.find((s) => s.isMain)?.id ?? activeBefore;
	const activeAfter = !used && inside(before, sceneId).has(activeBefore) ? main : activeBefore;
	editor.command.execute({ command: new ScenesSnapshotCommand(before, after, activeBefore, activeAfter) });
	return used ? "unlisted" : "removed";
}
