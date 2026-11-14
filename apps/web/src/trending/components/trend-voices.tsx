"use client";

// The «Trending» label (🔥 + a name) over a row of trending looks. The voices themselves are cards of the one voice
// picker (generate/components/voice-picker.tsx).
import { HugeiconsIcon } from "@/components/ui/icon";
import { Fire02Icon } from "@hugeicons/core-free-icons";
import { useT } from "@/i18n";

export function TrendLabel({ children }: { children: string }) {
	const t = useT();
	return (
		<div className="text-muted-foreground flex items-center gap-1 text-[11px] font-medium">
			<HugeiconsIcon icon={Fire02Icon} className="size-3 text-orange-400" />
			{t(children)}
		</div>
	);
}
