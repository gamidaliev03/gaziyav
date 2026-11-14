import { applyLinkage } from "@/timeline/linkage";
import type { LinkageKind } from "@/timeline/timeline-store";
import type { EditorCore } from "@/core";
import type { Command, CommandResult } from "@/commands";
import type { EditorSelectionSnapshot } from "@/selection/editor-selection";
import { applyRippleAdjustments, computeRippleAdjustments } from "@/ripple";
import type { SceneTracks } from "@/timeline/types";
import { withStableIds } from "@/utils/id";
import { lockedTracksChanged } from "@/timeline/track-lock";
import { toast } from "sonner";
import { t as translate } from "@/i18n";
import { packMainTrack, separateOverlaps } from "@/timeline/placement/main-track";
import { dropFit, endedByHand, followFilm, restoreFitted, snapshotFitted, type FitSnapshot } from "@/timeline/placement/fit-film";
import { auditLinkedAudio, auditSame, auditState, snapshotTimeline, timelineAuditOn, type TimelineSnapshot } from "./timeline-audit";
import { rideBookmarks } from "@/ripple/markers";
import { holdLockedTracks } from "@/ripple/locked";
import { updateSceneInArray } from "@/timeline/scenes";
import type { Bookmark } from "@/timeline/types";
import { TICKS_PER_SECOND } from "@/wasm";

interface CommandHistoryEntry {
	command: Command;
	previousSelection: EditorSelectionSnapshot;
	selectionOverride?: EditorSelectionSnapshot;
	/** Ids minted during the first execute, replayed on redo. */
	ids: string[];
	/** The magnet as it was when the edit was made: redo repeats that edit, whatever the magnet is now. */
	ripple?: RippleMode;
	/** Linkage as it was (same reason). */
	linkage?: LinkageMode;
	/**
	 * The magnet before and after the step (docs/TIMELINE.md O1): ⌘Z gives back the magnet of the state it returns to and
	 * ⇧⌘Z the one after, so a gap a step made with the magnet off never comes back under the magnet on.
	 */
	magnet?: { before: boolean; after: boolean };
	/** Test runs: the timeline before and after the step, which ⌘Z and ⇧⌘Z must give back byte for byte. */
	audit?: { before: TimelineSnapshot; after: TimelineSnapshot };
	/** The timeline the step was made on: ⌘Z / ⇧⌘Z open it again first, or they would rewrite the one open now. */
	sceneId?: string | null;
	/** The markers the step moved with the film (blind3 F4, ripple/markers.ts): ⌘Z gives `before` back, ⇧⌘Z `after`. */
	markers?: { before: Bookmark[]; after: Bookmark[] };
	selectionAfter?: EditorSelectionSnapshot;
	/** Rule D: the songs fitted to the film as they were before the step — ⌘Z gives them back exactly (fit-film.ts). */
	fitBefore?: FitSnapshot;
}

/** CapCut's Linkage: the kinds of items over a main-track clip that move and go with it. */
export interface LinkageMode {
	enabled: boolean;
	kinds: LinkageKind[];
}

interface RippleMode {
	enabled: boolean;
	mainOnly: boolean;
}

export type HistoryFailureListener = (failure: {
	kind: "undo" | "redo";
	error: unknown;
}) => void;

export class CommandManager {
	public isRippleEnabled = false;
	/** Ripple closes gaps on the main track only (CapCut's main-track magnet); overlays and audio keep their gaps. */
	public rippleMainTrackOnly = true;
	/** Set from the timeline's Linkage button and its settings (EditorRuntimeBindings). */
	public linkage: LinkageMode = { enabled: false, kinds: [] };
	private history: CommandHistoryEntry[] = [];
	private redoStack: CommandHistoryEntry[] = [];
	private reactors: Array<() => void> = [];
	private failureListeners = new Set<HistoryFailureListener>();
	private historyListeners = new Set<() => void>();
	private magnetListeners = new Set<(on: boolean) => void>();
	private lockedListeners = new Set<(count: number) => void>();

	constructor(private editor: EditorCore) {}

	execute({ command }: { command: Command }): Command {
		// Stored with the step, so its redo ripples the same way. A command that closes the gap itself (Extract
		// In–Out) gets no ripple on top: the clips after it moved twice.
		const ripple = command.ripplesItself ? { ...this.currentRipple(), enabled: false } : this.currentRipple();
		const linkage: LinkageMode = { enabled: this.linkage.enabled, kinds: [...this.linkage.kinds] };
		// Always kept: captions follow their speech even with Linkage off (applyLinkageIfEnabled).
		const tracksAtStart = this.editor.scenes.getActiveSceneOrNull()?.tracks ?? null;
		const beforeTracks = ripple.enabled ? tracksAtStart : null;
		const previousSelection = this.getSelectionSnapshot();
		const audited = timelineAuditOn() ? snapshotTimeline(this.editor) : null;
		const sceneAtStart = this.editor.scenes.getActiveSceneOrNull();
		const sceneId = sceneAtStart?.id ?? null;
		const stepStart = this.getTracksOrNull();
		const magnetBefore = this.isRippleEnabled;
		const bookmarksAtStart = sceneAtStart?.bookmarks;
		const fitBefore = snapshotFitted(stepStart);
		const ids: string[] = [];
		const result = withStableIds({ ids, fn: () => command.execute() });
		// A locked track takes no edit, whatever path the step came by (Q / W, paste, a menu, the connector): the step
		// is taken back whole, nothing enters the history, and the user is told why (tlc2, register A1).
		const made = this.getTracksOrNull();
		if (stepStart && made && made !== stepStart && lockedTracksChanged(stepStart, made).length > 0) {
			this.restoreTracks(stepStart);
			this.editor.selection.restoreSnapshot({ snapshot: previousSelection });
			if (this.isRippleEnabled !== magnetBefore) this.restoreMagnet(magnetBefore);
			toast.info(translate("The track is locked: unlock it to edit its clips"), { id: "locked-track" });
			return command;
		}
		const afterCommand = audited ? made : null;
		const fitEnded = endedByHand(stepStart, made);
		this.applyRippleIfEnabled({ beforeTracks, ripple });
		this.packMainIfMagnet({ beforeTracks, ripple });
		this.applyLinkageIfEnabled({ beforeTracks: tracksAtStart, linkage });
		this.separateIfOverlapping(stepStart);
		const leftBehind = this.holdLocked({ before: stepStart, made });
		const markers = this.rideMarkers({ before: stepStart, sceneId, bookmarksAtStart });
		this.musicFollowsFilm(stepStart, fitEnded);
		const selectionOverride = this.applySelectionOverride(result);
		this.runReactors();
		this.keepSelectionPresent();
		const finished = audited ? snapshotTimeline(this.editor) : null;
		// A step that left the open timeline as it was (the format, a media import) has no timeline to go back to.
		const touched = this.editor.scenes.getActiveSceneOrNull() !== sceneAtStart;
		this.history.push({
			command,
			previousSelection,
			selectionOverride,
			ids,
			ripple,
			linkage,
			magnet: { before: magnetBefore, after: this.isRippleEnabled },
			audit: audited && finished ? { before: audited, after: finished } : undefined,
			sceneId: touched ? sceneId : null,
			markers,
			selectionAfter: this.getSelectionSnapshot(),
			fitBefore,
		});
		this.redoStack = [];
		this.notifyHistory();
		if (leftBehind > 0) for (const listener of this.lockedListeners) listener(leftBehind);
		if (audited) this.audit({ at: `do ${command.constructor.name}`, before: audited, afterCommand, after: finished, linkage });
		return command;
	}

	/** Test runs: the step's state, and the sound linkage kept with its clips. */
	private audit({
		at,
		before,
		afterCommand,
		after,
		linkage,
	}: {
		at: string;
		before: TimelineSnapshot | null;
		afterCommand: SceneTracks | null;
		after: TimelineSnapshot | null;
		linkage: LinkageMode;
	}): void {
		auditState({ editor: this.editor, at });
		if (linkage.enabled && before && afterCommand && after) {
			auditLinkedAudio({ before: before.tracks, afterCommand, after: after.tracks, kinds: linkage.kinds, at });
		}
	}

	push({ command }: { command: Command }): void {
		this.history.push({
			command,
			previousSelection: this.getSelectionSnapshot(),
			ids: [],
			// A pushed step is a finished snapshot (no ripple was run for it): redo must not add one either.
			ripple: { enabled: false, mainOnly: this.rippleMainTrackOnly },
			magnet: { before: this.isRippleEnabled, after: this.isRippleEnabled },
			sceneId: this.activeSceneId(),
		});
		this.redoStack = [];
		this.keepSelectionPresent();
		this.notifyHistory();
		if (timelineAuditOn()) auditState({ editor: this.editor, at: `push ${command.constructor.name}` });
	}

	/**
	 * Undo/redo became possible or impossible (a step done, undone, redone, the history cleared). The steps are
	 * recorded after the stores have notified, so a selector of `canUndo()` would read the old answer.
	 */
	subscribeHistory(listener: () => void): () => void {
		this.historyListeners.add(listener);
		return () => this.historyListeners.delete(listener);
	}

	/**
	 * The magnet set back by ⌘Z / ⇧⌘Z (O1): the timeline's button follows (EditorRuntimeBindings). Never a step of its
	 * own, and never a packing: the state it comes back with is the one that magnet made.
	 */
	onMagnetRestored(listener: (on: boolean) => void): () => void {
		this.magnetListeners.add(listener);
		return () => {
			this.magnetListeners.delete(listener);
		};
	}

	/**
	 * A step left items on locked tracks behind while the clips under them moved (blind3 rule 7): the timeline says so
	 * in one line (EditorRuntimeBindings). Called with how many.
	 */
	onLockedLeftBehind(listener: (count: number) => void): () => void {
		this.lockedListeners.add(listener);
		return () => {
			this.lockedListeners.delete(listener);
		};
	}

	/** Locked tracks as the command made them: the engine's ripple, packing and Linkage never move them (ripple/locked.ts). */
	private holdLocked({ before, made }: { before: SceneTracks | null; made: SceneTracks | null }): number {
		const after = this.getTracksOrNull();
		if (!before || !made || !after || after === before) return 0;
		const { tracks, leftBehind } = holdLockedTracks({ before, made, after });
		if (tracks !== after) this.editor.timeline.updateTracks(tracks);
		return leftBehind;
	}

	/** Markers ride with the film the step moved (ripple/markers.ts); returns what to keep with the step. */
	private rideMarkers({
		before,
		sceneId,
		bookmarksAtStart,
	}: {
		before: SceneTracks | null;
		sceneId: string | null;
		bookmarksAtStart: Bookmark[] | undefined;
	}): { before: Bookmark[]; after: Bookmark[] } | undefined {
		const scene = this.editor.scenes.getActiveSceneOrNull();
		// a step that moved the markers itself (a scene moved with its marks) is left as it made them
		if (!scene || !before || scene.id !== sceneId || !bookmarksAtStart?.length || scene.bookmarks !== bookmarksAtStart) return undefined;
		if (before.main.id !== scene.tracks.main.id) return undefined;
		const fps = this.editor.project.getActiveOrNull?.()?.settings.fps;
		const next = rideBookmarks({
			before: before.main,
			after: scene.tracks.main,
			bookmarks: bookmarksAtStart,
			frameTicks: fps ? (TICKS_PER_SECOND * fps.denominator) / fps.numerator : undefined,
		});
		if (!next) return undefined;
		this.setBookmarks(next);
		return { before: bookmarksAtStart, after: next };
	}

	private setBookmarks(bookmarks: Bookmark[]): void {
		const scene = this.editor.scenes.getActiveSceneOrNull();
		if (!scene || scene.bookmarks === bookmarks) return;
		this.editor.scenes.setScenes({ scenes: updateSceneInArray({ scenes: this.editor.scenes.getScenes(), sceneId: scene.id, updates: { bookmarks } }) });
	}

	private restoreMagnet(on: boolean | undefined): void {
		if (on === undefined || on === this.isRippleEnabled) return;
		this.isRippleEnabled = on;
		for (const listener of this.magnetListeners) listener(on);
	}

	private notifyHistory(): void {
		for (const listener of this.historyListeners) listener();
	}

	/** Called when undo/redo throws; the timeline is rolled back first. */
	onHistoryFailure(listener: HistoryFailureListener): () => void {
		this.failureListeners.add(listener);
		return () => this.failureListeners.delete(listener);
	}

	registerReactor(reactor: () => void): void {
		this.reactors.push(reactor);
	}

	undo(): void {
		if (this.history.length === 0) return;
		const entry = this.history.pop();
		if (entry) {
			this.openSceneOf(entry);
			const tracksBefore = this.getTracksOrNull();
			const audited = timelineAuditOn() ? snapshotTimeline(this.editor) : null;
			const playhead = this.editor.playback.getCurrentTime();
			try {
				entry.command.undo();
				this.restoreFitted(entry.fitBefore);
			} catch (error) {
				// A broken entry must not take the editor down or leave the
				// timeline half-reverted: roll back and drop the entry.
				this.restoreTracks(tracksBefore);
				this.redoStack = [];
				this.reportFailure({ kind: "undo", error });
				this.notifyHistory();
				return;
			}
			// Only restore selection for commands that explicitly changed it.
			// Commands without selection intent leave selection untouched,
			// preserving any UI-driven selection changes (clicks, box select)
			// that happened between commands. Commands that remove editor-owned
			// selection targets must declare a selection override to clear stale refs.
			// never an item the step did not touch (blind1 S3-3: a caption got selected after ⌘Z of a drop). Commands that
			// declared no selection used to leave it as it was.
			this.editor.selection.restoreSnapshot({ snapshot: entry.previousSelection });
			if (entry.markers) this.setBookmarks(entry.markers.before);
			this.restoreMagnet(entry.magnet?.before);
			this.redoStack.push(entry);
			this.keepSelectionPresent();
			this.keepPlayhead(entry, playhead);
			if (audited) {
				const at = `undo ${entry.command.constructor.name}`;
				if (entry.audit) {
					const below = this.history[this.history.length - 1]?.audit?.after;
					auditSame({ expected: below ? [entry.audit.before, below] : [entry.audit.before], actual: snapshotTimeline(this.editor), rule: "undo-exact", at, unlessMoved: { from: entry.audit.after, now: audited } });
				}
				auditState({ editor: this.editor, at });
			}
		}
		this.notifyHistory();
	}

	redo(): void {
		if (this.redoStack.length === 0) return;
		const entry = this.redoStack.pop();
		if (!entry) {
			return;
		}

		this.openSceneOf(entry);
		const tracksBefore = this.getTracksOrNull();
		const fitBefore = snapshotFitted(tracksBefore);
		const playhead = this.editor.playback.getCurrentTime();
		const ripple = entry.ripple ?? this.currentRipple();
		const linkage = entry.linkage ?? { enabled: false, kinds: [] };
		const beforeTracks = ripple.enabled ? tracksBefore : null;
		const previousSelection = this.getSelectionSnapshot();
		const audited = timelineAuditOn() ? snapshotTimeline(this.editor) : null;
		let result: CommandResult | undefined;
		let afterCommand: SceneTracks | null = null;
		let redone: SceneTracks | null = null;
		try {
			result = withStableIds({
				ids: entry.ids,
				fn: () => entry.command.redo(),
			});
			redone = this.getTracksOrNull();
			afterCommand = audited ? redone : null;
		} catch (error) {
			this.restoreTracks(tracksBefore);
			this.redoStack = [];
			this.reportFailure({ kind: "redo", error });
			this.notifyHistory();
			return;
		}
		const fitEnded = endedByHand(tracksBefore, this.getTracksOrNull());
		this.applyRippleIfEnabled({ beforeTracks, ripple });
		this.packMainIfMagnet({ beforeTracks, ripple });
		this.applyLinkageIfEnabled({ beforeTracks: tracksBefore, linkage });
		this.separateIfOverlapping(tracksBefore);
		this.holdLocked({ before: tracksBefore, made: redone });
		if (entry.markers) this.setBookmarks(entry.markers.after);
		this.musicFollowsFilm(tracksBefore, fitEnded);
		const selectionOverride = this.applySelectionOverride(result);
		// Rule E: ⇧⌘Z gives back the selection the step left (not what was clicked between ⌘Z and ⇧⌘Z).
		if (entry.selectionAfter) this.editor.selection.restoreSnapshot({ snapshot: entry.selectionAfter });
		this.runReactors();
		this.keepSelectionPresent();
		this.keepPlayhead(entry, playhead);
		this.restoreMagnet(entry.magnet?.after);
		const made = audited ? snapshotTimeline(this.editor) : null;

		this.history.push({
			command: entry.command,
			previousSelection,
			selectionOverride,
			ids: entry.ids,
			ripple,
			linkage,
			magnet: entry.magnet,
			audit: audited && made ? { before: audited, after: made } : undefined,
			sceneId: entry.sceneId,
			markers: entry.markers,
			selectionAfter: entry.selectionAfter ?? this.getSelectionSnapshot(),
			fitBefore,
		});
		this.notifyHistory();
		if (audited) {
			const at = `redo ${entry.command.constructor.name}`;
			if (entry.audit) auditSame({ expected: [entry.audit.after], actual: made, rule: "redo-exact", at, unlessMoved: { from: entry.audit.before, now: audited } });
			this.audit({ at, before: audited, afterCommand, after: made, linkage });
		}
	}

	/** How many steps ⌘Z can take back (Gaziyav AI undoes exactly its own turn). */
	depth(): number {
		return this.history.length;
	}

	canUndo(): boolean {
		return this.history.length > 0;
	}

	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	clear(): void {
		this.history = [];
		this.redoStack = [];
		this.notifyHistory();
	}

	/**
	 * fit-film.ts); those the step moved or trimmed by hand leave the relation. Part of the step: ⌘Z gives them back.
	 */
	private musicFollowsFilm(before: SceneTracks | null, ended: string[]): void {
		const tracks = this.getTracksOrNull();
		if (!tracks || tracks === before) return;
		const next = followFilm(dropFit(tracks, ended));
		if (next !== tracks) this.editor.timeline.updateTracks(next);
	}

	private restoreFitted(snapshot: FitSnapshot | undefined): void {
		const tracks = this.getTracksOrNull();
		if (!tracks || !snapshot || snapshot.size === 0) return;
		const next = restoreFitted(tracks, snapshot);
		if (next !== tracks) this.editor.timeline.updateTracks(next);
	}

	/**
	 * Rule E: ⌘Z / ⇧⌘Z leave the playhead where the hand put it (a step that says it navigates excepted); a command whose
	 * undo seeked (to show what came back) no longer takes the playhead away.
	 */
	private keepPlayhead(entry: CommandHistoryEntry, playhead: ReturnType<EditorCore["playback"]["getCurrentTime"]>): void {
		if ((entry.command as { navigates?: boolean }).navigates) return;
		if (this.editor.playback.getCurrentTime() !== playhead) this.editor.playback.seek({ time: playhead });
	}

	/** A step can take away a selected clip (or move it to another track): the selection follows (SelectionManager.keepPresent). */
	private keepSelectionPresent(): void {
		const tracks = this.getTracksOrNull();
		if (tracks) this.editor.selection.keepPresent({ tracks });
	}

	private activeSceneId(): string | null {
		return this.editor.scenes.getActiveSceneOrNull()?.id ?? null;
	}

	/** CapCut: ⌘Z of a step made on another timeline opens that timeline and takes the step back there. */
	private openSceneOf(entry: CommandHistoryEntry): void {
		if (entry.sceneId) this.editor.scenes.returnTo({ sceneId: entry.sceneId });
	}

	private getTracksOrNull(): SceneTracks | null {
		return this.editor.scenes.getActiveSceneOrNull()?.tracks ?? null;
	}

	private restoreTracks(tracks: SceneTracks | null): void {
		if (!tracks || this.getTracksOrNull() === tracks) {
			return;
		}
		try {
			this.editor.timeline.updateTracks(tracks);
		} catch (restoreError) {
			console.error("[history] rollback failed", restoreError);
		}
	}

	private reportFailure(failure: {
		kind: "undo" | "redo";
		error: unknown;
	}): void {
		console.error(`[history] ${failure.kind} failed`, failure.error);
		for (const listener of this.failureListeners) {
			try {
				listener(failure);
			} catch {}
		}
	}

	private getSelectionSnapshot(): EditorSelectionSnapshot {
		return this.editor.selection.getSnapshot();
	}

	private applySelectionOverride(
		result: CommandResult | undefined,
	): EditorSelectionSnapshot | undefined {
		if (!result?.selection) {
			return undefined;
		}
		return this.editor.selection.applySelectionPatch({
			patch: result.selection,
		});
	}

	private runReactors(): void {
		for (const reactor of this.reactors) {
			reactor();
		}
	}

	private currentRipple(): RippleMode {
		return { enabled: this.isRippleEnabled, mainOnly: this.rippleMainTrackOnly };
	}

	/**
	 * The magnet keeps the main track packed after a step that changed it (packMainTrack): no gap, no two clips at
	 * once. The ripple only closes what a step vacated; a clip that got longer (a slower speed) overlapped the next.
	 */
	private packMainIfMagnet({ beforeTracks, ripple }: { beforeTracks: SceneTracks | null; ripple: RippleMode }): void {
		if (!ripple.enabled || !beforeTracks) return;
		const tracks = this.getTracksOrNull();
		if (!tracks || tracks.main === beforeTracks.main) return;
		const known = new Set(beforeTracks.main.elements.map((element) => element.id));
		const fresh = new Set(tracks.main.elements.filter((element) => !known.has(element.id)).map((element) => element.id));
		const packed = packMainTrack({ tracks, fresh });
		if (packed !== tracks) this.editor.timeline.updateTracks(packed);
	}

	/**
	 * No two items at once on a track (separateOverlaps): an item the step placed or moved over another — a sound
	 * linkage carried along with its clip — goes to a free track of its kind.
	 */
	private separateIfOverlapping(before: SceneTracks | null): void {
		const tracks = this.getTracksOrNull();
		if (!tracks || !before || tracks === before) return;
		const was = new Map<string, string>();
		for (const track of [...before.overlay, before.main, ...before.audio]) {
			for (const element of track.elements) was.set(element.id, `${track.id}|${element.startTime}|${element.duration}`);
		}
		const moved = new Set<string>();
		for (const track of [...tracks.overlay, ...tracks.audio]) {
			for (const element of track.elements) {
				if (was.get(element.id) !== `${track.id}|${element.startTime}|${element.duration}`) moved.add(element.id);
			}
		}
		if (moved.size === 0) return;
		const settled = separateOverlaps({ tracks, moved });
		if (settled !== tracks) this.editor.timeline.updateTracks(settled);
	}

	/** Items over a main-track clip follow it (moved by the edit or its ripple) or go with it (deleted). */
	private applyLinkageIfEnabled({ beforeTracks, linkage }: { beforeTracks: SceneTracks | null; linkage: LinkageMode }): void {
		if (!beforeTracks) return;
		const afterTracks = this.editor.scenes.getActiveSceneOrNull()?.tracks;
		if (!afterTracks || afterTracks === beforeTracks) return;
		// Linkage off: only the captions follow (a transcript never leaves its speech); the rest stays as the edit left it.
		const linked = applyLinkage({ before: beforeTracks, after: afterTracks, kinds: new Set(linkage.enabled ? linkage.kinds : []) });
		if (linked !== afterTracks) this.editor.timeline.updateTracks(linked);
	}

	private applyRippleIfEnabled({
		beforeTracks,
		ripple,
	}: {
		beforeTracks: SceneTracks | null;
		ripple: RippleMode;
	}): void {
		if (!ripple.enabled || !beforeTracks) {
			return;
		}

		const afterTracks = this.editor.scenes.getActiveSceneOrNull()?.tracks;
		if (!afterTracks) {
			return;
		}
		const adjustments = computeRippleAdjustments({
			beforeTracks,
			afterTracks,
		}).filter(
			(adjustment) =>
				!ripple.mainOnly || adjustment.trackId === afterTracks.main.id,
		);
		if (adjustments.length === 0) {
			return;
		}

		// Titles and the rest over the main clips follow through Linkage (applyLinkageIfEnabled), as its settings say.
		const tracksWithRipple = applyRippleAdjustments({
			followText: false,
			tracks: afterTracks,
			adjustments,
		});
		this.editor.timeline.updateTracks(tracksWithRipple);
	}
}
