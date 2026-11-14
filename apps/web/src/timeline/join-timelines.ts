// An older project saved with several timelines (CapCut's tabs) is converted ONCE, as a stored document:
//   - the timeline that opens first and that export renders today stays THE timeline: the saved `currentSceneId`'s
//     (core/managers/scenes-manager.ts initializeScenes opens it; renderer-manager.ts → playbackTracks exports the open
//     one) — climbed up to its top-level timeline when the project was saved inside a compound clip; the main one when
//     that id leads nowhere;
//   - every other timeline becomes a compound clip kept in Media (`inMedia`, NOT `nested` — round C, F9: every older
//     build, which knows no `inMedia`, keeps it as the ordinary timeline it was; its settleNestedScenes would drop a
//     nested scene nothing opens), placed nowhere; its scene,
//     its id, its tracks and everything in them stay exactly as they were (nothing in a track is touched at all);
//   - an INNER timeline (a compound clip / AI composition anywhere points at it: a graphic `ai.Composition` element
//     whose `params.sceneId` is its id — or the scene is already marked `nested`) is no free-standing timeline: it
//     keeps its one scene, is marked `nested` (what scenes.ts settleNestedScenes does on every open anyway) and gets
//     NO Media item — it is reached through its clip, never listed twice (the common case in his projects);
//   - a free-standing timeline with nothing in it (no element, no bookmark) is dropped — no 0:00 remnant (round B);
//   - a name the user gave stays; a default one («Timeline 02», «Main scene», «Timeline 02 copy», empty) becomes the
//     product's own default compound name «Compound clip N»; the old name and main flag are kept in `formerTimeline`;
//   - the document gets `timelineModel: 1`: a document that has it is never converted again.
// Pure: a document in, a document out (JSON values only, no editor, no storage). The editor's side — the version kept
// first, one save, the flight-recorder line on failure — is project/join-on-open.ts.

/** The document field that marks the one-timeline shape. */
export const TIMELINE_MODEL = 1;
/** montage/flatten.ts COMPOSITION_DEF (a test keeps them equal; this module imports nothing). */
const COMPOSITION_DEF = "ai.Composition";

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

export type TimelineCounts = {
	tracks: number;
	elements: number;
	keyframes: number;
	transitions: number;
	mediaRefs: number;
	/** the end of the last element, in the project's ticks */
	duration: number;
};

export type JoinReport = {
	/** free-standing timelines before (the tabs: no compound clip opens them) */
	timelines: number;
	/** the scene that stays the timeline */
	stays: string | null;
	/** the scenes that became compound clips in Media */
	compounds: Array<{ id: string; name: string; was: string }>;
	/** former timelines that were already some compound clip's inner timeline: marked nested, not put in Media */
	inner: string[];
	/** free-standing timelines with nothing in them (no element on any track, no bookmark): dropped, not kept as a
	 * 0:00 compound (the lead, 14.11: no remnants); the «Before joining timelines» version still holds them */
	dropped: Array<{ id: string; was: string }>;
	/** per scene, before and after */
	before: Record<string, TimelineCounts>;
	after: Record<string, TimelineCounts>;
};

export type JoinResult =
	| { kind: "already"; doc: unknown }
	| { kind: "marked"; doc: Json; report: JoinReport }
	| { kind: "joined"; doc: Json; report: JoinReport }
	| { kind: "skipped"; doc: unknown; reason: string };

const tracksOf = (scene: Json): Json[] => {
	const t = isRecord(scene.tracks) ? scene.tracks : null;
	if (!t) return [];
	return [...(Array.isArray(t.overlay) ? t.overlay : []), t.main, ...(Array.isArray(t.audio) ? t.audio : [])].filter(isRecord);
};
const elementsOf = (track: Json): Json[] => (Array.isArray(track.elements) ? track.elements.filter(isRecord) : []);

/** The scene ids the compound clips / AI compositions in `scenes` open, with the scenes that hold them. */
function compositionUses(scenes: Json[]): Map<string, string[]> {
	const uses = new Map<string, string[]>();
	for (const scene of scenes) {
		for (const track of tracksOf(scene)) {
			for (const element of elementsOf(track)) {
				const params = isRecord(element.params) ? element.params : null;
				if (element.type === "graphic" && element.definitionId === COMPOSITION_DEF && typeof params?.sceneId === "string") {
					const list = uses.get(params.sceneId) ?? [];
					list.push(String(scene.id));
					uses.set(params.sceneId, list);
				}
			}
		}
	}
	return uses;
}

/** Keyframes anywhere in an element: every entry of a `keys` / `keyframes` list (animations, masks, effects). */
function countKeyframes(value: unknown, depth = 0): number {
	if (depth > 12) return 0;
	if (Array.isArray(value)) return value.reduce((n: number, v) => n + countKeyframes(v, depth + 1), 0);
	if (!isRecord(value)) return 0;
	let n = 0;
	for (const [key, v] of Object.entries(value)) {
		if ((key === "keys" || key === "keyframes") && Array.isArray(v)) n += v.length;
		else n += countKeyframes(v, depth + 1);
	}
	return n;
}

/** What a timeline holds: the numbers that must be equal before and after the conversion. */
export function countTimeline(scene: unknown): TimelineCounts {
	const counts: TimelineCounts = { tracks: 0, elements: 0, keyframes: 0, transitions: 0, mediaRefs: 0, duration: 0 };
	if (!isRecord(scene)) return counts;
	for (const track of tracksOf(scene)) {
		counts.tracks++;
		if (Array.isArray(track.transitions)) counts.transitions += track.transitions.length;
		for (const element of elementsOf(track)) {
			counts.elements++;
			counts.keyframes += countKeyframes(element);
			if (typeof element.mediaId === "string" && element.mediaId) counts.mediaRefs++;
			const end = Number(element.startTime ?? 0) + Number(element.duration ?? 0);
			if (Number.isFinite(end)) counts.duration = Math.max(counts.duration, end);
		}
	}
	return counts;
}

const DEFAULT_NAME = /^(?:(?:timeline|таймлайн)(?: \d+)?(?: copy(?: \d+)?)?|main scene|scene(?: \d+)?)$/i;
/** A name the product gave (a tab's «Timeline 02», the old «Main scene», a «… copy»), not one the user typed. */
export function isDefaultTimelineName(name: unknown): boolean {
	const text = typeof name === "string" ? name.trim() : "";
	return text === "" || DEFAULT_NAME.test(text);
}

function nextCompoundNumber(scenes: Json[]): () => number {
	let n = 0;
	for (const scene of scenes) {
		const m = /^Compound clip (\d+)$/.exec(String(scene.name ?? ""));
		if (m) n = Math.max(n, Number(m[1]));
	}
	return () => ++n;
}

/** The saved current timeline, climbed out of compound clips to the top-level timeline that holds it. */
function stayingScene(scenes: Json[], topLevel: Json[], currentSceneId: unknown, uses: Map<string, string[]>): Json | null {
	const top = new Set(topLevel.map((scene) => scene.id));
	let id = typeof currentSceneId === "string" ? currentSceneId : null;
	for (let hops = 0; id && hops <= scenes.length; hops++) {
		if (top.has(id)) return topLevel.find((scene) => scene.id === id) ?? null;
		id = uses.get(id)?.[0] ?? null;
	}
	return topLevel.find((scene) => scene.isMain === true) ?? topLevel[0] ?? null;
}

/**
 * The conversion. `already`: the document has the mark (nothing to do, the same object). `marked`: it holds one
 * timeline — only the mark is added. `joined`: several timelines became one + compound clips in Media. `skipped`: not
 * a document this can read (left as it is).
 */
export function joinTimelines(input: unknown): JoinResult {
	if (!isRecord(input)) return { kind: "skipped", doc: input, reason: "not a project" };
	if (typeof input.timelineModel === "number" && input.timelineModel >= TIMELINE_MODEL) return { kind: "already", doc: input };
	if (input.scenes !== undefined && !Array.isArray(input.scenes)) return { kind: "skipped", doc: input, reason: "scenes is not a list" };
	const raw = (input.scenes ?? []) as unknown[];
	if (raw.some((scene) => !isRecord(scene) || typeof scene.id !== "string" || !isRecord(scene.tracks)))
		return { kind: "skipped", doc: input, reason: "a scene without id or tracks" };
	const scenes = raw as Json[];
	if (new Set(scenes.map((scene) => scene.id)).size !== scenes.length) return { kind: "skipped", doc: input, reason: "two scenes share an id" };

	const uses = compositionUses(scenes);
	// a timeline: a scene not marked as a compound's inner one (a tab, or one a compound clip uses but older saves never marked)
	const timelines = scenes.filter((scene) => scene.nested !== true && scene.inMedia !== true);
	// the tabs: those no compound clip opens (the old tab strip's topLevelTimelines)
	const topLevel = timelines.filter((scene) => !uses.has(String(scene.id)));
	const before = Object.fromEntries(scenes.map((scene) => [String(scene.id), countTimeline(scene)]));
	const report: JoinReport = { timelines: topLevel.length, stays: null, compounds: [], inner: [], dropped: [], before, after: before };

	const stay = stayingScene(scenes, topLevel, input.currentSceneId, uses);
	// one free-standing timeline (inner ones not yet marked are settled by scenes.ts on open, as before): only the mark
	if (topLevel.length <= 1 || !stay) {
		report.stays = (stay ?? null)?.id as string | null;
		return { kind: "marked", doc: { ...input, timelineModel: TIMELINE_MODEL }, report };
	}
	report.stays = String(stay.id);

	const number = nextCompoundNumber(scenes);
	const empty = (scene: Json) => countTimeline(scene).elements === 0 && !(Array.isArray(scene.bookmarks) && scene.bookmarks.length > 0);
	const dropped = new Set(topLevel.filter((scene) => scene !== stay && empty(scene)).map((scene) => String(scene.id)));
	for (const scene of scenes) if (dropped.has(String(scene.id))) report.dropped.push({ id: String(scene.id), was: typeof scene.name === "string" ? scene.name : "" });
	const out = scenes.filter((scene) => !dropped.has(String(scene.id))).map((scene): Json => {
		if (scene === stay) return scene.isMain === true ? scene : { ...scene, isMain: true, formerTimeline: { name: scene.name ?? "", isMain: scene.isMain === true } };
		if (scene.nested === true || scene.inMedia === true) return scene; // already inner / already in Media: untouched
		const was = typeof scene.name === "string" ? scene.name : "";
		const name = isDefaultTimelineName(was) ? `Compound clip ${number()}` : was;
		const formerTimeline = { name: was, isMain: scene.isMain === true };
		if (uses.has(String(scene.id))) {
			report.inner.push(String(scene.id));
			return { ...scene, name, isMain: false, nested: true, formerTimeline };
		}
		report.compounds.push({ id: String(scene.id), name, was });
		return { ...scene, name, isMain: false, inMedia: true, formerTimeline };
	});
	report.after = Object.fromEntries(out.map((scene) => [String(scene.id), countTimeline(scene)]));
	return { kind: "joined", doc: { ...input, scenes: out, timelineModel: TIMELINE_MODEL }, report };
}

/** Every scene's counts equal before and after, no scene added, and the only scenes gone are the dropped empty
 * timelines (nothing in them: 0 elements): what makes a conversion safe to save. */
export function countsEqual(report: JoinReport): boolean {
	const dropped = new Set((report.dropped ?? []).map((d) => d.id));
	const a = Object.keys(report.before).filter((id) => !dropped.has(id));
	const b = Object.keys(report.after);
	if (a.length !== b.length || a.some((id) => !(id in report.after))) return false;
	if ([...dropped].some((id) => id in report.after || !report.before[id] || report.before[id].elements !== 0)) return false;
	return a.every((id) => JSON.stringify(report.before[id]) === JSON.stringify(report.after[id]));
}

/** The timelines a document still shows as tabs (for the proof: 1 after a conversion). */
export function topLevelCount(doc: unknown): number {
	if (!isRecord(doc) || !Array.isArray(doc.scenes)) return 0;
	const scenes = doc.scenes.filter(isRecord);
	const uses = compositionUses(scenes);
	return scenes.filter((scene) => scene.nested !== true && scene.inMedia !== true && !uses.has(String(scene.id))).length;
}
