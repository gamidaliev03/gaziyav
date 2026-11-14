// One trim in progress on the open timeline, for the mouse, the keys and typed numbers alike: it shows the result live
// (the editor's preview layer, nothing committed), then commits it as ONE undo step or puts everything back.
//
// What a pointer move costs is what the trim itself changes, never the length of the film: the trimmed clips, the clips
// a ripple moves, and the detached sounds in step with them (looked up once when the trim starts). What Linkage adds on
// top — titles, stickers and captions over the clips — is the editor's own rule (timeline/linkage.ts), a pass over
// every item of the timeline: it is shown with every move while the timeline is small (`linkageLoad`), and on a long
// film when the hand rests (`settle`) and, as always, in the committed step.
import { TracksEditCommand } from "@/actions/tracks-edit-command";
import type { EditorCore } from "@/core";
import { applyLinkage } from "@/timeline/linkage";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline/types";
import { planTrim } from "./core";
import type { TrimPlan, TrimResult, TrimTarget } from "./types";

const listTracks = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, tracks.main, ...tracks.audio];
type Update = { trackId: string; elementId: string; updates: Partial<TimelineElement> };

/** The fields a trim can change on a clip (and on the items Linkage moves with it): what the preview layer is given. */
const shownFields = (element: TimelineElement): Partial<TimelineElement> => ({
	startTime: element.startTime,
	duration: element.duration,
	trimStart: element.trimStart,
	trimEnd: element.trimEnd,
	animations: element.animations,
	beats: element.beats,
});
/** A detached sound takes its picture's place and part of the file, nothing else (linkage.ts: the pair's bounds). */
const pairFields = (picture: TimelineElement): Partial<TimelineElement> => ({
	startTime: picture.startTime,
	duration: picture.duration,
	trimStart: picture.trimStart,
	trimEnd: picture.trimEnd,
});
const rateOf = (element: TimelineElement): number => ("retime" in element && element.retime?.rate ? element.retime.rate : 1);
const pairKey = (element: TimelineElement) => `${"mediaId" in element ? element.mediaId : ""}|${element.startTime}|${element.duration}|${element.trimStart}|${rateOf(element)}`;

/** Under this many (items over and under the main track) × (main clips), Linkage is shown with every move. */
export const LIVE_LINKAGE_LOAD = 60_000;

export class TrimSession {
	/** The committed tracks the plan was made on. */
	private before: SceneTracks;
	private plan: TrimPlan;
	private asked = 0;
	private exact = false;
	private result: TrimResult | null = null;
	/** What the preview layer holds: the clip as committed, and whether the trim itself (or its pair sound) put it there. */
	private readonly shown = new Map<string, { trackId: string; was: TimelineElement; own: boolean }>();
	/** The detached sounds in step with the main-track pictures this trim can change, by picture. */
	private pairs: Map<string, Array<{ trackId: string; sound: TimelineElement }>> | null = null;
	private done = false;

	private constructor(
		private readonly editor: EditorCore,
		readonly target: TrimTarget,
		before: SceneTracks,
		plan: TrimPlan,
	) {
		this.before = before;
		this.plan = plan;
	}

	/** Null when the trim cannot be made here (see planTrim). */
	static start(editor: EditorCore, target: TrimTarget): TrimSession | null {
		const scene = editor.scenes.getActiveSceneOrNull();
		const fps = editor.project.getActiveOrNull()?.settings.fps;
		if (!scene || !fps) return null;
		const plan = planTrim({ tracks: scene.tracks, target, fps, linkSound: linksSound(editor) });
		return plan ? new TrimSession(editor, target, scene.tracks, plan) : null;
	}

	get range(): Pick<TrimPlan, "min" | "max" | "minLimit" | "maxLimit" | "frame" | "anchors" | "ids"> {
		return this.plan;
	}

	/** The tracks the trim started from. */
	get tracks(): SceneTracks {
		return this.before;
	}

	/** The last result computed (null before the first). */
	get last(): TrimResult | null {
		return this.result;
	}

	/** How much work Linkage's pass is on this timeline: its items × the main track's clips. */
	get linkageLoad(): number {
		const items = [...this.before.overlay, ...this.before.audio].reduce((n, track) => n + track.elements.length, 0);
		return items * this.before.main.elements.length;
	}

	/**
	 * Shows the trim at `delta` ticks (see TrimResult.delta for the sign) and returns what was applied. Nothing is
	 * committed. `linked`: also what Linkage adds (the default; a pointer on a long film passes false and calls
	 * `settle` when it rests). Null when the timeline changed under the trim and it can no longer be made.
	 */
	update(delta: number, { exact = false, linked = true }: { exact?: boolean; linked?: boolean } = {}): TrimResult | null {
		const result = this.compute(delta, { exact });
		if (!result) return null;
		if (linked) this.showLinked(result);
		else this.showOwn(result);
		return result;
	}

	/** The result at `delta` without showing it (a key or a typed number commits at once). */
	compute(delta: number, { exact = false }: { exact?: boolean } = {}): TrimResult | null {
		if (this.done || !this.fresh()) return null;
		this.asked = delta;
		this.exact = exact;
		this.result = this.plan.apply(delta, { exact });
		return this.result;
	}

	/** The hand rests: the last result with everything Linkage adds. */
	settle(): void {
		if (this.done || !this.result || !this.fresh()) return;
		this.showLinked(this.result);
	}

	/** One undo step with the last result. False when nothing changed (no step is made). */
	commit(): boolean {
		if (this.done) return false;
		this.done = true;
		this.editor.timeline.discardPreview();
		// Applied to what is committed now: an edit that landed during the drag is not put back by this one.
		const base = this.before;
		if (!this.fresh()) return false;
		const result = this.before === base ? this.result : this.plan.apply(this.asked, { exact: this.exact });
		if (!result || result.delta === 0) return false;
		// Final as it is (the clips after a ripple are already moved): the magnet adds nothing. Linkage runs on it like on
		// every edit — the titles and detached sounds the preview showed following are moved by the same rule.
		this.editor.command.execute({ command: new TracksEditCommand({ before: this.before, after: result.tracks, noEngineRipple: true }) });
		return true;
	}

	/** Esc: everything as it was. */
	cancel(): void {
		if (this.done) return;
		this.done = true;
		this.editor.timeline.discardPreview();
	}

	/** True while the plan matches the committed tracks; replans when they changed, false when the trim is gone. */
	private fresh(): boolean {
		const scene = this.editor.scenes.getActiveSceneOrNull();
		const fps = this.editor.project.getActiveOrNull()?.settings.fps;
		if (!scene || !fps) return false;
		if (scene.tracks === this.before) return true;
		const plan = planTrim({ tracks: scene.tracks, target: this.target, fps, linkSound: linksSound(this.editor) });
		if (!plan) return false;
		this.before = scene.tracks;
		this.plan = plan;
		this.pairs = null;
		// what the preview holds was shown over the old tracks: start again from what is committed now
		if (this.shown.size > 0) {
			this.editor.timeline.discardPreview();
			this.shown.clear();
		}
		return true;
	}

	/** The detached sounds still in step with the main-track pictures the trim can change (one pass, once a trim). */
	private pairsNow(): Map<string, Array<{ trackId: string; sound: TimelineElement }>> {
		if (this.pairs) return this.pairs;
		const pairs = new Map<string, Array<{ trackId: string; sound: TimelineElement }>>();
		this.pairs = pairs;
		if (this.plan.target.trackId !== this.before.main.id || !linksSound(this.editor)) return pairs;
		const pictures = new Map<string, string>();
		for (const element of this.before.main.elements) {
			if (element.type === "video" && element.isSourceAudioEnabled === false && this.plan.ids.has(element.id)) pictures.set(pairKey(element), element.id);
		}
		if (pictures.size === 0) return pairs;
		for (const track of this.before.audio) {
			if (track.locked) continue;
			for (const sound of track.elements as TimelineElement[]) {
				if (sound.type !== "audio" || sound.sourceType !== "upload") continue;
				const picture = pictures.get(pairKey(sound));
				if (!picture) continue;
				const list = pairs.get(picture);
				if (list) list.push({ trackId: track.id, sound });
				else pairs.set(picture, [{ trackId: track.id, sound }]);
			}
		}
		return pairs;
	}

	/** The trim's own changes and the sounds in step with them: what a move costs. Linkage's followers stay as last shown. */
	private showOwn(result: TrimResult): void {
		const updates: Update[] = [];
		const now = new Set<string>();
		const pairs = result.changed.length > 0 ? this.pairsNow() : null;
		for (const { trackId, element, was } of result.changed) {
			now.add(element.id);
			this.hold(element.id, trackId, was, true);
			updates.push({ trackId, elementId: element.id, updates: shownFields(element) });
			const sounds = pairs?.get(element.id);
			if (!sounds) continue;
			for (const { trackId: soundTrack, sound } of sounds) {
				now.add(sound.id);
				this.hold(sound.id, soundTrack, sound, true);
				updates.push({ trackId: soundTrack, elementId: sound.id, updates: pairFields(element) });
			}
		}
		for (const [id, held] of this.shown) {
			if (held.own && !now.has(id)) updates.push({ trackId: held.trackId, elementId: id, updates: shownFields(held.was) });
		}
		if (updates.length > 0) this.editor.timeline.previewElements({ updates });
	}

	/** The result with Linkage's followers, as the committed step will be: every clip that differs from the committed one. */
	private showLinked(result: TrimResult): void {
		const updates: Update[] = [];
		const now = new Set<string>();
		if (result.tracks !== this.before) {
			const { enabled, kinds } = this.editor.command.linkage;
			const tracks = applyLinkage({ before: this.before, after: result.tracks, kinds: new Set(enabled ? kinds : []) });
			// the trim's own clips and their pair sounds: a move without Linkage (showOwn) goes on resetting these
			const own = new Set(result.changed.map(({ element }) => element.id));
			const pairs = this.pairsNow();
			for (const { element } of result.changed) for (const { sound } of pairs.get(element.id) ?? []) own.add(sound.id);
			const committed = new Map(listTracks(this.before).map((track) => [track.id, track]));
			for (const track of listTracks(tracks)) {
				const was = committed.get(track.id);
				if (!was || was === track) continue;
				const old = new Map((was.elements as TimelineElement[]).map((element) => [element.id, element]));
				for (const element of track.elements as TimelineElement[]) {
					const before = old.get(element.id);
					if (!before || before === element) continue;
					now.add(element.id);
					this.hold(element.id, track.id, before, own.has(element.id));
					updates.push({ trackId: track.id, elementId: element.id, updates: shownFields(element) });
				}
			}
		}
		for (const [id, held] of this.shown) {
			if (!now.has(id)) updates.push({ trackId: held.trackId, elementId: id, updates: shownFields(held.was) });
		}
		if (updates.length > 0) this.editor.timeline.previewElements({ updates });
	}

	/** Notes a clip given to the preview layer (once `own`, always: the trim itself moves it). */
	private hold(id: string, trackId: string, was: TimelineElement, own: boolean): void {
		const held = this.shown.get(id);
		if (!held) this.shown.set(id, { trackId, was, own });
		else if (own) held.own = true;
	}
}

/** Linkage is on and lists sounds: a picture takes its detached sound along. */
export function linksSound(editor: EditorCore): boolean {
	const { enabled, kinds } = editor.command.linkage;
	return enabled && kinds.includes("audio");
}

/** A trim made in one go (a key, a typed number): the applied result, or null when the trim cannot be made. */
export function trimOnce(editor: EditorCore, target: TrimTarget, delta: number): TrimResult | null {
	const session = TrimSession.start(editor, target);
	if (!session) return null;
	const result = session.compute(delta);
	if (!result) {
		session.cancel();
		return null;
	}
	session.commit();
	return result;
}
