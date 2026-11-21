// A provider that refused a paid job for an empty balance (fal's 402, kie's code 402, ArgoLink's 402, a Settings →
// Services service's «no money left») is remembered: for 15 minutes every price_plan says «fal.ai: EMPTY (refused
// 02:09) — fal.ai models blocked», and Claude's paid steps on it are refused before anything is uploaded (the 10.11
// night: price_plan said «Fits… Go ahead» 30 s after three «fal balance empty», and 9 calls failed on it); after that the
// next press tries for real (the quiet recheck). The hold counts only refusals heard since this start of the app: a
// mark kept from before never blocks the paid route. The mark itself stays — on its key in Settings → Services, across a
// restart (empty.json beside the settings) — until a job the provider accepts, a new key, or a balance read that is
// above zero clears it (principle 1). Server side, one map for the whole app (the window reads it through /api/fal/status).
import fs from "node:fs";
import path from "node:path";
import type { AiApi } from "@/fal/video";
import { supportDir } from "@/platform/paths";

export const EMPTY_HOLD_MS = 15 * 60 * 1000;

/** fal / kie / Argo, or a service of Settings → Services by its id (elevenlabs, cartesia…). */
export type Payer = AiApi | (string & {});

const g = globalThis as { __gaziyavEmpty?: Record<string, number>; __gaziyavEmptyLoaded?: string; __gaziyavEmptyHeld?: Record<string, number> };
/** Refusals heard by THIS run of the app: only these hold paid steps back (a mark kept from before a restart never does). */
const held = (): Record<string, number> => (g.__gaziyavEmptyHeld ??= {});

// Kept beside the settings; never in the user's own folder from a test run that didn't give its own home.
const file = (): string | null => {
	if (process.env.STUDIO_TEST === "1" && !process.env.LIPSYNC_HOME) return null;
	try {
		return path.join(process.env.LIPSYNC_HOME || supportDir(), "empty.json");
	} catch {
		return null;
	}
};

const map = (): Record<string, number> => {
	const f = file();
	if (g.__gaziyavEmpty && g.__gaziyavEmptyLoaded === (f ?? "")) return g.__gaziyavEmpty;
	let kept: Record<string, number> = {};
	try {
		if (f) kept = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, unknown>).filter(([, v]) => typeof v === "number")) as Record<string, number>;
	} catch {}
	g.__gaziyavEmpty = { ...kept, ...(g.__gaziyavEmpty ?? {}) };
	g.__gaziyavEmptyLoaded = f ?? "";
	return g.__gaziyavEmpty;
};

function save() {
	const f = file();
	if (!f) return;
	try {
		fs.mkdirSync(path.dirname(f), { recursive: true });
		fs.writeFileSync(`${f}.tmp`, JSON.stringify(map()), { mode: 0o600 });
		fs.renameSync(`${f}.tmp`, f);
	} catch {}
}

/** The provider refused a paid step (or an upload) for an empty balance, now. */
export function noteEmpty(api: Payer, at = Date.now()) {
	map()[api] = at;
	held()[api] = at;
	save();
}

/** The provider accepted a paid job (or got a new key): its balance is not empty (any more). */
export function clearEmpty(api: Payer) {
	delete held()[api];
	const m = map();
	if (!(api in m)) return;
	delete m[api];
	save();
}

/** When the provider last refused for an empty balance, within the last 15 minutes; null otherwise. */
export function emptySince(api: Payer, now = Date.now()): number | null {
	const at = held()[api];
	return at !== undefined && now - at < EMPTY_HOLD_MS ? at : null;
}

/** Every fal / kie / Argo that refused for an empty balance in the last 15 minutes → when. */
export function emptyNow(now = Date.now()): Partial<Record<AiApi, number>> {
	const out: Partial<Record<AiApi, number>> = {};
	for (const api of (["fal", "kie", "argo"] as AiApi[]).filter((a) => a in held())) {
		const at = emptySince(api, now);
		if (at !== null) out[api] = at;
	}
	return out;
}

/**
 * For Settings → Services: every provider marked out of balance (until cleared), when, and whether paid steps on it
 * are held back right now (the first 15 minutes) or the next press rechecks it.
 */
export function emptyView(now = Date.now()): Record<string, { since: number; held: boolean }> {
	return Object.fromEntries(Object.entries(map()).map(([id, at]) => [id, { since: at, held: held()[id] !== undefined && now - (held()[id] as number) < EMPTY_HOLD_MS }]));
}

/** The quiet recheck: fal's balance read (an admin-scoped key reports it); above zero clears the mark. */
export async function recheckEmpty(): Promise<void> {
	if (!(("fal" as string) in map())) return;
	try {
		const { falBalance } = await import("@/fal/server");
		const usd = await falBalance();
		if (usd !== null && usd > 0) clearEmpty("fal");
	} catch {}
}
