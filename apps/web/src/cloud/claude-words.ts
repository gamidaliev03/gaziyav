// buttons show («Press Retry») in Claude's own terms, the time-limit line, and every input a kind or video mode needs at
// once. Pure: the agent's generate and lipsync (agent/tools.ts) use it.
type Args = Record<string, unknown>;

/**
 * Claude's own words for a provider's sentence written for the app's buttons: Claude has no Retry button (B19/A5) — the
 * same call again comes back to the same job, never paid twice; «pick another model» names one.
 */
export function forClaude(text: string, other?: string): string {
	const use = other ? `use ${other}` : "use another model (price_plan {kind, mode} lists them)";
	return text
		.replace(/Press Retry to keep waiting for this task, or pick another model\./g, `Send the same call again to keep waiting for this task (never paid twice), or ${use}.`)
		.replace(/Press Retry, or pick another model\./g, `Send the same call again, or ${use}.`)
		.replace(/Press Retry/g, "Send the same call again")
		.replace(/press Retry/g, "send the same call again")
		.replace(/\bor pick another model\b/g, `or ${use}`)
		.replace(/\bpick another model\b/gi, use)
		.replace(/\bPick it again\b/g, "Send the call again");
}

/**
 * A job that ran out of time, as one line (B1/A5): «kie.ai didn't finish this picture in 4 min; nothing charged if it never
 * started; use model X or reword». Null for any other error.
 */
export function lateLine(error: string, what: "picture" | "video", other?: string): string | null {
	const late = /(fal\.ai|kie\.ai|ArgoLink) didn't finish within (\d+) min/.exec(error) ?? /(kie\.ai) never started this task[^.]*? for (\d+) min/.exec(error);
	if (!late) return null;
	const [, who, min] = late;
	const never = /never started/.test(error);
	const bill = never ? "it never started: nothing was charged" : who === "fal.ai" ? "fal.ai cancelled it: nothing is charged for it" : `nothing is charged if it never started (it was running, and ${who} can't stop it: the same call again follows that task, never paid twice)`;
	return `${who} didn't finish this ${what} in ${min} min; ${bill}; ${other ? `use ${other}` : "use another model (price_plan {kind, mode} lists them)"} or reword.`;
}

/** What each kind and video mode needs from Claude, by the tool's own argument names (A14: one missing input at a time cost 6 calls). */
const NEEDS: Record<string, Array<{ arg: string; what: string; has: (a: Args) => boolean }>> = (() => {
	const has = (k: string) => (a: Args) => (Array.isArray(a[k]) ? (a[k] as unknown[]).length > 0 : a[k] !== undefined && a[k] !== null && String(a[k]).trim() !== "");
	const prompt = (what: string) => ({ arg: "prompt", what, has: has("prompt") });
	const from = (what: string) => ({ arg: "from", what, has: has("from") });
	const clip = (what: string) => ({ arg: "clip", what, has: has("clip") });
	return {
		picture: [prompt("what to draw")],
		text: [prompt("what happens in the shot")],
		image: [from("Media picture: the first frame (or '<clip id>@last')"), prompt("what happens")],
		frames: [from("Media picture: the first frame"), { arg: "end", what: "Media picture: the last frame", has: has("end") }, prompt("what happens between them")],
		reference: [{ arg: "refs or cast", what: "reference pictures", has: (a) => has("refs")(a) || has("cast")(a) }, prompt("what happens")],
		motion: [from("Media photo of the character"), clip("the motion: a Media video or a timeline clip")],
		edit: [clip("the clip to change: a Media video or a timeline clip"), prompt("what to change")],
		avatar: [from("Media photo of the person"), { arg: "sound", what: "a Media sound (soundFrom/soundTo for a piece) or a timeline audio clip (only its trimmed piece is sent)", has: has("sound") }],
		extend: [clip("the clip to continue: a Media video or a timeline clip"), prompt("what happens next")],
	};
})();

/** «Not run: video avatar needs from (…), sound (…), prompt optional — missing: from. Nothing was spent.», or null. */
export function missingInputs(kind: "image" | "video", mode: string, args: Args): string | null {
	const key = kind === "image" ? "picture" : mode || (args.from ? "image" : "text");
	const needs = NEEDS[key] ?? [];
	const missing = needs.filter((n) => !n.has(args));
	if (!missing.length) return null;
	const optional = key === "avatar" || key === "motion" ? ", prompt (optional)" : "";
	return `Not run: ${kind === "image" ? "a picture" : `video mode ${key}`} needs ${needs.map((n) => `${n.arg} (${n.what})`).join(", ")}${optional} — missing: ${missing.map((n) => n.arg).join(", ")}. Nothing was spent.`;
}

