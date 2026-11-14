"use client";

// The question before the agent spends money on fal.ai (spend.ts): what it makes, the price, and three
// answers — this step, a budget for the session, or nothing. Stopping Gaziyav AI answers «Don't spend». Mounted once
// in the editor.
import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/agent/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";
import { answerSpend, bolt, suggestedBudget, useSpend } from "../spend";

export function SpendDialog() {
	const t = useT();
	const ask = useSpend((s) => s.ask);
	const busy = useAgentStore((s) => s.busy);
	const [budget, setBudget] = useState("");
	const fromAgent = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once per question
	useEffect(() => {
		if (!ask) return;
		fromAgent.current = useAgentStore.getState().busy;
		setBudget(ask.cost != null ? String(suggestedBudget(ask.cost)) : "");
	}, [ask?.id]);
	useEffect(() => {
		if (ask && fromAgent.current && !busy) answerSpend("no");
	}, [ask, busy]);
	if (!ask) return null;
	const short = false;
	const n = Number(budget);
	return (
		<Dialog open onOpenChange={(open) => !open && answerSpend("no")}>
			<DialogContent className="max-w-md gap-3 p-5" data-point-spend={ask.cost ?? "unpriced"}>
				<DialogTitle>{ask.cost != null ? t("Spend {cost} on fal.ai?", { cost: bolt(ask.cost) }) : t("Run this paid step?")}</DialogTitle>
				<DialogDescription>{t("The agent wants to make: {what}", { what: ask.what })}</DialogDescription>
				{ask.prompt && <p className="bg-muted line-clamp-3 rounded-md px-2 py-1.5 text-xs">{ask.prompt}</p>}
				<p className="text-muted-foreground text-xs" data-point-spend-balance>
					{t("fal.ai's list price; you pay fal directly.")}
				</p>
				<div className="flex flex-col gap-2 pt-1">
					<Button disabled={short} onClick={() => answerSpend("once")} data-point-spend-once>
						{ask.cost != null ? t("Allow {cost}", { cost: bolt(ask.cost) }) : t("Allow this step")}
					</Button>
					{ask.cost != null && (
						<div className="flex items-center gap-2 text-xs">
							<Button variant="secondary" className="flex-1" disabled={short || !(n >= ask.cost)} onClick={() => answerSpend({ budget: n })} data-point-spend-budget>
								{t("Allow up to ${n} this session", { n: Number.isFinite(n) && n > 0 ? n : "…" })}
							</Button>
							<Input type="number" min={ask.cost} step={0.5} value={budget} onChange={(e) => setBudget(e.target.value)} className="h-9 w-20" aria-label={t("Session budget, $")} data-point-spend-budget-input />
						</div>
					)}
					<Button variant="ghost" onClick={() => answerSpend("no")} data-point-spend-no>
						{t("Don't spend")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
