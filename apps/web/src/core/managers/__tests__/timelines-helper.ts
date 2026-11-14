// TEST HELPER ONLY (tla3 B, F8): the engine's unit tests build older multi-timeline states with these. One project, one
// timeline (the owner, 12.11 and 14.11): nothing shipped makes a second free-standing timeline — this file was
// src/timeline/timelines.ts and left the product so nothing can. An older project's extra timelines become compound
// clips in Media when it opens (src/timeline/join-timelines.ts).
import { EditorCore } from "@/core";
import { findCompositionOwner } from "@/montage/compositions";
import type { TScene } from "@/timeline/types";

/** The main timeline's name until it is renamed (projects keep the old default «Main scene»). */
const MAIN_DEFAULT_NAME = "Main scene";

/** How a timeline is called on its tab: the project's own first timeline is «Timeline 01», as in CapCut. */
export function timelineTabName(scene: { name: string; isMain: boolean }): string {
	if (scene.isMain && (scene.name === MAIN_DEFAULT_NAME || !scene.name.trim())) return "Timeline 01";
	return scene.name.trim() || "Timeline";
}

/** The timelines a user switches between (no inner timelines of compound clips, also of one deleted since). */
export function topLevelTimelines(scenes: TScene[]): TScene[] {
	return scenes.filter((scene) => !scene.nested && !scene.inMedia && !findCompositionOwner(scenes, scene.id));
}

/** «Timeline NN» after the highest one there is: deleting 03 of 01–04 and adding one gave a second «Timeline 04». */
export function nextTimelineName(scenes: TScene[]): string {
	let n = 0;
	for (const scene of topLevelTimelines(scenes)) {
		const m = /^Timeline (\d+)$/.exec(timelineTabName(scene));
		if (m) n = Math.max(n, Number(m[1]));
	}
	return `Timeline ${String(n + 1).padStart(2, "0")}`;
}

/** A name no other timeline has: «Timeline 02 copy», «Timeline 02 copy 2», … */
export function freeTimelineName(scenes: TScene[], base: string): string {
	const taken = new Set(topLevelTimelines(scenes).map(timelineTabName));
	if (!taken.has(base)) return base;
	let n = 2;
	while (taken.has(`${base} ${n}`)) n++;
	return `${base} ${n}`;
}

/** A new timeline, opened right away. One project, one timeline (the owner, 12.11): no button makes one any more —
 * what remains of several timelines is an older project's (their tabs stay) and the unit tests that build one. */
export async function addTimeline(): Promise<void> {
	const editor = EditorCore.getInstance();
	await editor.scenes.createScene({ name: nextTimelineName(editor.scenes.getScenes()), isMain: false, open: true });
}

/** A copy of a timeline's clips right after it, opened right away (one ⌘Z) — no button makes one any more (above). */
export async function duplicateTimeline(sceneId: string): Promise<void> {
	const editor = EditorCore.getInstance();
	const scenes = editor.scenes.getScenes();
	const source = scenes.find((scene) => scene.id === sceneId);
	if (!source) return;
	const name = freeTimelineName(scenes, `${timelineTabName(source)} copy`);
	await editor.scenes.createScene({ name, isMain: false, copyOf: sceneId, open: true });
}
