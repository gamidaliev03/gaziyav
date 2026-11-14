import { buildEffectParamPath, parseEffectParamPath } from "@/animation/param-paths";
import type { ElementAnimations } from "@/animation/types";
import { UpdateElementsCommand } from "@/commands/timeline";
import type { Effect } from "@/effects/types";
import type { TimelineElement } from "@/timeline";
import { generateUUID } from "@/utils/id";
import type { ClipboardHandler, EffectClipboardEntry } from "../types";

/** Clips that carry an effect stack (a clip that never had one has no `effects` field yet). */
const EFFECT_CLIP_TYPES: ReadonlySet<string> = new Set(["video", "image", "text", "sticker", "graphic"]);

/** The effect copied from the Adjust tab (its ⧉ button), with its keyframes. */
export function buildEffectEntry({ element, effectId }: { element: TimelineElement; effectId: string }): EffectClipboardEntry | null {
	const effect = ("effects" in element ? element.effects : undefined)?.find((candidate) => candidate.id === effectId);
	if (!effect) return null;
	const animations: ElementAnimations = {};
	for (const [path, channel] of Object.entries(element.animations ?? {})) {
		if (channel && parseEffectParamPath({ propertyPath: path })?.effectId === effectId) animations[path] = structuredClone(channel);
	}
	return { type: "effect", effect: structuredClone(effect), animations, sourceName: element.name };
}

/** The effect (with fresh ids for it and its keys) added to each clip that can carry effects. */
export function effectPastePatches(
	entry: EffectClipboardEntry,
	clips: ReadonlyArray<{ track: { id: string }; element: TimelineElement }>,
): Array<{ trackId: string; elementId: string; patch: Partial<TimelineElement> }> {
	return clips.flatMap(({ track, element }) => {
		if (!EFFECT_CLIP_TYPES.has(element.type)) return [];
		const id = generateUUID();
		const effect: Effect = { ...structuredClone(entry.effect), id };
		const animations: ElementAnimations = { ...(element.animations ?? {}) };
		for (const [path, channel] of Object.entries(entry.animations)) {
			const parsed = parseEffectParamPath({ propertyPath: path });
			if (parsed && channel) animations[buildEffectParamPath({ effectId: id, paramKey: parsed.paramKey })] = structuredClone(channel);
		}
		const patch = {
			effects: [...(("effects" in element ? element.effects : undefined) ?? []), effect],
			...(Object.keys(entry.animations).length > 0 ? { animations } : {}),
		} as Partial<TimelineElement>;
		return [{ trackId: track.id, elementId: element.id, patch }];
	});
}

/** The effect (and its keys) added to every selected clip that can carry effects: one ⌘Z. */
export const EffectClipboardHandler = {
	type: "effect",

	// Copied by its button, not by ⌘C on a selection.
	canCopy() {
		return false;
	},

	copy() {
		return null;
	},

	paste({ entry, context }) {
		const updates = effectPastePatches(entry, context.editor.timeline.getElementsWithTracks({ elements: context.selectedElements }));
		return updates.length > 0 ? new UpdateElementsCommand({ updates }) : null;
	},
} satisfies ClipboardHandler<"effect">;
