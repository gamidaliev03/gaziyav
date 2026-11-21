"use client";

// The trim model's one mount in the timeline (beside the hover axis, inside the scrolled tracks): it listens for the
// trims' presses (pointer.ts), carries the keys (use-trim-actions.ts) and draws what a trim shows — the pointer shapes,
// the change beside the pointer, the snap line, the picked edge and the number being typed.
import { type RefObject, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import { TIMELINE_LAYERS } from "@/timeline/components/layers";
import { getTrackHeight } from "@/timeline/components/track-layout";
import { useEdgeAutoScroll } from "@/timeline/hooks/use-edge-auto-scroll";
import { getTimelinePixelsPerSecond } from "@/timeline/pixel-utils";
import { useTimelineStore } from "@/timeline/timeline-store";
import { TICKS_PER_SECOND } from "@/wasm";
import { cn } from "@/utils/ui";
import { TRIM_CURSOR_CSS } from "../cursors";
import { formatDeltaTimecode, formatFrames, TRIM_LIMIT_LABEL, TRIM_READOUT } from "../format";
import { editTime } from "../keys";
import { TrimPointer, twoUpTarget } from "../pointer";
import { useTrimUi } from "../store";
import { useTrimActions } from "../use-trim-actions";
import { legacyTrim } from "../legacy-watch";
import { twoUpOf } from "../two-up";
import { twoUpPlayer } from "../two-up-player";
import { TrimEntryField } from "./trim-entry";
import { TrimTwoUp } from "./trim-two-up";

interface TrimLayerProps {
	tracksScrollRef: RefObject<HTMLDivElement | null>;
	rulerScrollRef: RefObject<HTMLDivElement | null>;
	zoomLevel: number;
	/** The scrolled content's width (edge auto-scroll stops at its end). */
	contentWidth: number;
}

export function TrimLayer({ tracksScrollRef, rulerScrollRef, zoomLevel, contentWidth }: TrimLayerProps) {
	const editor = useEditor();
	const pps = getTimelinePixelsPerSecond({ zoomLevel });
	const ppsRef = useRef(pps);
	ppsRef.current = pps;
	const [pointer] = useState(() => new TrimPointer({ editor, getScroller: () => tracksScrollRef.current, getPps: () => ppsRef.current }));
	useEffect(() => {
		const scroller = tracksScrollRef.current;
		return scroller ? pointer.attach(scroller) : undefined;
	}, [pointer, tracksScrollRef]);
	const dragging = useSyncExternalStore(pointer.onDragChange, () => pointer.isDragging, () => false);
	// A trim dragged past the visible part scrolls the timeline, like every timeline drag.
	useEdgeAutoScroll({ isActive: dragging, getMouseClientX: () => pointer.pointerX, rulerScrollRef, tracksScrollRef, contentWidth });
	// The old edge trim (a plain drag of a clip's edge) shows the two frames of its cut too: it tells when it starts and
	// ends, the frames are read from what it previews — once a frame, however often the mouse reports.
	useEffect(() => {
		let stop: (() => void) | null = null;
		const unwatch = legacyTrim.watch((trim) => {
			stop?.();
			stop = null;
			if (!trim) {
				twoUpPlayer.end("edge");
				return;
			}
			const fps = editor.project.getActiveOrNull()?.settings.fps;
			const scene = editor.scenes.getActiveSceneOrNull();
			if (!fps || !scene) return;
			const frame = Math.round((TICKS_PER_SECOND * fps.denominator) / fps.numerator);
			// the magnet closes the gap a shorter main clip leaves: its neighbour is the frame that follows
			const target = { kind: "edge" as const, ...trim, closes: editor.command.isRippleEnabled && trim.trackId === scene.tracks.main.id };
			let request = 0;
			let moved = false;
			const paint = () => {
				request = 0;
				const tracks = editor.timeline.getPreviewTracks();
				if (tracks) twoUpPlayer.show("edge", twoUpOf({ tracks, target, frame }), fps);
			};
			twoUpPlayer.begin(editor, "edge");
			twoUpPlayer.warm("edge", twoUpOf({ tracks: scene.tracks, target, frame }));
			const unsubscribe = editor.timeline.subscribe(() => {
				// a press that never moves (a click on the edge) shows nothing
				if (!editor.timeline.isPreviewActive() && !moved) return;
				moved = true;
				if (!request) request = requestAnimationFrame(paint);
			});
			stop = () => {
				unsubscribe();
				if (request) cancelAnimationFrame(request);
			};
		});
		return () => {
			unwatch();
			stop?.();
			twoUpPlayer.end("edge");
		};
	}, [editor]);
	// An edge or a cut picked for the keys: the player shows its two frames for as long as it is picked and nothing
	// plays (the trim view of Premiere and Avid) — each «,» «.» and typed number is seen at once. A trim in the hand
	// takes the panes over and gives them back.
	const picked = useTrimUi((s) => s.selection);
	const looping = useTrimUi((s) => s.looping);
	const playing = useEditor((e) => e.playback.getIsPlaying(), ["playback"]);
	const committed = useEditor((e) => e.scenes.getActiveSceneOrNull()?.tracks ?? null, ["scenes", "timeline"]);
	const watching = picked !== null && !dragging && !looping && !playing;
	useEffect(() => {
		if (!watching) return;
		twoUpPlayer.begin(editor, "picked");
		return () => twoUpPlayer.end("picked");
	}, [watching, editor]);
	useEffect(() => {
		const fps = editor.project.getActiveOrNull()?.settings.fps;
		if (!watching || !picked || !committed || !fps) return;
		const frame = Math.round((TICKS_PER_SECOND * fps.denominator) / fps.numerator);
		twoUpPlayer.show("picked", twoUpOf({ tracks: committed, target: twoUpTarget(picked), frame }), fps);
	}, [watching, picked, committed, editor]);
	// one object for the layer's life: the number's field places itself from it
	const [deps] = useState(() => ({ getScroller: () => tracksScrollRef.current, getPps: () => ppsRef.current }));
	useTrimActions(deps);

	return (
		<>
			{/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant stylesheet (the pointer shapes), no user text */}
			<style dangerouslySetInnerHTML={{ __html: TRIM_CURSOR_CSS }} />
			<TrimSnapLine pps={pps} />
			{!dragging && <PickedEdge pps={pps} />}
			<TrimReadoutChip />
			<TrimTwoUp />
			<TrimEntryField deps={deps} />
		</>
	);
}

/** The line at the snap point the dragged edge sits on. */
function TrimSnapLine({ pps }: { pps: number }) {
	const time = useTrimUi((s) => s.snapTime);
	if (time === null) return null;
	return (
		<div
			data-trim-snap=""
			aria-hidden
			className="bg-primary/60 pointer-events-none absolute top-0 bottom-0 w-0.5"
			style={{ left: (time / TICKS_PER_SECOND) * pps - 1, zIndex: TIMELINE_LAYERS.snapIndicator }}
		/>
	);
}

/**
 * The edge or the cut picked for the keys: a bracket on the side that will move («]» the end of the clip on the left,
 * «[» the start of the one on the right, both for a roll) and the trim's name over it.
 */
function PickedEdge({ pps }: { pps: number }) {
	const t = useT();
	const selection = useTrimUi((s) => s.selection);
	const looping = useTrimUi((s) => s.looping);
	// the picked edge follows every edit (and lets go when its clips are gone)
	const tracks = useEditor((e) => e.scenes.getActiveSceneOrNull()?.tracks ?? null, ["scenes", "timeline"]);
	useTimelineStore((s) => s.trackHeight);
	const markRef = useRef<HTMLDivElement>(null);
	const time = selection && tracks ? editTime(tracks, selection) : null;
	useEffect(() => {
		if (selection && time === null) useTrimUi.getState().select(null);
	}, [selection, time]);
	const trackId = selection?.trackId ?? null;
	const trackType = trackId && tracks ? ([...tracks.overlay, tracks.main, ...tracks.audio].find((track) => track.id === trackId)?.type ?? null) : null;
	// The row's place is the timeline's own: read from it, so every track height and expanded row is right.
	useLayoutEffect(() => {
		const mark = markRef.current;
		if (!mark || !trackId) return;
		const row = mark.parentElement?.querySelector<HTMLElement>(`[data-timeline-track-row="${CSS.escape(trackId)}"]`);
		if (row) mark.style.top = `${row.offsetTop}px`;
	});
	if (!selection || time === null || !trackType) return null;
	const height = getTrackHeight({ type: trackType });
	const x = (time / TICKS_PER_SECOND) * pps;
	const sides: Array<"out" | "in"> = selection.kind === "roll" ? ["out", "in"] : [selection.side === "right" ? "out" : "in"];
	return (
		<div
			ref={markRef}
			data-trim-picked={selection.kind}
			data-trim-side={selection.kind === "roll" ? "both" : selection.side === "right" ? "out" : "in"}
			data-trim-looping={looping ? "" : undefined}
			aria-hidden
			className="pointer-events-none absolute"
			style={{ left: x, height, zIndex: TIMELINE_LAYERS.dragLine }}
		>
			{sides.map((side) => (
				// the bracket: a bar on the edge with two short feet into its clip
				<span
					key={side}
					className={cn("absolute inset-y-0 w-[7px] border-y-[3px] border-[#ffc53d]", side === "out" ? "right-0 border-r-[3px] rounded-r-[3px]" : "left-0 border-l-[3px] rounded-l-[3px]")}
					style={side === "out" ? { right: selection.kind === "roll" ? 1 : 0 } : { left: selection.kind === "roll" ? 1 : 0 }}
				/>
			))}
			{looping && (
				// Only the looping note is worth a word over the cut («Roll: both sides» named nothing a person needed).
				<span className="absolute top-0.5 left-1/2 -translate-x-1/2 rounded-[3px] bg-[#ffc53d] px-1 text-[10px] leading-[14px] font-semibold whitespace-nowrap text-black">
					{t("plays")}
				</span>
			)}
		</div>
	);
}

/** The change in frames and timecode beside the pointer (or at the edge, for a key), and why it stopped when it did. */
function TrimReadoutChip() {
	const t = useT();
	const readout = useTrimUi((s) => s.readout);
	if (!readout || typeof document === "undefined") return null;
	const frames = formatFrames(readout.delta, readout.frame);
	const timecode = formatDeltaTimecode(readout.delta, readout.frame, readout.fps);
	// beside the pointer, inside the window: near the right edge it hangs to the pointer's left
	const nearRight = readout.x > window.innerWidth - 360;
	const top = Math.max(8, readout.y - 40);
	return createPortal(
		<div
			data-trim-readout={readout.kind}
			data-trim-frames={readout.delta / readout.frame}
			data-trim-limit={readout.limit ?? ""}
			role="status"
			className="bg-popover text-popover-foreground pointer-events-none fixed z-[400] flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs whitespace-nowrap tabular-nums shadow-md"
			style={nearRight ? { right: Math.max(8, window.innerWidth - readout.x + 16), top } : { left: Math.max(8, readout.x + 16), top }}
		>
			{readout.note ? (
				<span>{t(readout.note)}</span>
			) : (
				<>
					<span className="font-medium">{t(TRIM_READOUT[readout.kind], { n: frames })}</span>
					<span className="text-muted-foreground">{timecode}</span>
					{readout.limit && <span className="font-medium text-[#ffc53d]">{t(TRIM_LIMIT_LABEL[readout.limit])}</span>}
				</>
			)}
		</div>,
		document.body,
	);
}
