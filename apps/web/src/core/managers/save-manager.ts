import type { EditorCore } from "@/core";

type SaveManagerOptions = {
	debounceMs?: number;
	/** Continuous editing never postpones a save longer than this. */
	maxWaitMs?: number;
	/** A view change (zoom, scroll, playhead) with no edit after it is saved this long after it. */
	viewSaveMs?: number;
};

const RETRY_DELAYS_MS = [3_000, 10_000, 30_000];
/** A view change (zoom, scroll, playhead) with no edit after it is saved this long after it (perf, 13.11). */
const VIEW_SAVE_MS = 30_000;

export class SaveManager {
	private debounceMs: number;
	private viewSaveMs: number;
	private maxWaitMs: number;
	private isPaused = false;
	private isSaving = false;
	private hasPendingSave = false;
	private dirtySince: number | null = null;
	private failedAttempts = 0;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private viewTimer: ReturnType<typeof setTimeout> | null = null;
	private viewPending = false;
	/** The typed words the timeline's preview held at its last notification (TimelineManager.getTypedPreviewKey). */
	private typedKey = "";
	/** Clips on the project's timelines at the last change seen (null: none seen yet). */
	private knownClips: number | null = null;
	/** A clip was added since the last save began: the next save goes at once, not after the debounce. */
	private soon = false;
	private currentSave: Promise<boolean> | null = null;
	private unsubscribeHandlers: Array<() => void> = [];
	/** Told when getIsDirty() changes (perfb, 14.11: the header's save mark listens instead of polling every 300 ms). */
	private dirtyListeners = new Set<() => void>();
	private lastDirty = false;

	constructor({
		editor,
		// A quarter second after an edit it is on disk: a crash or a force quit right after it keeps it (800 ms lost an
		// edit made just before Gaziyav was killed). A save is one IndexedDB write of the project.
		debounceMs = 250,
		maxWaitMs = 3_000,
		viewSaveMs = VIEW_SAVE_MS,
	}: {
		editor: EditorCore;
	} & SaveManagerOptions) {
		this.editor = editor;
		this.debounceMs = debounceMs;
		this.maxWaitMs = maxWaitMs;
		this.viewSaveMs = viewSaveMs;
	}

	private editor: EditorCore;

	start(): void {
		if (this.unsubscribeHandlers.length > 0) return;

		this.unsubscribeHandlers = [
			this.editor.scenes.subscribe(() => {
				this.markChanged();
			}),
			// perf, 13.11: a gesture in progress (a clip dragged, an edge trimmed, a slider) is a preview, saved when it is
			// committed — through the scenes, above. Every preview step used to mark the project dirty: a 2-second drag of
			// a 20-minute talk wrote the whole unchanged project (724 KB) to IndexedDB 4 times, plus its disk copies.
			// Only the words of a title being typed go into every save as typed (ProjectManager.scenesForSave), and when
			// they are dropped (Esc) the save without them is due.
			this.editor.timeline.subscribe(() => {
				// (a clip added — a drop, a paste, a split — is committed through the scenes above and saved at once there:
				// rfix-A's rule; a preview never adds one)
				const typed = this.editor.timeline.getTypedPreviewKey();
				if (typed === this.typedKey) return;
				this.typedKey = typed;
				this.markDirty();
			}),
		];
	}

	stop(): void {
		for (const unsubscribe of this.unsubscribeHandlers) {
			unsubscribe();
		}
		this.unsubscribeHandlers = [];
		this.clearTimer();
		this.clearViewTimer();
		this.viewPending = false;
	}

	/**
	 * perf, 13.11: the timeline's zoom, scroll or playhead moved (ProjectManager.setTimelineViewState). Three numbers:
	 * they go with the next save, a flush (leaving the editor, quitting, an export) or, with no edit at all, after
	 * VIEW_SAVE_MS — not a write of the whole project each (a scroll, a zoom, a play wrote 724 KB + a disk copy).
	 */
	markViewDirty(): void {
		if (this.isPaused) return;
		this.viewPending = true;
		if (this.viewTimer) return;
		this.viewTimer = setTimeout(() => {
			this.viewTimer = null;
			if (this.viewPending) this.markDirty();
		}, this.viewSaveMs);
	}

	/** The view (zoom, scroll, playhead) moved since the last save: a quit should still save it. */
	hasViewPending(): boolean {
		return this.viewPending;
	}

	pause(): void {
		this.isPaused = true;
	}

	resume(): void {
		this.isPaused = false;
		if (this.hasPendingSave) {
			this.queueSave();
		}
	}

	/**
	 * A change of the timeline. A NEW clip (a file put on the timeline, a paste, a drop) is saved at once: killed in the
	 * quarter second of the debounce, a 1 GB file placed the moment its import showed was gone after the restart
	 * (pro-reliable crash, 13.11 — the test's kill landed 200–270 ms after the placement, on either side of the save).
	 * Other edits keep the debounce (a drag, typing: many changes, one write).
	 */
	private markChanged(): void {
		const count = this.clipCount();
		const grew = this.knownClips !== null && count > this.knownClips;
		this.knownClips = count;
		this.markDirty({ soon: grew });
	}

	private clipCount(): number {
		try {
			let n = 0;
			for (const scene of this.editor.scenes.getScenes()) {
				const t = scene.tracks;
				if (!t) continue;
				for (const track of [t.main, ...(t.overlay ?? []), ...(t.audio ?? [])]) n += track?.elements?.length ?? 0;
			}
			return n;
		} catch {
			return 0;
		}
	}

	markDirty({ force = false, soon = false }: { force?: boolean; soon?: boolean } = {}): void {
		if (this.isPaused && !force) return;
		if (soon) this.soon = true;
		this.hasPendingSave = true;
		if (this.dirtySince === null) {
			this.dirtySince = Date.now();
		}
		this.queueSave();
		this.tellDirty();
	}

	/**
	 * Saves now, waiting for a save that is already running. Resolves `true`
	 * when everything is on disk, `false` when the save failed (the edits are
	 * then in the recovery journal, see ProjectManager.saveCurrentProject).
	 */
	async flush(): Promise<boolean> {
		this.hasPendingSave = true;
		if (this.currentSave) {
			await this.currentSave;
		}
		return this.saveNow();
	}

	getIsDirty(): boolean {
		return this.hasPendingSave || this.isSaving;
	}

	/** Called when getIsDirty() turns true (an edit waits) or false (it is on disk); returns the unsubscribe. */
	subscribeDirty(listener: () => void): () => void {
		this.dirtyListeners.add(listener);
		return () => this.dirtyListeners.delete(listener);
	}

	private tellDirty(): void {
		const dirty = this.getIsDirty();
		if (dirty === this.lastDirty) return;
		this.lastDirty = dirty;
		for (const listener of this.dirtyListeners) { try { listener(); } catch {} }
	}

	/**
	 * Synchronous last-chance copy of unsaved edits (window closing, reload,
	 * renderer about to go away). Cheap no-op when everything is saved.
	 */
	writeEmergencyJournal(): boolean {
		if (!this.getIsDirty()) return false;
		return this.editor.project.writeRecoveryJournalNow({ reason: "unload" });
	}

	private queueSave({ delayMs }: { delayMs?: number } = {}): void {
		if (this.isSaving) return;
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
		}
		const waitedMs =
			this.dirtySince === null ? 0 : Date.now() - this.dirtySince;
		const delay =
			delayMs ??
			(this.soon ? 0 : Math.max(0, Math.min(this.debounceMs, this.maxWaitMs - waitedMs)));
		this.saveTimer = setTimeout(() => {
			void this.saveNow();
		}, delay);
	}

	private saveNow(): Promise<boolean> {
		if (this.isSaving) return this.currentSave ?? Promise.resolve(false);
		if (!this.hasPendingSave) return Promise.resolve(true);

		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) {
			// The project was closed: what was pending belonged to it (flushed on exit), not to the next one opened.
			this.hasPendingSave = false;
			this.dirtySince = null;
			this.clearTimer();
			this.tellDirty();
			return Promise.resolve(true);
		}
		if (this.editor.project.getIsLoading()) return Promise.resolve(false);
		if (this.editor.project.getMigrationState().isMigrating) {
			return Promise.resolve(false);
		}

		this.isSaving = true;
		this.soon = false;
		this.hasPendingSave = false;
		this.dirtySince = null;
		this.clearTimer();
		// the save writes the view as it is now
		this.viewPending = false;
		this.clearViewTimer();

		const run = (async () => {
			let ok = false;
			try {
				await this.editor.project.saveCurrentProject();
				ok = true;
				this.failedAttempts = 0;
			} catch (error) {
				// ProjectManager already told the user (in Russian) and wrote the
				// recovery journal. Keep the edits marked dirty and retry later.
				console.error("[save] autosave failed", error);
				this.hasPendingSave = true;
				this.dirtySince ??= Date.now();
				this.failedAttempts += 1;
			} finally {
				this.isSaving = false;
				this.currentSave = null;
				this.tellDirty();
			}
			if (this.hasPendingSave) {
				const retryDelay = ok
					? undefined
					: RETRY_DELAYS_MS[
							Math.min(this.failedAttempts - 1, RETRY_DELAYS_MS.length - 1)
						];
				this.queueSave({ delayMs: retryDelay });
			}
			return ok;
		})();
		this.currentSave = run;
		return run;
	}

	private clearTimer(): void {
		if (!this.saveTimer) return;
		clearTimeout(this.saveTimer);
		this.saveTimer = null;
	}

	private clearViewTimer(): void {
		if (!this.viewTimer) return;
		clearTimeout(this.viewTimer);
		this.viewTimer = null;
	}
}
