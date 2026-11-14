// Removes time ranges from the whole timeline (jump cuts): every clip, caption and overlay that crosses a
// range is cut there, the pieces inside are dropped and everything after moves left — so captions stay in
// sync with the speech. Music beds from the library are never chopped (they only follow the edit when they
// start after a cut). One command → one ⌘Z; redo restores exactly the same pieces (stable ids).
import { Command, type CommandResult } from "@/commands/base-command";
import { BatchCommand } from "@/commands/batch-command";
import { EditorCore } from "@/core";
import { splitAnimationsAtTime } from "@/animation";
import { getSourceSpanAtClipTime } from "@/retime";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline";
import { isRetimableElement } from "@/timeline";
import { generateUUID } from "@/utils/id";
import { roundMediaTime } from "@/wasm";

export interface TickRange {
	start: number;
	end: number;
}

/** Pieces shorter than this (ticks) are dropped rather than left as slivers. */
const MIN_PIECE_FRACTION_OF_SECOND = 1 / 30;

const isMusicBed = (el: TimelineElement) => el.type === "audio" && el.sourceType === "library";

/** Ticks of the ranges removed before time t (ranges sorted, non-overlapping). */
function removedBefore(ranges: TickRange[], t: number): number {
	let sum = 0;
	for (const r of ranges) {
		if (r.end <= t) sum += r.end - r.start;
		else if (r.start < t) sum += t - r.start;
		else break;
	}
	return sum;
}

/** The visible pieces of [start, end) once the ranges are taken out. */
function keptPieces(start: number, end: number, ranges: TickRange[]): TickRange[] {
	const pieces: TickRange[] = [];
	let cursor = start;
	for (const r of ranges) {
		if (r.end <= cursor) continue;
		if (r.start >= end) break;
		if (r.start > cursor) pieces.push({ start: cursor, end: Math.min(r.start, end) });
		cursor = Math.max(cursor, r.end);
		if (cursor >= end) break;
	}
	if (cursor < end) pieces.push({ start: cursor, end });
	return pieces;
}

/**
 * The edges of a piece: the clip's own fade in / In animation stays on its first piece only, the fade out / Out
 * animation on its last (every piece used to fade at every jump cut); an edge made by a cut gets `seamFade` seconds of
 * sound fade (no click), when given.
 */
function pieceEdges<T extends TimelineElement>(el: T, piece: T, headCut: boolean, tailCut: boolean, seamFade: number): T {
	if (!headCut && !tailCut) return piece;
	const params = { ...((el.params ?? {}) as Record<string, unknown>) };
	const sound = el.type === "video" || el.type === "audio";
	if (headCut) {
		if (sound) params.fadeIn = seamFade;
		if (params["anim.in"] !== undefined && params["anim.in"] !== "none") params["anim.in"] = "none";
	}
	if (tailCut) {
		if (sound) params.fadeOut = seamFade;
		if (params["anim.out"] !== undefined && params["anim.out"] !== "none") params["anim.out"] = "none";
	}
	return { ...piece, params } as T;
}

function cutElement<T extends TimelineElement>(el: T, ranges: TickRange[], minPiece: number, seamFade = 0): T[] {
	const start = el.startTime as number;
	const end = start + (el.duration as number);
	const crossing = ranges.some((r) => r.start < end && r.end > start);
	// Music is never chopped: it only moves with its start.
	if (!crossing || isMusicBed(el)) {
		const shift = removedBefore(ranges, start);
		return [shift ? ({ ...el, startTime: roundMediaTime({ time: start - shift }) } as T) : el];
	}
	const retime = isRetimableElement(el) ? el.retime : undefined;
	const totalSource = roundMediaTime({ time: getSourceSpanAtClipTime({ clipTime: el.duration, retime }) }) as number;
	const pieces = keptPieces(start, end, ranges).filter((p) => p.end - p.start >= minPiece);
	return pieces.map((p, index) => {
		const headCut = p.start > start;
		const tailCut = p.end < end;
		const offset = p.start - start;
		const length = p.end - p.start;
		const sourceBefore = roundMediaTime({ time: getSourceSpanAtClipTime({ clipTime: offset, retime }) }) as number;
		const sourceLength = roundMediaTime({ time: getSourceSpanAtClipTime({ clipTime: length, retime }) }) as number;
		const sourceAfter = Math.max(0, totalSource - sourceBefore - sourceLength);
		const { rightAnimations } = splitAnimationsAtTime({
			animations: el.animations,
			splitTime: roundMediaTime({ time: offset }),
			shouldIncludeSplitBoundary: true,
		});
		const { leftAnimations } = splitAnimationsAtTime({
			animations: rightAnimations,
			splitTime: roundMediaTime({ time: length }),
			shouldIncludeSplitBoundary: true,
		});
		const piece = {
			...el,
			id: index === 0 ? el.id : generateUUID(),
			startTime: roundMediaTime({ time: p.start - removedBefore(ranges, p.start) }),
			duration: roundMediaTime({ time: length }),
			trimStart: roundMediaTime({ time: (el.trimStart as number) + sourceBefore }),
			trimEnd: roundMediaTime({ time: (el.trimEnd as number) + sourceAfter }),
			animations: leftAnimations,
		} as T;
		return pieceEdges(el, piece, headCut, tailCut, seamFade);
	});
}

function cutTrack<T extends TimelineTrack>(track: T, ranges: TickRange[], minPiece: number, seamFade = 0): T {
	const elements = (track.elements as TimelineElement[]).flatMap((el) => cutElement(el, ranges, minPiece, seamFade));
	return { ...track, elements } as T;
}

/** Normalizes ranges: sorted, merged, clipped to ≥ 0. */
export function normalizeRanges(ranges: TickRange[]): TickRange[] {
	const sorted = ranges
		.map((r) => ({ start: Math.max(0, Math.round(r.start)), end: Math.round(r.end) }))
		.filter((r) => r.end > r.start)
		.sort((a, b) => a.start - b.start);
	const out: TickRange[] = [];
	for (const r of sorted) {
		const last = out[out.length - 1];
		if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
		else out.push({ ...r });
	}
	return out;
}

/** `seamFade`: seconds of sound fade on both sides of every cut (Claude's seamless cuts: 0.01). */
export function removeRangesFromTracks(tracks: SceneTracks, ranges: TickRange[], ticksPerSecond: number, seamFade = 0): SceneTracks {
	const clean = normalizeRanges(ranges);
	if (clean.length === 0) return tracks;
	const minPiece = ticksPerSecond * MIN_PIECE_FRACTION_OF_SECOND;
	return {
		overlay: tracks.overlay.map((t) => cutTrack(t, clean, minPiece, seamFade)),
		main: cutTrack(tracks.main, clean, minPiece, seamFade),
		audio: tracks.audio.map((t) => cutTrack(t, clean, minPiece, seamFade)),
	};
}

class RemoveRangesCommand extends Command {
	private before: SceneTracks | null = null;
	private after: SceneTracks | null = null;

	constructor(
		private readonly ranges: TickRange[],
		private readonly ticksPerSecond: number,
		private readonly seamFade = 0,
	) {
		super();
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.before = editor.scenes.getActiveScene().tracks;
		this.after = removeRangesFromTracks(this.before, this.ranges, this.ticksPerSecond, this.seamFade);
		editor.timeline.updateTracks(this.after);
		return {
			selection: { selectedElements: [], selectedKeyframes: [], keyframeSelectionAnchor: null, selectedMaskPoints: null },
		};
	}

	undo(): void {
		if (this.before) EditorCore.getInstance().timeline.updateTracks(this.before);
	}

	redo(): CommandResult | undefined {
		if (!this.after) return this.execute();
		EditorCore.getInstance().timeline.updateTracks(this.after);
		return undefined;
	}
}

/**
 * Cuts the given seconds ranges out of the timeline as one ⌘Z and returns the resulting tracks (to check
 * later that nothing else changed before undoing or re-applying).
 */
export function applyCuts(editor: EditorCore, cuts: { start: number; end: number }[], ticksPerSecond: number, seamFade = 0): SceneTracks {
	const ranges = cuts.map((c) => ({ start: c.start * ticksPerSecond, end: c.end * ticksPerSecond }));
	const ripple = editor.command.isRippleEnabled;
	// The command closes the gaps itself; ripple mode must not shift things a second time.
	editor.command.isRippleEnabled = false;
	try {
		editor.command.execute({ command: removeRangesCommand(ranges, ticksPerSecond, seamFade) });
	} finally {
		editor.command.isRippleEnabled = ripple;
	}
	return editor.scenes.getActiveScene().tracks;
}

/** The whole edit as one BatchCommand (one ⌘Z). Ranges in ticks. */
export function removeRangesCommand(ranges: TickRange[], ticksPerSecond: number, seamFade = 0): BatchCommand {
	return new BatchCommand([new RemoveRangesCommand(ranges, ticksPerSecond, seamFade)]);
}
