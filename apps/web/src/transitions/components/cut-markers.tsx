"use client";

import { EditorCore } from "@/core";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeftRightIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { flushSync } from "react-dom";
import { create } from "zustand";
import { scheduleShaderWarmup } from "@/effects/components/warmup";
import { useCommittedRef } from "@/hooks/use-committed-ref";
import type { VideoTrack } from "@/timeline";
import type { TimelineTrack } from "@/timeline/types";
import { getTimelinePixelsPerSecond, timelineTimeToPixels } from "@/timeline/pixel-utils";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { TICKS_PER_SECOND } from "@/wasm";
import { cn } from "@/utils/ui";
import { watchCutPress } from "@/timeline/cut-press";
import { getTransitionDefinition } from "../definitions";
import {
	type CutRef,
	applyTransition,
	clampTransitionTicks,
	commitTransitionEdit,
	listTrackCuts,
	moveTransition,
	previewTransitionPatch,
	removeTransition,
	snapshotTracks,
	type CutInfo,
	useSelectedCut,
} from "../commands";

const TRANSITION_DRAG_MIME = "application/x-studio-transition";
/** A chip dragged off its cut: the cut it came from, so a drop on another cut moves it there (one undo step). */
const TRANSITION_MOVE_MIME = "application/x-studio-transition-move";
let droppedOnCut = false;
const parseCutRef = (raw: string): CutRef | null => {
	if (!raw) return null;
	try {
		const ref = JSON.parse(raw) as Partial<CutRef>;
		return ref.trackId && ref.fromElementId && ref.toElementId ? { trackId: ref.trackId, fromElementId: ref.fromElementId, toElementId: ref.toElementId } : null;
	} catch {
		return null;
	}
};

/**
 * Width of the part of a plain "+" that takes the pointer. The clips' trim handles reach about 10 px
 * into each clip from the cut; the whole 18 × 24 px marker used to sit on top of both of them, so a
 * press on a clip's edge at mid-height selected the cut instead of trimming.
 */
const CUT_HIT_WIDTH_PX = 8;

/**
 * How far a clip's trim handle reaches into the clip from the cut (timeline-element ResizeHandle: 12 px, 2.5 of them
 * outside the clip). A transition chip is centred on the cut and used to take the pointer over both handles: the edge of
 * a clip at a transition could not be trimmed by the mouse (check-flow layout at 1440×900, 07.11). The chip now leaves
 * that strip, at mid-height, to the handles (they are the topmost thing at the clip's edge); a click there on the chip
 * still selects the transition (selectCutUnder, from the handle). The plain "+" does the same with its middle.
 */
const TRIM_REACH_PX = 9.5;

/** Selects a cut: the clips let go (CapCut), the Transitions tab acts on it. */
export function selectCut(cut: CutRef) {
	EditorCore.getInstance().selection.clearSelection();
	useSelectedCut.getState().setCut({ trackId: cut.trackId, fromElementId: cut.fromElementId, toElementId: cut.toElementId });
	useAssetsPanelStore.getState().setActiveTab("transitions");
}

/**
 * A click (no drag) on a clip's trim handle that landed on the cut's marker at that edge — the transition chip or the
 * "+" — selects the cut, as a click on the marker did while the marker took the pointer there. False when the point is
 * off the marker, or no marker is shown there (a click on the clip's edge beside it selects the clip, as before).
 */
export function selectCutUnder(track: TimelineTrack | null | undefined, elementId: string, side: "left" | "right", x: number, y: number): boolean {
	// The whole track, with its elements: the trim pointer once passed only `{ id, type }`, and the cut list read
	// `elements` of nothing — a page error on every click on a clip's edge (check-edit fx, redsweep 13.11).
	if (track?.type !== "video") return false;
	const cut = listTrackCuts(track as VideoTrack).find((c) => (side === "right" ? c.fromElementId === elementId : c.toElementId === elementId));
	if (!cut) return false;
	const marker = document.querySelector(`[data-cut-marker][data-cut-from="${CSS.escape(cut.fromElementId)}"][data-cut-to="${CSS.escape(cut.toElementId)}"]`);
	const box = marker?.getBoundingClientRect();
	if (!box || x < box.left || x > box.right || y < box.top || y > box.bottom) return false;
	selectCut(cut);
	return true;
}

/**
 * True while a transition tile is being dragged: only then does a plain cut's whole box take the
 * pointer, so the drop is easy to hit. Watched once for all markers (a long edit has hundreds).
 */
const useTransitionDrag = create<{ active: boolean }>(() => ({ active: false }));
let isWatchingTransitionDrags = false;
function watchTransitionDrags() {
	if (isWatchingTransitionDrags || typeof window === "undefined") return;
	isWatchingTransitionDrags = true;
	// Bubble phase: the tile's own dragstart has set the drag data by the time this runs.
	window.addEventListener("dragstart", (event) => {
		if (event.dataTransfer?.types.includes(TRANSITION_DRAG_MIME)) {
			useTransitionDrag.setState({ active: true });
		}
	});
	const stop = () => useTransitionDrag.setState({ active: false });
	window.addEventListener("dragend", stop, true);
	window.addEventListener("drop", stop, true);
}

/**
 * Cut markers on a video track: a small "+" on every cut between touching
 * clips, a labelled bar where a transition exists. Click selects the cut and
 * opens the Transitions tab; drop a transition tile onto it to apply; drag
 * the bar's edge to change the duration (one ⌘Z per drag).
 */
export function TransitionCutMarkers({ track, zoomLevel }: { track: VideoTrack; zoomLevel: number }) {
	// mounted with the timeline when the editor opens: warm the top shaders in idle time
	useEffect(() => scheduleShaderWarmup(), []);
	useEffect(() => watchTransitionDrags(), []);
	const cuts = listTrackCuts(track);
	// Every "+" shows while the Transitions tab is open or a transition tile is dragged (all are drop targets);
	// otherwise a plain "+" shows only under the pointer, and HoverCutMarker mounts just that one.
	const transitionsOpen = useAssetsPanelStore((state) => state.activeTab === "transitions");
	const isTransitionDrag = useTransitionDrag((state) => state.active);
	const showAllPlain = transitionsOpen || isTransitionDrag;
	const selected = useSelectedCut((state) => state.cut);
	const isSelectedCut = (cut: CutInfo) =>
		selected?.fromElementId === cut.fromElementId && selected?.toElementId === cut.toElementId;
	const shown = showAllPlain ? cuts : cuts.filter((cut) => cut.transition || isSelectedCut(cut));
	// Plain "+" markers that only moved (a ripple) skipped their render: put them at their new time.
	useLayoutEffect(() => {
		if (cutPositioners.size === 0) return;
		for (const cut of cuts) {
			if (!cut.transition) cutPositioners.get(cutKey(cut))?.(cut.time);
		}
	});
	if (cuts.length === 0) return null;
	return (
		<>
			{shown.map((cut) => (
				<CutMarker key={`${cut.fromElementId}:${cut.toElementId}`} cut={cut} zoomLevel={zoomLevel} />
			))}
			{!showAllPlain && (
				<HoverCutMarker cuts={cuts} zoomLevel={zoomLevel} skip={selected ? `${selected.fromElementId}:${selected.toElementId}` : null} />
			)}
		</>
	);
}

/**
 * The one plain "+" of a track that is under the pointer. A "+" per cut (~260 in a long edit, two paint layers each)
 * was restyled and laid out again by every ripple and zoom and walked by every hover hit test, for markers that
 * stay invisible until hovered. This one mounts when the pointer comes within reach of a cut (synchronously, so a
 * press right after the move already lands on it) and from there behaves as before: hover shows it, a click selects
 * the cut, a press beside its middle reaches the trim handles.
 */
/** Clips narrower than this (the filmstrip's plain-plate width) get no hover «+» at their cuts. */
const NARROW_CLIP_PX = 24;

function HoverCutMarker({ cuts, zoomLevel, skip }: { cuts: CutInfo[]; zoomLevel: number; skip: string | null }) {
	const anchorRef = useRef<HTMLSpanElement>(null);
	const [hoveredKey, setHoveredKey] = useState<string | null>(null);
	const shownKeyRef = useRef<string | null>(null);
	const liveRef = useCommittedRef({ cuts, zoomLevel });
	useEffect(() => {
		const surface = anchorRef.current?.parentElement;
		if (!surface) return;
		const show = (key: string | null) => {
			if (shownKeyRef.current === key) return;
			shownKeyRef.current = key;
			flushSync(() => setHoveredKey(key));
		};
		const onMove = (event: PointerEvent) => {
			const { cuts: list, zoomLevel: zoom } = liveRef.current;
			const x = event.clientX - surface.getBoundingClientRect().left;
			const pps = getTimelinePixelsPerSecond({ zoomLevel: zoom });
			const reach = CUT_HIT_WIDTH_PX / 2 + HOVER_REACH_MARGIN_PX;
			let found: string | null = null;
			for (const cut of list) {
				if (cut.transition) continue;
				// Next to a narrow clip (zoomed out) the «+» would cover most of it: a click near its edges picked the cut
				// instead of the clip (a 12 px clip had 4 px left to click). There the press goes to the clip.
				if (Math.min(cut.from.duration, cut.to.duration) / TICKS_PER_SECOND * pps < NARROW_CLIP_PX) continue;
				const dx = x - (cut.time / TICKS_PER_SECOND) * pps;
				if (dx < -reach) break;
				if (dx <= reach) {
					found = `${cut.fromElementId}:${cut.toElementId}`;
					break;
				}
			}
			show(found);
		};
		const onLeave = () => show(null);
		surface.addEventListener("pointermove", onMove);
		surface.addEventListener("pointerleave", onLeave);
		return () => {
			surface.removeEventListener("pointermove", onMove);
			surface.removeEventListener("pointerleave", onLeave);
		};
	}, [liveRef]);
	const cut = hoveredKey && hoveredKey !== skip ? cuts.find((c) => !c.transition && `${c.fromElementId}:${c.toElementId}` === hoveredKey) : undefined;
	return (
		<>
			<span ref={anchorRef} hidden />
			{cut && <CutMarker key={hoveredKey} cut={cut} zoomLevel={zoomLevel} hovered />}
		</>
	);
}

/**
 * A ripple moves every cut after the edit: ~200 plain "+" markers re-rendered on each delete / undo / redo
 * just to change `left`. Such a marker skips that render; TransitionCutMarkers calls its positioner.
 */
const cutPositioners = new Map<string, (time: number) => void>();
const cutKey = (cut: { trackId: string; fromElementId: string; toElementId: string }) =>
	`${cut.trackId}:${cut.fromElementId}:${cut.toElementId}`;
const PLAIN_CUT_WIDTH_PX = 18;
/** Starts the trim of the clip edge on one side of a cut, as if the press had landed on its handle. */
function startTrimAtCut({
	cut,
	side,
	startX,
	startY,
	x,
	y,
}: {
	cut: CutInfo;
	side: "left" | "right";
	startX: number;
	startY: number;
	x: number;
	y: number;
}): boolean {
	const elementId = side === "left" ? cut.fromElementId : cut.toElementId;
	const label = side === "left" ? "Right resize handle" : "Left resize handle";
	const handle = document
		.querySelector(`[data-timeline-element-id="${CSS.escape(elementId)}"]`)
		?.querySelector<HTMLElement>(`[aria-label="${label}"]`);
	if (!handle) return false;
	// The resize controller listens on the document from the press on.
	handle.dispatchEvent(new MouseEvent("mousedown", { clientX: startX, clientY: startY, button: 0, buttons: 1, bubbles: true }));
	document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, buttons: 1, bubbles: true }));
	return true;
}
/** How far outside a cut's hit strip the pointer mounts its "+" (so it is there before the pointer reaches it). */
const HOVER_REACH_MARGIN_PX = 6;
const plainCutLeft = (time: number) =>
	`calc(${time / TICKS_PER_SECOND} * var(--timeline-pps) * 1px - ${PLAIN_CUT_WIDTH_PX / 2}px)`;

/**
 * Memoized: `listTrackCuts` builds fresh CutInfo objects on every track change, so
 * compare by value. Without it all ~260 markers of a long edit re-render on every
 * edit anywhere on the timeline (select, split, undo, ...). A plain "+" sits at
 * seconds × --timeline-pps, so only markers with a transition (their width is the
 * transition's) re-render on zoom.
 */
const CutMarker = memo(CutMarkerImpl, (prev, next) =>
	(prev.zoomLevel === next.zoomLevel || (!prev.cut.transition && !next.cut.transition)) &&
	prev.cut.trackId === next.cut.trackId &&
	prev.cut.fromElementId === next.cut.fromElementId &&
	prev.cut.toElementId === next.cut.toElementId &&
	// a plain "+" that only moved is positioned without a render (see cutPositioners)
	(prev.cut.time === next.cut.time || (!prev.cut.transition && !next.cut.transition)) &&
	prev.cut.transition === next.cut.transition &&
	prev.hovered === next.hovered);

/** `hovered`: mounted by HoverCutMarker because the pointer is near the cut — the "+" shows at once, wherever on the row the pointer is. */
function CutMarkerImpl({ cut, zoomLevel, hovered = false }: { cut: CutInfo; zoomLevel: number; hovered?: boolean }) {
	const selected = useSelectedCut((state) => state.cut);
	const setCut = useSelectedCut((state) => state.setCut);
	// The "+" shows on hover, or for every cut while the Transitions tab is open (CapCut).
	const transitionsOpen = useAssetsPanelStore((state) => state.activeTab === "transitions");
	const isTransitionDrag = useTransitionDrag((state) => state.active);
	const [dropHover, setDropHover] = useState(false);
	const dragRef = useRef<{ before: ReturnType<typeof snapshotTracks> } | null>(null);
	const markerRef = useRef<HTMLDivElement>(null);
	// A press on the "+" that turned into a trim: its click must not select the cut.
	const trimmedRef = useRef(false);
	// The time this marker's `left` shows (written by a render or by the positioner).
	const shownTimeRef = useRef(cut.time);
	const isPlain = !cut.transition;
	useLayoutEffect(() => {
		shownTimeRef.current = cut.time;
	});
	const key = cutKey(cut);
	useLayoutEffect(() => {
		if (!isPlain) return;
		const position = (time: number) => {
			const node = markerRef.current;
			if (!node || shownTimeRef.current === time) return;
			shownTimeRef.current = time;
			node.style.left = plainCutLeft(time);
		};
		cutPositioners.set(key, position);
		return () => {
			if (cutPositioners.get(key) === position) cutPositioners.delete(key);
		};
	}, [key, isPlain]);

	const isSelected =
		selected?.fromElementId === cut.fromElementId && selected?.toElementId === cut.toElementId;
	const transition = cut.transition;
	const definition = transition ? getTransitionDefinition(transition.type) : undefined;
	const halfPx = transition ? timelineTimeToPixels({ time: transition.duration / 2, zoomLevel }) : 0;
	const width = Math.max(PLAIN_CUT_WIDTH_PX, halfPx * 2);

	// Picking a cut lets go of the clips (CapCut): ⌘C / ⌫ then act on the transition.
	const select = () => selectCut(cut);

	const startResize = (event: React.PointerEvent) => {
		event.stopPropagation();
		event.preventDefault();
		if (!transition) return;
		dragRef.current = { before: snapshotTracks() };
		const target = event.currentTarget as HTMLElement;
		target.setPointerCapture(event.pointerId);
		const pxPerSecond = getTimelinePixelsPerSecond({ zoomLevel });
		const originX = event.clientX - halfPx;
		const onMove = (moveEvent: PointerEvent) => {
			const half = Math.max(0, moveEvent.clientX - originX) / pxPerSecond;
			previewTransitionPatch(cut, { duration: clampTransitionTicks(half * 2 * TICKS_PER_SECOND, cut) });
		};
		const onUp = () => {
			target.removeEventListener("pointermove", onMove);
			target.removeEventListener("pointerup", onUp);
			commitTransitionEdit(dragRef.current?.before ?? null);
			dragRef.current = null;
		};
		target.addEventListener("pointermove", onMove);
		target.addEventListener("pointerup", onUp);
	};

	return (
		// biome-ignore lint: marker is a pointer target; keyboard users use the Transitions tab
		<div
			ref={markerRef}
			role="button"
			tabIndex={-1}
			data-cut-marker={transition ? "transition" : "add"}
			data-cut-from={cut.fromElementId}
			data-cut-to={cut.toElementId}
			title={definition ? `${definition.name} · ${((transition?.duration ?? 0) / TICKS_PER_SECOND).toFixed(2)} s` : "Add a transition"}
			// No transform or opacity here: ~260 markers each made their own paint chunk / layer (zoom jank).
			className={cn("group/cut absolute flex items-center justify-center", transition ? "top-[15%] h-[70%]" : "top-[calc(50%-12px)] h-6")}
			style={{
				left: transition
					? timelineTimeToPixels({ time: cut.time, zoomLevel }) - width / 2
					: plainCutLeft(cut.time),
				width,
				zIndex: 15,
				// A plain "+" lets presses beside its middle through to the trim handles under it; a chip leaves the
				// handles' strip (TRIM_REACH_PX each side of the cut) to them. While a tile is dragged the whole box takes
				// the drop.
				pointerEvents: isTransitionDrag ? undefined : "none",
			}}
			onMouseDown={(event) => {
				event.stopPropagation();
				trimmedRef.current = false;
				if (transition || event.button !== 0) return;
				const box = markerRef.current?.getBoundingClientRect();
				if (!box) return;
				watchCutPress({
					startX: event.clientX,
					startY: event.clientY,
					cutX: box.left + box.width / 2,
					target: document,
					startTrim: (args) => startTrimAtCut({ cut, ...args }),
					onTrim: () => {
						trimmedRef.current = true;
					},
				});
			}}
			onMouseUp={(event) => event.stopPropagation()}
			onClick={(event) => {
				event.stopPropagation();
				if (trimmedRef.current) {
					trimmedRef.current = false;
					return;
				}
				select();
			}}
			onDragOver={(event) => {
				if (!event.dataTransfer.types.includes(TRANSITION_DRAG_MIME)) return;
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = "copy";
				setDropHover(true);
			}}
			onDragLeave={() => setDropHover(false)}
			onDrop={(event) => {
				const type = event.dataTransfer.getData(TRANSITION_DRAG_MIME);
				setDropHover(false);
				if (!type) return;
				event.preventDefault();
				event.stopPropagation();
				// A chip dragged from another cut moves here (one undo step); a tile from the panel applies its type.
				const from = parseCutRef(event.dataTransfer.getData(TRANSITION_MOVE_MIME));
				if (from) droppedOnCut = true;
				const same = !!from && from.trackId === cut.trackId && from.fromElementId === cut.fromElementId && from.toElementId === cut.toElementId;
				if (from ? same || moveTransition({ from, to: cut }) : applyTransition({ cut, type })) select();
			}}
		>
			{transition ? (
				<div
					draggable
					onDragStart={(event) => {
						event.stopPropagation();
						event.dataTransfer.setData(TRANSITION_DRAG_MIME, transition.type);
						event.dataTransfer.setData(TRANSITION_MOVE_MIME, JSON.stringify({ trackId: cut.trackId, fromElementId: cut.fromElementId, toElementId: cut.toElementId }));
						event.dataTransfer.effectAllowed = "copyMove";
						droppedOnCut = false;
						// The window's dragstart watcher (watchTransitionDrags) never sees this event — it stops here — so the
						// plain markers are told directly: during the drag each takes the pointer over its whole box and the
						// drop lands on it (moveTransition, one ⌘Z), not on the track through the gap under its middle (the
						// track applied the type there and the drag's end removed the old one: two ⌘Z, 07.11).
						useTransitionDrag.setState({ active: true });
					}}
					onDragEnd={(event) => {
						// Let go on the timeline but not on a cut: the transition comes off (⌘Z puts it back) — never half a
						// transition left behind. Outside the timeline, or Esc: nothing changes.
						const wasDropped = droppedOnCut;
						droppedOnCut = false;
						if (wasDropped) return;
						const area = document.querySelector('section[aria-label="Timeline"]')?.getBoundingClientRect();
						const inside = !!area && event.clientX >= area.left && event.clientX <= area.right && event.clientY >= area.top && event.clientY <= area.bottom;
						if (!inside) return;
						removeTransition(cut);
						setCut(null);
					}}
					className={cn(
						"relative flex size-full cursor-grab items-center justify-center overflow-hidden rounded-sm border bg-black/55 text-[10px] font-medium text-white backdrop-blur-[1px]",
						isSelected ? "border-primary ring-primary ring-1" : "border-white/60",
						dropHover && "ring-primary ring-2",
					)}
				>
					{/* A narrow chip shows an icon: «⇄» is in no font of the app, and the Mac's search for a font that has it
					    held the first transition's frame of a session for ~20 ms (its layout). */}
					{width > 44 ? (
						<span className="truncate px-1">{definition?.name}</span>
					) : (
						<HugeiconsIcon icon={ArrowLeftRightIcon} className="size-2.5 shrink-0" aria-hidden />
					)}
					{/* The chip takes the pointer everywhere but the trim handles' strip at mid-height (TRIM_REACH_PX each side of
					    the cut, the middle 40 % of the chip): there the cursor is the trim cursor and a press trims the clip's
					    edge; a click there still selects the transition (selectTransitionUnder). Its sides and its upper and
					    lower bands select it, drag it to another cut and show the tooltip. */}
					<span aria-hidden className="pointer-events-auto absolute inset-y-0 left-0" style={{ width: `max(0px, calc(50% - ${TRIM_REACH_PX}px))` }} data-cut-chip-side="left" />
					<span aria-hidden className="pointer-events-auto absolute inset-y-0 right-0" style={{ width: `max(0px, calc(50% - ${TRIM_REACH_PX}px))` }} data-cut-chip-side="right" />
					<span aria-hidden className="pointer-events-auto absolute top-0 h-[30%]" style={{ left: `calc(50% - ${TRIM_REACH_PX}px)`, width: TRIM_REACH_PX * 2 }} data-cut-chip-side="top" />
					<span aria-hidden className="pointer-events-auto absolute bottom-0 h-[30%]" style={{ left: `calc(50% - ${TRIM_REACH_PX}px)`, width: TRIM_REACH_PX * 2 }} data-cut-chip-side="bottom" />
					<div
						className="pointer-events-auto absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/50 invisible group-hover/cut:visible"
						onPointerDown={startResize}
						onClick={(event) => event.stopPropagation()}
					/>
				</div>
			) : (
				<>
					<div
						className={cn(
							"pointer-events-none flex size-4 items-center justify-center rounded-full border text-[0.65rem] leading-none",
							isSelected || dropHover
								? "bg-primary border-primary text-primary-foreground"
								: cn("border-white/80 bg-black/70 text-white", !transitionsOpen && !hovered && "invisible group-hover/cut:visible"),
						)}
					>
						+
					</div>
					{/* The only parts that take the pointer: the top and bottom of the "+" (a click selects the cut, a press that
					    moves trims — watchCutPress); events bubble to the marker's handlers through React. Its middle is left
					    to the clips' trim handles (their centres lie there — check-flow layout at 1024×640, 07.11): a click on
					    it reaches the marker through the handle (selectCutUnder), a press trims the edge the handle belongs to. */}
					<span
						aria-hidden
						className="pointer-events-auto absolute top-0 h-[30%]"
						style={{ left: `calc(50% - ${CUT_HIT_WIDTH_PX / 2}px)`, width: CUT_HIT_WIDTH_PX }}
						onMouseMove={(event) => lightEdgeAtCut(cut, event.currentTarget, event.clientX)}
						onMouseLeave={() => lightEdgeAtCut(cut, null, 0)}
					/>
					<span
						aria-hidden
						className="pointer-events-auto absolute bottom-0 h-[30%]"
						style={{ left: `calc(50% - ${CUT_HIT_WIDTH_PX / 2}px)`, width: CUT_HIT_WIDTH_PX }}
						onMouseMove={(event) => lightEdgeAtCut(cut, event.currentTarget, event.clientX)}
						onMouseLeave={() => lightEdgeAtCut(cut, null, 0)}
					/>
				</>
			)}
		</div>
	);
}

/**
 * The "+" of a plain cut takes the pointer over the clips' edges (its top and bottom): the edge a press there trims lights
 * as its own zone would (tlfix A2 — the handle bar, globals.css .tl-trim-bar[data-hover]). Left of the cut the clip
 * before it (its end), right of it the clip after it (its start); null clears both.
 */
function lightEdgeAtCut(cut: { fromElementId: string; toElementId: string }, part: HTMLElement | null, clientX: number): void {
	const bar = (id: string, side: "left" | "right") =>
		document.querySelector(`[data-timeline-element-id="${CSS.escape(id)}"] [data-trim-bar="${side}"]`) as HTMLElement | null;
	const out = bar(cut.fromElementId, "right");
	const into = bar(cut.toElementId, "left");
	const marker = part?.parentElement?.getBoundingClientRect();
	const before = !!marker && clientX < marker.left + marker.width / 2;
	for (const [el, on] of [
		[out, !!part && before],
		[into, !!part && !before],
	] as const) {
		if (!el) continue;
		if (on) el.setAttribute("data-hover", "");
		else el.removeAttribute("data-hover");
	}
	// The marker may be drawn again under the pointer (an edit, an undo) and never see its pointer leave: the next move
	// anywhere off a «+» clears what it lit.
	if (part && !clearArmed) {
		clearArmed = true;
		const clear = (event: MouseEvent) => {
			if (event.type === "mousemove" && event.target instanceof Element && event.target.closest("[data-cut-to]")) return;
			for (const lit of document.querySelectorAll("[data-trim-bar][data-hover]")) lit.removeAttribute("data-hover");
			document.removeEventListener("mousemove", clear, true);
			clearArmed = false;
		};
		document.addEventListener("mousemove", clear, true);
	}
}
let clearArmed = false;
