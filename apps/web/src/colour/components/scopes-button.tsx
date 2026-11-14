"use client";

// The Color section's «Scopes» button: opens and closes the strip under the player (src/colour/scopes).
import { ChartHistogramIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { useScopes } from "@/colour/scopes/store";
import { useT } from "@/i18n";
import { cn } from "@/utils/ui";

export function ScopesButton({ className }: { className?: string }) {
	const t = useT();
	const open = useScopes((s) => s.open);
	return (
		<button
			type="button"
			data-colour-scopes={open ? "on" : "off"}
			aria-pressed={open}
			title={t("Waveform, RGB parade, vectorscope and histogram of the frame in the player")}
			onClick={() => useScopes.getState().toggle()}
			className={cn(
				"flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium",
				open ? "bg-primary/20 text-foreground" : "bg-foreground/[0.07] hover:bg-foreground/[0.1]",
				className,
			)}
		>
			<HugeiconsIcon icon={ChartHistogramIcon} className="size-3.5" />
			{t("Scopes")}
		</button>
	);
}
