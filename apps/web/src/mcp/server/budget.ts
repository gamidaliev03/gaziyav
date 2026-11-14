// What Claude may spend through the connector, per video (project): the user's own limit from Settings → Claude
// (default $1), or the budget the user named for this video in the chat (price_plan {budget}); and what Claude's paid
// steps cost there, by provider. On disk next to the token (mcp/budget.json), so it outlives a restart of the app.
// The editor's own buttons and Gaziyav AI never read it: they ask the user in the app as before.
import fs from "node:fs";
import path from "node:path";
import { readTaste } from "@/production/server/store";
import { mcpDir } from "./hub";

/**
 * «ебала со сметами»): no per-video cap, a paid step stops only when its provider's balance can't cover it; "video": the
 * taste profile's budget caps every video. A budget the user names for one video caps that video either way.
 */
function tasteMode(): "balance" | "video" {
	try {
		return readTaste().budgetMode === "video" ? "video" : "balance";
	} catch {
		return "balance";
	}
}

/** The per-video budget the user's taste profile names (taste_profile {set:{budget}}; $1 by default): the one default. */
function tasteBudget(): number | null {
	try {
		const v = readTaste().budget;
		return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
	} catch {
		return null;
	}
}

export const DEFAULT_LIMIT_USD = 1;

export interface SpendStep {
	at: number;
	what: string;
	usd: number;
	api: string;
	/** The generation it paid for: a job is counted once, however many calls hand its result back (C2). */
	job?: string;
}

interface ProjectSpend {
	/** The budget the user named for this video (absent: the limit from Settings). */
	budget?: number;
	spent: number;
	byApi: Record<string, number>;
	steps: SpendStep[];
}

interface BudgetFile {
	limit: number;
	projects: Record<string, ProjectSpend>;
}

export interface BudgetView {
	/** The default for every video (Settings → Claude). */
	limit: number;
	/** This video's budget: its own, or the default. */
	budget: number;
	own: boolean;
	spent: number;
	left: number;
	byApi: Record<string, number>;
	steps: SpendStep[];
	/** "balance": no per-video cap unless the user named this video's budget; "video": the budget caps every video. */
	mode: "balance" | "video";
	/** Whether `left` stops a paid step (the user's own budget for this video, or the "video" mode). */
	capped: boolean;
}

const file = () => path.join(mcpDir(), "budget.json");
const money = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 1e6) / 1e6 : fallback);

function read(): BudgetFile {
	try {
		const j = JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<BudgetFile>;
		return { limit: money(j.limit, DEFAULT_LIMIT_USD), projects: j.projects && typeof j.projects === "object" ? j.projects : {} };
	} catch {
		return { limit: DEFAULT_LIMIT_USD, projects: {} };
	}
}

function write(b: BudgetFile) {
	const tmp = `${file()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(b), { mode: 0o600 });
	fs.renameSync(tmp, file());
}

const projectKey = (id: string | null | undefined) => String(id ?? "").slice(0, 80) || "none";

export function budgetView(projectId: string | null | undefined): BudgetView {
	const b = read();
	b.limit = tasteBudget() ?? b.limit;
	const p = b.projects[projectKey(projectId)];
	const budget = p?.budget ?? b.limit;
	const spent = money(p?.spent, 0);
	const mode = tasteMode();
	return { limit: b.limit, budget, own: p?.budget !== undefined, spent, left: Math.max(0, Math.round((budget - spent) * 1e6) / 1e6), byApi: p?.byApi ?? {}, steps: (p?.steps ?? []).slice(-12), mode, capped: p?.budget !== undefined || mode === "video" };
}

/** Settings → Claude: the limit every video starts with. */
export function setLimit(usd: number): BudgetView {
	const b = read();
	b.limit = Math.min(1000, money(usd, b.limit));
	write(b);
	return budgetView(null);
}

/** The budget the user named for this video (null: back to the default). */
export function setProjectBudget(projectId: string, usd: number | null): BudgetView {
	const b = read();
	const key = projectKey(projectId);
	const p = b.projects[key] ?? { spent: 0, byApi: {}, steps: [] };
	if (usd === null) delete p.budget;
	else p.budget = Math.min(10_000, money(usd, b.limit));
	b.projects[key] = p;
	write(b);
	return budgetView(projectId);
}

/** A paid step Claude made (negative: a refund of a step that failed before it was billed). */
export function recordSpend(projectId: string, step: { what: string; usd: number; api: string; job?: string }): BudgetView {
	const b = read();
	const key = projectKey(projectId);
	const p = b.projects[key] ?? { spent: 0, byApi: {}, steps: [] };
	const job = typeof step.job === "string" && step.job ? step.job.slice(0, 80) : undefined;
	// the same generation handed back again (a joined or returned call): already counted
	if (job && (p.steps ?? []).some((s) => s.job === job)) return budgetView(projectId);
	const usd = Number.isFinite(step.usd) ? Math.round(step.usd * 1e6) / 1e6 : 0;
	const api = String(step.api || "fal").slice(0, 20);
	p.spent = Math.max(0, Math.round((money(p.spent, 0) + usd) * 1e6) / 1e6);
	p.byApi = { ...p.byApi, [api]: Math.max(0, Math.round(((p.byApi?.[api] ?? 0) + usd) * 1e6) / 1e6) };
	p.steps = [...(p.steps ?? []), { at: Date.now(), what: String(step.what).slice(0, 160), usd, api, ...(job ? { job } : {}) }].slice(-60);
	b.projects[key] = p;
	write(b);
	return budgetView(projectId);
}
