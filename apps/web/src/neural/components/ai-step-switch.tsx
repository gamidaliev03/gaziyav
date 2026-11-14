"use client";

// The on/off of an AI step on a clip, in that tool's own section (docs/EDITOR-MAP.md: a modification never silently
// replaces the clip). An AI step makes a new file from the clip's media; the clip keeps the media it was made from, so
// the switch shows the result (on) or the clip as it was (off). A step with later steps made from it can only be taken
// off together with them (one ⌘Z brings them all back) — the line under the switch says so.
import { Switch } from "@/components/ui/switch";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import type { TimelineElement } from "@/timeline";
import { aiStepsOf, removeAiStep, toggleAiResult } from "../apply";
import { type NeuralFamilyId, neuralEffect } from "../catalog";

export function AiStepSwitch({ element, trackId, families }: { element: TimelineElement; trackId: string; families: readonly NeuralFamilyId[] }) {
	const t = useT();
	const assets = useEditor((e) => e.media.getAssets(), ["media"]);
	if (element.type !== "video" && element.type !== "image") return null;
	const steps = aiStepsOf(assets, element);
	const index = steps.findIndex((step) => {
		const family = step.neural ? neuralEffect(step.neural.effect)?.family : undefined;
		return !!family && families.includes(family);
	});
	if (index < 0) return null;
	const step = steps[index];
	const last = index === steps.length - 1;
	const on = !(last && element.aiOff === step.id);
	const later = steps.length - 1 - index;
	const flip = () => {
		if (last) toggleAiResult(trackId, element.id);
		else removeAiStep(trackId, element.id, step.id);
	};
	return (
		<div className="bg-accent/50 flex flex-col gap-1 rounded-md px-2.5 py-1.5" data-ai-step={step.neural?.effect} data-ai-step-on={on ? "on" : "off"}>
			<div className="flex items-center justify-between gap-2">
				<span className="min-w-0 truncate text-xs font-medium">{t(step.neural?.label ?? step.name)}</span>
				<Switch aria-label={t("Show the result")} checked={on} onCheckedChange={flip} data-ai-step-switch="" />
			</div>
			<span className="text-muted-foreground text-[11px] leading-snug">
				{later > 0
					? t("Made as a new file. Off also takes off the {n} AI step(s) made after it (⌘Z brings them back).", { n: later })
					: on
						? t("Made as a new file; your original is kept. Switch off to see the clip without it.")
						: t("Off: the clip shows your original. Switch on to see the result again.")}
			</span>
		</div>
	);
}
