// A beat plan → the timeline's tracks, built as data with the editor's own element builders (the same clips, captions,
// titles, motion templates, sounds and effects its buttons make) and committed by the caller as ONE undo step. The
// rules of the craft live here: cut points with pads and 30 ms fades, cover-fit and punch-ins on the face, inserts on
// their own track, captions in the platform's safe zone off the face, titles on a grid, one grade with shots matched,
// the dialog cleaned, music ending on a bar and ducked, sounds only at structure points.
import { buildDefaultEffectInstance } from "@/effects";
import { CUT_RULES } from "@/hear/cuts";
import { t } from "@/i18n";
import { buildLibraryClip } from "@/library/client";
import { mographElement } from "@/montage/mograph-insert";
import { MOGRAPH_BY_KIND } from "@/montage/mograph";
import { type PlatformSpec, safeRect } from "@/platforms/table";
import { buildStyledCaptionElement } from "@/subtitles/build-subtitle-text-element";
import { chunkCaptionsForStyle } from "@/subtitles/insert";
import { type CaptionStyleId, getCaptionStyle } from "@/subtitles/styles";
import type { SubtitleCue } from "@/subtitles/types";
import { buildPresetParams, TEXT_PRESETS, type TextPreset } from "@/text/presets";
import type { AudioTrack, CreateTimelineElement, SceneTracks, TextTrack, TimelineElement, VideoTrack } from "@/timeline";
import { DEFAULTS } from "@/timeline/defaults";
import { buildElementFromMedia, buildTextElement } from "@/timeline/element-utils";
import { buildEmptyTrack } from "@/timeline/placement/track-factory";
import { generateUUID } from "@/utils/id";
import { mediaTimeFromSeconds } from "@/wasm";
import { type Box, centreOf, coverTransform, facePunchLimit, framingOf } from "./framing";
import type { MaterialBrief } from "./material";
import type { MediaRef, Plan } from "./plan";
import { mographFont, type Preset } from "./presets";

const ticks = (seconds: number) => mediaTimeFromSeconds({ seconds: Math.max(0, seconds) });
const TICKS = 120000;
const r1 = (v: number) => Math.round(v * 10) / 10;

export interface CompileContext {
	plan: Plan;
	preset: Preset;
	platform: PlatformSpec;
	canvas: { width: number; height: number };
	media: MediaRef[];
	/** The project's frames per second (cuts land on whole frames). */
	fps: number;
	/** The tracks now (kept: nothing of the user's is thrown away silently — the plan replaces the edit, ⌘Z brings it back). */
	before: SceneTracks;
}

/** What the build made, by role: review and the taste learner find their elements by these ids. */
export interface Compiled {
	tracks: SceneTracks;
	roles: Record<string, string[]>;
	style: Record<string, string | number>;
	summary: string[];
	/** A wide close-up sits framed in the middle of a narrow frame: the project's background should be the look's plate. */
	framed: boolean;
}

export { coverTransform } from "./framing";

/** The look of a preset on a text preset: its fonts, palette, spacing and moves (eased, 0.2–0.4 s, one direction). */
export function styledText(base: TextPreset, preset: Preset, role: "display" | "text"): TextPreset {
	const font = role === "display" ? preset.fonts.display : preset.fonts.text;
	const weight = role === "display" ? preset.fonts.displayWeight : preset.fonts.textWeight;
	const moveIn = preset.moves.in === "pop" ? "lettersPop" : preset.moves.in === "slideUp" ? "wordsUp" : "fade";
	const params: TextPreset["params"] = {
		...base.params,
		fontFamily: font,
		fontWeight: weight,
		color: preset.palette.ink,
		letterSpacing: preset.fonts.tracking,
		lineHeight: preset.fonts.leading,
		"anim.in": moveIn,
		"anim.inDuration": preset.moves.inSeconds,
		"anim.out": preset.moves.out,
		"anim.outDuration": preset.moves.outSeconds,
		"anim.loop": "none",
	};
	if ("design.accent" in params) params["design.accent"] = preset.palette.accent;
	if ("design.plate" in params) params["design.plate"] = preset.palette.plate;
	if ("design.subColor" in params) params["design.subColor"] = preset.palette.ink;
	if ("stroke.enabled" in params && params["stroke.enabled"]) params["stroke.color"] = preset.palette.plate;
	if ("gradient.enabled" in params) params["gradient.enabled"] = false;
	if ("highlight.color" in params) params["highlight.color"] = preset.palette.accent;
	const plate = base.plate ? { ...base.plate, color: `${preset.palette.plate}cc` } : undefined;
	return { ...base, params, plate };
}

/** Text height as a share of the frame (fontSize is px at 90 px per frame-height unit). */
export const lineShare = (fontSize: number, leading = 1.1) => (fontSize / 90) * leading;

/**
 * A vertical centre (share of the height) for a text block inside the safe zone: off the whole face when there is room,
 * else at least off the eyes (a close-up leaves no room: the block sits over the chin, never the eyes), and off the
 * bands other texts already hold at that time.
 */
export function placeY(
	want: number,
	blockShare: number,
	safe: { top: number; bottom: number },
	face?: [number, number, number, number] | null,
	taken: Array<[number, number]> = [],
): number {
	const half = blockShare / 2;
	const clampY = (y: number) => Math.max(safe.top + half, Math.min(safe.bottom - half, y));
	const zones: Array<Array<[number, number]>> = [];
	if (face) {
		const [, fy, , fh] = face;
		zones.push([[fy - 0.02, fy + fh + 0.02], ...taken]);
		zones.push([[fy + fh * 0.1, fy + fh * 0.66], ...taken]);
	}
	zones.push(taken);
	for (const blocked of zones) {
		const free = (y: number) => blocked.every(([a, b]) => y + half <= a || y - half >= b);
		const y0 = clampY(want);
		if (free(y0)) return y0;
		// the nearest free place to the wanted one: just below or just above each blocked band
		const options = blocked.flatMap(([a, b]) => [b + half + 0.005, a - half - 0.005]).map(clampY).filter(free);
		if (options.length) return options.sort((p, q) => Math.abs(p - want) - Math.abs(q - want))[0];
	}
	return clampY(want);
}

const findMedia = (ctx: CompileContext, id: string) => ctx.media.find((m) => m.id === id);

/** One grade across the video: the preset's look, each shot's exposure and cast pulled to the speaker's (skin kept). */
function gradeEffects(brief: MaterialBrief | undefined, ref: MaterialBrief | undefined, preset: Preset) {
	const color = buildDefaultEffectInstance({ effectType: "studio.color" });
	const params: Record<string, string | number | boolean> = { ...color.params, look: preset.grade.look, lookIntensity: preset.grade.intensity };
	// Two shots of people are matched skin to skin (exposure and warmth); a picture of something else keeps its own
	// light and colour, only a jump that would flash is halved (a sunny exterior after an interview stays brighter, not
	// blinding); a clip that is plainly too bright or too dark on its own is brought back.
	const people = (b?: MaterialBrief) => (b?.faces ?? 0) >= 0.3;
	let exposure: number | undefined;
	if (brief && ref && brief !== ref && brief.exposure && ref.exposure) {
		const stops = Math.log2(Math.max(0.05, ref.exposure.luma) / Math.max(0.05, brief.exposure.luma));
		if (people(brief) && people(ref)) {
			if (Math.abs(stops) > 0.15) exposure = Math.max(-1, Math.min(1, stops));
			const warm = (ref.cast.r - brief.cast.r) * 300;
			if (Math.abs(warm) > 3) params.temperature = Math.round(Math.max(-15, Math.min(15, warm)));
		} else if (Math.abs(stops) > 0.5) exposure = Math.max(-0.6, Math.min(0.6, stops / 2));
	}
	if (exposure === undefined && brief?.exposure.verdict === "dark") exposure = 0.4;
	else if (exposure === undefined && brief?.exposure.verdict === "bright") exposure = -0.4;
	if (exposure !== undefined) params.exposure = Math.round(exposure * 100) / 100;
	if (preset.grade.vignette > 0 && "vignette" in params) params.vignette = preset.grade.vignette;
	const effects = [{ ...color, params }];
	if (preset.grade.grain > 0) {
		const grain = buildDefaultEffectInstance({ effectType: "studio.grain" });
		effects.push({ ...grain, params: { ...grain.params, amount: preset.grade.grain } });
	}
	return effects;
}

/** The dialog chain on a speaking clip: noise down when there is noise, de-ess, level (the app's own audio effects). */
function dialogParams(brief: MaterialBrief | undefined): Record<string, string | number | boolean> {
	const out: Record<string, string | number | boolean> = {
		"fx.deesser": true,
		"fx.compressor": true,
		"fx.compressor.threshold": -18,
		"fx.compressor.ratio": 3,
		"fx.compressor.makeup": 2,
	};
	const noise = brief?.audio?.noiseDb;
	if (noise !== null && noise !== undefined && noise > -58) Object.assign(out, { "fx.denoise": true, "fx.denoise.amount": noise > -45 ? 18 : 10 });
	return out;
}

const withId = <T extends CreateTimelineElement>(e: T): T & { id: string } => ({ ...e, id: generateUUID() });

export function compilePlan(ctx: CompileContext): Compiled {
	const { plan, preset, platform, canvas } = ctx;
	const roles: Record<string, string[]> = {};
	const note = (role: string, id: string) => {
		if (!roles[role]) roles[role] = [];
		roles[role].push(id);
	};
	const summary: string[] = [];
	const rect = safeRect(platform, canvas);
	const safe = { top: rect.top / canvas.height, bottom: rect.bottom / canvas.height, left: rect.left / canvas.width, right: rect.right / canvas.width };
	const speakerRef = ctx.media.find((m) => m.id === (plan.pieces.find((p) => p.role !== "still") ?? plan.pieces[0])?.media)?.brief;
	// How each piece sits in the frame: full bleed, or framed in the middle when a wide close-up's face would fill a
	// narrow frame; a punch-in never pushes the face past the frame's edge.
	let framed = false;
	const placeOf = (m: MediaRef, punch: number, focus?: [number, number]) => {
		const size = { width: m.brief?.width ?? m.width, height: m.brief?.height ?? m.height };
		const face = (m.brief?.faceBox as Box | undefined) ?? null;
		const base = framingOf(size, canvas, face);
		const zoom = Math.min(punch, Math.max(1, facePunchLimit(size, canvas, face, base)));
		return { ...coverTransform(size, canvas, zoom, focus ?? centreOf(face), base), base };
	};
	// ── the spine (main track) ──
	const main = { ...buildEmptyTrack({ id: ctx.before.main.id, type: "video", name: ctx.before.main.name }), elements: [] as VideoTrack["elements"] };
	// Back to back in whole frames, in ticks (no rounding gap or overlap between shots), never past a source's end.
	const frame = Math.round(TICKS / ctx.fps);
	let cursor = 0;
	plan.pieces.forEach((p, i) => {
		const m = findMedia(ctx, p.media);
		if (!m || m.type === "audio") return;
		const full = m.type === "video" ? (m.duration ?? m.brief?.seconds ?? p.to) : Number.POSITIVE_INFINITY;
		const from = Math.max(0, Math.min(p.from, Number.isFinite(full) ? full - 0.2 : p.from));
		const to = Math.min(p.to, full);
		const frames = Math.max(3, Math.round(((to - from) * TICKS) / frame));
		const duration = Math.min(frames * frame, Number.isFinite(full) ? Math.floor(((full - from) * TICKS) / frame) * frame : frames * frame);
		const element = withId(buildElementFromMedia({ mediaId: m.id, mediaType: m.type, name: m.name, duration: duration as never, startTime: cursor as never }) as CreateTimelineElement);
		p.at = cursor / TICKS;
		cursor += duration;
		if (m.type === "video") {
			const start = Math.round((from * TICKS) / frame) * frame;
			const total = Math.round(full * TICKS);
			(element as { trimStart: number }).trimStart = start;
			(element as { trimEnd: number }).trimEnd = Math.max(0, total - start - duration);
			(element as { sourceDuration?: number }).sourceDuration = total;
		}
		const t = placeOf(m, p.punch, p.focus);
		if (t.base < 1) framed = true;
		const params: Record<string, string | number | boolean> = { ...element.params, "transform.scaleX": t.scale, "transform.scaleY": t.scale, "transform.positionX": t.x, "transform.positionY": t.y };
		if (m.type === "video" && m.brief?.speech) Object.assign(params, dialogParams(m.brief), { fadeIn: CUT_RULES.fade, fadeOut: CUT_RULES.fade });
		const built = { ...element, params, effects: gradeEffects(m.brief, speakerRef, preset) } as TimelineElement;
		main.elements.push(built as VideoTrack["elements"][number]);
		note(p.role === "still" ? "stills" : i === 0 ? "hook" : "aroll", built.id);
	});
	// The last frame holds a second after the last word (the CTA sits on it), in whole frames, within the source.
	const last = main.elements[main.elements.length - 1];
	if (last && last.type === "video") {
		// Only into the silence after the last word: a held frame must not let the next sentence leak in.
		const words = findMedia(ctx, (last as { mediaId: string }).mediaId)?.brief?.speech?.words ?? [];
		const endSec = (last.trimStart + last.duration) / TICKS;
		const nextWord = words.find((w) => w.start >= endSec - 0.01);
		const quiet = nextWord ? Math.max(0, nextWord.start - endSec - 0.08) : 1;
		const extra = Math.min(Math.floor((last.trimEnd ?? 0) / frame), Math.round(TICKS / frame), Math.floor((quiet * TICKS) / frame)) * frame;
		if (extra > 0) {
			(last as { duration: number }).duration = last.duration + extra;
			(last as { trimEnd: number }).trimEnd = last.trimEnd - extra;
			// what ends with the video (the CTA, the end screen) holds with it
			const end = plan.seconds;
			for (const hit of plan.texts) if ((hit.kind === "cta" || hit.kind === "end-screen") && Math.abs(hit.at + hit.seconds - end) < 0.3) hit.seconds += extra / TICKS;
		}
	}
	const total = main.elements.reduce((s, e) => Math.max(s, (e.startTime + e.duration) / TICKS), 0);
	summary.push(`${main.elements.length} shots on the main track, ${total.toFixed(1)} s${framed ? " (the wide close-up framed in the middle on the look's plate: no face cut, no blow-up)" : ""}`);
	// ── inserts (B-roll) on their own track ──
	const broll = buildEmptyTrack({ id: generateUUID(), type: "video", name: t("B-roll") }) as VideoTrack;
	for (const x of plan.inserts) {
		const m = findMedia(ctx, x.media);
		if (!m || m.type === "audio") continue;
		const element = withId(buildElementFromMedia({ mediaId: m.id, mediaType: m.type, name: m.name, duration: ticks(x.seconds), startTime: ticks(x.at) }) as CreateTimelineElement);
		if (m.type === "video") {
			const full = m.duration ?? x.seconds;
			const from = Math.max(0, Math.min(x.from, full - x.seconds));
			const len = Math.min(x.seconds, full - from);
			(element as { duration: number }).duration = Math.round(len * TICKS);
			(element as { trimStart: number }).trimStart = Math.round(from * TICKS);
			(element as { trimEnd: number }).trimEnd = Math.max(0, Math.round(full * TICKS) - Math.round(from * TICKS) - Math.round(len * TICKS));
			(element as { sourceDuration?: number }).sourceDuration = Math.round(full * TICKS);
		}
		const t = coverTransform({ width: m.brief?.width ?? m.width, height: m.brief?.height ?? m.height }, canvas, 1.04);
		const params = { ...element.params, "transform.scaleX": t.scale, "transform.scaleY": t.scale, "transform.positionX": t.x, "transform.positionY": t.y, muted: true, volume: -60 };
		broll.elements.push({ ...element, params, effects: gradeEffects(m.brief, speakerRef, preset) } as unknown as VideoTrack["elements"][number]);
		note("broll", broll.elements[broll.elements.length - 1].id);
	}
	if (broll.elements.length) summary.push(`${broll.elements.length} inserts (${r1(plan.inserts.reduce((s, x) => s + x.seconds, 0))} s)`);
	// ── texts: titles, chapters, lower thirds, CTA (text presets restyled), stats and end screen (motion templates) ──
	const titles = buildEmptyTrack({ id: generateUUID(), type: "text", name: t("Titles") }) as TextTrack;
	const graphics = buildEmptyTrack({ id: generateUUID(), type: "graphic", name: t("Graphics") });
	const faceAt = (at: number): [number, number, number, number] | null => {
		if (plan.inserts.some((x) => at >= x.at && at < x.at + x.seconds)) return null;
		const piece = plan.pieces.find((p) => at >= p.at && at < p.at + (p.to - p.from));
		const b = piece ? findMedia(ctx, piece.media)?.brief : undefined;
		if (!b?.faceBox || !piece) return null;
		// The face box after the fit and punch-in (share of the frame).
		const m = findMedia(ctx, piece.media);
		if (!m) return null;
		const t = placeOf(m, piece.punch, piece.focus);
		const sw = b.width ?? canvas.width;
		const sh = b.height ?? canvas.height;
		const contain = Math.min(canvas.width / sw, canvas.height / sh);
		const dw = sw * contain * t.scale;
		const dh = sh * contain * t.scale;
		const x0 = canvas.width / 2 + t.x - dw / 2;
		const y0 = canvas.height / 2 + t.y - dh / 2;
		const [fx, fy, fw, fh] = b.faceBox;
		return [(x0 + fx * dw) / canvas.width, (y0 + fy * dh) / canvas.height, (fw * dw) / canvas.width, (fh * dh) / canvas.height];
	};
	const bands: Array<{ from: number; to: number; band: [number, number] }> = [];
	/** Every face on screen over [from, to]: one box around them all (a text there must keep off each). */
	const facesOver = (from: number, to: number): [number, number, number, number] | null => {
		const boxes = [from + 0.1, (from + to) / 2, Math.max(from, to - 0.15)].map(faceAt).filter((b): b is [number, number, number, number] => !!b);
		if (!boxes.length) return null;
		const x0 = Math.min(...boxes.map((b) => b[0]));
		const y0 = Math.min(...boxes.map((b) => b[1]));
		const x1 = Math.max(...boxes.map((b) => b[0] + b[2]));
		const y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
		return [x0, y0, x1 - x0, y1 - y0];
	};
	for (const hit of plan.texts) {
		if (hit.kind === "stat" || hit.kind === "end-screen") {
			const kindId = hit.kind === "stat" ? preset.motion.stat : preset.motion.endScreen;
			const kind = MOGRAPH_BY_KIND.get(kindId);
			if (!kind) continue;
			const g = mographElement(kind, hit.at);
			const params: Record<string, string | number | boolean> = { ...g.params };
			const set = (key: string, value: string | number) => {
				if (kind.fields.some((f) => f.key === key)) params[key] = value;
			};
			set("font", mographFont(preset.fonts.display));
			set("accent", preset.palette.accent);
			set("ink", preset.palette.ink);
			if (hit.kind === "stat") {
				set("value", hit.value ?? 0);
				set("v1", String(hit.value ?? ""));
				set("label", hit.text);
				set("l1", hit.text);
			} else {
				set("title", hit.text);
				set("button", hit.text);
			}
			const el = withId({ ...g, startTime: ticks(hit.at), duration: ticks(hit.seconds), params } as CreateTimelineElement);
			(graphics.elements as unknown as TimelineElement[]).push(el as TimelineElement);
			note(hit.kind, el.id);
			continue;
		}
		const styleId = hit.kind === "hook" ? preset.text.hook : hit.kind === "title" || hit.kind === "chapter" ? preset.text.title : hit.kind === "lower-third" ? preset.text.lowerThird : preset.text.cta;
		const base = TEXT_PRESETS.find((p) => p.id === styleId) ?? TEXT_PRESETS.find((p) => p.id === "plain")!;
		const styled = styledText(base, preset, hit.kind === "lower-third" ? "text" : "display");
		const params = buildPresetParams({ preset: styled, canvasHeight: canvas.height });
		const size = Number(params.fontSize) || 5;
		const lines = Math.min(3, Math.max(1, Math.ceil(hit.text.length / (canvas.width > canvas.height ? 34 : 16))));
		const share = lineShare(size, preset.fonts.leading) * lines + (params["design.sub"] ? lineShare(size * 0.5) : 0) + 0.02;
		const want = hit.kind === "hook" ? safe.top + share / 2 + 0.03 : hit.kind === "lower-third" ? safe.bottom - share / 2 - 0.06 : hit.kind === "cta" ? 0.5 : 0.42;
		const y = placeY(want, share, safe, facesOver(hit.at, hit.at + hit.seconds));
		params["transform.positionY"] = Math.round((y - 0.5) * canvas.height);
		bands.push({ from: hit.at, to: hit.at + hit.seconds, band: [y - share / 2 - 0.01, y + share / 2 + 0.01] });
		if (hit.kind === "lower-third") params["transform.positionX"] = Math.round(-canvas.width / 2 + rect.left + canvas.width * 0.35);
		params.content = hit.text;
		if (typeof params["design.sub"] === "string") params["design.sub"] = hit.sub ?? "";
		const el = withId(buildTextElement({ raw: { ...DEFAULTS.text.element, name: `${hit.kind}: ${hit.text.slice(0, 24)}`, duration: ticks(hit.seconds), params: { ...DEFAULTS.text.element.params, ...params } }, startTime: ticks(hit.at) }) as CreateTimelineElement);
		titles.elements.push(el as TextTrack["elements"][number]);
		note(hit.kind, el.id);
	}
	// ── captions ──
	const captionTrack = buildEmptyTrack({ id: generateUUID(), type: "text", name: t("Captions") }) as TextTrack;
	if (plan.captions?.words.length) {
		const style = getCaptionStyle(plan.captions.style as CaptionStyleId);
		// One cue per shot (captions never run across a cut), re-chunked by the style's limits.
		const cues: SubtitleCue[] = [];
		for (const p of plan.pieces) {
			const ws = plan.captions.words.filter((w) => w.start >= p.at - 0.01 && w.end <= p.at + (p.to - p.from) + 0.01);
			if (!ws.length) continue;
			cues.push({ text: ws.map((w) => w.text).join(" "), startTime: ws[0].start, duration: Math.max(0.3, ws[ws.length - 1].end - ws[0].start + 0.15), words: ws.map((w) => ({ text: w.text, startTime: w.start, endTime: w.end })) });
		}
		const maxWords = Math.min(preset.captions.maxWords, platform.captions.maxWords);
		const chunks = chunkCaptionsForStyle({ captions: cues, styleId: style.id, maxWords });
		chunks.forEach((cue, index) => {
			const built = buildStyledCaptionElement({ index, caption: cue, canvasSize: canvas, style });
			const size = Number(built.params.fontSize) || 4.6;
			const share = lineShare(size) * Math.min(2, platform.captions.maxLines) + 0.01;
			const taken = bands.filter((b) => b.from < cue.startTime + cue.duration && b.to > cue.startTime).map((b) => b.band);
			const y = placeY(platform.captions.y, share, safe, facesOver(cue.startTime, cue.startTime + cue.duration), taken);
			const params = {
				...built.params,
				fontFamily: preset.fonts.text === preset.fonts.display ? preset.fonts.display : preset.fonts.text,
				fontWeight: preset.energetic ? preset.fonts.displayWeight : preset.fonts.textWeight,
				color: preset.palette.ink,
				"highlight.color": preset.palette.accent,
				"box.maxLines": Math.min(2, platform.captions.maxLines),
				"box.width": Math.round(((rect.right - rect.left) / canvas.width) * 100) - 4,
				textTransform: preset.captions.uppercase ? "uppercase" : "none",
				"transform.positionY": Math.round((y - 0.5) * canvas.height),
				"transform.positionX": Math.round(((rect.left + rect.right) / 2 - canvas.width / 2) * 0.5),
			};
			const el = { ...built, id: generateUUID(), params } as TextTrack["elements"][number];
			captionTrack.elements.push(el);
			note("captions", el.id);
		});
		summary.push(`${captionTrack.elements.length} captions (${style.name})`);
	}
	// ── sound: music bed, then sounds ──
	const voiceTrack = buildEmptyTrack({ id: generateUUID(), type: "audio", name: t("Voice") }) as AudioTrack;
	if (plan.voice) {
		const m = findMedia(ctx, plan.voice.media);
		if (m) {
			const len = plan.voice.to - plan.voice.from;
			const element = withId(buildElementFromMedia({ mediaId: m.id, mediaType: "audio", name: m.name, duration: ticks(len), startTime: ticks(plan.voice.at) }) as CreateTimelineElement);
			const full = m.duration ?? len;
			Object.assign(element, { trimStart: ticks(plan.voice.from), trimEnd: ticks(Math.max(0, full - plan.voice.to)), sourceDuration: ticks(full) });
			element.params = { ...element.params, ...dialogParams(m.brief), voiceRole: "yes", fadeIn: CUT_RULES.fade, fadeOut: 0.2 };
			voiceTrack.elements.push(element as AudioTrack["elements"][number]);
			note("voice", element.id);
		}
	}
	const musicTrack = buildEmptyTrack({ id: generateUUID(), type: "audio", name: t("Music") }) as AudioTrack;
	if (plan.music?.pick.media) {
		// The user's song: their own file on the music track, faded out from the last bar.
		const m = plan.music;
		const media = findMedia(ctx, m.pick.media!);
		if (media) {
			const len = Math.min(m.seconds, total);
			const element = withId(buildElementFromMedia({ mediaId: media.id, mediaType: "audio", name: media.name, duration: ticks(len), startTime: ticks(m.at) }) as CreateTimelineElement);
			Object.assign(element, { trimStart: 0, trimEnd: ticks(Math.max(0, (media.duration ?? len) - len)), sourceDuration: ticks(media.duration ?? len) });
			element.params = { ...element.params, volume: m.gainDb, fadeOut: m.fadeOut, fadeIn: 0.05 };
			musicTrack.elements.push(element as AudioTrack["elements"][number]);
			note("music", element.id);
			summary.push(`your track «${media.name}» ${len.toFixed(1)} s, cuts on its bars`);
		}
	} else if (plan.music) {
		const m = plan.music;
		const el = buildLibraryClip({ entry: { url: m.pick.url, name: m.pick.name, dur: m.pick.dur, kind: "music", gain: 0 }, startTime: ticks(m.at) });
		const len = Math.min(m.seconds, total);
		const element = withId({
			...el,
			duration: ticks(len),
			trimEnd: ticks(Math.max(0, m.pick.dur - len)),
			params: { ...el.params, volume: Math.round(m.gainDb * 10) / 10, duckUnderVoice: true, fadeIn: 0.4, fadeOut: m.fadeOut },
		} as CreateTimelineElement);
		musicTrack.elements.push(element as AudioTrack["elements"][number]);
		note("music", element.id);
		summary.push(`music «${m.pick.name}» ${len.toFixed(1)} s${m.pick.bpm ? ` at ${Math.round(m.pick.bpm)} bpm, ends on a bar` : ""}, ducked under speech`);
	}
	const sfxTrack = buildEmptyTrack({ id: generateUUID(), type: "audio", name: t("Sound effects") }) as AudioTrack;
	for (const s of plan.sfx) {
		const el = buildLibraryClip({ entry: { url: s.pick.url, name: s.pick.name, dur: s.pick.dur, kind: "sfx", gain: 0 }, startTime: ticks(s.at) });
		const element = withId({ ...el, params: { ...el.params, volume: Math.round(s.gainDb * 10) / 10 } } as CreateTimelineElement);
		sfxTrack.elements.push(element as AudioTrack["elements"][number]);
		note("sfx", element.id);
	}
	if (sfxTrack.elements.length) summary.push(`${sfxTrack.elements.length} sounds at ${plan.sfx.map((s) => s.why).join(", ")}`);
	const overlay = [captionTrack, titles, graphics, broll].filter((t) => t.elements.length) as SceneTracks["overlay"];
	const audio = [voiceTrack, musicTrack, sfxTrack].filter((t) => t.elements.length);
	return {
		tracks: { overlay, main: main as SceneTracks["main"], audio },
		roles,
		style: {
			captionFont: preset.fonts.text,
			captionColor: preset.palette.accent,
			captionStyle: plan.captions?.style ?? "",
			titleFont: preset.fonts.display,
			accent: preset.palette.accent,
			musicDb: plan.music ? Math.round(plan.music.gainDb * 10) / 10 : 0,
		},
		summary,
		framed,
	};
}
