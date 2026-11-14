// A provider that refused a paid job for an empty balance (fal's 402, kie's code 402, ArgoLink's 402) is remembered for
// 15 minutes: every price_plan says «fal.ai: EMPTY (refused 02:09) — fal.ai models blocked», and Claude's paid steps on it
// are refused before anything is uploaded (the 10.11 night: price_plan said «Fits… Go ahead» 30 s after three «fal balance
// empty», and 9 calls failed on it). A job the provider accepts again forgets it at once (a top-up). Server side, one map
// for the whole app (the window reads it through /api/fal/status).
import type { AiApi } from "@/fal/video";

export const EMPTY_HOLD_MS = 15 * 60 * 1000;

const g = globalThis as { __gaziyavEmpty?: Partial<Record<AiApi, number>> };
const map = (): Partial<Record<AiApi, number>> => (g.__gaziyavEmpty ??= {});

/** The provider refused a paid step (or an upload) for an empty balance, now. */
export function noteEmpty(api: AiApi, at = Date.now()) {
	map()[api] = at;
}

/** The provider accepted a paid job: its balance is not empty (any more). */
export function clearEmpty(api: AiApi) {
	delete map()[api];
}

/** When the provider last refused for an empty balance, within the last 15 minutes; null otherwise. */
export function emptySince(api: AiApi, now = Date.now()): number | null {
	const at = map()[api];
	return at !== undefined && now - at < EMPTY_HOLD_MS ? at : null;
}

/** Every provider that refused for an empty balance in the last 15 minutes → when. */
export function emptyNow(now = Date.now()): Partial<Record<AiApi, number>> {
	const out: Partial<Record<AiApi, number>> = {};
	for (const api of Object.keys(map()) as AiApi[]) {
		const at = emptySince(api, now);
		if (at !== null) out[api] = at;
	}
	return out;
}
