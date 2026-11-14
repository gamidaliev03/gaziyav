// The user's taste, kept by the app so a brief of a few words is enough («рилс из этого», «ютуб на 8 минут про X»):
// where they post, the look, the budget, captions, voice, music, usual lengths, the brand kit. Sensible defaults; it
// learns from what the user keeps (a caption font changed in the editor, the music turned down) and from what they
// tell Claude (taste_profile {set}). Pure: the server stores it (production/server/store.ts), the tools read it.
import { type PlatformId, platformSpec } from "@/platforms/table";
import { PRESET_IDS, type PresetId } from "./presets";
import { RECIPE_IDS, type RecipeId } from "./recipes";

export interface BrandKit {
	name?: string;
	/** Title and text fonts (bundled families). */
	display?: string;
	text?: string;
	ink?: string;
	accent?: string;
	plate?: string;
	/** Media id of the logo in the project (the user imports it once). */
	logo?: string;
	/** @handle or site for the CTA. */
	handle?: string;
	cta?: string;
}

export interface TasteProfile {
	platform: PlatformId;
	preset: PresetId;
	recipe: RecipeId;
	/** US dollars per video for paid generation (0 = free sources only), when `budgetMode` is "video". */
	budget: number;
	/**
	 * price question — a paid step stops only when its provider's balance can't cover it. "video": `budget` is the cap of
	 * every video. A budget the user names for one video (price_plan {budget}) caps that video either way.
	 */
	budgetMode: "balance" | "video";
	captions: { style?: string; font?: string; color?: string; uppercase?: boolean; off?: boolean };
	/** A ready voice id for voice-overs (null: the speaker's own / none). */
	voice: string | null;
	music: { mood?: string; levelDb: number; off?: boolean };
	/** Usual lengths, seconds. */
	seconds: { short: number; long: number };
	brand: BrandKit;
	/** Where finished videos go (Share → Post / export presets). */
	targets: PlatformId[];
	language: "auto" | "ru" | "en";
	/** What the profile learned from the user's own changes (newest first). */
	learned: Array<{ key: string; value: string | number | boolean; at: number }>;
	updatedAt: number;
}

export const DEFAULT_TASTE: TasteProfile = {
	platform: "reels",
	preset: "clean-premium",
	recipe: "reel-talking-head",
	budget: 1,
	budgetMode: "balance",
	captions: {},
	voice: null,
	music: { levelDb: 0 },
	seconds: { short: 30, long: 480 },
	brand: {},
	targets: ["reels", "tiktok", "shorts"],
	language: "auto",
	learned: [],
	updatedAt: 0,
};

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const clampNum = (v: unknown, lo: number, hi: number, fallback: number) => {
	const n = Number(v);
	return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

/** A profile from anything stored or sent (unknown keys dropped, bad values back to the default). */
export function normalizeTaste(raw: unknown): TasteProfile {
	const r = (raw && typeof raw === "object" ? raw : {}) as Partial<TasteProfile> & Record<string, unknown>;
	const d = DEFAULT_TASTE;
	const brandIn = (r.brand && typeof r.brand === "object" ? r.brand : {}) as BrandKit;
	const brand: BrandKit = {};
	for (const k of ["name", "display", "text", "logo", "handle", "cta"] as const) if (typeof brandIn[k] === "string" && brandIn[k]!.trim()) brand[k] = brandIn[k]!.trim().slice(0, 120);
	for (const k of ["ink", "accent", "plate"] as const) if (typeof brandIn[k] === "string" && HEX.test(brandIn[k]!)) brand[k] = brandIn[k];
	const capIn = (r.captions && typeof r.captions === "object" ? r.captions : {}) as TasteProfile["captions"];
	const musicIn = (r.music && typeof r.music === "object" ? r.music : {}) as TasteProfile["music"];
	const secIn = (r.seconds && typeof r.seconds === "object" ? r.seconds : {}) as Partial<TasteProfile["seconds"]>;
	const targets = Array.isArray(r.targets) ? r.targets.map((t) => platformSpec(String(t))?.id).filter((t): t is PlatformId => !!t) : d.targets;
	return {
		platform: platformSpec(String(r.platform ?? ""))?.id ?? d.platform,
		preset: PRESET_IDS.includes(r.preset as PresetId) ? (r.preset as PresetId) : d.preset,
		recipe: RECIPE_IDS.includes(r.recipe as RecipeId) ? (r.recipe as RecipeId) : d.recipe,
		budget: clampNum(r.budget, 0, 1000, d.budget),
		budgetMode: r.budgetMode === "video" ? "video" : r.budgetMode === "balance" ? "balance" : d.budgetMode,
		captions: {
			...(typeof capIn.style === "string" && capIn.style ? { style: capIn.style.slice(0, 60) } : {}),
			...(typeof capIn.font === "string" && capIn.font ? { font: capIn.font.slice(0, 60) } : {}),
			...(typeof capIn.color === "string" && HEX.test(capIn.color) ? { color: capIn.color } : {}),
			...(typeof capIn.uppercase === "boolean" ? { uppercase: capIn.uppercase } : {}),
			...(capIn.off === true ? { off: true } : {}),
		},
		voice: typeof r.voice === "string" && r.voice ? r.voice.slice(0, 80) : null,
		music: {
			...(typeof musicIn.mood === "string" && musicIn.mood ? { mood: musicIn.mood.slice(0, 80) } : {}),
			levelDb: clampNum(musicIn.levelDb, -20, 6, 0),
			...(musicIn.off === true ? { off: true } : {}),
		},
		seconds: { short: clampNum(secIn.short, 5, 180, d.seconds.short), long: clampNum(secIn.long, 30, 7200, d.seconds.long) },
		brand,
		targets: targets.length ? [...new Set(targets)] : d.targets,
		language: r.language === "ru" || r.language === "en" ? r.language : "auto",
		learned: Array.isArray(r.learned) ? r.learned.filter((l) => l && typeof l.key === "string").slice(0, 30) : [],
		updatedAt: Number(r.updatedAt) || 0,
	};
}

/** The profile with a change on top (deep for captions, music, seconds, brand). */
export function mergeTaste(base: TasteProfile, patch: Record<string, unknown>): TasteProfile {
	const p = patch as Partial<TasteProfile>;
	return normalizeTaste({
		...base,
		...p,
		// naming a per-video budget makes it the cap (unless the mode is named too)
		...(p.budget !== undefined && p.budgetMode === undefined ? { budgetMode: "video" } : {}),
		captions: { ...base.captions, ...(p.captions ?? {}) },
		music: { ...base.music, ...(p.music ?? {}) },
		seconds: { ...base.seconds, ...(p.seconds ?? {}) },
		brand: { ...base.brand, ...(p.brand ?? {}) },
		learned: base.learned,
		updatedAt: Date.now(),
	});
}

/**
 * What the user kept or changed in the editor, as a profile change: `key` is a dotted path of the profile
 * (captions.font, captions.color, captions.style, brand.display, brand.accent, music.levelDb (a difference), preset).
 */
export function learnTaste(base: TasteProfile, key: string, value: string | number | boolean, now = Date.now()): TasteProfile {
	const patch: Record<string, unknown> = {};
	const [head, tail] = key.split(".");
	if (head === "music" && tail === "levelDb") patch.music = { levelDb: base.music.levelDb + Number(value) };
	else if (head && tail) patch[head] = { [tail]: value };
	else if (head) patch[head] = value;
	const next = mergeTaste(base, patch);
	const learned = [{ key, value, at: now }, ...base.learned.filter((l) => l.key !== key)].slice(0, 30);
	return { ...next, learned };
}

/** The profile in a few lines for Claude. */
export function describeTaste(t: TasteProfile): string {
	const brand = Object.entries(t.brand).map(([k, v]) => `${k} ${v}`).join(", ");
	const caps = Object.entries(t.captions).map(([k, v]) => `${k} ${v}`).join(", ");
	return [
		`platform ${t.platform} · preset ${t.preset} · recipe ${t.recipe} · budget ${t.budgetMode === "balance" ? "the providers' balances (no per-video cap)" : `$${t.budget}/video`} · language ${t.language}`,
		`lengths: short ${t.seconds.short} s, long ${Math.round(t.seconds.long / 60)} min · post to ${t.targets.join(", ")}`,
		`captions: ${caps || "the preset's"} · music: ${t.music.off ? "off" : `${t.music.mood ?? "the preset's mood"}, ${t.music.levelDb >= 0 ? "+" : ""}${t.music.levelDb} dB`} · voice: ${t.voice ?? "the speaker's own"}`,
		`brand: ${brand || "none yet"}`,
		...(t.learned.length ? [`learned: ${t.learned.slice(0, 5).map((l) => `${l.key}=${l.value}`).join(", ")}`] : []),
	].join("\n");
}
