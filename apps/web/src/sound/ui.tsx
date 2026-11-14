"use client";

// Small pieces every sound surface shares (the look is the design standard's: docs/design).
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { useT } from "@/i18n";
import { cn } from "@/utils/ui";

/** The seal: free and on this Mac, said where a machine's work starts. */
export function Seal({ className }: { className?: string }) {
	const t = useT();
	return (
		<span className={cn("text-muted-foreground inline-flex items-center gap-1 text-[11px] whitespace-nowrap", className)} data-free-seal="">
			<HugeiconsIcon icon={CheckmarkCircle02Icon} className="text-constructive size-3.5 shrink-0" />
			{t("On this Mac · free")}
		</span>
	);
}

/** A 14 px progress ring: an arc that grows, never a wheel that spins. */
export function Ring({ progress }: { progress: number }) {
	const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
	return (
		<span
			aria-hidden
			className="inline-block size-3.5 shrink-0 rounded-full"
			style={{
				background: `conic-gradient(var(--primary) ${pct}%, var(--muted) 0)`,
				mask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))",
				WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))",
			}}
		/>
	);
}
