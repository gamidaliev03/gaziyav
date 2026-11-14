// Scene actions on the open timeline. Every action is one undo step: a snapshot of the timeline's tracks and markers
// before and after (the engine in move-range.ts computes the after), so ⌘Z gives back the exact state.
import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import { copySceneAs, updateSceneInArray } from "@/timeline/scenes";
import type { Bookmark, TScene } from "@/timeline/types";
import { type MediaTime, TICKS_PER_SECOND } from "@/wasm";
import { type Chapter, chaptersOf } from "./model";
import { type ChapterState, duplicateRange, EDGE_EPS, extractRange, moveRange, removeRange } from "./move-range";

/** Replaces the open timeline's tracks and markers (and, for a copy, adds a timeline) in one step. */
export class ChapterEditCommand extends Command {
	private before: TScene[] | null = null;
	private after: TScene[] | null = null;

	constructor(
		private readonly build: (state: ChapterState, scene: TScene) => { state: ChapterState; add?: TScene } | null,
		readonly label: string,
	) {
		super();
	}

	/** The step moves what follows itself: the magnet's ripple must not run on top of it. */
	override get ripplesItself(): boolean {
		return true;
	}

	private next: { state: ChapterState; add?: TScene } | null = null;

	/** Computes the step on the timeline as it is now; false when it would change nothing (it is then not run). */
	prepare(): boolean {
		const scene = EditorCore.getInstance().scenes.getActiveSceneOrNull();
		if (!scene) return false;
		const next = this.build({ tracks: scene.tracks, bookmarks: scene.bookmarks }, scene);
		if (!next || (next.state.tracks === scene.tracks && next.state.bookmarks === scene.bookmarks && !next.add)) return false;
		this.next = next;
		return true;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const scene = editor.scenes.getActiveScene();
		const scenes = editor.scenes.getScenes();
		const next = this.next ?? (this.prepare() ? this.next : null);
		this.next = null;
		if (!next) return undefined;
		this.before = [...scenes];
		let after = updateSceneInArray({
			scenes,
			sceneId: scene.id,
			updates: { tracks: next.state.tracks, bookmarks: next.state.bookmarks, updatedAt: new Date() },
		});
		if (next.add) {
			const at = after.findIndex((s) => s.id === scene.id);
			after = [...after.slice(0, at + 1), next.add, ...after.slice(at + 1)];
		}
		this.after = after;
		this.apply(after);
		return undefined;
	}

	private apply(scenes: TScene[]) {
		const editor = EditorCore.getInstance();
		editor.scenes.setScenes({ scenes });
		// The timeline's own listeners (drawing, the player) hear about the new tracks too.
		editor.timeline.updateTracks(editor.scenes.getActiveScene().tracks);
	}

	undo(): void {
		if (this.before) this.apply(this.before);
	}

	redo(): CommandResult | undefined {
		if (!this.after) return this.execute();
		this.apply(this.after);
		return undefined;
	}
}

const editor = () => EditorCore.getInstance();
const fpsOf = () => {
	const fps = editor().project.getActiveOrNull()?.settings.fps;
	const f = fps ? fps.numerator / fps.denominator : 30;
	return Number.isFinite(f) && f > 0 ? f : 30;
};
/** Frame-exact ticks. */
export const toFrame = (ticks: number) => {
	const frame = TICKS_PER_SECOND / fpsOf();
	return Math.round(Math.round(ticks / frame) * frame) as MediaTime;
};

export function totalTicks(): number {
	return editor().timeline.getTotalDuration() as number;
}

export function currentChapters(): Chapter[] {
	const scene = editor().scenes.getActiveSceneOrNull();
	if (!scene) return [];
	return chaptersOf(scene.bookmarks, totalTicks());
}

function run(command: ChapterEditCommand): boolean {
	if (!command.prepare()) return false;
	editor().command.execute({ command });
	return true;
}

/** The chapter's mark (made at its start when the first scene has none yet), changed by `patch`. */
function withMark(bookmarks: Bookmark[], chapter: Chapter, patch: Partial<Bookmark>): Bookmark[] {
	const at = bookmarks.findIndex((b) => b.chapter && Math.abs(b.time - chapter.start) <= EDGE_EPS);
	if (at >= 0) return bookmarks.map((b, i) => (i === at ? { ...b, ...patch } : b));
	return [{ time: chapter.start as MediaTime, chapter: true as const, ...patch }, ...bookmarks].sort((a, b) => a.time - b.time);
}

const byIndex = (index: number) => currentChapters()[index] ?? null;

/** Drag and drop: scene `index` goes into slot `slot` (0 = before the first, n = after the last). */
export function moveChapter(index: number, slot: number): boolean {
	const chapters = currentChapters();
	const chapter = chapters[index];
	if (!chapter || slot === index || slot === index + 1 || slot < 0 || slot > chapters.length) return false;
	const to = slot === chapters.length ? totalTicks() : chapters[slot].start;
	return run(new ChapterEditCommand((state) => ({ state: moveRange({ state, span: chapter, to }) }), "Move scene"));
}

export function deleteChapter(index: number): boolean {
	const chapter = byIndex(index);
	if (!chapter) return false;
	return run(new ChapterEditCommand((state) => ({ state: removeRange({ state, span: chapter }) }), "Delete scene"));
}

export function duplicateChapter(index: number): boolean {
	const chapter = byIndex(index);
	if (!chapter) return false;
	return run(
		new ChapterEditCommand((state) => {
			// The first scene without a mark: the copy needs one to be a scene of its own.
			const marked = chapter.mark === null ? { ...state, bookmarks: withMark(state.bookmarks, chapter, {}) } : state;
			return { state: duplicateRange({ state: marked, span: chapter }) };
		}, "Duplicate scene"),
	);
}

/** The scene and the next one become one (the next one's mark goes); its title stays. */
export function mergeWithNext(index: number): boolean {
	const chapters = currentChapters();
	const next = chapters[index + 1];
	if (!next || next.mark === null) return false;
	return run(
		new ChapterEditCommand(
			(state) => ({ state: { ...state, bookmarks: state.bookmarks.filter((b) => !(b.chapter && Math.abs(b.time - next.start) <= EDGE_EPS)) } }),
			"Merge scenes",
		),
	);
}

/** A new scene mark at `time` (the playhead by default). */
export function splitChapterAt(time = editor().playback.getCurrentTime() as number): boolean {
	const t = toFrame(time);
	const total = totalTicks();
	if (t <= EDGE_EPS || t >= total - EDGE_EPS) return false;
	const chapters = currentChapters();
	if (chapters.some((c) => Math.abs(c.start - t) <= EDGE_EPS)) return false;
	return run(
		new ChapterEditCommand((state) => {
			const start: Bookmark[] = chapters.length === 0 || chapters[0].mark === null ? [{ time: 0 as MediaTime, chapter: true }] : [];
			const bookmarks = [...start, ...state.bookmarks.filter((b) => b.time !== t), { time: t, chapter: true as const }].sort((a, b) => a.time - b.time);
			return { state: { ...state, bookmarks } };
		}, "Split scene"),
	);
}

export function renameChapter(index: number, title: string): boolean {
	const chapter = byIndex(index);
	if (!chapter || (chapter.title ?? "") === title.trim()) return false;
	const note = title.trim() || undefined;
	return run(new ChapterEditCommand((state) => ({ state: { ...state, bookmarks: withMark(state.bookmarks, chapter, { note }) } }), "Rename scene"));
}

export function colorChapter(index: number, color: string | undefined): boolean {
	const chapter = byIndex(index);
	if (!chapter || chapter.color === color) return false;
	return run(new ChapterEditCommand((state) => ({ state: { ...state, bookmarks: withMark(state.bookmarks, chapter, { color }) } }), "Colour scene"));
}

/** The scene becomes a compound clip kept in Media (same media; one project, one timeline — tla3 B): placed nowhere,
 * the open timeline unchanged. Returns its name. */
export function copyChapterToTimeline(index: number, name: string): string | null {
	const chapter = byIndex(index);
	if (!chapter) return null;
	const ok = run(
		new ChapterEditCommand((state, scene) => {
			const piece = extractRange({ state, span: chapter });
			const add = copySceneAs({ source: { ...scene, isMain: false, tracks: piece.tracks, bookmarks: piece.bookmarks }, name });
			return { state, add: { ...add, isMain: false, inMedia: true } };
		}, "Copy scene to a compound clip"),
	);
	return ok ? name : null;
}

/** «Find scenes» accepted: these times become scene marks (with titles), the first scene starts at 0. One step. */
export function applyChapterMarks(marks: { time: number; title?: string }[]): boolean {
	if (marks.length === 0) return false;
	return run(
		new ChapterEditCommand((state) => {
			const times = [0, ...marks.map((m) => toFrame(m.time) as number)];
			const titles = new Map<number, string | undefined>([[0, undefined], ...marks.map((m) => [toFrame(m.time) as number, m.title] as [number, string | undefined])]);
			const kept = state.bookmarks.filter((b) => !b.chapter || !times.some((t) => Math.abs(t - b.time) <= EDGE_EPS));
			const added = [...new Set(times)].map((time) => {
				const old = state.bookmarks.find((b) => b.chapter && Math.abs(b.time - time) <= EDGE_EPS);
				const title = titles.get(time) ?? old?.note;
				return { ...(old ?? {}), time: time as MediaTime, chapter: true as const, ...(title ? { note: title } : {}) };
			});
			return { state: { ...state, bookmarks: [...kept, ...added].sort((a, b) => a.time - b.time) } };
		}, "Add scenes"),
	);
}

export function seekTo(ticks: number) {
	const ed = editor();
	ed.playback.seek({ time: Math.round(ticks) as MediaTime });
}
