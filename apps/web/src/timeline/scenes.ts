import type { TimelineElement, TimelineTrack, TScene } from "@/timeline";
import { generateUUID } from "@/utils/id";
import { calculateTotalDuration } from "@/timeline";
import { MAIN_TRACK_NAME } from "@/timeline/placement/main-track";
import { type MediaTime, ZERO_MEDIA_TIME } from "@/wasm";
import { isComposition } from "@/montage/flatten";

export function getMainScene({ scenes }: { scenes: TScene[] }): TScene | null {
	return scenes.find((scene) => scene.isMain) || null;
}

export function ensureMainScene({ scenes }: { scenes: TScene[] }): TScene[] {
	const hasMain = scenes.some((scene) => scene.isMain);
	if (!hasMain) {
		const mainScene = buildDefaultScene({ name: "Main scene", isMain: true });
		return [mainScene, ...scenes];
	}
	return scenes;
}

export function buildDefaultScene({
	name,
	isMain,
	nested,
}: {
	name: string;
	isMain: boolean;
	nested?: boolean;
}): TScene {
	return {
		id: generateUUID(),
		name,
		isMain,
		...(nested && { nested: true }),
		tracks: {
			overlay: [],
			main: {
				id: generateUUID(),
				name: MAIN_TRACK_NAME,
				type: "video",
				elements: [],
				muted: false,
				hidden: false,
			},
			audio: [],
		},
		bookmarks: [],
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

export function canDeleteScene({ scene }: { scene: TScene }): {
	canDelete: boolean;
	reason?: string;
} {
	if (scene.isMain) {
		return { canDelete: false, reason: "Cannot delete main scene" };
	}
	return { canDelete: true };
}

export function getFallbackSceneAfterDelete({
	scenes,
	deletedSceneId,
	currentSceneId,
}: {
	scenes: TScene[];
	deletedSceneId: string;
	currentSceneId: string | null;
}): TScene | null {
	if (currentSceneId !== deletedSceneId) {
		return scenes.find((s) => s.id === currentSceneId) || null;
	}
	return getMainScene({ scenes });
}

export function findCurrentScene({
	scenes,
	currentSceneId,
}: {
	scenes: TScene[];
	currentSceneId: string;
}): TScene | null {
	return (
		scenes.find((s) => s.id === currentSceneId) ||
		getMainScene({ scenes }) ||
		scenes[0] ||
		null
	);
}

export function getProjectDurationFromScenes({
	scenes,
}: {
	scenes: TScene[];
}): MediaTime {
	const mainScene = getMainScene({ scenes }) ?? scenes[0] ?? null;
	if (!mainScene?.tracks) {
		return ZERO_MEDIA_TIME;
	}

	return calculateTotalDuration({ tracks: mainScene.tracks });
}

export function updateSceneInArray({
	scenes,
	sceneId,
	updates,
}: {
	scenes: TScene[];
	sceneId: string;
	updates: Partial<TScene>;
}): TScene[] {
	return scenes.map((scene) =>
		scene.id === sceneId ? { ...scene, ...updates } : scene,
	);
}

/** The scenes the compound clips / AI compositions on `scenes` open. */
export function compositionSceneIds(scenes: TScene[]): Set<string> {
	const ids = new Set<string>();
	for (const scene of scenes) {
		for (const track of [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]) {
			for (const element of track.elements as TimelineElement[]) {
				if (isComposition(element) && typeof element.params.sceneId === "string") ids.add(element.params.sceneId);
			}
		}
	}
	return ids;
}

/**
 * A project as it opens: the inner timelines of its compound clips are marked nested (projects saved before the
 * mark), and a nested one that nothing opens any more (its clip deleted, then the project closed: no ⌘Z can bring
 * the clip back) is dropped. The same array when there is nothing to change.
 */
export function settleNestedScenes({ scenes, keepId }: { scenes: TScene[]; keepId?: string }): TScene[] {
	const opened = compositionSceneIds(scenes);
	// a Media compound (inMedia) is never marked nested, also once a clip opens it: older builds keep it (tla3 C, F9)
	let settled = scenes.map((scene) => (opened.has(scene.id) && !scene.isMain && !scene.nested && !scene.inMedia ? { ...scene, nested: true } : scene));
	for (;;) {
		const used = compositionSceneIds(settled);
		const kept = settled.filter((scene) => !scene.nested || scene.inMedia || scene.id === keepId || used.has(scene.id));
		if (kept.length === settled.length) break;
		settled = kept;
	}
	const same = settled.length === scenes.length && settled.every((scene, index) => scene === scenes[index]);
	return same ? scenes : settled;
}

type WithTransitions = { transitions?: Array<{ id?: string; fromElementId: string; toElementId: string }> };

/**
 * A timeline's copy (Duplicate timeline): the same clips with new ids, the transitions on their cuts kept. A compound
 * clip in it opens the same inner timeline until one of the two is opened (compositions' copy-on-open).
 */
export function copySceneAs({ source, name }: { source: TScene; name: string }): TScene {
	const now = new Date();
	const fresh = <T extends TimelineTrack>(track: T): T => {
		const ids = new Map<string, string>();
		const elements = (track.elements as TimelineElement[]).map((element) => {
			const id = generateUUID();
			ids.set(element.id, id);
			return { ...element, id };
		});
		const transitions = (track as WithTransitions).transitions?.map((transition) => ({
			...transition,
			...(transition.id && { id: generateUUID() }),
			fromElementId: ids.get(transition.fromElementId) ?? transition.fromElementId,
			toElementId: ids.get(transition.toElementId) ?? transition.toElementId,
		}));
		return { ...track, id: generateUUID(), elements, ...(transitions && { transitions }) } as T;
	};
	const { inMedia: _inMedia, formerTimeline: _former, ...rest } = source;
	return {
		...rest,
		id: generateUUID(),
		name,
		isMain: false,
		tracks: { overlay: source.tracks.overlay.map(fresh), main: fresh(source.tracks.main), audio: source.tracks.audio.map(fresh) },
		bookmarks: source.bookmarks.map((bookmark) => ({ ...bookmark })),
		createdAt: now,
		updatedAt: now,
	};
}
