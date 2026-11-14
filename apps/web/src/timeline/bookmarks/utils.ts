import type { Bookmark } from "@/timeline";
import type { FrameRate } from "opencut-wasm";
import { addMediaTime, roundFrameTime, type MediaTime } from "@/wasm";

function bookmarkTimeEqual({
	bookmarkTime,
	frameTime,
}: {
	bookmarkTime: MediaTime;
	frameTime: MediaTime;
}): boolean {
	return bookmarkTime === frameTime;
}

export function findBookmarkIndex({
	bookmarks,
	frameTime,
}: {
	bookmarks: Bookmark[];
	frameTime: MediaTime;
}): number {
	return bookmarks.findIndex((bookmark) =>
		bookmarkTimeEqual({ bookmarkTime: bookmark.time, frameTime }),
	);
}

export function isBookmarkAtTime({
	bookmarks,
	frameTime,
}: {
	bookmarks: Bookmark[];
	frameTime: MediaTime;
}): boolean {
	return bookmarks.some((bookmark) =>
		bookmarkTimeEqual({ bookmarkTime: bookmark.time, frameTime }),
	);
}

export function toggleBookmarkInArray({
	bookmarks,
	frameTime,
}: {
	bookmarks: Bookmark[];
	frameTime: MediaTime;
}): Bookmark[] {
	const bookmarkIndex = findBookmarkIndex({ bookmarks, frameTime });

	if (bookmarkIndex !== -1) {
		// Every marker on this frame goes: projects saved before markers merged on drop can hold two
		// on one frame, drawn as one, and M removed only one of them (the marker "came back").
		return bookmarks.filter(
			(bookmark) => !bookmarkTimeEqual({ bookmarkTime: bookmark.time, frameTime }),
		);
	}

	const newBookmarks = [...bookmarks, { time: frameTime }];
	return newBookmarks.slice().sort((a, b) => a.time - b.time);
}

export function removeBookmarkFromArray({
	bookmarks,
	frameTime,
}: {
	bookmarks: Bookmark[];
	frameTime: MediaTime;
}): Bookmark[] {
	return bookmarks.filter(
		(bookmark) =>
			!bookmarkTimeEqual({ bookmarkTime: bookmark.time, frameTime }),
	);
}

export function updateBookmarkInArray({
	bookmarks,
	frameTime,
	updates,
}: {
	bookmarks: Bookmark[];
	frameTime: MediaTime;
	updates: Partial<Omit<Bookmark, "time">>;
}): Bookmark[] {
	const index = findBookmarkIndex({ bookmarks, frameTime });
	if (index === -1) {
		return bookmarks;
	}

	const updated = { ...bookmarks[index], ...updates };
	const result = [...bookmarks];
	result[index] = updated;
	return result;
}

export function moveBookmarkInArray({
	bookmarks,
	fromTime,
	toTime,
}: {
	bookmarks: Bookmark[];
	fromTime: MediaTime;
	toTime: MediaTime;
}): Bookmark[] {
	const index = findBookmarkIndex({ bookmarks, frameTime: fromTime });
	if (index === -1) {
		return bookmarks;
	}

	const moved = { ...bookmarks[index], time: toTime };
	const others = bookmarks.filter((_, otherIndex) => otherIndex !== index);
	// Dropped onto another marker: one marker per frame (two were drawn as one, M removed only one of
	// them, and they shared a React key). The dragged marker wins; the other one's note, colour and
	// duration fill in what it lacks, and both notes are kept.
	const occupantIndex = findBookmarkIndex({ bookmarks: others, frameTime: toTime });
	if (occupantIndex !== -1) {
		others[occupantIndex] = mergeBookmarks({
			kept: moved,
			absorbed: others[occupantIndex],
		});
		return others;
	}

	return [...others, moved].sort((a, b) => a.time - b.time);
}

function mergeBookmarks({
	kept,
	absorbed,
}: {
	kept: Bookmark;
	absorbed: Bookmark;
}): Bookmark {
	const merged: Bookmark = { time: kept.time };
	const notes = [kept.note, absorbed.note].filter(
		(note): note is string => !!note && note.trim().length > 0,
	);
	if (notes.length > 0) merged.note = [...new Set(notes)].join(" · ");
	const color = kept.color ?? absorbed.color;
	if (color !== undefined) merged.color = color;
	const duration = kept.duration ?? absorbed.duration;
	if (duration !== undefined) merged.duration = duration;
	return merged;
}

/**
 * Where a dragged marker lands, or null when the drop is on its own frame: nothing moved, so no
 * undo step (a ⌘Z that seemed to do nothing).
 */
export function resolveBookmarkDrop({
	fromTime,
	toTime,
	fps,
}: {
	fromTime: MediaTime;
	toTime: MediaTime;
	fps: FrameRate;
}): MediaTime | null {
	const target = getFrameTime({ time: toTime, fps });
	return target === getFrameTime({ time: fromTime, fps }) ? null : target;
}

/**
 * React keys for the markers row: the time, plus a counter for a repeated time (older projects can
 * hold two markers on one frame; equal keys made React drop or reuse the wrong one).
 */
export function getBookmarkKeys({
	bookmarks,
}: {
	bookmarks: Bookmark[];
}): string[] {
	const seen = new Map<number, number>();
	return bookmarks.map((bookmark) => {
		const count = seen.get(bookmark.time) ?? 0;
		seen.set(bookmark.time, count + 1);
		return count === 0
			? `bookmark-${bookmark.time}`
			: `bookmark-${bookmark.time}-${count}`;
	});
}

export function getFrameTime({
	time,
	fps,
}: {
	time: MediaTime;
	fps: FrameRate;
}): MediaTime {
	return roundFrameTime({ time, fps });
}

export function getBookmarkAtTime({
	bookmarks,
	frameTime,
}: {
	bookmarks: Bookmark[];
	frameTime: MediaTime;
}): Bookmark | null {
	const index = findBookmarkIndex({ bookmarks, frameTime });
	return index === -1 ? null : bookmarks[index];
}

export function getBookmarksActiveAtTime({
	bookmarks,
	time,
}: {
	bookmarks: Bookmark[];
	time: MediaTime;
}): Bookmark[] {
	return bookmarks.filter((bookmark) => {
		const start = bookmark.time;
		const end =
			bookmark.duration != null && bookmark.duration > 0
				? addMediaTime({ a: start, b: bookmark.duration })
				: start;
		return time >= start && time <= end;
	});
}
