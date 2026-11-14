// The quality gate (docs/CLAUDE-PRODUCTION.md §3 + the owner's premium-look rules): every check an editor would make,
// on the real project, its rendered frames (judged by Apple Vision on the server) and its measured sound (ffmpeg's EBU
// R128 meter on a mix of the project's own sources). A score 0–100, the hard checks that keep Claude's export closed
// until fixed or waived, and the fixes as exact edit steps. Pure: the window gathers the inputs (produce-tools.ts).
import { dropHallucinations } from "@/hear/hallucinations";
import { PLATFORMS, type PlatformSpec, platformSpec } from "@/platforms/table";
import { type Box, centreOf, coverTransform, framingOf } from "./framing";
import type { FrameVerdict, MaterialBrief, Word } from "./material";
import type { MediaRef } from "./plan";
import type { Preset } from "./presets";
import type { Recipe, RecipeId } from "./recipes";

export const TICKS = 120000;

export interface ReviewElement {
	id: string;
	type: string;
	track: string;
	trackType: string;
	trackRole: "main" | "overlay" | "audio";
	name: string;
	start: number;
	end: number;
	mediaId?: string;
	trimStart?: number;
	params: Record<string, unknown>;
	effects?: Array<{ type: string; params: Record<string, unknown> }>;
	definitionId?: string;
	sourceUrl?: string;
	/** It has keyframes (a push-in, Ken Burns): the shot moves. */
	animated?: boolean;
	/** Stacking: 0 = the top overlay track, higher = further down; the main track is under every overlay. */
	layer?: number;
	/** Playback speed (source seconds per timeline second). */
	rate?: number;
	/** Its track is muted (the clip itself: params.muted). */
	trackMuted?: boolean;
}

/** When a performance shot (an avatar or a lipsync result) was made: the sound its lips follow. */
export interface SyncInfo {
	/** Timeline seconds where the result's second 0 belonged when it was made (its sound started there). */
	at: number;
	/** The sound it was made from: a Media id (the song, one of its stems, or a piece) and seconds into it. */
	sound?: string;
	soundFrom?: number;
}

export interface Measured {
	/** The mix as it will play (before the export's loudness step). */
	lufs: number | null;
	truePeak: number | null;
	/** Median of speech level minus music level while someone talks, dB (null: no music or no speech). */
	speechOverMusic: number | null;
	/** Loudness of each section, LUFS (sections of the plan, or thirds). */
	sections: Array<{ from: number; to: number; lufs: number | null }>;
	/** Digital silence holes over 150 ms inside the edit (seconds where they start). */
	holes: number[];
}

export interface RenderedFrame {
	t: number;
	verdict: FrameVerdict;
	faces: Array<{ box: [number, number, number, number]; eyes?: number }>;
	luma: number;
	/** Horizon angle in degrees when one was seen (the content turned clockwise is positive). */
	horizon?: number | null;
}

export interface ReviewInput {
	platform: PlatformSpec;
	preset: Preset;
	recipe: Recipe;
	canvas: { width: number; height: number };
	fps: number;
	elements: ReviewElement[];
	transitions: Array<{ type: string; at: number }>;
	media: MediaRef[];
	measured: Measured | null;
	frames: RenderedFrame[];
	/** claude-hear's cut checker: problems found at the seams (null: not run). */
	seams: { problems: number; text: string } | null;
	plannedSeconds?: number;
	/** The export brings the sound to the platform's loudness (Claude's export with a platform does). */
	exportNormalizes: boolean;
	waived: string[];
	provenance: Array<{ media: string; from: string; name: string }>;
	/** Performance shots' sound times by media id (stored when the avatar / lipsync was made). */
	sync?: Record<string, SyncInfo>;
	/** The song under a music video: its name and where its vocals are sung (timeline seconds). */
	song?: { name: string; vocals: Array<{ start: number; end: number }>; hasVocals: boolean } | null;
}

export interface EditStep {
	op: string;
	[key: string]: unknown;
}

export interface Fix {
	check: string;
	say: string;
	steps: EditStep[];
	/** The window applies it itself with review {fix:true} (no step Claude must write). */
	auto: boolean;
}

export interface Check {
	id: string;
	name: string;
	hard: boolean;
	ok: boolean;
	/** 0–1. */
	score: number;
	weight: number;
	detail: string;
	fixes: Fix[];
}

export interface ReviewResult {
	score: number;
	hardFailed: string[];
	checks: Check[];
	fixes: Fix[];
	cover: { t: number; score: number; why: string } | null;
	notes: string[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const short = (id: string) => id.slice(0, 8);
const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Where a text block sits on the frame (shares 0…1): centre from transform.positionY, height from the font size. */
export function textBox(e: ReviewElement, canvas: { width: number; height: number }): { x0: number; y0: number; x1: number; y1: number } {
	const p = e.params;
	const size = num(p.fontSize, 5);
	const lines = Math.max(1, Math.min(num(p["box.maxLines"], 2), Math.ceil(String(p.content ?? "").length / (canvas.width > canvas.height ? 34 : 14))));
	const h = (size / 90) * num(p.lineHeight, 1.1) * lines + (p["background.enabled"] ? 0.02 : 0);
	const cy = 0.5 + num(p["transform.positionY"]) / canvas.height;
	const w = Math.min(0.96, num(p["box.width"], 84) / 100);
	const cx = 0.5 + num(p["transform.positionX"]) / canvas.width;
	return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
}

const overlaps = (a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

const ENERGETIC_TRANSITION = /whip|spin|glitch|zoomPunch|shake|flash|crosswarp|Mosaic|rotate|swipe/i;

function check(id: string, name: string, hard: boolean, weight: number, score: number, detail: string, fixes: Fix[] = []): Check {
	const s = Math.max(0, Math.min(1, score));
	return { id, name, hard, ok: s >= 0.999 || (!hard && s >= 0.8), score: s, weight, detail, fixes };
}

export function runReview(input: ReviewInput): ReviewResult {
	const { platform, preset, recipe, canvas, elements } = input;
	const checks: Check[] = [];
	const notes: string[] = [];
	const total = elements.filter((e) => e.trackRole !== "audio").reduce((m, e) => Math.max(m, e.end), 0);
	const main = elements.filter((e) => e.trackRole === "main").sort((a, b) => a.start - b.start);
	const texts = elements.filter((e) => e.type === "text");
	const captions = texts.filter((e) => !!e.params["caption.style"] || (typeof e.params["caption.words"] === "string" && String(e.params["caption.words"]).trim() !== ""));
	const titles = texts.filter((e) => !captions.includes(e));
	const inserts = elements.filter((e) => e.trackRole === "overlay" && (e.type === "video" || e.type === "image"));
	const graphics = elements.filter((e) => e.type === "graphic");
	const audio = elements.filter((e) => e.type === "audio");
	const music = audio.filter((e) => e.params.duckUnderVoice === true || /music/i.test(e.name) || (e.sourceUrl ?? "").includes("/library/") && e.end - e.start > 12);
	const brief = (id?: string) => (id ? input.media.find((m) => m.id === id)?.brief : undefined);
	const speechBriefs = new Set(main.map((e) => e.mediaId).filter((id): id is string => !!brief(id)?.speech));
	const short_ = platform.review.ending === "cta-or-loop";
	// A music video is judged as one: the song carries it (no B-roll share, end screen or jump cuts to hide), every
	// second moves, the singer sings on screen. An AI short moves too.
	const musicVideo = recipe.id === "music-video";
	const generated = musicVideo || recipe.id === "ai-short";

	// ── length and frame ──
	const aspect = canvas.width / canvas.height;
	const want = platform.size.width / platform.size.height;
	checks.push(check("aspect", "Frame", true, 1, Math.abs(aspect - want) < 0.02 ? 1 : 0, Math.abs(aspect - want) < 0.02 ? `${canvas.width}×${canvas.height}` : `${canvas.width}×${canvas.height}, ${platform.label} wants ${platform.aspect}`, Math.abs(aspect - want) < 0.02 ? [] : [{ check: "aspect", say: `set the project to ${platform.aspect}`, steps: [{ op: "project", action: "settings", aspect: platform.aspect }], auto: false }]));
	const inLimits = total >= platform.minSeconds && (platform.maxSeconds === null || total <= platform.maxSeconds);
	const planned = input.plannedSeconds;
	const nearPlan = !planned || Math.abs(total - planned) <= Math.max(1.5, planned * 0.12);
	checks.push(check("length", "Length", true, 1, inLimits ? (nearPlan ? 1 : 0.85) : 0, `${r1(total)} s${planned ? ` (plan ${r1(planned)} s)` : ""}${platform.maxSeconds ? `, ${platform.label} takes ≤ ${platform.maxSeconds} s` : ""}`));

	// ── hook ──
	const first = main[0];
	const firstBrief = brief(first?.mediaId);
	const boldTitle = titles.some((t) => t.start < 0.5 && num(t.params.fontSize, 0) >= 4);
	const faceFirst = (firstBrief?.faces ?? 0) >= 0.5;
	const motionFirst = (!!firstBrief && firstBrief.motion !== "static") || (!!first && hasMotion(first));
	const firstWord = firstBrief?.speech?.words.find((w) => w.end > num(first?.trimStart) / TICKS);
	const silentStart = !!firstBrief?.speech && !!firstWord && firstWord.start - num(first?.trimStart) / TICKS > 1.0;
	const logoIntro = graphics.some((g) => g.start < 0.3 && /Logo|Intro|Reveal/i.test(String(g.definitionId)) && g.end > 1.5);
	const hookOk = (boldTitle || faceFirst || motionFirst) && !silentStart && !logoIntro;
	checks.push(check("hook", "Hook", true, 2, hookOk ? 1 : 0.3, hookOk ? `${[faceFirst && "a face", motionFirst && "motion", boldTitle && "a bold title"].filter(Boolean).join(" + ")} in the first ${platform.review.hookSeconds} s` : silentStart ? "the first words come after a silence" : logoIntro ? "a logo intro opens the video" : "no face, motion or bold title at the start", hookOk ? [] : [{ check: "hook", say: "open on the best line with a bold title", steps: [{ op: "add_text_style", style: preset.text.hook, text: "…", start: 0, duration: 2 }], auto: false }]));

	// ── pacing and jump cuts ──
	const shots: number[] = [];
	const cutsAt: number[] = [];
	for (let i = 0; i < main.length; i++) {
		const e = main[i];
		let s = e.start;
		const ins = inserts.filter((x) => x.start < e.end && x.end > e.start).sort((a, b) => a.start - b.start);
		for (const x of ins) {
			if (x.start > s) shots.push(x.start - s);
			shots.push(Math.min(x.end, e.end) - Math.max(x.start, s));
			s = Math.min(x.end, e.end);
		}
		if (e.end > s) shots.push(e.end - s);
		if (i) cutsAt.push(e.start);
	}
	const [lo, hi] = short_ ? preset.pace.reel : preset.pace.long;
	const inRange = shots.filter((d) => d >= lo * 0.6 && d <= hi * 1.6).length / Math.max(1, shots.length);
	const staticMax = platform.review.staticMaxSeconds;
	const longStatic = main.filter((e) => {
		const b = brief(e.mediaId);
		const covered = inserts.some((x) => x.start < e.end && x.end > e.start);
		return !covered && e.end - e.start > staticMax * 1.25 && (!b || b.motion === "static" || b.motion === "low") && num(e.params["transform.scaleX"], 1) === num(e.params["transform.scaleY"], 1) && !hasMotion(e);
	});
	checks.push(check("pacing", "Pace", false, 1.5, inRange * (longStatic.length ? 0.7 : 1), `${shots.length} shots, ${Math.round(inRange * 100)} % within ${lo}–${hi} s${longStatic.length ? `; ${longStatic.length} static shot(s) over ${staticMax} s` : ""}`, longStatic.slice(0, 3).map((e) => ({ check: "pacing", say: `a slow push-in on ${short(e.id)} (static ${r1(e.end - e.start)} s)`, steps: pushIn(e), auto: true }))));
	let jumps = 0;
	let covered = 0;
	const uncovered: ReviewElement[] = [];
	for (let i = 1; i < main.length; i++) {
		const a = main[i - 1];
		const b = main[i];
		if (!a.mediaId || a.mediaId !== b.mediaId || !speechBriefs.has(b.mediaId)) continue;
		jumps++;
		const scaleA = num(a.params["transform.scaleX"], 1);
		const scaleB = num(b.params["transform.scaleX"], 1);
		const hidden = Math.abs(scaleA - scaleB) / Math.max(scaleA, scaleB) >= 0.05 || inserts.some((x) => x.start <= b.start + 0.2 && x.end >= b.start - 0.2);
		if (hidden) covered++;
		else uncovered.push(b);
	}
	const jumpShare = jumps ? covered / jumps : 1;
	checks.push(check("jumpcuts", "Jump cuts covered", speechBriefs.size > 0 && !musicVideo, 1.5, jumpShare >= 0.9 ? 1 : jumpShare, jumps ? `${covered}/${jumps} jump cuts hidden by a punch-in or an insert` : "no jump cuts", uncovered.slice(0, 5).map((e) => ({ check: "jumpcuts", say: `punch in on ${short(e.id)}`, steps: [{ op: "set", id: short(e.id), params: { "transform.scaleX": r3(num(e.params["transform.scaleX"], 1) * preset.pace.punchIn), "transform.scaleY": r3(num(e.params["transform.scaleY"], 1) * preset.pace.punchIn) } }], auto: true }))));

	// ── B-roll ──
	const visualsBesides = input.media.some((m) => m.type !== "audio" && !speechBriefs.has(m.id));
	if (speechBriefs.size && visualsBesides && !musicVideo) {
		const share = inserts.reduce((s, x) => s + (x.end - x.start), 0) / Math.max(1, total);
		const [bmin, bmax] = platform.review.broll;
		const brollScore = share >= bmin && share <= bmax ? 1 : share < bmin ? 0.5 + share / bmin / 2 : 0.8;
		checks.push(check("broll", "B-roll", false, 1, brollScore, `${Math.round(share * 100)} % of the length (wanted ${Math.round(bmin * 100)}–${Math.round(bmax * 100)} %)`));
	}
	const seen = new Map<string, number>();
	for (const x of inserts) if (x.mediaId) seen.set(`${x.mediaId}@${Math.round(num(x.trimStart) / TICKS)}`, (seen.get(`${x.mediaId}@${Math.round(num(x.trimStart) / TICKS)}`) ?? 0) + 1);
	const repeats = [...seen.values()].filter((n) => n > 1).length;
	const lowRes = inserts.filter((x) => {
		const b = brief(x.mediaId);
		return !!b?.width && Math.min(b.width, b.height ?? b.width) < Math.min(canvas.width, canvas.height) * 0.5;
	});
	const marked = inserts.filter((x) => {
		const fr = brief(x.mediaId)?.frames ?? [];
		return fr.length > 0 && fr.filter((f) => f.flags.includes("watermark")).length >= Math.max(1, fr.length / 2);
	});
	checks.push(check("broll-quality", "B-roll quality", false, 0.7, (repeats ? 0.6 : 1) * (lowRes.length ? 0.7 : 1) * (marked.length ? 0.6 : 1), `${repeats ? `${repeats} shot(s) used twice` : "no shot twice"}${lowRes.length ? `, ${lowRes.length} low-res insert(s)` : ""}${marked.length ? `, ${marked.length} watermarked insert(s)` : ""}`, marked.slice(0, 3).map((x) => ({ check: "broll-quality", say: `${short(x.id)} carries a watermark: take it out`, steps: [{ op: "delete", ids: [short(x.id)] }], auto: true }))));

	// ── captions ──
	const words = [...speechBriefs].flatMap((id) => {
		const b = brief(id)!;
		return main.filter((e) => e.mediaId === id).flatMap((e) => (b.speech?.words ?? []).filter((w) => w.start >= num(e.trimStart) / TICKS - 0.01 && w.end <= num(e.trimStart) / TICKS + (e.end - e.start) + 0.01).map((w) => ({ t: e.start + (w.start + w.end) / 2 - num(e.trimStart) / TICKS })));
	});
	if (words.length) {
		const minCov = platform.captions.minCoverage;
		const shown = words.filter((w) => captions.some((c) => w.t >= c.start - 0.05 && w.t <= c.end + 0.05)).length / words.length;
		const rect = { x0: platform.safe.left / platform.size.width, x1: 1 - platform.safe.right / platform.size.width, y0: platform.safe.top / platform.size.height, y1: 1 - platform.safe.bottom / platform.size.height };
		const outside = captions.filter((c) => {
			const b = textBox(c, canvas);
			return b.y0 < rect.y0 - 0.005 || b.y1 > rect.y1 + 0.005;
		});
		// Word-timed captions (karaoke, word pop) follow the speech word by word: their pace is the speaker's, not a
		// reading speed. Sentence subtitles are read: ≤ maxCps characters a second.
		const fast = captions.filter((c) => !String(c.params["caption.words"] ?? "").trim() && String(c.params.content ?? "").length / Math.max(0.3, c.end - c.start) > platform.captions.maxCps);
		const lines = captions.filter((c) => num(c.params["box.maxLines"], 2) > platform.captions.maxLines);
		const weak = captions.filter((c) => !c.params["stroke.enabled"] && !c.params["shadow.enabled"] && !c.params["background.enabled"]);
		if (minCov > 0 || captions.length) {
			const covScore = minCov > 0 ? (shown >= minCov - 0.02 ? 1 - Math.max(0, minCov - shown) : Math.min(1, shown / minCov) * 0.9) : 1;
			const score = covScore * (outside.length ? 0.5 : 1);
			const style = (fast.length / Math.max(1, captions.length) > 0.1 ? 0.7 : 1) * (lines.length ? 0.8 : 1) * (weak.length ? 0.8 : 1);
			checks.push(check("caption-style", "Caption reading", false, 0.8, style, `${fast.length ? `${fast.length} subtitle(s) faster than ${platform.captions.maxCps} chars/s` : "readable pace"}${lines.length ? `, ${lines.length} over ${platform.captions.maxLines} lines` : ""}${weak.length ? ", low contrast (no stroke, shadow or plate)" : ""}`, weak.slice(0, 20).length ? [{ check: "caption-style", say: "a soft shadow under the captions", steps: weak.slice(0, 40).map((c) => ({ op: "set", id: short(c.id), params: { "shadow.enabled": true, "shadow.color": "#000000cc", "shadow.blur": 10, "shadow.offsetY": 3 } })), auto: true }] : []));
			const fixes: Fix[] = [];
			if (outside.length) {
				const y = Math.round((platform.captions.y - 0.5) * canvas.height);
				fixes.push({ check: "captions", say: `move ${outside.length} caption(s) into the safe zone`, steps: outside.slice(0, 40).map((c) => ({ op: "set", id: short(c.id), params: { "transform.positionY": y } })), auto: true });
			}
			if (minCov > 0 && shown < minCov) fixes.push({ check: "captions", say: "add word captions", steps: [{ op: "captions", style: preset.captions.style }], auto: false });
			checks.push(check("captions", "Captions", minCov > 0 && !musicVideo && (shown < minCov - 0.02 || outside.length > 0), 2, score, `${Math.round(shown * 100)} % of speech captioned${outside.length ? `, ${outside.length} outside the safe zone` : ""}${fast.length ? `, ${fast.length} too fast (> ${platform.captions.maxCps} chars/s)` : ""}${weak.length ? ", low contrast" : ""}`, fixes));
		}
	}

	// ── text placement: faces, safe zones, other layers over captions ──
	const faceHits: Array<{ e: ReviewElement; at: number; box: [number, number, number, number] }> = [];
	// Faces at a time: what Vision saw in the rendered frame, and where the briefs' faces land after each clip's fit
	// (a title over the eyes can hide the face from the detector, never from the geometry).
	const facesAt = (t: number): Array<[number, number, number, number]> => {
		const seen = input.frames.filter((f) => Math.abs(f.t - t) < 0.6).flatMap((f) => f.faces.map((x) => x.box));
		const top = [...inserts, ...main].find((e) => e.start <= t && e.end > t);
		const b = brief(top?.mediaId);
		if (top && b?.faceBox && b.width && b.height) {
			const contain = Math.min(canvas.width / b.width, canvas.height / b.height);
			const sx = num(top.params["transform.scaleX"], 1);
			const sy = num(top.params["transform.scaleY"], 1);
			const dw = b.width * contain * sx;
			const dh = b.height * contain * sy;
			const x0 = canvas.width / 2 + num(top.params["transform.positionX"]) - dw / 2;
			const y0 = canvas.height / 2 + num(top.params["transform.positionY"]) - dh / 2;
			const [fx, fy, fw, fh] = b.faceBox;
			seen.push([(x0 + fx * dw) / canvas.width, (y0 + fy * dh) / canvas.height, (fw * dw) / canvas.width, (fh * dh) / canvas.height]);
		}
		return seen;
	};
	for (const e of texts) {
		const b = textBox(e, canvas);
		for (const t of [e.start + Math.min(0.5, (e.end - e.start) / 2), (e.start + e.end) / 2]) {
			const face = facesAt(t).find((box) => {
				const [x0, y0, w, h] = box;
				// The eyes' band: the upper half of the face.
				return w > 0.08 && overlaps(b, { x0, x1: x0 + w, y0: y0 + h * 0.15, y1: y0 + h * 0.6 });
			});
			if (face) {
				faceHits.push({ e, at: t, box: face });
				break;
			}
		}
	}
	checks.push(check("text-face", "Text off faces", true, 2, faceHits.length ? 0 : 1, faceHits.length ? `${faceHits.length} text(s) over a face's eyes (${faceHits.slice(0, 3).map((h) => `${short(h.e.id)} at ${r1(h.at)} s`).join(", ")})` : "no text over eyes", faceHits.slice(0, 5).map((h) => {
		const bottom = h.box[1] + h.box[3] + 0.03;
		const box = textBox(h.e, canvas);
		const height = box.y1 - box.y0;
		const below = bottom + height / 2;
		const safeBottom = 1 - platform.safe.bottom / platform.size.height;
		const y = below + height / 2 <= safeBottom ? below : Math.max(platform.safe.top / platform.size.height + height / 2, h.box[1] - 0.02 - height / 2);
		return { check: "text-face", say: `move ${short(h.e.id)} off the face`, steps: [{ op: "set", id: short(h.e.id), params: { "transform.positionY": Math.round((y - 0.5) * canvas.height) } }], auto: true };
	})));
	const safeRect = { x0: platform.safe.left / platform.size.width, x1: 1 - platform.safe.right / platform.size.width, y0: platform.safe.top / platform.size.height, y1: 1 - platform.safe.bottom / platform.size.height };
	const unsafeTitles = titles.filter((e) => {
		const b = textBox(e, canvas);
		return b.y0 < safeRect.y0 - 0.01 || b.y1 > safeRect.y1 + 0.01;
	});
	const coveredCaps = captions.filter((c) => {
		const cb = textBox(c, canvas);
		return titles.some((t) => t.start < c.end && t.end > c.start && overlaps(cb, textBox(t, canvas))) || graphics.some((g) => g.start < c.end && g.end > c.start && !/Grain|Light|Leak|Film/i.test(String(g.definitionId)) && /EndScreen|Subscribe|Counter|Stat|Chart|Quote/i.test(String(g.definitionId)));
	});
	checks.push(check("layout", "Layout", false, 1, (unsafeTitles.length ? 0.6 : 1) * (coveredCaps.length > 2 ? 0.7 : 1), `${unsafeTitles.length ? `${unsafeTitles.length} title(s) outside the safe zone` : "titles inside the safe zone"}${coveredCaps.length ? `, ${coveredCaps.length} caption(s) under another layer` : ""}`, unsafeTitles.slice(0, 4).map((e) => ({ check: "layout", say: `move ${short(e.id)} inside the safe zone`, steps: [{ op: "set", id: short(e.id), params: { "transform.positionY": Math.round((((safeRect.y0 + safeRect.y1) / 2) - 0.5) * canvas.height * 0.6) } }], auto: true }))));

	// ── typography, palette, motion ──
	const families = new Set<string>();
	const weights = new Set<string>();
	const offPalette: ReviewElement[] = [];
	const palette = [preset.palette.ink, preset.palette.accent, preset.palette.plate].map((c) => c.slice(0, 7).toLowerCase());
	for (const t of texts) {
		if (t.params.fontFamily) families.add(String(t.params.fontFamily));
		if (t.params.fontWeight) weights.add(String(t.params.fontWeight));
		const color = String(t.params.color ?? "").slice(0, 7).toLowerCase();
		if (color && !palette.some((p) => near(p, color))) offPalette.push(t);
	}
	const defaultTitle = titles.filter((t) => /^arial$/i.test(String(t.params.fontFamily)));
	const typeScore = (families.size <= 2 ? 1 : families.size === 3 ? 0.7 : 0.4) * (weights.size <= 2 ? 1 : 0.85) * (defaultTitle.length ? 0.5 : 1);
	checks.push(check("typography", "Typography", false, 1, typeScore, `${families.size} font(s) (${[...families].slice(0, 4).join(", ")}), ${weights.size} weight(s)${defaultTitle.length ? ", a title in the default font" : ""}`, [...defaultTitle, ...titles.filter((t) => families.size > 2 && t.params.fontFamily !== preset.fonts.display && t.params.fontFamily !== preset.fonts.text)].slice(0, 4).map((t) => ({ check: "typography", say: `title font of ${short(t.id)} → ${preset.fonts.display}`, steps: [{ op: "set", id: short(t.id), params: { fontFamily: preset.fonts.display, fontWeight: preset.fonts.displayWeight } }], auto: true }))));
	checks.push(check("palette", "Palette", false, 0.8, offPalette.length ? Math.max(0.4, 1 - offPalette.length / Math.max(4, texts.length)) : 1, offPalette.length ? `${offPalette.length} text(s) off the palette (${palette.join(" ")})` : `text in ${palette.join(" ")}`, offPalette.slice(0, 4).map((t) => ({ check: "palette", say: `colour of ${short(t.id)} → ink`, steps: [{ op: "set", id: short(t.id), params: { color: preset.palette.ink } }], auto: true }))));
	const pops = titles.filter((t) => String(t.params["anim.in"] ?? "none") === "none" && !t.params["design.id"]);
	const slow = titles.filter((t) => String(t.params["anim.in"]) === "fade" && (num(t.params["anim.inDuration"], 0.3) < 0.15 || num(t.params["anim.inDuration"], 0.3) > 0.6));
	const kinds = new Set(input.transitions.map((t) => t.type));
	const cheap = input.transitions.filter((t) => ENERGETIC_TRANSITION.test(t.type) && !preset.energetic);
	const motionScore = (pops.length ? 0.6 : 1) * (slow.length ? 0.9 : 1) * (kinds.size > 1 ? 0.7 : 1) * (cheap.length ? 0.6 : 1) * (input.transitions.length > Math.max(2, cutsAt.length * 0.3) ? 0.8 : 1);
	checks.push(check("motion", "Motion", false, 1, motionScore, `${pops.length ? `${pops.length} text(s) pop in without motion; ` : ""}${input.transitions.length} transition(s) of ${kinds.size} style(s)${cheap.length ? `, ${cheap.length} cheap wipe/spin` : ""}, ${cutsAt.length - input.transitions.length} straight cuts`, pops.slice(0, 4).map((t) => ({ check: "motion", say: `ease ${short(t.id)} in`, steps: [{ op: "set", id: short(t.id), params: { "anim.in": "fade", "anim.inDuration": preset.moves.inSeconds, "anim.out": "fade", "anim.outDuration": preset.moves.outSeconds } }], auto: true }))));

	// ── colour: one grade, shots matched, skin kept ──
	const visual = [...main, ...inserts].filter((e) => e.mediaId);
	const looks = new Set(visual.map((e) => String(e.effects?.find((f) => f.type === "studio.color")?.params.look ?? "none")));
	const lumas = visual
		.map((e) => {
			const b = brief(e.mediaId);
			if (!b?.exposure) return null;
			const exp = num(e.effects?.find((f) => f.type === "studio.color")?.params.exposure, 0);
			return Math.min(1, b.exposure.luma * 2 ** exp);
		})
		.filter((x): x is number => x !== null);
	const spread = lumas.length > 1 ? Math.max(...lumas) - Math.min(...lumas) : 0;
	checks.push(check("grade", "One grade", false, 1, (looks.size <= 1 ? 1 : 0.6) * (spread <= 0.18 ? 1 : spread <= 0.3 ? 0.8 : 0.6), `${looks.size} look(s) (${[...looks].join(", ")}), exposure spread ${Math.round(spread * 100)} %`, looks.size > 1 ? visual.filter((e) => String(e.effects?.find((f) => f.type === "studio.color")?.params.look ?? "none") !== preset.grade.look).slice(0, 6).map((e) => ({ check: "grade", say: `${preset.grade.look} on ${short(e.id)}`, steps: [{ op: "apply_filter", id: short(e.id), look: preset.grade.look }], auto: true })) : []));

	// ── sound ──
	const m = input.measured;
	const audible = elements.some((e) => (e.type === "audio" || e.type === "video") && e.params.muted !== true && num(e.params.volume, 0) > -59 && (e.type === "audio" || !!brief(e.mediaId)?.hasAudio));
	const notBriefed = [...new Set([...main, ...inserts].map((e) => e.mediaId).filter((id): id is string => !!id && !brief(id)))];
	if (notBriefed.length) notes.push(`${notBriefed.length} media not analysed yet (${notBriefed.slice(0, 4).map((id) => input.media.find((m) => m.id === id)?.name ?? short(id)).join(", ")}): judged on the rendered frames only — review again in a minute for the full checks`);
	if (!audible) notes.push("no sound in this edit: loudness not checked");
	else if (!m) notes.push("the mix wasn't measured in time: loudness not checked this round (review again)");
	if (m && audible) {
		const target = platform.export.lufs;
		const after = input.exportNormalizes && m.lufs !== null ? target : m.lufs;
		const peakAfter = m.truePeak !== null && m.lufs !== null && input.exportNormalizes ? m.truePeak + (target - m.lufs) : m.truePeak;
		const loudOk = after !== null && Math.abs(after - target) <= 1;
		// The export's limiter holds peaks to −1 dBTP when it normalizes (media/audio-mastering.ts).
		const peakOk = input.exportNormalizes || (peakAfter ?? -99) <= -1;
		checks.push(check("loudness", "Loudness", true, 2, loudOk && peakOk ? 1 : 0.2, `mix ${m.lufs ?? "?"} LUFS, true peak ${m.truePeak ?? "?"} dBTP${input.exportNormalizes ? ` → ${target} LUFS at export` : ""}`, loudOk ? [] : [{ check: "loudness", say: `export with platform ${platform.id} (brings it to ${target} LUFS)`, steps: [{ op: "export", platform: platform.id }], auto: false }]));
		// A song's vocals are part of the song (its stems together are the song): no «music under speech» rule there.
		if (m.speechOverMusic !== null && !musicVideo) {
			const gap = m.speechOverMusic;
			const fix = Math.ceil(12.5 - gap);
			checks.push(check("music-level", "Music under speech", false, 1.2, gap >= 12 ? 1 : gap >= 9 ? 0.7 : 0.3, `music ${r1(gap)} dB under speech (≥ 12 wanted)`, gap >= 12 ? [] : music.slice(0, 2).map((e) => ({ check: "music-level", say: `music ${short(e.id)} ${fix} dB down`, steps: [{ op: "set", id: short(e.id), params: { volume: r1(num(e.params.volume) - fix) } }], auto: true }))));
		}
		const secs = m.sections.filter((s) => s.lufs !== null) as Array<{ from: number; to: number; lufs: number }>;
		if (secs.length > 1) {
			const spread = Math.max(...secs.map((s) => s.lufs)) - Math.min(...secs.map((s) => s.lufs));
			checks.push(check("sections", "Even loudness", false, 0.6, spread <= 4 ? 1 : spread <= 7 ? 0.7 : 0.4, `sections within ${r1(spread)} LU`));
		}
		checks.push(check("holes", "No silence holes", false, 0.6, m.holes.length ? 0.5 : 1, m.holes.length ? `${m.holes.length} hole(s) of silence at ${m.holes.slice(0, 4).map((h) => r1(h)).join(", ")} s` : "no holes"));
	}
	for (const e of music) {
		const b = input.media.find((x) => x.id === e.mediaId)?.brief;
		const fade = num(e.params.fadeOut);
		const ends = Math.abs(e.end - total) < 0.6;
		const onBar = fade >= 0.8 || !!b?.music?.downbeats.some((d) => Math.abs(d - (num(e.trimStart) / TICKS + e.end - e.start)) < 0.12);
		checks.push(check("music-end", "Music ends cleanly", false, 0.6, ends && onBar ? 1 : 0.6, ends ? (onBar ? "ends with the video, on a bar / faded" : "cut off at the end") : `ends ${r1(Math.abs(total - e.end))} s from the video's end`, ends && onBar ? [] : [{ check: "music-end", say: `fade the music out`, steps: [{ op: "set", id: short(e.id), params: { fadeOut: 1.5 } }], auto: true }]));
		break;
	}
	const sfx = audio.filter((e) => !music.includes(e) && e.end - e.start < 6);
	if (sfx.length) {
		const dense = sfx.length / Math.max(1, total / 5);
		checks.push(check("sfx", "Sound effects", false, 0.5, dense <= 1 ? 1 : 0.6, `${sfx.length} sound(s) — ${dense <= 1 ? "at structure points" : "too many"}`));
	}
	if (input.seams) checks.push(check("seams", "Cuts by ear", false, 1, input.seams.problems ? Math.max(0.4, 1 - input.seams.problems * 0.1) : 1, input.seams.problems ? `${input.seams.problems} seam problem(s): ${input.seams.text.slice(0, 160)}` : "every cut clean", input.seams.problems ? [{ check: "seams", say: "fix the seams", steps: [{ op: "check_cuts", fix: true }], auto: false }] : []));

	// ── picture: black/flash frames, soft upscales, beauty of the rendered frames ──
	const gaps: number[] = [];
	for (let i = 1; i < main.length; i++) if (main[i].start - main[i - 1].end > 1 / input.fps) gaps.push(main[i - 1].end);
	const flashes = [...main, ...inserts].filter((e) => e.end - e.start < 2 / input.fps);
	const blackFrames = input.frames.filter((f) => f.luma < 0.02 && f.t > 0.2 && f.t < total - 0.2);
	checks.push(check("black", "No black or flash frames", true, 1.5, gaps.length || flashes.length || blackFrames.length ? 0 : 1, gaps.length || flashes.length || blackFrames.length ? `${gaps.length} gap(s), ${flashes.length} flash frame(s), ${blackFrames.length} black frame(s) seen` : "none", gaps.slice(0, 3).map((g) => ({ check: "black", say: `close the gap at ${r1(g)} s`, steps: [{ op: "action", name: "ripple-delete" }], auto: false }))));
	const soft = [...main, ...inserts].filter((e) => {
		const b = brief(e.mediaId);
		if (!b?.width || !b.height) return false;
		const contain = Math.min(canvas.width / b.width, canvas.height / b.height);
		return contain * num(e.params["transform.scaleX"], 1) > 1.75;
	});
	checks.push(check("upscale", "Sharp, not blown up", false, 0.8, soft.length ? Math.max(0.4, 1 - soft.length / Math.max(3, main.length)) : 1, soft.length ? `${soft.length} clip(s) enlarged past 175 %` : "no soft upscales"));
	const shown = (t: number) => [...inserts, ...main].find((e) => e.start <= t && e.end > t);
	// Exposure is the clip's own (judged on its face and subject, not on a frame a white title lit up); the grade's
	// correction counts: −0.3 EV and more brings a bright clip back, +0.3 a dark one; blown past saving stays blown.
	const exposureOf = (t: number) => {
		const e = shown(t);
		const b = brief(e?.mediaId);
		if (!b?.exposure) return null;
		const exp = num(e?.effects?.find((f) => f.type === "studio.color")?.params.exposure, 0);
		if (b.exposure.verdict === "bright") return exp <= -0.3 && b.exposure.clipHi < 0.15 ? null : "overexposed";
		if (b.exposure.verdict === "dark") return exp >= 0.3 ? null : "dark";
		return null;
	};
	// What the clip's brief saw at that moment, without the edit's titles over it (undefined: it has no frame near).
	const briefSays = (t: number, flag: string): boolean | undefined => {
		const e = shown(t);
		const b = brief(e?.mediaId);
		if (!e || !b?.frames?.length) return undefined;
		if (b.kind === "image") return b.frames.some((x) => x.flags.includes(flag));
		const at = num(e.trimStart) / TICKS + (t - e.start);
		const near = b.frames.filter((x) => Math.abs(x.t - at) <= 1.5);
		return near.length ? near.some((x) => x.flags.includes(flag)) : undefined;
	};
	// A watermark belongs to a source (a logo in its corner): the edit's own titles in a corner are not one.
	const watermarked = (t: number) => !!brief(shown(t)?.mediaId)?.frames?.some((x) => x.flags.includes("watermark"));
	// A clip whose brief isn't ready yet (review waits ≤ 10 s for it): the rendered frame's own exposure and watermark
	// judgement stands — unless the edit's own text or graphics are on screen then (a white title, a corner caption).
	const unbriefed = (t: number) => {
		const e = shown(t);
		return !!e?.mediaId && !brief(e.mediaId) && ![...texts, ...graphics].some((x) => x.start <= t && x.end > t);
	};
	for (const f of input.frames) {
		const had = f.verdict.flags;
		const level = had.includes("tilted") && briefSays(f.t, "tilted") === false;
		const raw = unbriefed(f.t);
		const own = had.filter((x) => (raw || (x !== "overexposed" && x !== "dark" && x !== "watermark")) && !(x === "tilted" && level));
		const exp = raw ? null : exposureOf(f.t);
		const mark = raw ? false : watermarked(f.t);
		const penalty = { overexposed: 25, dark: 20, watermark: 15, tilted: 15 } as Record<string, number>;
		const flags = [...own, ...(exp ? [exp] : []), ...(mark ? ["watermark"] : [])];
		const delta = [...new Set([...had, ...flags])].reduce((s, x) => s + (penalty[x] ?? 0) * (Number(had.includes(x)) - Number(flags.includes(x))), 0);
		f.verdict = { ...f.verdict, flags, score: Math.max(0, Math.min(100, f.verdict.score + delta)), why: rewhy(f.verdict, flags) };
	}
	const flagged = input.frames.filter((f) => f.verdict.flags.some((x) => ["blurry", "overexposed", "dark", "tilted", "eyes-closed", "face-cut"].includes(x)));
	const avg = input.frames.length ? input.frames.reduce((s, f) => s + f.verdict.score, 0) / input.frames.length : 70;
	const beautyFixes: Fix[] = flagged.slice(0, 6).map((f) => frameFix(f, elements, preset, { brief, canvas }));
	checks.push(check("beauty", "Beautiful frames", false, 1.5, Math.min(1, avg / 65) * (flagged.length ? Math.max(0.5, 1 - flagged.length * 0.12) : 1), `${input.frames.length} frames judged, average ${Math.round(avg)}/100${flagged.length ? `; ${flagged.map((f) => `${r1(f.t)} s ${f.verdict.flags.filter((x) => ["blurry", "overexposed", "dark", "tilted", "eyes-closed", "face-cut"].includes(x)).join("+")}`).slice(0, 10).join(", ")}` : ""}`, beautyFixes));

	// ── ending ──
	const endText = [...titles, ...graphics].filter((e) => e.end >= total - 0.6 && e.start >= total - Math.max(4, total * 0.15));
	if (short_) {
		const cta = endText.some((e) => /cta|follow|link|subscribe|swipe|buy/i.test(`${e.name} ${e.definitionId ?? ""} ${e.params.content ?? ""}`) || e.type === "text");
		checks.push(check("ending", "Ending", recipe.ending !== "cta" && !musicVideo, 1, cta ? 1 : 0.4, cta ? "a call to action on the last seconds" : "no call to action or loop at the end", cta ? [] : [{ check: "ending", say: "a CTA over the last 2.5 s", steps: [{ op: "add_text_style", style: preset.text.cta, text: "Follow for more", start: r1(Math.max(0, total - 2.5)), duration: 2.5 }], auto: false }]));
	} else if (!musicVideo) {
		const end = graphics.find((g) => /EndScreen|Subscribe|Outro/i.test(String(g.definitionId)) && g.end >= total - 0.6);
		const len = end ? end.end - end.start : 0;
		checks.push(check("ending", "End screen", true, 1, end && len >= 5 && len <= 20 ? 1 : 0.3, end ? `end screen ${r1(len)} s` : "no end screen (5–20 s)", end ? [] : [{ check: "ending", say: "an end screen over the last 8 s", steps: [{ op: "add_motion", kind: preset.motion.endScreen, start: r1(Math.max(0, total - 8)) }], auto: false }]));
	}
	if (input.provenance.some((p) => p.from === "youtube")) notes.push(`${input.provenance.filter((p) => p.from === "youtube").length} piece(s) from YouTube (may be claimed when posted): ${input.provenance.filter((p) => p.from === "youtube").map((p) => p.name).slice(0, 4).join(", ")}`);

	// ── a video that moves, its shots used once, lips on their sound, the singer on screen ──
	const media = (id?: string) => (id ? input.media.find((x) => x.id === id) : undefined);
	const tops = topPictures(elements);
	if (generated) {
		const stillTop = new Map<string, { e: ReviewElement; seconds: number; at: number }>();
		for (const p of tops) {
			if (!p.e || p.e.type !== "image") continue;
			const hit = stillTop.get(p.e.id) ?? { e: p.e, seconds: 0, at: p.start };
			hit.seconds += p.end - p.start;
			stillTop.set(p.e.id, hit);
		}
		const still = [...stillTop.values()].reduce((s, x) => s + x.seconds, 0);
		const share = still / Math.max(0.01, total);
		const worst = [...stillTop.values()].sort((a, b) => b.seconds - a.seconds);
		const ok = share <= STILLS_MAX + 1e-9;
		checks.push(
			check(
				"stills",
				"Moving pictures",
				true,
				2,
				ok ? 1 : Math.max(0, 1 - share),
				`${Math.round(share * 100)} % of the length (${r1(still)} s) shows a still picture on top${ok ? "" : ` — a ${musicVideo ? "music video" : "AI short"} moves: at most ${Math.round(STILLS_MAX * 100)} % (camera moves on a still don't count as video); stills at ${worst.slice(0, 6).map((x) => `${r1(x.at)} s (${short(x.e.id)}, ${r1(x.seconds)} s)`).join(", ")}`}`,
				ok
					? []
					: worst.slice(0, 4).map((x) => ({
							check: "stills",
							say: `turn the still ${short(x.e.id)} at ${r1(x.e.start)} s into video: generate {kind:"video", mode:"image", from:"${short(x.e.mediaId ?? "")}", duration:${Math.max(3, Math.ceil(x.e.end - x.e.start))}, start:${r1(x.e.start)}} over it, then delete the still (or put a video shot there)`,
							steps: [],
							auto: false,
						})),
			),
		);
		const uses = reuseOf(elements, input.media);
		const over = uses.filter((u) => u.uses > REUSE_MAX);
		checks.push(
			check(
				"reuse",
				"Each shot once",
				true,
				1.5,
				over.length ? Math.max(0, 0.9 - over.length * 0.15) : 1,
				over.length ? `${over.length} media used more than ${REUSE_MAX}×: ${over.slice(0, 5).map((u) => `«${u.name}» ${u.uses}× (at ${u.at.slice(0, 6).map(r1).join(", ")} s)`).join("; ")}` : `no media used more than ${REUSE_MAX}×`,
				over.slice(0, 4).map((u) => ({ check: "reuse", say: `«${u.name}» is on screen ${u.uses}×: keep ${REUSE_MAX} (another part of it), put new shots at ${u.at.slice(REUSE_MAX, REUSE_MAX + 4).map(r1).join(", ")} s`, steps: [], auto: false })),
			),
		);
	}
	const performances = elements.filter((e) => (e.type === "video" || e.type === "image") && e.trackRole !== "audio" && isPerformance(media(e.mediaId), input.sync));
	if (performances.length) {
		const off: Array<{ e: ReviewElement; by: number; want: number }> = [];
		const twice: ReviewElement[] = [];
		let unknown = 0;
		const byMedia = new Map<string, ReviewElement[]>();
		for (const e of performances) byMedia.set(e.mediaId as string, [...(byMedia.get(e.mediaId as string) ?? []), e]);
		for (const [id, list] of byMedia) {
			const want = syncedStart(id, input.sync?.[id], elements, input.media);
			for (const e of list) {
				if (want === null) continue;
				const at = want + num(e.trimStart) / TICKS / (e.rate || 1);
				if (Math.abs(e.start - at) > SYNC_SLACK) off.push({ e, by: e.start - at, want: at });
			}
			if (want === null) {
				// Its sound time wasn't stored (made before Gaziyav kept it): one clip placed twice is off at least once.
				if (list.length > 1) twice.push(...list);
				else unknown++;
			}
		}
		const bad = off.length + (twice.length ? twice.length - 1 : 0);
		checks.push(
			check(
				"lipsync",
				"Lips on their sound",
				true,
				2,
				bad ? Math.max(0, 0.6 - bad * 0.1) : 1,
				bad
					? [off.length ? `${off.length} performance shot(s) off the time of their sound: ${off.slice(0, 5).map((o) => `${short(o.e.id)} at ${r1(o.e.start)} s (its sound is at ${r1(o.want)} s, ${o.by > 0 ? "+" : ""}${r1(o.by)} s)`).join(", ")}` : "", twice.length ? `the same lipsync clip placed ${twice.length}× (${twice.map((e) => `${short(e.id)} at ${r1(e.start)} s`).join(", ")}): its lips match its own sound at one time only` : ""].filter(Boolean).join("; ")
					: `${performances.length - unknown} performance shot(s) at their own sound's time${unknown ? `; ${unknown} not verifiable (made before the sound time was stored)` : ""}`,
				off.slice(0, 5).map((o) => ({ check: "lipsync", say: `move ${short(o.e.id)} to ${r1(o.want)} s (the lips follow the sound there)`, steps: [{ op: "move", id: short(o.e.id), start: Math.round(o.want * 1000) / 1000 }], auto: false })),
			),
		);
	}
	if (musicVideo && input.song?.hasVocals) {
		const sections = input.song.vocals.filter((v) => v.end - v.start >= 4);
		const sung = (s: { start: number; end: number }) =>
			tops.filter((p) => p.e && isPerformance(media(p.e.mediaId), input.sync)).reduce((sum, p) => sum + Math.max(0, Math.min(s.end, p.end) - Math.max(s.start, p.start)), 0);
		const need = (s: { start: number; end: number }) => Math.max(1, Math.ceil((s.end - s.start) / 45));
		const missing = sections.filter((s) => sung(s) < Math.min(1, (s.end - s.start) * 0.3) * need(s));
		const anyone = tops.some((p) => p.e && isPerformance(media(p.e.mediaId), input.sync));
		const failed = sections.length ? missing.length > 0 : !anyone;
		checks.push(
			check(
				"singing",
				"The singer sings on screen",
				true,
				2,
				failed ? (sections.length ? Math.max(0, 0.8 * (1 - missing.length / sections.length)) : 0) : 1,
				sections.length
					? missing.length
						? `«${input.song.name}» has vocals: no one sings on screen in ${missing.length} of ${sections.length} sung section(s) (${missing.slice(0, 6).map((s) => `${r1(s.start)}–${r1(s.end)} s`).join(", ")})`
						: `a performance shot in each of the ${sections.length} sung section(s)`
					: anyone
						? "the singer is on screen"
						: `«${input.song.name}» has vocals but no performance shot (avatar or lipsync) is on screen`,
				(sections.length ? missing : [{ start: 0, end: total }]).slice(0, 4).map((s) => ({ check: "singing", say: `a performance shot over ${r1(s.start)}–${r1(s.end)} s: the singer's picture → generate {kind:"video", mode:"avatar", from:"<singer picture>", sound:"<that line's vocal piece>"} (or lipsync a video shot) placed at the line's own time`, steps: [], auto: false })),
			),
		);
	}

	// ── score ──
	const active = checks.filter((c) => !input.waived.includes(c.id));
	const weight = active.reduce((s, c) => s + c.weight, 0);
	let score = Math.round((active.reduce((s, c) => s + c.weight * c.score, 0) / Math.max(1, weight)) * 100);
	const hardFailed = active.filter((c) => c.hard && c.score < 0.999).map((c) => c.id);
	if (hardFailed.length) score = Math.min(score, 84 - hardFailed.length);
	const fixes = active
		.filter((c) => !c.ok || c.score < 0.95)
		.sort((a, b) => Number(b.hard) - Number(a.hard) || (1 - b.score) * b.weight - (1 - a.score) * a.weight)
		.flatMap((c) => c.fixes)
		.slice(0, 8);
	// The cover: the most beautiful rendered frame with a face, eyes open, sharp; else the best frame.
	const candidates = [...input.frames].filter((f) => !f.verdict.flags.some((x) => ["blurry", "eyes-closed", "overexposed", "dark", "face-cut", "tilted", "watermark"].includes(x)));
	const withFace = candidates.filter((f) => f.faces.length);
	const best = [...(withFace.length ? withFace : candidates)].sort((a, b) => b.verdict.score - a.verdict.score)[0];
	return { score: Math.max(0, Math.min(100, score)), hardFailed, checks, fixes, cover: best ? { t: best.t, score: best.verdict.score, why: best.verdict.why } : null, notes };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** A music video / AI short shows a still on top for at most this share of its length. */
export const STILLS_MAX = 0.1;
/** A media on screen at most this many times (another part of it each time). */
export const REUSE_MAX = 2;
/** A performance shot this far off its sound's time is off sync (seconds; ≈ 2 frames). */
const SYNC_SLACK = 0.08;

/** Names the app gives avatar and lipsync results (Kling AI Avatar, «Lipsync · …», OmniHuman, sync, LatentSync…). */
const PERFORMANCE = /avatar|lip ?-?sync|latentsync|omnihuman|hedra|musetalk|sadtalker|wav2lip|talking ?(head|photo)|sync\.so|синхрон/i;

/** A performance shot: an avatar or lipsync result (its sound time stored, or named so by the app). */
export function isPerformance(m: { id: string; name: string } | undefined, sync?: Record<string, SyncInfo>): boolean {
	return !!m && (!!sync?.[m.id] || PERFORMANCE.test(m.name));
}

/** The picture fills the frame (not a sticker or a small picture-in-picture) and is seen (not faded out). */
function fillsFrame(e: ReviewElement): boolean {
	if (e.type !== "video" && e.type !== "image") return false;
	const sx = Math.abs(num(e.params["transform.scaleX"], 1));
	const sy = Math.abs(num(e.params["transform.scaleY"], 1));
	const o = num(e.params.opacity, 1);
	return sx >= 0.6 && sy >= 0.6 && (o > 1 ? o / 100 : o) >= 0.5;
}

const layerOf = (e: ReviewElement) => e.layer ?? (e.trackRole === "main" ? 1e6 : 0);

/** What picture is on top at every moment of the video: pieces [start, end) with the element seen (null: no picture). */
export function topPictures(elements: ReviewElement[]): Array<{ start: number; end: number; e: ReviewElement | null }> {
	const vis = elements.filter((e) => e.trackRole !== "audio" && e.end - e.start > 1e-6 && fillsFrame(e));
	const edges = [...new Set(vis.flatMap((e) => [e.start, e.end]))].sort((a, b) => a - b);
	const out: Array<{ start: number; end: number; e: ReviewElement | null }> = [];
	for (let i = 0; i + 1 < edges.length; i++) {
		const a = edges[i];
		const b = edges[i + 1];
		if (b - a < 1e-6) continue;
		const mid = (a + b) / 2;
		const top = vis.filter((e) => e.start <= mid && e.end > mid).sort((x, y) => layerOf(x) - layerOf(y))[0] ?? null;
		const last = out[out.length - 1];
		if (last && last.e === top && Math.abs(last.end - a) < 1e-6) last.end = b;
		else out.push({ start: a, end: b, e: top });
	}
	return out;
}

/**
 * How many times each media is on screen. One shot cut away from and back to (the same source time at the same
 * timeline offset) is one use; a long recording (> 20 s) counts only when the same frames come again.
 */
export function reuseOf(elements: ReviewElement[], media: MediaRef[]): Array<{ id: string; name: string; uses: number; at: number[] }> {
	const vis = elements.filter((e) => (e.type === "video" || e.type === "image") && e.trackRole !== "audio" && e.mediaId).sort((a, b) => a.start - b.start);
	const by = new Map<string, ReviewElement[]>();
	for (const e of vis) by.set(e.mediaId as string, [...(by.get(e.mediaId as string) ?? []), e]);
	const out: Array<{ id: string; name: string; uses: number; at: number[] }> = [];
	for (const [id, list] of by) {
		const m = media.find((x) => x.id === id);
		const long = m?.type === "video" && (m.duration ?? 0) > 20;
		const shots: Array<{ start: number; end: number; from: number; to: number; offset: number; track: string }> = [];
		for (const e of list) {
			const rate = e.rate || 1;
			const from = num(e.trimStart) / TICKS;
			const to = from + (e.end - e.start) * rate;
			// A shot split in pieces (back to back on its track, the picture going on) is one shot.
			const prev = shots.find((s) => s.track === e.track && Math.abs(s.end - e.start) < 0.05 && (e.type === "image" || Math.abs(s.to - from) < 0.1));
			if (prev) {
				prev.end = e.end;
				prev.to = to;
				continue;
			}
			shots.push({ start: e.start, end: e.end, from, to, offset: e.type === "image" ? Number.NaN : e.start - from / rate, track: e.track });
		}
		let uses = 0;
		const at: number[] = [];
		if (!long) {
			const offsets: number[] = [];
			for (const s of shots) {
				if (Number.isFinite(s.offset) && offsets.some((o) => Math.abs(o - s.offset) < 0.1)) continue;
				offsets.push(s.offset);
				uses++;
				at.push(s.start);
			}
		} else {
			const seen: Array<{ from: number; to: number }> = [];
			uses = 1;
			at.push(shots[0].start);
			for (const s of shots) {
				const again = seen.some((p) => Math.min(p.to, s.to) - Math.max(p.from, s.from) > 0.5 * (s.to - s.from));
				if (again) {
					uses++;
					at.push(s.start);
				}
				seen.push(s);
			}
		}
		out.push({ id, name: m?.name ?? id.slice(0, 8), uses, at });
	}
	return out.sort((a, b) => b.uses - a.uses);
}

/** Where a performance result's second 0 belongs on the timeline now: by its sound on the timeline, else the stored time. */
function syncedStart(id: string, info: SyncInfo | undefined, elements: ReviewElement[], media: MediaRef[]): number | null {
	if (!info || !Number.isFinite(info.at)) return null;
	if (info.sound && info.soundFrom !== undefined) {
		const of = (mid?: string) => media.find((x) => x.id === mid);
		const song = (mid?: string) => of(mid)?.stemOf ?? mid;
		const want = song(info.sound);
		for (const e of elements) {
			if ((e.type !== "audio" && e.type !== "video") || !e.mediaId || e.mediaId === id || song(e.mediaId) !== want) continue;
			const rate = e.rate || 1;
			const from = num(e.trimStart) / TICKS;
			const to = from + (e.end - e.start) * rate;
			if (info.soundFrom >= from - 0.05 && info.soundFrom <= to + 0.05) return e.start + (info.soundFrom - from) / rate;
		}
	}
	return info.at;
}

/** A song's sung lines → the stretches where someone sings (timeline seconds): lines closer than `gap` s are one. */
export function vocalSpans(words: Word[], place: { start: number; end: number; trimStart: number; rate?: number }, gap = 3.5): Array<{ start: number; end: number }> {
	const rate = place.rate || 1;
	const clean = dropHallucinations(words);
	const ts = clean.map((w) => ({ start: place.start + (w.start - place.trimStart) / rate, end: place.start + (w.end - place.trimStart) / rate })).filter((w) => w.end > place.start && w.start < place.end);
	const out: Array<{ start: number; end: number; n: number }> = [];
	for (const w of ts) {
		const last = out[out.length - 1];
		if (last && w.start - last.end < gap) {
			last.end = Math.max(last.end, w.end);
			last.n++;
		} else out.push({ start: w.start, end: w.end, n: 1 });
	}
	return out.filter((s) => s.n >= 4).map((s) => ({ start: r3(Math.max(place.start, s.start)), end: r3(Math.min(place.end, s.end)) }));
}

/** What the hearing model heard on the main sound (shares 0–1 of its windows, AudioSet tagger on the full mix). */
export interface HeardFacts {
	music: number;
	singing: number;
	speech: number;
}

/**
 * What the edit is when no plan says it: a music video when the main sound — the sound under most of the video — is a
 * song with vocals (the tagger hears music and singing, or a beat grid with sung words, or the song was separated into
 * its voice and music stems).
 */
export function inferRecipe({ elements, media, heard }: { elements: ReviewElement[]; media: MediaRef[]; heard?: HeardFacts | null }): { recipe: RecipeId; why: string; main: MediaRef } | null {
	const main = mainSound(elements, media);
	if (!main) return null;
	const { ref, stems, seconds, total } = main;
	const words = (ref.brief?.speech?.words.length ?? 0) + stems.reduce((n, s) => n + (s.stem === "voice" ? (s.brief?.speech?.words.length ?? 0) : 0), 0);
	const separated = stems.some((s) => s.stem === "voice") && stems.some((s) => s.stem === "music");
	const grid = !!ref.brief?.music || stems.some((s) => !!s.brief?.music);
	const why = separated
		? `«${ref.name}» was separated into its voice and music: a song`
		: heard && heard.music >= 0.5 && (heard.singing >= 0.15 || words >= 10)
			? `the hearing hears a song in «${ref.name}» (music ${Math.round(heard.music * 100)} %, singing ${Math.round(heard.singing * 100)} %)`
			: grid && words >= 6
				? `«${ref.name}» has a beat and sung words`
				: "";
	if (!why || seconds < Math.min(20, total * 0.5)) return null;
	if (!separated && heard && heard.speech > heard.singing + 0.3 && heard.music < 0.5) return null;
	return { recipe: "music-video", why: `${why}, under ${Math.round((seconds / Math.max(0.01, total)) * 100)} % of the video`, main: ref };
}

/** The sound under most of the video: the media (a song, or the source of its stems) heard longest. */
export function mainSound(elements: ReviewElement[], media: MediaRef[]): { ref: MediaRef; stems: MediaRef[]; seconds: number; total: number } | null {
	const total = elements.filter((e) => e.trackRole !== "audio").reduce((m, e) => Math.max(m, e.end), 0);
	const heardOf = new Map<string, Array<[number, number]>>();
	for (const e of elements) {
		if (e.type !== "audio" || !e.mediaId) continue;
		const m = media.find((x) => x.id === e.mediaId);
		if (!m) continue;
		const key = m.stemOf ?? m.id;
		heardOf.set(key, [...(heardOf.get(key) ?? []), [e.start, e.end]]);
	}
	let best: { id: string; seconds: number } | null = null;
	for (const [id, spans] of heardOf) {
		spans.sort((a, b) => a[0] - b[0]);
		let seconds = 0;
		let end = -Infinity;
		for (const [a, b] of spans) {
			const from = Math.max(a, end);
			if (b > from) seconds += b - from;
			end = Math.max(end, b);
		}
		if (!best || seconds > best.seconds) best = { id, seconds };
	}
	if (!best) return null;
	const stems = media.filter((m) => m.stemOf === best.id);
	const ref = media.find((m) => m.id === best.id) ?? stems[0];
	return ref ? { ref, stems, seconds: best.seconds, total: Math.max(total, best.seconds) } : null;
}

/**
 * The platform a review judges against when none is named: the taste's own when its frame and length fit the project,
 * else the first platform of that frame that takes the length (16:9 → YouTube, 9:16 → Reels, TikTok past 3 min).
 */
export function platformFor(canvas: { width: number; height: number }, seconds: number, prefer: Array<string | undefined>): PlatformSpec {
	const aspect = canvas.width / Math.max(1, canvas.height);
	const fits = (p: PlatformSpec) => Math.abs(p.size.width / p.size.height - aspect) < 0.02 && (p.maxSeconds === null || seconds <= p.maxSeconds + 0.5);
	for (const id of prefer) {
		const p = id ? platformSpec(id) : null;
		if (p && fits(p)) return p;
	}
	const order = ["reels", "youtube", "feed", "tiktok", "shorts"];
	const all = [...(PLATFORMS as unknown as PlatformSpec[])].sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
	return all.find(fits) ?? all.find((p) => Math.abs(p.size.width / p.size.height - aspect) < 0.02) ?? (platformSpec(prefer.find(Boolean)) as PlatformSpec) ?? all[0];
}

function hasMotion(e: ReviewElement): boolean {
	return !!e.animated || /Ken|push/i.test(e.name);
}

function pushIn(e: ReviewElement): EditStep[] {
	const s = num(e.params["transform.scaleX"], 1);
	const points = [
		{ time: r3(e.start), value: r3(s) },
		{ time: r3(e.end), value: r3(s * 1.08) },
	];
	return [
		{ op: "keyframes", id: short(e.id), key: "transform.scaleX", points, interpolation: "bezier" },
		{ op: "keyframes", id: short(e.id), key: "transform.scaleY", points, interpolation: "bezier" },
	];
}

/** The verdict's line of reasons with its flags replaced (the good words kept). */
function rewhy(v: FrameVerdict, flags: string[]): string {
	const old = new Set(v.flags.map((x) => x.replace("-", " ")));
	const good = v.why.split(", ").filter((w) => w && !old.has(w));
	return [...flags.map((x) => x.replace("-", " ")), ...good].join(", ") || "plain";
}

/** The fix for an ugly rendered frame: grade it, straighten it, frame it wider, or take a better moment / another shot. */
function frameFix(f: RenderedFrame, elements: ReviewElement[], preset: Preset, ctx: { brief: (id?: string) => MaterialBrief | undefined; canvas: { width: number; height: number } }): Fix {
	const at = elements.filter((e) => (e.type === "video" || e.type === "image") && e.start <= f.t && e.end > f.t).sort((a, b) => (a.trackRole === "overlay" ? -1 : 1) - (b.trackRole === "overlay" ? -1 : 1))[0];
	const id = at ? short(at.id) : "";
	const flags = f.verdict.flags;
	if (!at) return { check: "beauty", say: `${r1(f.t)} s: ${flags.join(", ")}`, steps: [], auto: false };
	if (flags.includes("overexposed") && at.trackRole === "overlay" && (ctx.brief(at.mediaId)?.exposure.clipHi ?? 0) >= 0.15) {
		return { check: "beauty", say: `${id} at ${r1(f.t)} s is blown past what a grade brings back: swap the insert`, steps: [{ op: "delete", ids: [id] }], auto: true };
	}
	if (flags.includes("overexposed") || flags.includes("dark")) {
		return { check: "beauty", say: `${id} ${flags.includes("dark") ? "too dark" : "overexposed"}: exposure ${flags.includes("dark") ? "+0.6" : "−0.7"}`, steps: [{ op: "set_effect", id, effect: "studio.color", params: { exposure: flags.includes("dark") ? 0.6 : -0.7, highlights: flags.includes("dark") ? 0 : -40, look: preset.grade.look } }], auto: true };
	}
	if (flags.includes("tilted")) {
		// Turn it back by the angle seen and zoom in just enough that no corner shows (1/cos + sin·aspect).
		const angle = f.horizon ?? 0;
		const rad = (Math.abs(angle) * Math.PI) / 180;
		const fill = r3(Math.cos(rad) + Math.sin(rad) * 1.78);
		return { check: "beauty", say: `${id} horizon tilted ${r1(angle)}°: straighten and fill`, steps: [{ op: "set", id, params: { "transform.rotate": r1(num(at.params["transform.rotate"], 0) - angle), "transform.scaleX": r3(num(at.params["transform.scaleX"], 1) * fill), "transform.scaleY": r3(num(at.params["transform.scaleY"], 1) * fill) } }], auto: true };
	}
	if (flags.includes("eyes-closed") || flags.includes("blurry")) {
		return { check: "beauty", say: `${id} at ${r1(f.t)} s ${flags.includes("blurry") ? "blurry" : "eyes closed"}: ${at.trackRole === "overlay" ? "swap the insert" : "take another moment or cover it with an insert"}`, steps: at.trackRole === "overlay" ? [{ op: "delete", ids: [id] }] : [], auto: at.trackRole === "overlay" };
	}
	if (flags.includes("face-cut")) {
		// Wider, never tighter: back to the full-bleed framing on the face; a close-up already at full bleed is a choice.
		const b = ctx.brief(at.mediaId);
		const size = { width: b?.width, height: b?.height };
		const face = (b?.faceBox as Box | undefined) ?? null;
		const base = framingOf(size, ctx.canvas, face);
		const t = coverTransform(size, ctx.canvas, 1, centreOf(face), 1);
		const s = num(at.params["transform.scaleX"], 1);
		if (base < 1) return { check: "beauty", say: `${id} at ${r1(f.t)} s: this wide close-up cuts the face in a ${ctx.canvas.width}×${ctx.canvas.height} frame — frame it in the middle on a plain plate (apply_plan does it)`, steps: [], auto: false };
		if (t.scale < s * 0.98) return { check: "beauty", say: `${id} at ${r1(f.t)} s: the frame cuts the face — frame it wider`, steps: [{ op: "set", id, params: { "transform.scaleX": t.scale, "transform.scaleY": t.scale, "transform.positionX": t.x, "transform.positionY": t.y } }], auto: true };
		return { check: "beauty", say: `${id} at ${r1(f.t)} s: the face fills the frame edge to edge (a close-up this tight is a choice)`, steps: [], auto: false };
	}
	return { check: "beauty", say: `${id}: ${flags.join(", ")} — reframe`, steps: [], auto: false };
}

function near(a: string, b: string): boolean {
	const p = (s: string) => [1, 3, 5].map((i) => Number.parseInt(s.slice(i, i + 2), 16));
	if (!/^#[0-9a-f]{6}$/.test(a) || !/^#[0-9a-f]{6}$/.test(b)) return a === b;
	const x = p(a);
	const y = p(b);
	return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 40;
}

/** The review as a few lines for Claude: the score, the hard checks, each failing check with its fix. */
export function describeReview(r: ReviewResult, { waived = [] as string[] } = {}): string {
	const lines = [`Score ${r.score}/100 · hard checks ${r.hardFailed.length ? `FAILED: ${r.hardFailed.join(", ")} (export stays closed until fixed or waived)` : "all passed"}`];
	for (const c of r.checks) {
		if (waived.includes(c.id)) continue;
		if (c.score >= 0.95) continue;
		lines.push(`- ${c.hard ? "[hard] " : ""}${c.name} ${Math.round(c.score * 100)}: ${c.detail}`);
	}
	const passed = r.checks.filter((c) => c.score >= 0.95).map((c) => c.id);
	if (passed.length) lines.push(`ok: ${passed.join(", ")}`);
	const auto = r.fixes.filter((f) => f.auto);
	if (r.fixes.length) {
		lines.push(r.fixes.length > 6 ? `Fixes (the first 6 of ${r.fixes.length}):` : "Fixes:");
		// (a step that is a tool of its own is written as that tool: «edit [{op:"check_cuts"}]» is not an edit step)
		const asCall = (steps: Array<Record<string, unknown>>) => (steps.every((s) => s.op === "check_cuts") ? `check_cuts ${JSON.stringify(Object.fromEntries(Object.entries(steps[0]).filter(([k]) => k !== "op")))}` : `edit ${JSON.stringify(steps)}`);
		for (const f of r.fixes.slice(0, 6)) lines.push(`  ${f.say}${f.steps.length ? ` → ${asCall(f.steps as Array<Record<string, unknown>>)}` : ""}`);
		if (auto.length) lines.push(`review {fix:true} applies ${auto.length} of them itself (one ⌘Z).`);
	}
	if (r.cover) lines.push(`Cover: ${r.cover.t.toFixed(1)} s (${r.cover.score}/100, ${r.cover.why}) → export {cover: ${r.cover.t.toFixed(1)}}`);
	for (const n of r.notes) lines.push(`Note: ${n}`);
	return lines.join("\n");
}

export type { MaterialBrief };
