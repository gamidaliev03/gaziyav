"use client";

// Settings → AI: the limit under which a paid step of the Lipsync panel runs on the button alone (rule B: the button is
// the consent); a total above it asks once. Default 1 $.
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";
import { useStudioStore } from "@/studio/client/studio-store";

export function SpendLimit() {
	const t = useT();
	const usd = useStudioStore((s) => s.confirmAbove);
	return (
		<label className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm" data-settings-spend-limit>
			<span className="flex min-w-0 flex-1 flex-col">
				<span>{t("Confirm spending above")}</span>
				<span className="text-muted-foreground text-xs">{t("Lipsync and voices: below this the button is the consent, above it one question")}</span>
			</span>
			<Input
				type="number"
				min={0}
				step={0.1}
				className="h-8 w-20 text-right tabular-nums"
				value={usd}
				data-spend-limit-input
				onChange={(e) => useStudioStore.getState().setConfirmAbove(Number(e.target.value))}
			/>
			<span className="text-muted-foreground w-3 text-xs">$</span>
		</label>
	);
}
