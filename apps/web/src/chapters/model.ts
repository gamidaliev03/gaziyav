// The film's scenes, read from the open timeline: a scene runs from one scene mark (a marker with `chapter: true`) to
// the next; the first starts at 0 (with or without a mark there), the last ends at the timeline's end. Pure.
import type { Bookmark } from "@/timeline/types";
import { EDGE_EPS } from "./eps";

export interface Chapter {
	/** 0-based position in the film. */
	index: number;
	/** Ticks. */
	start: number;
	end: number;
	/** The mark's note; none = «Scene n». */
	title?: string;
	color?: string;
	/** The time of its mark (null: the first scene without a mark at 0). */
	mark: number | null;
}

export const isChapterMark = (b: Bookmark) => b.chapter === true;

export function chaptersOf(bookmarks: readonly Bookmark[], total: number): Chapter[] {
	if (total <= 0) return [];
	const marks = bookmarks.filter((b) => isChapterMark(b) && b.time < total - EDGE_EPS).sort((a, b) => a.time - b.time);
	if (marks.length === 0) return [];
	const starts: { time: number; mark: Bookmark | null }[] = [];
	if (marks[0].time > EDGE_EPS) starts.push({ time: 0, mark: null });
	for (const mark of marks) {
		const last = starts[starts.length - 1];
		if (last && mark.time - last.time <= EDGE_EPS) continue;
		starts.push({ time: starts.length === 0 ? 0 : mark.time, mark });
	}
	return starts.map((s, i) => ({
		index: i,
		start: s.time,
		end: i + 1 < starts.length ? starts[i + 1].time : total,
		title: s.mark?.note?.trim() || undefined,
		color: s.mark?.color,
		mark: s.mark ? s.mark.time : null,
	}));
}

/** The scene that plays at `time` (the last one at the very end). */
export function chapterAt(chapters: readonly Chapter[], time: number): Chapter | null {
	if (chapters.length === 0) return null;
	return chapters.find((c) => time >= c.start && time < c.end) ?? chapters[chapters.length - 1];
}

/** 0:00 / 1:02:03 for YouTube and the cards. */
export function clock(ticks: number, perSecond: number): string {
	const total = Math.floor(ticks / perSecond + 1e-6);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const ss = String(s).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

/** A length for a card: «42 s», «3:05», «1:02:03». */
export function length(ticks: number, perSecond: number): string {
	const s = ticks / perSecond;
	if (s < 60) return `${Math.max(0, Math.round(s * 10) / 10).toFixed(s < 10 ? 1 : 0)} s`;
	return clock(ticks, perSecond).replace(/^0(\d:)/, "$1");
}

export interface YouTubeChapters {
	text: string;
	/** Why YouTube would not show them, if it would not: «fewer» (under three) or «short» (one under 10 s). */
	problem: "fewer" | "short" | null;
}

/** «00:00 Title» lines, the first at 00:00 — what YouTube reads from a description. */
export function youtubeChapters(chapters: readonly Chapter[], perSecond: number, name: (c: Chapter) => string): YouTubeChapters {
	const long = chapters.some((c) => c.end >= 3600 * perSecond);
	const stamp = (ticks: number) => {
		const t = clock(ticks, perSecond);
		return long && t.split(":").length === 2 ? `0:${t}` : t;
	};
	const text = chapters.map((c, i) => `${stamp(i === 0 ? 0 : c.start)} ${name(c)}`).join("\n");
	const problem = chapters.length < 3 ? "fewer" : chapters.some((c) => c.end - c.start < 10 * perSecond) ? "short" : null;
	return { text, problem };
}
