import { buildResizeMembers } from "@/timeline/group-resize/members";
import { hapticTrimLimit } from "@/haptics";
import { legacyTrim } from "@/timeline/trim/legacy-watch";
import type { MouseEvent as ReactMouseEvent } from "react";
import { BASE_TIMELINE_PIXELS_PER_SECOND } from "@/timeline/scale";
import {
	addMediaTime,
	type MediaTime,
	mediaTime,
	subMediaTime,
	TICKS_PER_SECOND,
} from "@/wasm";
import {
	computeGroupResize,
	type GroupResizeMember,
	type GroupResizeResult,
	type GroupResizeUpdate,
	type ResizeSide,
} from "@/timeline/group-resize";
import {
	buildTimelineSnapPoints,
	getTimelineSnapThresholdInTicks,
	resolveTimelineSnap,
	type SnapPoint,
} from "@/timeline/snapping";
import { getElementEdgeSnapPoints } from "@/timeline/element-snap-source";
import { getPlayheadSnapPoints } from "@/timeline/playhead-snap-source";
import { getMarkerSnapPoints } from "@/assist/snap";
import { getAnimationKeyframeSnapPointsForTimeline } from "@/timeline/animation-snap-points";
import {
	type SceneTracks,
	type TimelineElement,
	type TimelineTrack,
} from "@/timeline";
import type { ElementRef } from "@/timeline/types";
import type { FrameRate } from "opencut-wasm";

// --- Session ---

interface ResizeSession {
	kind: "active";
	side: ResizeSide;
	/** The clip whose edge was pressed, and whether ⌘ / ⇧ was held (a click selects it). */
	pressed: { trackId: string; elementId: string };
	additive: boolean;
	/** ⇧ alone: the click extends the selection from the anchor (timeline/selection-click.ts). */
	range: boolean;
	/** The farthest the pointer went from the press: a press that went away and came back is a drag, not a click. */
	maxDeltaX: number;
	startX: number;
	/** The tracks' scrollLeft at the press: the edge follows the time under the pointer while the view auto-scrolls. */
	startScrollLeft: number;
	/** The latest pointer x (edge auto-scroll speed). */
	lastClientX: number;
	fps: FrameRate;
	members: GroupResizeMember[];
	result: GroupResizeResult | null;
	/** The magnet's clips after the one being lengthened: they move along with its end (see onResizeStart). */
	followers: GroupResizeUpdate[];
	/** The magnet's head: the left edge pulled out grows the clip to the right, its start stays (see withFollowers). */
	pinHead: boolean;
}

type Session = { kind: "idle" } | ResizeSession;

// --- Config ---

export interface ResizeConfig {
	/** A press on an edge that ends without a drag is a click on the clip: it selects it (⌘ / ⇧ add it). */
	selectOnClick?: (ref: { trackId: string; elementId: string }, additive: boolean, range?: boolean) => void;
	zoomLevel: number;
	snappingEnabled: boolean;
	isShiftHeld: () => boolean;
	getSceneTracks: () => SceneTracks;
	getCurrentPlayheadTime: () => MediaTime;
	getActiveProjectFps: () => FrameRate | null;
	/** The tracks scroller's scrollLeft (0 when it isn't mounted). */
	getScrollLeft?: () => number;
	/** The magnetic track (the main track while the magnet is on), else null. */
	getRippleTrackId?: () => string | null;
	selectedElements: ElementRef[];
	discardPreview: () => void;
	previewElements: (updates: GroupResizeUpdate[]) => void;
	commitElements: (updates: GroupResizeUpdate[]) => void;
	onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
}

export interface ResizeConfigRef {
	readonly current: ResizeConfig;
}

// --- Pure helpers ---

// the edge bounds of a resize live with the resize math (group-resize/members.ts): a speed change fits by them too
export { buildResizeMembers };


function hasResizeChanges({
	members,
	result,
}: {
	members: GroupResizeMember[];
	result: GroupResizeResult;
}): boolean {
	return result.updates.some((update) => {
		const member = members.find((m) => m.elementId === update.elementId);
		return (
			member?.trimStart !== update.patch.trimStart ||
			member?.trimEnd !== update.patch.trimEnd ||
			member?.startTime !== update.patch.startTime ||
			member?.duration !== update.patch.duration
		);
	});
}

/**
 * The magnet's followers moved by how much the clip's end grew (only growth: a shorter clip is closed up on commit).
 * The head pulled out on the magnet track (CapCut: the trimmed-off start of a main clip comes back) keeps the clip's start
 * where it is, so it never overlaps the clip before it: the clip grows to the right and pushes the clips after it.
 */
export function withFollowers({
	session,
	result,
}: {
	session: Pick<ResizeSession, "members" | "followers" | "pinHead">;
	result: GroupResizeResult;
}): GroupResizeResult {
	const member = session.members[0];
	const found = result.updates.find((u) => u.elementId === member?.elementId);
	if (!member || !found) return result;
	let update = found;
	let updates = result.updates;
	if (session.pinHead) {
		const pulled = subMediaTime({ a: member.startTime, b: update.patch.startTime });
		if (pulled <= 0) return result;
		update = { ...found, patch: { ...found.patch, startTime: member.startTime } };
		updates = result.updates.map((u) => (u === found ? update : u));
	}
	if (!session.followers.length) return updates === result.updates ? result : { ...result, updates };
	const before = addMediaTime({ a: member.startTime, b: member.duration });
	const after = addMediaTime({ a: update.patch.startTime, b: update.patch.duration });
	const growth = subMediaTime({ a: after, b: before });
	if (growth <= 0) return updates === result.updates ? result : { ...result, updates };
	return {
		...result,
		updates: [
			...updates,
			...session.followers.map((f) => ({ ...f, patch: { ...f.patch, startTime: addMediaTime({ a: f.patch.startTime, b: growth }) } })),
		],
	};
}

// --- Controller ---

export class ResizeController {
	private session: Session = { kind: "idle" };
	private readonly subscribers = new Set<() => void>();
	private readonly configRef: ResizeConfigRef;

	constructor(deps: { configRef: ResizeConfigRef }) {
		this.configRef = deps.configRef;
		this.onResizeStart = this.onResizeStart.bind(this);
		this.handleMouseMove = this.handleMouseMove.bind(this);
		this.handleMouseUp = this.handleMouseUp.bind(this);
	}

	private get config(): ResizeConfig {
		return this.configRef.current;
	}

	get isResizing(): boolean {
		return this.session.kind === "active";
	}

	/** Pointer x of the trim in progress (0 when idle). */
	getLastClientX(): number {
		return this.session.kind === "active" ? this.session.lastClientX : 0;
	}

	subscribe(fn: () => void): () => void {
		this.subscribers.add(fn);
		return () => this.subscribers.delete(fn);
	}

	cancel(): void {
		this.config.discardPreview();
		this.finishSession();
	}

	destroy(): void {
		this.deactivate();
		this.subscribers.clear();
	}

	onResizeStart({
		event,
		element,
		track,
		side,
	}: {
		event: ReactMouseEvent;
		element: TimelineElement;
		track: TimelineTrack;
		side: ResizeSide;
	}): void {
		event.stopPropagation();
		event.preventDefault();

		// UI should prevent this, but be explicit: a new resize start
		// means the previous one is abandoned, not silently replaced.
		if (this.session.kind === "active") this.cancel();

		const fps = this.config.getActiveProjectFps();
		if (!fps) return;

		const ref = { trackId: track.id, elementId: element.id };
		const activeSelection = this.config.selectedElements.some(
			(el) => el.trackId === track.id && el.elementId === element.id,
		)
			? this.config.selectedElements
			: [ref];

		const tracks = this.config.getSceneTracks();
		// The pressed clip first: its edge is the one put on a frame (computeGroupResize's anchor).
		const members = buildResizeMembers({
			tracks,
			selectedElements: activeSelection,
		}).sort((a, b) => Number(b.elementId === element.id) - Number(a.elementId === element.id));
		if (members.length === 0) return;

		// The magnet (CapCut's main track): lengthening a clip pushes the clips after it instead of stopping at the next
		// one. Shortening needs nothing here: the gap it leaves closes when the edit is committed.
		let followers: GroupResizeUpdate[] = [];
		let pinHead = false;
		const rippleTrackId = this.config.getRippleTrackId?.() ?? null;
		const only = members.length === 1 ? members[0] : null;
		if (only && only.trackId === rippleTrackId) {
			const end = addMediaTime({ a: only.startTime, b: only.duration });
			const track = [...tracks.overlay, tracks.main, ...tracks.audio].find((t) => t.id === only.trackId);
			followers = (track?.elements ?? [])
				.filter((el) => el.id !== only.elementId && el.startTime >= end)
				.map((el) => ({
					trackId: only.trackId,
					elementId: el.id,
					patch: { trimStart: el.trimStart, trimEnd: el.trimEnd, startTime: el.startTime, duration: el.duration },
				}));
			if (side === "right") only.rightNeighborBound = null;
			else {
				only.leftNeighborBound = null;
				only.leftUnbounded = true;
				pinHead = true;
			}
		}

		this.config.discardPreview();

		this.session = {
			kind: "active",
			side,
			pressed: ref,
			// ⌃ is the Mac's right click, not «add to the selection»
			additive: event.metaKey || event.shiftKey,
			range: event.shiftKey && !event.metaKey,
			maxDeltaX: 0,
			startX: event.clientX,
			startScrollLeft: this.config.getScrollLeft?.() ?? 0,
			lastClientX: event.clientX,
			fps,
			members,
			result: null,
			followers,
			pinHead,
		};
		this.activate();
		this.notify();
		// the player shows the two frames of this cut while the edge is in the hand (timeline/trim)
		legacyTrim.start({ trackId: track.id, elementId: element.id, side });
	}

	private activate(): void {
		document.addEventListener("mousemove", this.handleMouseMove);
		document.addEventListener("mouseup", this.handleMouseUp);
	}

	private deactivate(): void {
		document.removeEventListener("mousemove", this.handleMouseMove);
		document.removeEventListener("mouseup", this.handleMouseUp);
	}

	private notify(): void {
		for (const fn of this.subscribers) fn();
	}

	private finishSession(): void {
		legacyTrim.end();
		hapticTrimLimit(false);
		this.session = { kind: "idle" };
		this.deactivate();
		this.config.onSnapPointChange?.(null);
		this.notify();
	}

	private snappedDelta({
		session,
		rawDeltaTime,
	}: {
		session: ResizeSession;
		rawDeltaTime: MediaTime;
	}): { deltaTime: MediaTime; exact: boolean } {
		const { snappingEnabled, isShiftHeld, zoomLevel } = this.config;

		if (!snappingEnabled || isShiftHeld()) {
			this.config.onSnapPointChange?.(null);
			return { deltaTime: rawDeltaTime, exact: false };
		}

		const tracks = this.config.getSceneTracks();
		const playheadTime = this.config.getCurrentPlayheadTime();
		const excludeElementIds = new Set(session.members.map((m) => m.elementId));

		const snapPoints = buildTimelineSnapPoints({
			sources: [
				() => getElementEdgeSnapPoints({ tracks, excludeElementIds }),
				() => getPlayheadSnapPoints({ playheadTime }),
				getMarkerSnapPoints, // assist6: clips snap to markers (beat markers)
				() =>
					getAnimationKeyframeSnapPointsForTimeline({
						tracks,
						excludeElementIds,
					}),
			],
		});
		const maxSnapDistance = getTimelineSnapThresholdInTicks({ zoomLevel });

		let closestSnapPoint: SnapPoint | null = null;
		let closestSnapDistance = Infinity;
		let deltaTime = rawDeltaTime;

		for (const member of session.members) {
			const baseEdgeTime =
				session.side === "left"
					? member.startTime
					: addMediaTime({ a: member.startTime, b: member.duration });
			const snapResult = resolveTimelineSnap({
				targetTime: addMediaTime({ a: baseEdgeTime, b: rawDeltaTime }),
				snapPoints,
				maxSnapDistance,
			});
			if (
				snapResult.snapPoint &&
				snapResult.snapDistance < closestSnapDistance
			) {
				closestSnapDistance = snapResult.snapDistance;
				closestSnapPoint = snapResult.snapPoint;
				deltaTime = subMediaTime({ a: snapResult.snappedTime, b: baseEdgeTime });
			}
		}

		this.config.onSnapPointChange?.(closestSnapPoint);
		return { deltaTime, exact: closestSnapPoint !== null };
	}

	private handleMouseMove({ clientX }: MouseEvent): void {
		this.dragTo(clientX);
	}

	/** The trim with the pointer at `clientX` (a move, or the release's own position). */
	private dragTo(clientX: number): void {
		if (this.session.kind !== "active") return;
		const session = this.session;

		session.lastClientX = clientX;
		session.maxDeltaX = Math.max(session.maxDeltaX, Math.abs(clientX - session.startX));
		const scrolledPx = (this.config.getScrollLeft?.() ?? 0) - session.startScrollLeft;
		const rawDeltaTime = mediaTime({
			ticks: Math.round(
				((clientX - session.startX + scrolledPx) /
					(BASE_TIMELINE_PIXELS_PER_SECOND * this.config.zoomLevel)) *
					TICKS_PER_SECOND,
			),
		});
		const { deltaTime, exact } = this.snappedDelta({ session, rawDeltaTime });
		const result = computeGroupResize({
			members: session.members,
			side: session.side,
			deltaTime,
			fps: session.fps,
			exact,
		});

		hapticTrimLimit(result.limited === true); // a tap as the trim reaches its end (haptics)
		session.result = withFollowers({ session, result });
		this.config.previewElements(session.result.updates);
	}

	private handleMouseUp(event?: MouseEvent): void {
		if (this.session.kind !== "active") return;
		// The release commits from its own position (the last move may lie before it): tlc C1b. (A synthetic release
		// with no position — clientX 0 — keeps the last move's, as the trim pointer does.)
		if (event?.clientX && event.clientX !== this.session.lastClientX) this.dragTo(event.clientX);
		const session = this.session;

		this.config.discardPreview();

		if (
			session.result &&
			hasResizeChanges({ members: session.members, result: session.result })
		) {
			this.config.commitElements(session.result.updates);
		} else if (session.maxDeltaX < 3) {
			// CapCut: a click on a clip's edge selects the clip like a click on its body (it did nothing, and the
			// clip that was selected lost its selection).
			this.config.selectOnClick?.(session.pressed, session.additive, session.range);
		}

		this.finishSession();
	}
}
