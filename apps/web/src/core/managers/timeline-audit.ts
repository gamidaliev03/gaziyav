// Test runs only (the studio test hook sets globalThis.__gaziyavInvariants): after every step, ⌘Z and ⇧⌘Z the
// timeline's invariants (timeline/invariants.ts) are checked, an undo and a redo must give the timeline back byte for
// byte, and the track rows and the player's layers must keep the order of the tracks. The state is immutable, so a
// step keeps references and the checks run right after it (a timer): the edit itself pays nothing. What fails collects
// in globalThis.__gaziyavInvariantViolations; the test library reports it with the page's errors.
import type { EditorCore } from "@/core";
import type { LinkageKind } from "@/timeline/timeline-store";
import type { SceneTracks } from "@/timeline/types";
import {
	checkLinkedAudio,
	checkTimelineInvariants,
	describeStateDifference,
	timelineStateKey,
	type InvariantViolation,
} from "@/timeline/invariants";

type AuditScope = typeof globalThis & {
	__gaziyavInvariants?: boolean;
	__gaziyavInvariantViolations?: Array<InvariantViolation & { at: string }>;
};

export interface TimelineSnapshot {
	tracks: SceneTracks;
	bookmarks: unknown;
}

const KEPT = 200;

export function timelineAuditOn(): boolean {
	return !!(globalThis as AuditScope).__gaziyavInvariants;
}

export function snapshotTimeline(editor: EditorCore): TimelineSnapshot | null {
	const scene = editor.scenes.getActiveSceneOrNull();
	return scene ? { tracks: scene.tracks, bookmarks: scene.bookmarks } : null;
}

function report(found: InvariantViolation[], at: string): void {
	if (found.length === 0) return;
	const scope = globalThis as AuditScope;
	if (!scope.__gaziyavInvariantViolations) scope.__gaziyavInvariantViolations = [];
	const list = scope.__gaziyavInvariantViolations;
	for (const violation of found) if (list.length < KEPT) list.push({ ...violation, at });
}

const queue: Array<() => void> = [];
let flushing = false;
let rowsCheck: EditorCore | null = null;

function later(job: () => void): void {
	queue.push(job);
	if (flushing) return;
	flushing = true;
	setTimeout(() => {
		flushing = false;
		for (const next of queue.splice(0)) {
			try {
				next();
			} catch (error) {
				report([{ rule: "audit", detail: String(error) }], "audit");
			}
		}
	}, 0);
}

/** How many clips each track holds, top to bottom (main in brackets), and which scene: a report says what the step left. */
function shapeOf(editor: EditorCore, tracks: SceneTracks): string {
	const count = (list: { elements: unknown[] }[]) => list.map((track) => track.elements.length).join(",");
	const scene = editor.scenes.getActiveSceneOrNull();
	return `${count(tracks.overlay)} [${tracks.main.elements.length}] ${count(tracks.audio)}${scene && !scene.isMain ? ` in «${scene.name}»` : ""}`;
}

/** The rules a state holds on its own, as the step left it. */
export function auditState({ editor, at: step }: { editor: EditorCore; at: string }): void {
	const state = snapshotTimeline(editor);
	if (!state) return;
	const at = `${step} → ${shapeOf(editor, state.tracks)}`;
	const magnet = editor.command.isRippleEnabled;
	const { selectedElements, selectedKeyframes } = editor.selection.getSnapshot();
	const selection = { selectedElements: [...selectedElements], selectedKeyframes: [...selectedKeyframes] };
	later(() => report(checkTimelineInvariants({ tracks: state.tracks, magnet, selection }), at));
	scheduleOrderCheck(editor);
}

const same = (a: TimelineSnapshot, b: TimelineSnapshot) => a.tracks === b.tracks && a.bookmarks === b.bookmarks;

/**
 * ⌘Z / ⇧⌘Z: the timeline is the one the step started from (or made), byte for byte. `expected` lists what counts: an
 * undo may also give back the timeline the step before left — a step whose flow changed the timeline outside the
 * history before it ran (a copy shown under the pointer while ⌥-dragging) started from there. `unlessMoved`: the
 * timeline the step left (`from`) and the one ⌘Z found (`now`) — when something outside the history changed it in
 * between, there is nothing exact to compare with: counted in __gaziyavInvariantDrift, not reported.
 */
export function auditSame({
	expected,
	actual,
	rule,
	at,
	unlessMoved,
}: {
	expected: TimelineSnapshot[];
	actual: TimelineSnapshot | null;
	rule: string;
	at: string;
	unlessMoved?: { from: TimelineSnapshot; now: TimelineSnapshot };
}): void {
	if (!actual || expected.some((candidate) => same(actual, candidate))) return;
	later(() => {
		if (unlessMoved && !same(unlessMoved.from, unlessMoved.now) && timelineStateKey(unlessMoved.from) !== timelineStateKey(unlessMoved.now)) {
			const scope = globalThis as AuditScope & { __gaziyavInvariantDrift?: number };
			scope.__gaziyavInvariantDrift = (scope.__gaziyavInvariantDrift ?? 0) + 1;
			return;
		}
		const got = timelineStateKey(actual);
		const wants = expected.map(timelineStateKey);
		if (!wants.includes(got)) report([{ rule, detail: describeStateDifference(wants[0], got) }], at);
	});
}

/** Linkage kept the sound with its clip (see checkLinkedAudio). */
export function auditLinkedAudio({
	before,
	afterCommand,
	after,
	kinds,
	at,
}: {
	before: SceneTracks;
	afterCommand: SceneTracks;
	after: SceneTracks;
	kinds: LinkageKind[];
	at: string;
}): void {
	later(() => report(checkLinkedAudio({ before, afterCommand, after, kinds: new Set(kinds) }), at));
}

/**
 * Once the screen has the step: the track rows run top to bottom in the order of the tracks, and the player stacks
 * the layers the same way (the top row is the top layer).
 */
function scheduleOrderCheck(editor: EditorCore): void {
	if (typeof document === "undefined" || rowsCheck) return;
	rowsCheck = editor;
	requestAnimationFrame(() =>
		setTimeout(async () => {
			rowsCheck = null;
			const scene = editor.scenes.getActiveSceneOrNull();
			if (!scene) return;
			const { tracks } = scene;
			const order = [...tracks.overlay, tracks.main, ...tracks.audio].map((track) => track.id);
			const rows = [...document.querySelectorAll<HTMLElement>("[data-timeline-track-row]")]
				.map((row) => ({ id: row.dataset.timelineTrackRow ?? "", top: row.getBoundingClientRect().top, height: row.getBoundingClientRect().height }))
				.filter((row) => row.height > 0 && order.includes(row.id))
				.sort((a, b) => a.top - b.top)
				.map((row) => row.id);
			const expected = order.filter((id) => rows.includes(id));
			if (rows.join() !== expected.join()) {
				report([{ rule: "track-order", detail: `rows ${rows.map((id) => id.slice(0, 6)).join(",")} ≠ tracks ${expected.map((id) => id.slice(0, 6)).join(",")}` }], "screen");
			}
			// the player: at each overlay clip's start, the layers it stacks go from the main track up to overlay[0]
			const project = editor.project.getActiveOrNull();
			if (!project) return;
			const { getVisibleElementsWithBounds } = await import("@/preview/element-bounds");
			const layer = new Map([tracks.main, ...tracks.overlay.slice().reverse()].map((track, index) => [track.id, index]));
			const times = tracks.overlay.flatMap((track) => track.elements.map((element) => element.startTime)).slice(0, 12);
			for (const currentTime of times) {
				const stack = getVisibleElementsWithBounds({ tracks, currentTime, canvasSize: project.settings.canvasSize, mediaAssets: editor.media.getAssets() });
				const levels = stack.map((item) => layer.get(item.trackId) ?? -1);
				if (levels.some((level, i) => i > 0 && level < levels[i - 1])) {
					report([{ rule: "track-order", detail: `player layers at ${currentTime}: ${stack.map((item) => item.trackId.slice(0, 6)).join(",")}` }], "player");
					break;
				}
			}
		}, 0),
	);
}
