"use client";

// The model ladder (lip5, 14.11): one compact control. Closed, it reads the chosen model and its price for THIS clip;
// open, every model with its price for this clip (the pre-flight's `models[]`, the run's own plan), one short line of
// what it is for, the one the checks recommend marked with the reason, and a model that does not fit this clip disabled
// with the reason. The choice is the clip's draft (`model`); a new clip starts with the last pick (studio-store CARRIED).

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/utils/ui";
import { useT } from "@/i18n";
import type { Preflight } from "@/studio/client/api";
import { apiOf, byPrice, type FalModel } from "@/fal/models";

/** What each model is for, in one short line (the page's own words; the price is the server's). */
const FOR: Record<string, string> = {
	"fal-ai/latentsync": "Draft: a face to the camera, cheap",
	"veed/lipsync": "Short pieces, the cheapest per second",
	"fal-ai/sync-lipsync": "Older generation, cheap per minute",
	"fal-ai/sync-lipsync/v2": "Real footage: head turns, close-ups",
	"fal-ai/sync-lipsync/v2/pro": "Best detail: teeth, beards, a hand at the mouth",
	"fal-ai/kling-video/lipsync/audio-to-video": "Pieces of 2–10 s only, 720p and up",
};

/** The checks' reason (lip-ladder.ts `Reason`) in the page's words. */
export const REASON: Record<string, string> = {
	hand_at_mouth: "hand at the mouth",
	face_profile: "profile",
	faces_several: "several faces",
	face_small: "small face",
	face_turned: "head turned",
	draft_ok: "face to the camera",
	no_face: "no face found",
};

const WHY: Record<string, string> = { needs_720p: "needs 720p or more", too_short: "the piece is too short" };

export function ModelLadder({
	models,
	chosen,
	pf,
	checked,
	sentSeconds,
	money,
	exact,
	remade,
	open,
	onOpenChange,
	onChoose,
	missingKey,
}: {
	models: FalModel[];
	chosen: { id: string; title: string };
	pf: Preflight | null;
	checked: boolean;
	/** Seconds of video that go (a model's piece limits are checked on it). */
	sentSeconds: number;
	money: (usd: number) => string;
	exact: boolean;
	remade: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onChoose: (id: string) => void;
	/** A model whose API has no key here: that API's name (it stays listed, marked). */
	missingKey?: (m: FalModel) => string | undefined;
}) {
	const t = useT();
	const rungs = pf?.models ?? [];
	const rung = (id: string) => rungs.find((r) => r.id === id);
	/** THIS clip's price of a model: the plan's for the chosen one, the ladder's for the others. */
	const usdOf = (id: string): number | undefined => (id === chosen.id && pf?.usd != null ? pf.usd : rung(id)?.usd);
	const rec = pf?.recommended;
	const chosenUsd = usdOf(chosen.id);
	return (
		<Select value={chosen.id} onValueChange={onChoose} open={open} onOpenChange={onOpenChange}>
			<SelectTrigger className="h-auto min-h-8 min-w-0 py-1 text-xs" data-lipsync-model-trigger data-lipsync-ladder>
				<SelectValue>
					<span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 whitespace-normal">
						<span data-no-translate>
							{chosen.title}
						</span>
						{checked && chosenUsd != null ? (
							<span className="text-muted-foreground tabular-nums" data-testid="ladder-price" data-usd={String(chosenUsd)}>
								· {remade ? t("free") : `${exact ? "" : "≈ "}${money(chosenUsd)}`}
							</span>
						) : null}
						{rec?.id === chosen.id && <span className="text-primary" aria-label={t("recommended")}>★</span>}
					</span>
				</SelectValue>
			</SelectTrigger>
			<SelectContent className="max-w-[min(26rem,calc(100vw-2rem))]">
				{byPrice(models, (m) => usdOf(m.id) ?? Number.POSITIVE_INFINITY).map((m) => {
					const r = rung(m.id);
					// the piece that goes decides (a 15 s clip with a 10 s voice sends 10 s); the server's own verdict first
					const tooLong = !!(m.maxSeconds && sentSeconds > m.maxSeconds + 0.05);
					const tooShort = !!(m.minSeconds && sentSeconds > 0 && sentSeconds < m.minSeconds);
					const why = r && !r.fits ? t(WHY[r.why ?? ""] ?? "does not fit this clip") : tooLong || tooShort ? t("Takes {a}–{b} s pieces", { a: m.minSeconds ?? 0, b: m.maxSeconds ?? 0 }) : "";
					const usd = usdOf(m.id);
					const recommended = rec?.id === m.id;
					const noKey = missingKey?.(m);
					return (
						<SelectItem key={m.id} value={m.id} disabled={!!why} className="text-xs" data-lipsync-model={m.id} data-usd={usd != null ? String(usd) : undefined} data-recommended={recommended ? (rec?.reason ?? "") : undefined} data-unfit={why ? "" : undefined} data-model-api={apiOf(m)} data-model-no-key={noKey}>
							<span className="flex w-full min-w-0 flex-col gap-0.5">
								<span className="flex min-w-0 items-baseline gap-2">
									<span className="font-medium" data-no-translate>
										{m.title}
									</span>
									{recommended && (
										<span className="text-primary shrink-0" data-ladder-reason>
											★ {t(REASON[rec?.reason ?? ""] ?? "recommended")}
										</span>
									)}
									<span className="ml-auto shrink-0 tabular-nums">{usd != null ? money(usd) : ""}</span>
								</span>
								<span className={cn("leading-tight", why || noKey ? "text-amber-500" : "text-muted-foreground")}>{why || (noKey ? t("needs a {api} key", { api: noKey === "kie" ? "kie.ai" : "fal.ai" }) : t(FOR[m.id] ?? m.note))}</span>
							</span>
						</SelectItem>
					);
				})}
			</SelectContent>
		</Select>
	);
}
