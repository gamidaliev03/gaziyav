import {
	Command,
	createElementSelectionResult,
	type CommandResult,
} from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { ElementRef, SceneTracks } from "@/timeline/types";
import { applyRippleAdjustments, computeRippleAdjustments } from "@/ripple";

/**
 * One undo step for a precomputed hotkey edit (ripple delete, trim to playhead, nudge,
 * paste attributes).
 *
 * `ripple: true` closes gaps on every edited track. The engine's ripple mode
 * (CommandManager.isRippleEnabled, main track only by default) closes the main-track gaps
 * itself after `execute()`, so the command pre-closes only what the engine won't —
 * undo/redo give the same tracks either way, without rippling twice.
 */
export class TracksEditCommand extends Command {
	private readonly before: SceneTracks;
	private readonly after: SceneTracks;
	private readonly rippledAfter: SceneTracks | null;
	/** Gaps closed on every track except the main one (the engine closes those itself). */
	private readonly rippledExceptMain: SceneTracks | null;
	private readonly selection: ElementRef[] | undefined;
	private readonly noEngineRipple: boolean;
	private target: SceneTracks | null = null;

	constructor({
		before,
		after,
		ripple = false,
		selection,
		noEngineRipple = false,
	}: {
		before: SceneTracks;
		after: SceneTracks;
		ripple?: boolean;
		selection?: ElementRef[];
		/** The result is final (Lift / Extract): the engine's magnet must not touch it. */
		noEngineRipple?: boolean;
	}) {
		super();
		this.before = before;
		this.after = after;
		if (ripple) {
			const adjustments = computeRippleAdjustments({ beforeTracks: before, afterTracks: after });
			this.rippledAfter = applyRippleAdjustments({ tracks: after, adjustments });
			this.rippledExceptMain = applyRippleAdjustments({
				tracks: after,
				adjustments: adjustments.filter((a) => a.trackId !== after.main.id),
			});
		} else {
			this.rippledAfter = null;
			this.rippledExceptMain = null;
		}
		this.selection = selection;
		this.noEngineRipple = noEngineRipple;
	}

	override get ripplesItself(): boolean {
		return this.noEngineRipple;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const engine = editor.command;
		if (this.noEngineRipple) {
			editor.timeline.updateTracks(this.after);
			return this.selection ? createElementSelectionResult(this.selection) : undefined;
		}
		// Chosen once, with the magnet as it was for the edit: a redo repeats that edit even if the magnet was switched
		// since (the manager's own ripple is stored with the step the same way).
		this.target ??= !this.rippledAfter
			? this.after
			: !engine.isRippleEnabled
				? this.rippledAfter
				: engine.rippleMainTrackOnly
					? (this.rippledExceptMain ?? this.after)
					: this.after;
		editor.timeline.updateTracks(this.target);
		return this.selection ? createElementSelectionResult(this.selection) : undefined;
	}

	undo(): void {
		EditorCore.getInstance().timeline.updateTracks(this.before);
	}
}
