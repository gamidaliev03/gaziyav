"use client";

// «Another take» on a clip's result (lip5): the same request with a new seed — and, behind a small disclosure, the lip
// strength (`guidance`) where the model has it (LatentSync). The price is on the button before the click; the take
// joins the piece's versions, the earlier ones stay.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n";

/** The models whose fal schema takes `guidance_scale` (fal/wire.ts lipsyncInput). */
const STRENGTH = new Set(["fal-ai/latentsync"]);

export function TakeButton({ modelId, price, disabled, onTake }: { modelId: string; price: string; disabled: boolean; onTake: (o: { seed: number; guidance?: number }) => void }) {
	const t = useT();
	const [more, setMore] = useState(false);
	const [strength, setStrength] = useState(1.5);
	const knob = STRENGTH.has(modelId);
	return (
		<div className="flex flex-col gap-1.5" data-lipsync-take>
			<div className="flex items-center gap-1.5">
				<Button
					variant="outline"
					size="sm"
					className="min-w-0 flex-1 justify-between gap-2 whitespace-nowrap tabular-nums"
					disabled={disabled || !price}
					data-take-go
					onClick={() => onTake({ seed: Math.floor(Math.random() * 2 ** 31), ...(knob && more ? { guidance: strength } : {}) })}
				>
					<span>{t("Another take")}</span>
					<span className="opacity-80" data-take-price>
						{price || <Spinner className="size-3" />}
					</span>
				</Button>
				{knob && (
					<button type="button" aria-expanded={more} aria-label={t("Lip strength")} className="text-muted-foreground hover:text-foreground size-8 shrink-0 rounded-md text-sm" onClick={() => setMore(!more)} data-take-more>
						⋯
					</button>
				)}
			</div>
			{knob && more && (
				<div className="flex items-center gap-2" data-take-strength>
					<span className="text-muted-foreground shrink-0 text-[11px]">{t("Lip strength")}</span>
					<Slider min={1} max={2} step={0.1} value={[strength]} onValueChange={([v]) => setStrength(Math.round(v * 10) / 10)} aria-label={t("Lip strength")} className="flex-1" />
					<span className="text-muted-foreground w-6 shrink-0 text-right text-[11px] tabular-nums">{strength.toFixed(1).replace(".", ",")}</span>
				</div>
			)}
		</div>
	);
}
