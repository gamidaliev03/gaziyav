"use client";

import { useEffect, useState } from "react";
import type { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import type { BookmarkDragState } from "../hooks/use-bookmark-drag";
import { DEFAULT_TIMELINE_BOOKMARK_COLOR } from "@/timeline/components/theme";
import { TIMELINE_BOOKMARK_ROW_HEIGHT_PX } from "@/timeline/components/layout";
import { DEFAULT_FPS } from "@/fps/defaults";
import {
	ArrowTurnBackwardIcon,
	Delete02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import type { Bookmark } from "@/timeline";
import { getBookmarkKeys } from "../utils";
import { speedOff } from "@/timeline/speed-flags";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ColorPicker } from "@/components/ui/color-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { uppercase } from "@/utils/string";
import { clamp, formatNumberForDisplay } from "@/utils/math";
import { timelineTimeToPixels, timelineTimeToSnappedPixels } from "@/timeline";
import {
	type MediaTime,
	mediaTimeFromSeconds,
	mediaTimeToSeconds,
	snapSeekMediaTime,
	subMediaTime,
	ZERO_MEDIA_TIME,
} from "@/wasm";

const MIN_BOOKMARK_WIDTH_PX = 2;
const BOOKMARK_MARKER_WIDTH_PX = 12;
const BOOKMARK_MARKER_HEIGHT_PX = 15;
const BOOKMARK_HALF_WIDTH_PX = BOOKMARK_MARKER_WIDTH_PX / 2;
const BOOKMARK_MARKER_CLIP_PATH =
	"polygon(50% 100%, 12% 72%, 12% 10%, 88% 10%, 88% 72%)";

function seekToBookmarkTime({
	editor,
	time,
}: {
	editor: EditorCore;
	time: MediaTime;
}) {
	const activeProject = editor.project.getActive();
	const duration = editor.timeline.getTotalDuration();
	const rate = activeProject?.settings.fps ?? DEFAULT_FPS;
	const snappedTime = snapSeekMediaTime({ time, duration, fps: rate });
	editor.playback.seek({ time: snappedTime });
}

interface TimelineBookmarksRowProps {
	zoomLevel: number;
	dynamicTimelineWidth: number;
	dragState: BookmarkDragState;
	onBookmarkMouseDown: (params: {
		event: React.MouseEvent;
		bookmark: Bookmark;
	}) => void;
	handleWheel: (event: React.WheelEvent) => void;
	handleRulerMouseDown: (event: React.MouseEvent) => void;
	/** The tracks' virtualization window (px at this zoom): markers outside it are not mounted. */
	renderWindow?: { startPx: number; endPx: number } | null;
}

/** A marker's flag (a scene's name) runs up to this far to the right of its mark. */
const BOOKMARK_FLAG_REACH_PX = 200;

export function TimelineBookmarksRow({
	zoomLevel,
	dynamicTimelineWidth,
	dragState,
	onBookmarkMouseDown,
	handleWheel,
	handleRulerMouseDown,
	renderWindow = null,
}: TimelineBookmarksRowProps) {
	// The markers change with the timeline only (it listened to every manager: each playback tick ran this).
	const bookmarks = useEditor((e) => e.scenes.getActiveScene().bookmarks, ["scenes"]);
	// Markers outside the window the tracks are drawn for are not mounted: 100 markers of a two-hour film were 100
	// popovers rendered again on every zoom step, of which two or three were on screen (ideal-longform, 11.11).
	const windowed = renderWindow && !speedOff("marks") ? renderWindow : null;
	const inWindow = (bookmark: Bookmark) => {
		if (!windowed) return true;
		if (dragState.isDragging && dragState.bookmarkTime === bookmark.time) return true;
		const left = timelineTimeToPixels({ time: bookmark.time, zoomLevel });
		const right = left + (bookmark.duration ? timelineTimeToPixels({ time: bookmark.duration, zoomLevel }) : 0) + BOOKMARK_FLAG_REACH_PX;
		return right >= windowed.startPx && left - BOOKMARK_MARKER_WIDTH_PX <= windowed.endPx;
	};
	const keys = getBookmarkKeys({ bookmarks });
	const t = useT();
	// Scene marks (src/chapters) are named flags: their title, else «Scene n» by their place in the film.
	const chapterMarks = bookmarks.filter((b) => b.chapter).map((b) => b.time).sort((a, b) => a - b);
	const firstOffset = chapterMarks.length > 0 && chapterMarks[0] > 0 ? 2 : 1;
	const flagOf = (bookmark: Bookmark) =>
		bookmark.chapter ? bookmark.note || t("Scene {n}", { n: chapterMarks.indexOf(bookmark.time) + firstOffset }) : undefined;

	return (
		<div
			className="relative flex-1 overflow-hidden"
			style={{ height: TIMELINE_BOOKMARK_ROW_HEIGHT_PX }}
		>
			{/* No press squeeze here (globals.css): this button is as wide as the timeline, and the 2 %
			    squeeze slid the markers inside it out from under the pointer, so their click was lost. */}
			<button
				className="relative w-full cursor-default select-none border-0 bg-transparent p-0"
				style={{
					height: TIMELINE_BOOKMARK_ROW_HEIGHT_PX,
					width: `${dynamicTimelineWidth}px`,
				}}
				aria-label="Timeline ruler"
				type="button"
				data-no-press=""
				onWheel={handleWheel}
				// Same as the ruler above: the press moves the playhead (scrub) and nothing else. The
				// follow-up click used to go to the tracks' click handler, which also cleared the clip
				// selection, so a ⌘B right after split every track instead of the selected clip.
				onMouseDown={(event) => {
					// A marker's popover is portalled but its events still bubble here through React.
					if (!event.currentTarget.contains(event.target as Node)) return;
					handleRulerMouseDown(event);
				}}
			>
				{bookmarks.map((bookmark, index) =>
					inWindow(bookmark) ? (
						<TimelineBookmark
							key={keys[index]}
							bookmark={bookmark}
							flag={flagOf(bookmark)}
							zoomLevel={zoomLevel}
							dragState={dragState}
							onBookmarkMouseDown={onBookmarkMouseDown}
						/>
					) : null,
				)}
			</button>
		</div>
	);
}

function TimelineBookmark({
	bookmark,
	flag,
	zoomLevel,
	dragState,
	onBookmarkMouseDown,
}: {
	bookmark: Bookmark;
	flag?: string;
	zoomLevel: number;
	dragState: BookmarkDragState;
	onBookmarkMouseDown: (params: {
		event: React.MouseEvent;
		bookmark: Bookmark;
	}) => void;
}) {
	const editor = useEditor();
	const duration = editor.timeline.getTotalDuration();
	const [isPopoverOpen, setIsPopoverOpen] = useState(false);

	const isDragging =
		dragState.isDragging &&
		dragState.bookmarkTime !== null &&
		dragState.bookmarkTime === bookmark.time;

	const displayTime = isDragging ? dragState.currentTime : bookmark.time;
	const time = bookmark.time;
	const bookmarkDuration = bookmark.duration ?? ZERO_MEDIA_TIME;
	const durationWidth =
		bookmarkDuration > 0
			? timelineTimeToPixels({ time: bookmarkDuration, zoomLevel })
			: 0;
	const hasDurationRange = durationWidth > MIN_BOOKMARK_WIDTH_PX;
	const bookmarkWidth = BOOKMARK_MARKER_WIDTH_PX + Math.max(durationWidth, 0);
	const left = timelineTimeToSnappedPixels({ time: displayTime, zoomLevel });
	const bookmarkLeft = left - BOOKMARK_HALF_WIDTH_PX;
	const rightHalfLeft = BOOKMARK_HALF_WIDTH_PX + Math.max(durationWidth, 0);
	const iconColor = bookmark.color ?? DEFAULT_TIMELINE_BOOKMARK_COLOR;

	const handleSeek = () => seekToBookmarkTime({ editor, time });

	const handleClick = (event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		if (event.detail === 2) {
			setIsPopoverOpen(true);
		} else {
			handleSeek();
		}
	};

	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		handleSeek();
	};

	const handleMouseDown = (event: React.MouseEvent) => {
		onBookmarkMouseDown({ event, bookmark });
		event.preventDefault();
		event.stopPropagation();
	};

	return (
		<Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
			<PopoverAnchor asChild>
				<button
					className="absolute top-0 h-full min-w-0.5 border-0 bg-transparent p-0"
					style={{
						left: `${bookmarkLeft}px`,
						width: `${bookmarkWidth}px`,
					}}
					aria-label={`Bookmark at ${formatNumberForDisplay({ value: mediaTimeToSeconds({ time }), fractionDigits: 1 })}s`}
					type="button"
					data-no-press=""
					onMouseDown={handleMouseDown}
					onClick={handleClick}
					onKeyDown={handleKeyDown}
				>
					{hasDurationRange ? (
						<div
							className="absolute opacity-30"
							style={{
								top: 1.5,
								height: BOOKMARK_MARKER_HEIGHT_PX - 2.5,
								left: BOOKMARK_HALF_WIDTH_PX,
								width: durationWidth,
								backgroundColor: iconColor,
							}}
						/>
					) : null}
					<div
						className="absolute top-0 overflow-hidden"
						style={{
							left: 0,
							width: BOOKMARK_HALF_WIDTH_PX,
							height: BOOKMARK_MARKER_HEIGHT_PX,
						}}
					>
						<div
							className="absolute inset-0"
							style={{
								width: BOOKMARK_MARKER_WIDTH_PX,
								height: BOOKMARK_MARKER_HEIGHT_PX,
								clipPath: BOOKMARK_MARKER_CLIP_PATH,
								backgroundColor: "hsl(var(--background))",
							}}
						/>
						<div
							className="absolute"
							style={{
								top: 1,
								left: 1,
								width: BOOKMARK_MARKER_WIDTH_PX - 2,
								height: BOOKMARK_MARKER_HEIGHT_PX - 2,
								clipPath: BOOKMARK_MARKER_CLIP_PATH,
								backgroundColor: iconColor,
							}}
						/>
					</div>
					<div
						className="absolute top-0 overflow-hidden"
						style={{
							left: rightHalfLeft,
							width: BOOKMARK_HALF_WIDTH_PX,
							height: BOOKMARK_MARKER_HEIGHT_PX,
						}}
					>
						<div
							className="absolute top-0"
							style={{
								left: -BOOKMARK_HALF_WIDTH_PX,
								width: BOOKMARK_MARKER_WIDTH_PX,
								height: BOOKMARK_MARKER_HEIGHT_PX,
								clipPath: BOOKMARK_MARKER_CLIP_PATH,
								backgroundColor: "hsl(var(--background))",
							}}
						/>
						<div
							className="absolute"
							style={{
								top: 1,
								left: 1 - BOOKMARK_HALF_WIDTH_PX,
								width: BOOKMARK_MARKER_WIDTH_PX - 2,
								height: BOOKMARK_MARKER_HEIGHT_PX - 2,
								clipPath: BOOKMARK_MARKER_CLIP_PATH,
								backgroundColor: iconColor,
							}}
						/>
					</div>
					{flag ? (
						<span
							className="pointer-events-none absolute top-0 max-w-40 truncate text-[10px] leading-[15px] font-medium"
							style={{ left: bookmarkWidth + 2, color: iconColor }}
							data-chapter-flag=""
						>
							{flag}
						</span>
					) : null}
				</button>
			</PopoverAnchor>
			<PopoverContent
				className="w-64 flex flex-col gap-3 p-3"
				align="start"
				side="bottom"
				sideOffset={8}
				onOpenAutoFocus={(event) => event.preventDefault()}
			>
				<BookmarkPopoverContent
					bookmark={bookmark}
					time={time}
					timelineDuration={duration}
					onPopoverClose={() => setIsPopoverOpen(false)}
				/>
			</PopoverContent>
		</Popover>
	);
}

function BookmarkPopoverContent({
	bookmark,
	time,
	timelineDuration,
	onPopoverClose,
}: {
	bookmark: Bookmark;
	time: MediaTime;
	timelineDuration: MediaTime;
	onPopoverClose: () => void;
}) {
	const editor = useEditor();
	const [draftColorHex, setDraftColorHex] = useState(
		(bookmark.color ?? DEFAULT_TIMELINE_BOOKMARK_COLOR)
			.replace("#", "")
			.toUpperCase(),
	);

	useEffect(() => {
		setDraftColorHex(
			(bookmark.color ?? DEFAULT_TIMELINE_BOOKMARK_COLOR)
				.replace("#", "")
				.toUpperCase(),
		);
	}, [bookmark.color]);

	const handleRemove = () => {
		editor.scenes.removeBookmark({ time });
		onPopoverClose();
	};

	const handleUpdate = ({
		note,
		color,
		duration,
	}: Partial<Omit<Bookmark, "time">>) => {
		const updates: Partial<Omit<Bookmark, "time">> = {};
		if (note !== undefined && note !== bookmark.note) updates.note = note;
		if (
			color !== undefined &&
			color.toUpperCase() !== (bookmark.color ?? "").toUpperCase()
		) {
			updates.color = color;
		}
		if (duration !== undefined && duration !== bookmark.duration) {
			updates.duration = duration;
		}
		if (Object.keys(updates).length === 0) return;
		editor.scenes.updateBookmark({ time, updates });
	};
	const maxDuration = mediaTimeToSeconds({
		time:
			timelineDuration > time
				? subMediaTime({ a: timelineDuration, b: time })
				: ZERO_MEDIA_TIME,
	});
	const durationSeconds = mediaTimeToSeconds({
		time: bookmark.duration ?? ZERO_MEDIA_TIME,
	});

	return (
		<>
			<div className="flex flex-col gap-2">
				<Label className="text-xs">Note</Label>
				<Input
					placeholder="Add a note..."
					value={bookmark.note ?? ""}
					onChange={(event) => handleUpdate({ note: event.target.value })}
					className="h-8 text-sm"
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label className="text-xs">Color</Label>
				<div className="relative">
					<ColorPicker
						value={uppercase({ string: draftColorHex })}
						onChange={(color) => setDraftColorHex(uppercase({ string: color }))}
						onChangeEnd={(color) =>
							handleUpdate({ color: `#${uppercase({ string: color })}` })
						}
						className="bg-background border"
					/>
					{bookmark.color &&
						bookmark.color.replace(/^#/, "").toUpperCase() !==
							DEFAULT_TIMELINE_BOOKMARK_COLOR.replace(
								/^#/,
								"",
							).toUpperCase() && (
							<Button
								type="button"
								variant="text"
								size="text"
								aria-label="Reset to default color"
								className="absolute top-1/2 right-1 -translate-y-1/2 mr-1"
								onClick={() =>
									editor.scenes.updateBookmark({
										time,
										updates: { color: undefined },
									})
								}
							>
								<HugeiconsIcon
									icon={ArrowTurnBackwardIcon}
									className="!size-3.5"
								/>
							</Button>
						)}
				</div>
			</div>
			<div className="flex flex-col gap-2">
				<Label className="text-xs">Duration</Label>
				<div className="flex items-center gap-1.5">
					<Input
						type="number"
						min={0}
						step={0.1}
						value={durationSeconds}
						onChange={(event) => {
							const parsed = parseFloat(event.target.value);
							const value = Number.isNaN(parsed)
								? 0
								: clamp({
										value: parsed,
										min: 0,
										max: maxDuration,
									});
							handleUpdate({
								duration: mediaTimeFromSeconds({ seconds: value }),
							});
						}}
						className="h-8 text-sm"
						containerClassName="w-full"
					/>
				</div>
			</div>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="text-destructive hover:bg-destructive/10"
				onClick={handleRemove}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						handleRemove();
					}
				}}
				aria-label="delete bookmark"
			>
				<HugeiconsIcon icon={Delete02Icon} className="!size-3.5" />
				Delete
			</Button>
		</>
	);
}
