"use client";

// The mixer's place: at the right of the timeline, beside the level meter (rendered from the meter's own file, so the
// timeline's layout is not touched). Closed, nothing of the mixer is loaded.
import dynamic from "next/dynamic";
import { PanelErrorBoundary } from "@/reliability/panel-error-boundary";
import { SOUND_MIXER } from "../features";
import { useSoundUi } from "../ui-store";

const Mixer = dynamic(() => import("./mixer"), { ssr: false });

/** Nothing while the mixer is switched off (sound/features.ts). */
export const MixerDock = ({ headerHeight }: { headerHeight: number }) => (SOUND_MIXER ? <Dock headerHeight={headerHeight} /> : null);

function Dock({ headerHeight }: { headerHeight: number }) {
	const open = useSoundUi((s) => s.mixerOpen);
	if (!open) return null;
	return (
		<PanelErrorBoundary name="Mixer">
			<Mixer headerHeight={headerHeight} />
		</PanelErrorBoundary>
	);
}
