"use client";

// The number an editor types to trim: + or − on the timeline opens this field at the picked edge (or the selected
// clip), «12» is frames, «1:05» a second and five frames, ↵ applies it as one undo step, Esc closes it. For a clip the
// three things a number can do are one switch: Move · Slip · Slide (Tab goes to the next).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline/types";
import { TICKS_PER_SECOND } from "@/wasm";
import { cn } from "@/utils/ui";
import { parseTypedFrames, pickedLabel } from "../format";
import { editTime } from "../keys";
import { type TrimEntry, useTrimUi } from "../store";
import { flashReadout, movePlayheadByFrames, moveSelectionByFrames, trimByFrames } from "../use-trim-actions";

interface Deps {
	getScroller: () => HTMLElement | null;
	getPps: () => number;
}

const CLIP_MODES = [
	{ value: "move", label: "Move" },
	{ value: "slip", label: "Slip" },
	{ value: "slide", label: "Slide" },
] as const;

const listTracks = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, tracks.main, ...tracks.audio];

export function TrimEntryField({ deps }: { deps: Deps }) {
	const t = useT();
	const editor = useEditor();
	const entry = useTrimUi((s) => s.entry);
	const inputRef = useRef<HTMLInputElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
	const open = entry !== null;

	// Over the edge or the clip it will move, inside the window.
	useLayoutEffect(() => {
		if (!entry) {
			setPlace(null);
			return;
		}
		const scroller = deps.getScroller();
		const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
		if (!scroller || !tracks) return;
		const box = scroller.getBoundingClientRect();
		const subject = entry.subject;
		// the first of several selected clips stands for them
		const [first] = editor.selection.getSelectedElements();
		const trackId = subject.type === "edit" ? subject.target.trackId : subject.type === "clip" ? subject.trackId : subject.type === "clips" ? (first?.trackId ?? null) : null;
		const row = trackId ? scroller.querySelector<HTMLElement>(`[data-timeline-track-row="${CSS.escape(trackId)}"]`)?.getBoundingClientRect() : undefined;
		let time = editor.playback.getCurrentTime() as number;
		if (subject.type === "edit") time = editTime(tracks, subject.target) ?? time;
		else if (subject.type !== "playhead") {
			const id = subject.type === "clip" ? subject.elementId : first?.elementId;
			const element = (listTracks(tracks).find((track) => track.id === trackId)?.elements as TimelineElement[] | undefined)?.find((e) => e.id === id);
			if (element) time = element.startTime + element.duration / 2;
		}
		const x = box.left + (time / TICKS_PER_SECOND) * deps.getPps() - scroller.scrollLeft;
		const width = boxRef.current?.offsetWidth ?? 260;
		const height = boxRef.current?.offsetHeight ?? 40;
		setPlace({
			left: Math.max(8, Math.min(Math.max(box.left, Math.min(box.right, x)) - width / 2, window.innerWidth - width - 8)),
			top: Math.max(8, (row ? row.top : box.top) - height - 6),
		});
		// entry.mode changes the box's width (the switch): placed again
	}, [entry, deps, editor]);

	useEffect(() => {
		if (!open) return;
		const input = inputRef.current;
		if (!input) return;
		input.focus();
		const end = input.value.length;
		input.setSelectionRange(end, end);
	}, [open]);

	if (!entry || typeof document === "undefined") return null;
	const close = () => useTrimUi.getState().setEntry(null);
	const update = (patch: Partial<TrimEntry>) => useTrimUi.getState().setEntry({ ...entry, ...patch });
	const fps = editor.project.getActiveOrNull()?.settings.fps;

	const apply = () => {
		if (!fps) return;
		const frames = parseTypedFrames(entry.text, fps);
		if (frames === null) {
			update({ invalid: true });
			return;
		}
		close();
		if (frames === 0) return;
		if (entry.subject.type === "edit") {
			trimByFrames(editor, deps, entry.subject.target, frames);
			return;
		}
		if (entry.subject.type === "playhead") {
			movePlayheadByFrames(editor, frames);
			return;
		}
		const [first] = editor.selection.getSelectedElements();
		const ref = entry.subject.type === "clip" ? entry.subject : first;
		if (!ref) return;
		const { trackId, elementId } = ref;
		if (entry.subject.type === "clip" && (entry.mode === "slip" || entry.mode === "slide")) {
			trimByFrames(editor, deps, { kind: entry.mode, trackId, elementId }, frames);
			return;
		}
		if (!moveSelectionByFrames(editor, frames)) {
			const tracks = editor.scenes.getActiveScene().tracks;
			const element = (listTracks(tracks).find((track) => track.id === trackId)?.elements as TimelineElement[] | undefined)?.find((e) => e.id === elementId);
			// On the main track with its magnet a clip has no room to move; elsewhere a clip is in the way.
			flashReadout({ deps, editor, kind: "slide", delta: 0, limit: null, at: element ? element.startTime + element.duration / 2 : 0, trackId, note: trackId === tracks.main.id ? "The magnet keeps this clip in place: slide it instead" : "No room to move it there" });
		}
	};

	const nextMode = (direction: 1 | -1) => {
		if (entry.subject.type !== "clip") return;
		const at = CLIP_MODES.findIndex((mode) => mode.value === entry.mode);
		update({ mode: CLIP_MODES[(at + direction + CLIP_MODES.length) % CLIP_MODES.length].value });
	};

	return createPortal(
		<div
			ref={boxRef}
			data-trim-entry={entry.mode}
			// Esc is the field's own (the global keys would only take the focus away)
			data-handles-escape=""
			role="dialog"
			aria-label={t("Trim by a number")}
			className="bg-popover text-popover-foreground fixed z-[400] flex items-center gap-1.5 rounded-md border p-1.5 shadow-md"
			style={{ left: place?.left ?? -9999, top: place?.top ?? -9999 }}
			onMouseDown={(event) => event.stopPropagation()}
		>
			{entry.subject.type === "clip" ? (
				<Segmented
					aria-label={t("What the number does")}
					value={entry.mode as (typeof CLIP_MODES)[number]["value"]}
					onValueChange={(mode) => {
						update({ mode });
						inputRef.current?.focus();
					}}
					items={CLIP_MODES.map((mode) => ({ value: mode.value, label: t(mode.label) }))}
					itemProps={(value) => ({ "data-trim-entry-mode": value, tabIndex: -1 })}
				/>
			) : (
				<span className="px-1 text-xs font-medium whitespace-nowrap">
					{t(entry.subject.type === "edit" ? pickedLabel(entry.subject.target) : entry.subject.type === "clips" ? "Move the clips" : "Move the playhead")}
				</span>
			)}
			<input
				ref={inputRef}
				data-trim-entry-input=""
				aria-label={t("Frames or timecode")}
				aria-invalid={entry.invalid || undefined}
				title={t("12 is frames, 1:05 is 1 second 5 frames")}
				inputMode="numeric"
				autoComplete="off"
				spellCheck={false}
				value={entry.text}
				onChange={(event) => update({ text: event.target.value.replace(/[^\d+\-−:;.,\s]/g, ""), invalid: false })}
				onKeyDown={(event) => {
					// the timeline's own keys stay out of the field
					event.stopPropagation();
					if (event.key === "Enter") {
						event.preventDefault();
						apply();
					} else if (event.key === "Escape") {
						event.preventDefault();
						close();
					} else if (event.key === "Tab") {
						event.preventDefault();
						nextMode(event.shiftKey ? -1 : 1);
					}
				}}
				onBlur={(event) => {
					// a click outside the field closes it; a click on its own switch or button does not
					if (!boxRef.current?.contains(event.relatedTarget as Node | null)) close();
				}}
				className={cn(
					"bg-input h-6 w-20 rounded-[5px] border px-1.5 text-xs tabular-nums outline-none",
					entry.invalid ? "border-destructive" : "border-border focus-visible:border-primary/50",
				)}
			/>
			<Button type="button" size="sm" className="h-6 px-2 text-xs" data-trim-entry-apply="" onClick={apply}>
				{t("Apply")}
			</Button>
		</div>,
		document.body,
	);
}
