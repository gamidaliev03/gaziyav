"use client";

// Effects → AI: tiles. Double-click applies to the selected clip(s) with the family's current settings;
// one click picks the effect in the inspector's AI tab, where its settings, status and Re-run live.
import { HugeiconsIcon } from "@/components/ui/icon";
import {
	AiMagicIcon,
	BlurIcon,
	CenterFocusIcon,
	PaintBucketIcon,
	Resize01Icon,
	UserRemove01Icon,
} from "@hugeicons/core-free-icons";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { usePropertiesStore } from "@/components/editor/panels/properties/stores/properties-store";
import { cn } from "@/utils/ui";
import { applyNeuralEffect } from "../apply";
import type { NeuralEffect } from "../catalog";
import { familyValues, useNeuralSettings, valuesIn } from "../settings-store";

export const AI_CATEGORY = "AI";

const ICONS: Record<string, typeof AiMagicIcon> = {
	"ai.removeBackground": UserRemove01Icon,
	"ai.blurBackground": BlurIcon,
	"ai.colorBackground": PaintBucketIcon,
	"ai.enhance": AiMagicIcon,
	"ai.denoise": CenterFocusIcon,
	"ai.upscale2x": Resize01Icon,
	"ai.upscale4x": Resize01Icon,
};

/** The tile's family and preset become the inspector's AI settings; the inspector shows the effect's place (its AI
 * tab, or Video → Remove BG for Remove Background). */
function pickInInspector(effect: NeuralEffect) {
	const settings = useNeuralSettings.getState();
	settings.pick(effect.family);
	if (effect.preset) settings.setValues(effect.family, effect.preset);
	usePropertiesStore.getState().setActiveTab({ elementType: "video", tabId: effect.family === "background" ? "cutout" : effect.family === "upscale" ? "ai" : "fix" });
}

export function AiEffectTile({ effect }: { effect: NeuralEffect }) {
	const picked = useNeuralSettings((s) => {
		if (s.picked !== effect.family) return false;
		const values = valuesIn(effect.family, s.values);
		return Object.entries(effect.preset ?? {}).every(([k, v]) => String(values[k]) === String(v));
	});
	return (
		<DraggableItem
			name={effect.name}
			preview={
				// biome-ignore lint: tile is a gesture surface; the label is the accessible name
				<div
					role="button"
					tabIndex={-1}
					data-ai-effect={effect.id}
					aria-label={`${effect.name} — double-click to apply`}
					onClick={(event) => {
						if (event.detail === 1) pickInInspector(effect);
					}}
					className={cn(
						"relative flex size-full cursor-pointer items-center justify-center rounded-[inherit] bg-gradient-to-br from-amber-500/35 via-teal-500/20 to-sky-500/30",
						picked && "ring-primary/70 ring-1 ring-inset",
					)}
				>
					<HugeiconsIcon icon={ICONS[effect.id] ?? AiMagicIcon} className="size-8 text-white/90" strokeWidth={1.4} />
					{effect.family === "upscale" && (
						<span className="absolute right-1.5 bottom-1 text-[0.65rem] font-semibold text-white/90">{effect.preset?.scale}×</span>
					)}
					<span className="absolute top-1 left-1.5 text-[0.55rem] font-semibold tracking-wide text-white/80">AI</span>
				</div>
			}
			// Not draggable: an AI effect makes a new file, so it's applied on purpose (double-click or the inspector).
			dragData={{ id: effect.id, name: effect.name, type: "effect", effectType: effect.id, targetElementTypes: ["video"] }}
			onAddToTimeline={() => {
				pickInInspector(effect);
				applyNeuralEffect(effect.id, familyValues(effect.family));
			}}
			isDraggable={false}
			aspectRatio={1}
			isRounded
			variant="card"
			containerClassName="w-full"
		/>
	);
}

