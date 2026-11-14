"use client";

// The mixer's button in the timeline's bar (the same look as the bar's own buttons: timeline-toolbar.tsx).
import { PreferenceVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { SOUND_MIXER } from "../features";
import { useSoundUi } from "../ui-store";

/** Nothing while the mixer is switched off (sound/features.ts). */
export const MixerToolbarButton = () => (SOUND_MIXER ? <MixerButton /> : null);

function MixerButton() {
	const t = useT();
	const open = useSoundUi((s) => s.mixerOpen);
	const toggle = useSoundUi((s) => s.toggleMixer);
	return (
		<Tooltip delayDuration={200}>
			<TooltipTrigger asChild>
				<Button variant={open ? "secondary" : "text"} size="icon" aria-label={t("Mixer")} aria-pressed={open} data-toolbar-button="mixer" onClick={toggle} className="h-7 w-8 rounded-sm">
					<HugeiconsIcon icon={PreferenceVerticalIcon} />
				</Button>
			</TooltipTrigger>
			<TooltipContent>{t("Mixer: a fader, pan, mute and solo for every track")}</TooltipContent>
		</Tooltip>
	);
}
