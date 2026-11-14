// Every dollar the agent spends on fal.ai is the user's OK first: the price before the step, then «Allow $N» (this
// step), «Up to $N this session» (later steps within it go ahead, each one shown) or «Don't spend». One question at a
// time; a session's budget is never kept between launches.
import { toast } from "sonner";
import { create } from "zustand";
import { t } from "@/i18n";
import { usd } from "@/fal/models";

export interface SpendAsk {
	id: number;
	/** What the step makes («Video · Seedance 2 Mini · 5 s»). */
	what: string;
	/** The description it is made from, as the model wrote it. */
	prompt?: string;
	/** US dollars at fal's list price; null = not priced beforehand (then only «Allow» or «Don't spend»). */
	cost: number | null;
}

interface SpendState {
	ask: SpendAsk | null;
	/** The session's budget the user set ($) and what the agent spent from it. */
	budget: number | null;
	spent: number;
}

export const useSpend = create<SpendState>(() => ({ ask: null, budget: null, spent: 0 }));

/** What the user allowed for a step: its price ($), or null for a step priced only when it runs. */
export interface Approval {
	usd: number | null;
}

let settle: ((r: Approval | null) => void) | null = null;
let queue: Promise<unknown> = Promise.resolve();
let nextId = 1;

export const bolt = (n: number) => usd(n);

/** The user's OK for one paid step (null = not allowed: nothing may be spent). */
export function approveSpend(what: string, cost: number | null, prompt?: string): Promise<Approval | null> {
	const run = queue.then(() => askNow(what, cost, prompt));
	queue = run.catch(() => {});
	return run;
}

function askNow(what: string, cost: number | null, prompt?: string): Promise<Approval | null> {
	const s = useSpend.getState();
	if (cost != null && s.budget != null && s.spent + cost <= s.budget) {
		useSpend.setState({ spent: s.spent + cost });
		toast(t("fal.ai: {cost} for {what}", { cost: bolt(cost), what }), { description: t("From this session's budget — {left} of {budget} left", { left: bolt(s.budget - s.spent - cost), budget: bolt(s.budget) }) });
		return Promise.resolve({ usd: cost });
	}
	return new Promise((resolve) => {
		settle = resolve;
		useSpend.setState({ ask: { id: nextId++, what, cost, prompt } });
	});
}

/** The user's answer to the open question. */
export function answerSpend(answer: "once" | "no" | { budget: number }) {
	const ask = useSpend.getState().ask;
	const done = settle;
	settle = null;
	if (!ask || !done) return;
	if (answer === "no") {
		useSpend.setState({ ask: null });
		done(null);
		return;
	}
	if (answer === "once" || ask.cost == null) useSpend.setState({ ask: null });
	// A new budget counts from this step on.
	else useSpend.setState({ ask: null, budget: Math.max(ask.cost, answer.budget), spent: ask.cost });
	done({ usd: ask.cost });
}

/** A budget to offer: room for a few more steps like this one, in round numbers. */
export function suggestedBudget(cost: number): number {
	return Math.max(1, Math.ceil(cost * 5));
}
