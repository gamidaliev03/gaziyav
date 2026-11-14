// Scenes for Claude (the connector's `scenes` tool): list the film's scenes and rename, move, merge, split, delete,
// duplicate, colour, copy out and find them. Every changing call is one ⌘Z. A scene is the run from one scene mark to
// the next: the marks are the timeline's own markers (the Scenes view itself is gone: one project, one timeline, 12.11).
import { EditorCore } from "@/core";
import { t } from "@/i18n";
import type { SceneTracks } from "@/timeline/types";
import { TICKS_PER_SECOND } from "@/wasm";
import {
	applyChapterMarks,
	colorChapter,
	copyChapterToTimeline,
	currentChapters,
	deleteChapter,
	duplicateChapter,
	mergeWithNext,
	moveChapter,
	renameChapter,
	splitChapterAt,
} from "./commands";
import { stripsOf } from "./content";
import { type Chapter, clock, length } from "./model";
import { noteOf } from "./note";
import { youtubeText } from "./youtube";

type Args = Record<string, unknown>;
const T = TICKS_PER_SECOND;
const name = (c: Chapter) => c.title ?? t("Scene {n}", { n: c.index + 1 });

/** «4», 4, «Storm» or «scene 4» → the scene. */
function pick(chapters: Chapter[], ref: unknown): Chapter | null {
	if (typeof ref === "number") return chapters[ref - 1] ?? null;
	const s = String(ref ?? "").trim();
	const n = s.match(/^(?:scene\s*|сцена\s*)?(\d+)$/i);
	if (n) return chapters[Number(n[1]) - 1] ?? null;
	const low = s.toLowerCase();
	return chapters.find((c) => (c.title ?? "").toLowerCase() === low) ?? chapters.find((c) => (c.title ?? "").toLowerCase().includes(low) && low.length > 1) ?? null;
}

function inside(tracks: SceneTracks, c: Chapter, total: number): string {
	const [strip] = stripsOf(tracks, [c], total);
	const cover = (lane: keyof typeof strip) => Math.round(strip[lane].reduce((s, [a, b]) => s + b - a, 0) * 100);
	const parts: string[] = [];
	if (cover("speech")) parts.push(`speech ${cover("speech")}%`);
	if (cover("music")) parts.push(`music ${cover("music")}%`);
	if (cover("titles")) parts.push(`titles ${cover("titles")}%`);
	const clips = tracks.main.elements.filter((e) => e.startTime < c.end && e.startTime + e.duration > c.start).length;
	parts.push(`${clips} clip${clips === 1 ? "" : "s"}`);
	return parts.join(", ");
}

export function listScenes(): string {
	const ed = EditorCore.getInstance();
	const chapters = currentChapters();
	const total = ed.timeline.getTotalDuration() as number;
	if (chapters.length === 0) return `No scenes yet (the film is ${length(total, T)}). scenes {action:"find"} proposes them, or {action:"split", at} adds one.`;
	const tracks = ed.scenes.getActiveScene().tracks;
	const lines = chapters.map((c) => {
		const note = noteOf(tracks, c);
		return `${c.index + 1}. ${clock(c.start, T)} «${name(c)}» · ${length(c.end - c.start, T)} · ${inside(tracks, c, total)} · from ${seconds(c.start)} s${c.color ? ` · colour ${c.color}` : ""}${note ? ` · “${note}”` : ""}`;
	});
	return `${chapters.length} scene${chapters.length === 1 ? "" : "s"} · ${length(total, T)}\n${lines.join("\n")}`;
}

/** A mark's exact place in timeline seconds (the clock is floored: 149.6 s reads 02:29), ready for look and edit. */
const seconds = (ticks: number) => Math.round((ticks / T) * 100) / 100;

export async function scenesTool(args: Args): Promise<{ ok: boolean; content: string }> {
	const action = String(args.action ?? "list");
	const chapters = currentChapters();
	const fail = (content: string) => ({ ok: false, content: `Error: ${content}` });
	const done = (what: string) => ({ ok: true, content: `${what}\n${listScenes()}` });
	const scene = () => pick(chapters, args.scene);
	switch (action) {
		case "list":
			return { ok: true, content: listScenes() };
		case "youtube": {
			const y = youtubeText();
			if (!y) return fail("No scenes yet.");
			const why = y.problem === "fewer" ? "\nYouTube shows chapters only when there are at least three." : y.problem === "short" ? "\nYouTube needs every chapter to be at least 10 seconds long." : "";
			return { ok: true, content: `${y.text}${why}` };
		}
		case "find": {
			const { findScenes, useFindScenes } = await import("./find");
			await findScenes();
			const state = useFindScenes.getState();
			const found = state.proposals ?? [];
			if (state.outcome?.kind === "error") return fail(`Could not find scenes: ${state.outcome.why}`);
			if (found.length < 2) return { ok: true, content: "No scene changes found: the film runs as one piece." };
			const text = found.map((p, i) => `${i + 1}. ${clock(p.time * T, T)} (${Math.round(p.time * 100) / 100} s) ${p.title ? `«${p.title}» ` : ""}(${p.why})`).join("\n");
			if (args.apply === false) return { ok: true, content: `Proposed, not applied (nothing changed: find without apply:false adds them as scene marks):\n${text}` };
			applyChapterMarks(found.map((p) => ({ time: p.time * T, title: p.title })));
			state.set({ proposals: null });
			// What the marks are, and the two steps that follow (six renames, one call each, was the journal's way).
			const untitled = currentChapters().filter((c) => !c.title).length;
			return done(`Added ${found.length} scenes (one ⌘Z). Found by: ${found.map((p) => p.why).join(", ")} — a mark from a pause sits on the picture change next to it when there is one (look at a frame on each side of a mark you doubt).${untitled ? ` ${untitled} have no title: read what is said in each (analyze {what:"words", from, to}) and name them all in one call: scenes {action:"rename", titles:[…in order]}.` : ""}`);
		}
		case "split": {
			const at = args.at === "playhead" || args.at == null ? undefined : Number(args.at) * T;
			if (at !== undefined && !Number.isFinite(at)) return fail("at: seconds or \"playhead\".");
			if (!splitChapterAt(at)) return fail("Nothing to split there (the start or end of the film, or a scene already starts there).");
			if (typeof args.title === "string") {
				const now = currentChapters();
				const made = now.find((c) => Math.abs(c.start - (at ?? (EditorCore.getInstance().playback.getCurrentTime() as number))) < T / 10);
				if (made) renameChapter(made.index, args.title);
			}
			return done("Split (a new scene mark).");
		}
		case "rename": {
			// Every scene named in one call: titles in the film's order (an empty one keeps its name).
			if (!Array.isArray(args.titles)) break;
			if (!chapters.length) return fail('There are no scenes yet: scenes {action:"find"}.');
			const titles = (args.titles as unknown[]).map((x) => (typeof x === "string" ? x.trim() : ""));
			if (titles.length > chapters.length) return fail(`${titles.length} titles for ${chapters.length} scenes: give one per scene, in order.`);
			titles.forEach((title, i) => {
				if (title) renameChapter(i, title);
			});
			return done(`Named ${titles.filter(Boolean).length} scene(s).`);
		}
		default:
			break;
	}
	const c = scene();
	if (!c) return fail(`scene: a number 1–${chapters.length} or a title${chapters.length ? ` (${chapters.map((x) => `${x.index + 1} «${name(x)}»`).join(", ").slice(0, 300)})` : ". There are no scenes yet: scenes {action:\"find\"}"}.`);
	switch (action) {
		case "rename":
			if (typeof args.title !== "string") return fail("title: the new name (or titles: [every scene's name, in order]).");
			renameChapter(c.index, args.title);
			// (one line: the list did not change but for this name)
			return { ok: true, content: `Scene ${c.index + 1} (${clock(c.start, T)}) is «${args.title.trim() || name(c)}».` };
		case "move": {
			// to: the place it takes (1 = first); or before / after another scene.
			let slot: number | null = null;
			if (args.before != null) slot = pick(chapters, args.before)?.index ?? null;
			else if (args.after != null) {
				const a = pick(chapters, args.after);
				slot = a ? a.index + 1 : null;
			} else if (args.to != null) {
				const to = Math.max(1, Math.min(chapters.length, Number(args.to)));
				slot = to - 1 > c.index ? to : to - 1;
			}
			if (slot === null) return fail("move takes to (a place 1…n), before or after (a scene).");
			if (!moveChapter(c.index, slot)) return fail("It is already there.");
			return done(`Moved «${name(c)}» (the clips, captions, titles and sounds inside it went with it; music beds stayed; one ⌘Z).`);
		}
		case "merge":
			if (!mergeWithNext(c.index)) return fail("The last scene has no next one.");
			return done(`Scene ${c.index + 1} and ${c.index + 2} are one now (nothing on the tracks changed).`);
		case "delete":
			if (!deleteChapter(c.index)) return fail("Could not delete it.");
			return done(`Removed scene «${name(c)}» with its part of the film; what followed closed up (one ⌘Z).`);
		case "duplicate":
			if (!duplicateChapter(c.index)) return fail("Could not duplicate it.");
			return done(`A copy of «${name(c)}» follows it.`);
		case "color":
			colorChapter(c.index, typeof args.color === "string" && args.color ? args.color : undefined);
			return done("Colour set.");
		case "copy": {
			const made = copyChapterToTimeline(c.index, typeof args.name === "string" && args.name ? args.name : name(c));
			if (!made) return fail("Could not copy it.");
			return { ok: true, content: `A compound clip «${made}» of this scene alone is in Media (get_project lists it under compounds; add_media places it); the open timeline is unchanged.` };
		}
		default:
			return fail("action: list, find, rename, move, merge, split, delete, duplicate, color, copy, youtube.");
	}
}
