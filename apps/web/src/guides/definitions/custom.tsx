import { Add01Icon, RulerIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import type { GuideDefinition } from "@/guides/types";

function CustomGuideOptions() {
	return (
		<div className="flex gap-2">
			<Button variant="outline" size="sm" className="flex-1">
				<HugeiconsIcon icon={Add01Icon} />
				Add guide line
			</Button>
		</div>
	);
}

export const customGuide = {
	id: "custom",
	label: "Custom",
	renderPreview: () => <HugeiconsIcon size={16} icon={RulerIcon} />,
	renderTriggerIcon: () => <HugeiconsIcon icon={RulerIcon} />,
	renderOverlay: () => null,
	renderOptions: () => <CustomGuideOptions />,
} as const satisfies GuideDefinition;
