"use client";

// Settings → Services → AI on this Mac: the model manager (download size, progress, cancel, Repair, remove). Every "open the
// models" link in the app lands here.
import { OndeviceSection } from "@/ondevice/components/ondevice-dialogs";
import { useT } from "@/i18n";

/** Settings → Services → AI on this Mac: the first group of the AI section (AI on this Mac · API keys · Connect Claude). */
export function OndeviceSlot() {
	const t = useT();
	return (
		// The content only: the AI section wraps each group (its border, spacing and data-settings-group).
		<>
			{/* a name and the list: no paragraph about where it runs or what it costs (the owner, 12.11) */}
			<h3 className="text-[0.95rem] font-medium" data-settings-ondevice>
				{t("Models")}
			</h3>
			<OndeviceSection />
		</>
	);
}
