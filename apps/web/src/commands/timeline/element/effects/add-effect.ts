import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import { isVisualElement, updateElementInSceneTracks } from "@/timeline";
import type { SceneTracks, VisualElement } from "@/timeline";
import { buildDefaultEffectInstance } from "@/effects";
import type { ParamValues } from "@/params";

function addEffectToElement({
	element,
	effectType,
	params,
}: {
	element: VisualElement;
	effectType: string;
	params?: ParamValues;
}): VisualElement {
	const currentEffects = element.effects ?? [];
	// A filter dropped on a clip that is already graded changes that grade's look: no second grade stacked on top.
	const existing = params ? currentEffects.find((effect) => effect.type === effectType) : undefined;
	if (existing) {
		return { ...element, effects: currentEffects.map((effect) => (effect === existing ? { ...effect, params: { ...effect.params, ...params } } : effect)) };
	}
	const instance = buildDefaultEffectInstance({ effectType });
	return { ...element, effects: [...currentEffects, params ? { ...instance, params: { ...instance.params, ...params } } : instance] };
}

export class AddClipEffectCommand extends Command {
	private savedState: SceneTracks | null = null;
	private effectId: string | null = null;
	private readonly trackId: string;
	private readonly elementId: string;
	private readonly effectType: string;
	private readonly params?: ParamValues;

	constructor({
		trackId,
		elementId,
		effectType,
		params,
	}: {
		trackId: string;
		elementId: string;
		effectType: string;
		params?: ParamValues;
	}) {
		super();
		this.trackId = trackId;
		this.elementId = elementId;
		this.effectType = effectType;
		this.params = params;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;

		const updatedTracks = updateElementInSceneTracks({
			tracks: this.savedState,
			trackId: this.trackId,
			elementId: this.elementId,
			elementPredicate: isVisualElement,
		update: (element) => {
			const updated = addEffectToElement({
				element: element as VisualElement,
				effectType: this.effectType,
				params: this.params,
			});
				const effects = updated.effects ?? [];
				this.effectId = (this.params ? effects.find((effect) => effect.type === this.effectType)?.id : undefined) ?? effects[effects.length - 1]?.id ?? null;
				return updated;
			},
		});

		editor.timeline.updateTracks(updatedTracks);
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}

	getEffectId(): string | null {
		return this.effectId;
	}
}
