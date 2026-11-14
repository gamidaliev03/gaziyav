// What a person can make with «Assemble»: the cards of the sheet, each a recipe of production/recipes.ts that works from
// the person's own footage with no paid step, with the options a first cut needs. Pure data.
import type { RecipeId } from "@/production/recipes";
import type { PresetId } from "@/production/presets";

export type KindId = "talking" | "interview" | "reel" | "clip" | "tutorial" | "story" | "documentary";
export type LengthMode = "all" | "tight" | "minutes";
export type Frame = "footage" | "16:9" | "9:16";

export interface Kind {
	id: KindId;
	title: string;
	line: string;
	/** Typical length, as the card says it. */
	typical: string;
	recipe: RecipeId;
	preset?: PresetId;
	/** Speech leads (cut by words) or pictures lead (cut on the music). */
	lead: "speech" | "pictures";
	defaults: { length: LengthMode; minutes: number; captions: boolean; music: boolean; mood: string; frame: Frame };
	/** The platform when the frame is vertical / not. */
	vertical: string;
	wide: string;
}

export const KINDS: Kind[] = [
	{ id: "talking", title: "Talking video", line: "One person to camera: pauses and slips cut", typical: "5–20 min", recipe: "youtube-video", lead: "speech", defaults: { length: "all", minutes: 8, captions: true, music: false, mood: "calm", frame: "footage" }, vertical: "reels", wide: "youtube" },
	{ id: "interview", title: "Interview or podcast", line: "A conversation, tidy and even in sound", typical: "10–60 min", recipe: "youtube-video", preset: "podcast", lead: "speech", defaults: { length: "all", minutes: 20, captions: true, music: false, mood: "calm", frame: "footage" }, vertical: "reels", wide: "youtube" },
	{ id: "reel", title: "Reel from a talking head", line: "The strongest lines as a vertical reel", typical: "15–45 s", recipe: "reel-talking-head", lead: "speech", defaults: { length: "minutes", minutes: 0.5, captions: true, music: true, mood: "upbeat", frame: "9:16" }, vertical: "reels", wide: "youtube" },
	{ id: "clip", title: "Clip from a long recording", line: "The best minute of a stream or a podcast", typical: "20–60 s", recipe: "podcast-clips", lead: "speech", defaults: { length: "minutes", minutes: 1, captions: true, music: false, mood: "calm", frame: "9:16" }, vertical: "reels", wide: "youtube" },
	{ id: "tutorial", title: "Screen tutorial", line: "A screen recording with your voice, step by step", typical: "2–15 min", recipe: "screen-tutorial", lead: "speech", defaults: { length: "all", minutes: 5, captions: true, music: false, mood: "calm", frame: "footage" }, vertical: "reels", wide: "youtube" },
	{ id: "story", title: "Photo and video story", line: "Clips and photos cut to the beat of music", typical: "30 s – 3 min", recipe: "photo-story", lead: "pictures", defaults: { length: "all", minutes: 1, captions: false, music: true, mood: "warm", frame: "footage" }, vertical: "reels", wide: "youtube" },
	{ id: "documentary", title: "Documentary with commentary", line: "Your voice over your footage, in chapters", typical: "5–30 min", recipe: "documentary", lead: "speech", defaults: { length: "all", minutes: 10, captions: true, music: true, mood: "cinematic", frame: "footage" }, vertical: "reels", wide: "youtube" },
];

export const kindOf = (id: string | null | undefined): Kind => KINDS.find((k) => k.id === id) ?? KINDS[0];

export interface AssembleOptions {
	kind: KindId;
	length: LengthMode;
	minutes: number;
	captions: boolean;
	/** Language of captions and titles: as spoken, or one of the two. */
	language: "auto" | "ru" | "en";
	music: boolean;
	mood: string;
	frame: Frame;
}

export const MOODS = ["calm", "warm", "upbeat", "cinematic"] as const;

export function optionsFor(kind: Kind, prev?: Partial<AssembleOptions>): AssembleOptions {
	return { kind: kind.id, ...kind.defaults, language: prev?.language ?? "auto", ...(prev?.kind === kind.id ? prev : {}) } as AssembleOptions;
}

export type StepId = "listen" | "takes" | "repeats" | "pauses" | "fillers" | "length" | "lay" | "sound" | "music" | "captions" | "title" | "check";

/** The plain list «What will happen» for a choice (the run's steps in the same words). */
export function stepsFor(o: AssembleOptions): Array<{ id: StepId; title: string }> {
	const kind = kindOf(o.kind);
	const out: Array<{ id: StepId; title: string }> = [{ id: "listen", title: kind.lead === "speech" ? "Listening" : "Looking at the material" }];
	if (kind.lead === "speech") {
		out.push({ id: "takes", title: "Finding the best takes" }, { id: "pauses", title: "Cutting pauses and repeats" });
	}
	out.push({ id: "lay", title: "Laying the cut" });
	if (kind.lead === "speech") out.push({ id: "sound", title: "Evening the sound" });
	if (o.music) out.push({ id: "music", title: "Music" });
	if (o.captions && kind.lead === "speech") out.push({ id: "captions", title: "Captions" });
	out.push({ id: "check", title: "Checking" });
	return out;
}
