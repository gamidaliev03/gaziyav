"use client";
// The phone's bottom bar (mobile, 14.11): the tools of tools.ts in the creator's order, 56 px tall + the home
// indicator's safe area, each target ≥ 48 × 48. Export opens the editor's own Export window (one export path).
import {
	Add01Icon,
	ArrowReloadHorizontalIcon,
	ArrowTurnBackwardIcon,
	ArrowTurnForwardIcon,
	ColorsIcon,
	Copy01Icon,
	CropIcon,
	DashboardSpeed01Icon,
	Delete02Icon,
	MusicNote01Icon,
	PauseIcon,
	PlayIcon,
	ScissorIcon,
	Share01Icon,
	TextFontIcon,
	VolumeOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { useT } from "@/i18n";
import { PHONE_TOOLS, type SheetId } from "./tools";

export const ICONS: Record<string, typeof Add01Icon> = {
	Add01Icon,
	ArrowReloadHorizontalIcon,
	ArrowTurnBackwardIcon,
	ArrowTurnForwardIcon,
	ColorsIcon,
	Copy01Icon,
	CropIcon,
	DashboardSpeed01Icon,
	Delete02Icon,
	MusicNote01Icon,
	PauseIcon,
	PlayIcon,
	ScissorIcon,
	Share01Icon,
	TextFontIcon,
	VolumeOffIcon,
};

export function BottomBar({ active, onPick }: { active: SheetId | null; onPick: (sheet: SheetId) => void }) {
	const t = useT();
	return (
		<nav className="gz-safe-bottom border-border bg-background flex shrink-0 items-stretch justify-around border-t" aria-label={t("Tools")}>
			{PHONE_TOOLS.map((tool) => (
				<button
					key={tool.id}
					type="button"
					className="gz-tool"
					data-active={active === tool.sheet ? "" : undefined}
					onClick={() => {
						if (tool.sheet) onPick(tool.sheet);
					}}
				>
					<HugeiconsIcon icon={ICONS[tool.icon]} className="size-6" />
					<span>{t(tool.label)}</span>
				</button>
			))}
		</nav>
	);
}
