// Generated videos the way a crew makes them, not "a prompt per clip": a cast (a character sheet made once, passed as
// the reference of every shot that shows them, a voice each), a shot list with film grammar (establishing → medium →
// close, shot / reverse shot with the 180° rule and eyelines, one light and palette per scene), every prompt built from
// the same template per model (subject, action, camera move in the model's own words, lens, light, style, mood,
// duration), continuity (the next shot of a scene starts from the previous shot's last frame), cheap first (a picture,
// then animate it; drafts at the lowest tier, the chosen at final quality). Pure: apply_plan prints the script and
// Claude runs it through `price_plan` and `generate`; the stand-in test checks references and chaining.

export type ModelFamily = "kling" | "seedance" | "veo" | "wan" | "pixverse" | "hailuo" | "runway" | "generic";

/** Camera moves by name → the words each model family responds to; and how to fake it on real footage. */
export const CAMERA_MOVES: Record<string, { words: Partial<Record<ModelFamily, string>> & { generic: string }; footage: string }> = {
	"push-in": { words: { generic: "slow push-in toward the subject", kling: "camera slowly pushes in", seedance: "[push in]", veo: "slow dolly in", runway: "camera slowly dollies forward" }, footage: "scale 1.0 → 1.08, eased" },
	"pull-out": { words: { generic: "slow pull-out revealing the scene", kling: "camera slowly pulls back", seedance: "[pull out]", veo: "slow dolly out" }, footage: "scale 1.1 → 1.0, eased" },
	dolly: { words: { generic: "smooth dolly shot", seedance: "[dolly]", veo: "tracking dolly shot" }, footage: "positionX drift 3 %, eased" },
	truck: { words: { generic: "camera trucks sideways with the subject", kling: "camera moves left alongside" }, footage: "positionX drift 5 %" },
	orbit: { words: { generic: "camera orbits around the subject", kling: "camera circles around", seedance: "[orbit]", veo: "arc shot around the subject", pixverse: "orbit shot" }, footage: "not on footage: use a generated shot" },
	crane: { words: { generic: "crane shot rising up", seedance: "[crane up]", veo: "crane shot ascending" }, footage: "positionY drift up + scale 1.05" },
	"crash-zoom": { words: { generic: "fast crash zoom into the face", seedance: "[zoom in fast]" }, footage: "scale 1.0 → 1.35 in 0.25 s" },
	"whip-pan": { words: { generic: "whip pan to the side with motion blur", kling: "fast whip pan" }, footage: "whip transition (energetic presets only)" },
	handheld: { words: { generic: "handheld camera, subtle natural shake", veo: "handheld documentary camera" }, footage: "tiny position noise ±4 px" },
	static: { words: { generic: "locked-off static camera, tripod" }, footage: "no move" },
	"dolly-zoom": { words: { generic: "dolly zoom, vertigo effect" }, footage: "not on footage" },
	fpv: { words: { generic: "FPV drone flying fast through the scene" }, footage: "not on footage" },
	"ken-burns": { words: { generic: "slow pan and zoom over a still" }, footage: "scale 1.0 → 1.1 + drift, eased" },
	tilt: { words: { generic: "camera tilts up slowly", seedance: "[tilt up]" }, footage: "positionY drift" },
	"over-shoulder": { words: { generic: "over-the-shoulder shot" }, footage: "framing only" },
};

export interface CastMember {
	id: string;
	name: string;
	/** Face, build, age, hair; outfit kept in every shot. */
	look: string;
	outfit: string;
	/** Media id of the character sheet (or the user's photo) once made: every shot that shows them passes it. */
	sheet?: string;
	voice?: string;
	/** Screen side in a two-shot scene (180° rule): A stays left looking right, B right looking left. */
	side?: "left" | "right";
}

export interface Shot {
	n: number;
	scene: number;
	size: "establishing" | "wide" | "medium" | "close" | "over-shoulder";
	who: string[];
	action: string;
	move: keyof typeof CAMERA_MOVES;
	seconds: number;
	line?: { who: string; text: string };
	/** Starts from the previous shot's last frame (same scene). */
	chain: boolean;
}

export interface Scene {
	n: number;
	place: string;
	light: string;
	palette: string;
}

const LENS: Record<Shot["size"], string> = { establishing: "24mm wide lens", wide: "28mm lens", medium: "35mm lens", close: "85mm lens, shallow depth of field", "over-shoulder": "50mm lens over the shoulder" };

/** A character sheet prompt: three views, the same outfit, a plain background — made once, the cheapest good model. */
export function castSheetPrompt(c: CastMember, style: string): string {
	return `Character sheet of ${c.name}: ${c.look}, wearing ${c.outfit}. Three views side by side — front, three-quarter, profile — same outfit and lighting, neutral grey background, full body and a head close-up. ${style}.`;
}

/** One shot's prompt from the template: subject, action, camera move in the model's words, lens, light, style, mood, duration. */
export function shotPrompt(shot: Shot, scene: Scene, cast: CastMember[], style: string, mood: string, family: ModelFamily = "generic"): string {
	const who = shot.who.map((id) => cast.find((c) => c.id === id)).filter((c): c is CastMember => !!c);
	const subject = who.length ? who.map((c) => `${c.name} (${c.look}, ${c.outfit}${c.side ? `, on the ${c.side} of the frame looking ${c.side === "left" ? "right" : "left"}` : ""})`).join(" and ") : "the scene";
	const move = CAMERA_MOVES[shot.move]?.words[family] ?? CAMERA_MOVES[shot.move]?.words.generic ?? "static camera";
	return [`${shot.size === "establishing" ? "Establishing shot of" : `${shot.size[0].toUpperCase()}${shot.size.slice(1)} shot of`} ${subject} in ${scene.place}`, shot.action, `${move}, ${LENS[shot.size]}`, `${scene.light}, palette ${scene.palette}`, style, mood, `${shot.seconds} seconds`].filter(Boolean).join(". ");
}

/** Film grammar for a scene: establishing → medium → close; a dialogue alternates over-shoulders with the 180° rule. */
export function shotList({ lines, cast, seconds, scenes = 1 }: { lines: Array<{ who?: string; text: string; action?: string }>; cast: CastMember[]; seconds: number; scenes?: number }): Shot[] {
	const per = Math.max(2, Math.min(6, seconds / Math.max(3, lines.length + 1)));
	const out: Shot[] = [];
	const dialogue = cast.length >= 2 && lines.some((l) => l.who);
	if (dialogue) {
		cast[0].side = "left";
		cast[1].side = "right";
	}
	for (let s = 0; s < scenes; s++) {
		const mine = lines.filter((_, i) => Math.floor((i * scenes) / Math.max(1, lines.length)) === s);
		out.push({ n: out.length + 1, scene: s + 1, size: "establishing", who: cast.map((c) => c.id), action: mine[0]?.action ?? "the moment before it starts", move: "push-in", seconds: Math.round(per * 10) / 10, chain: false });
		mine.forEach((l, i) => {
			const size: Shot["size"] = dialogue ? "over-shoulder" : i === 0 ? "medium" : i % 2 ? "close" : "medium";
			out.push({ n: out.length + 1, scene: s + 1, size, who: l.who ? [l.who] : cast.slice(0, 1).map((c) => c.id), action: l.action ?? (l.who ? `${cast.find((c) => c.id === l.who)?.name ?? "they"} speaks` : "reacts"), move: size === "close" ? "static" : i % 2 ? "push-in" : "dolly", seconds: Math.round(per * 10) / 10, ...(l.who ? { line: { who: l.who, text: l.text } } : {}), chain: true });
		});
	}
	return out;
}

export interface ScriptStep {
	step: string;
	tool: string;
	args: Record<string, unknown>;
	/** What the step's result is called in later steps. */
	as?: string;
}

/**
 * The production script for a generated video: price first, the cast sheets once, each shot as a cheap picture with the
 * cast's references, then animated from it (480p drafts, the chosen one at final quality), the next shot of the scene
 * started from the previous shot's last frame, the voices, lipsync where a face speaks, then apply_plan assembles.
 */
export function productionScript({ shots, scenes, cast, style, mood, family = "generic", aspect }: { shots: Shot[]; scenes: Scene[]; cast: CastMember[]; style: string; mood: string; family?: ModelFamily; aspect: string }): ScriptStep[] {
	const steps: ScriptStep[] = [];
	// Cheap first: the cheapest model that takes the inputs, priced exactly the way generate picks it (same kind, mode,
	// shape and number of references: claude-connect's cheapestOf() behind both).
	const cheapest = { model: "cheapest" } as const;
	const sheetsToMake = cast.filter((c) => !c.sheet);
	// Each shot's picture: the cast's references in every shot that shows them; the same scene goes on from the last frame
	// of the shot before (light, place and clothes carried over), re-framed by the prompt.
	const pictures: Array<{ shot: Shot; refs: string[] }> = [];
	for (const [i, shot] of shots.entries()) {
		const before = shots[i - 1];
		const sheets = shot.who.map((id) => cast.find((c) => c.id === id)?.sheet ?? `SHEET_${id}`);
		const chained = shot.chain && !!before && before.scene === shot.scene;
		pictures.push({ shot, refs: chained ? [`CLIP_${before.n}@last`, ...sheets] : sheets });
	}
	const seconds = (x: Shot) => Math.max(5, Math.ceil(x.seconds));
	const videoSeconds = shots.reduce((s, x) => s + seconds(x), 0);
	const byRefs = [...new Set(pictures.map((p) => p.refs.length))];
	const items = [
		...(sheetsToMake.length ? [{ kind: "image", aspect: "16:9", count: sheetsToMake.length, ...cheapest }] : []),
		...byRefs.map((n) => ({ kind: "image", aspect, ...(n ? { refs: n } : {}), count: pictures.filter((p) => p.refs.length === n).length, ...cheapest })),
		...[...new Set(shots.map(seconds))].map((d) => ({ kind: "video", mode: "image", quality: "480p", aspect, duration: d, count: shots.filter((x) => seconds(x) === d).length, ...cheapest })),
		...(shots.some((x) => x.line) ? [{ kind: "voice", chars: shots.reduce((s, x) => s + (x.line?.text.length ?? 0), 0) }] : []),
		...(shots.some((s) => s.line) ? [{ kind: "lipsync", duration: shots.filter((s) => s.line).reduce((a, s) => a + s.seconds, 0), ...cheapest }] : []),
	];
	steps.push({ step: "price everything first (drafts at 480p, the cheapest models)", tool: "price_plan", args: { items }, as: `≈ ${videoSeconds} s of video` });
	for (const c of sheetsToMake) {
		steps.push({ step: `cast sheet of ${c.name}, once`, tool: "generate", args: { kind: "image", aspect: "16:9", prompt: castSheetPrompt(c, style), place: false, ...cheapest }, as: `SHEET_${c.id}` });
	}
	for (const { shot, refs } of pictures) {
		const scene = scenes.find((s) => s.n === shot.scene) ?? scenes[0];
		const prompt = shotPrompt(shot, scene, cast, style, mood, family);
		steps.push({ step: `shot ${shot.n} (${shot.size}, scene ${shot.scene}) — picture`, tool: "generate", args: { kind: "image", aspect, prompt, refs, place: false, ...cheapest }, as: `PIC_${shot.n}` });
		steps.push({ step: `shot ${shot.n} — animate from the picture, 480p draft (run twice with seed 1 and 2 when it matters, keep the better)`, tool: "generate", args: { kind: "video", mode: "image", quality: "480p", duration: seconds(shot), aspect, from: `PIC_${shot.n}`, prompt: `${CAMERA_MOVES[shot.move]?.words[family] ?? CAMERA_MOVES[shot.move]?.words.generic}; ${shot.action}`, seed: 1, place: false, ...cheapest }, as: `CLIP_${shot.n}` });
		if (shot.line) {
			const who = cast.find((c) => c.id === shot.line!.who);
			steps.push({ step: `shot ${shot.n} — ${who?.name ?? "the speaker"}'s line`, tool: "generate", args: { kind: "voice", text: shot.line.text, ...(who?.voice ? { speaker: who.voice } : {}), place: false }, as: `VOICE_${shot.n}` });
			steps.push({ step: `shot ${shot.n} — lipsync`, tool: "generate", args: { kind: "lipsync", id: `CLIP_${shot.n}`, text: shot.line.text, ...cheapest }, as: `CLIP_${shot.n}` });
		}
	}
	steps.push({ step: "the chosen drafts again at final quality (only those)", tool: "generate", args: { kind: "video", mode: "image", quality: "1080p", from: "PIC_n of each chosen shot", seed: "the draft's seed", model: "the draft's model" } });
	steps.push({ step: "assemble: cuts on the voice, captions, music scored to the cuts, ambience and sounds per scene, one grade", tool: "apply_plan", args: { recipe: "ai-short" } });
	return steps;
}
