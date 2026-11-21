// Quick mode of the AI Composition agent + what both modes share. DeepSeek sees only ONE composition and, read-only,
// what lies under its time range (clip names, the speech transcript, the face box, on-screen text), this
// composition's own conversation and its current layers. Quick mode returns kit layers in the composition's style
// (one fast call); full mode (agent.ts) writes its own components. A fact guard rejects names and numbers nobody said,
// "do only what is asked" drops extras, the layout guard keeps text off the face.
import { BRAIN_OFF, brainReadyNow } from "@/studio/server/brain";
import { agentReady } from "@/studio/server/agent-keys";
import { transform } from "sucrase";
import { StudioError } from "@/studio/server/errors";
import { loadSettings } from "@/studio/server/settings";
import { getFile } from "@/studio/server/files";
import { run } from "@/studio/server/tools";
import fs from "node:fs";
import path from "node:path";
import { MONTAGE_KINDS } from "../catalog";
import { styleOf } from "../styles";
import { maskDeep, maskSwears } from "../profanity";
import { JSON_PREFIX, type PropValue } from "../types";
import { type Box, pinOf, resolveLayout } from "./layout";
import { factProblems, type FactSource } from "./facts";
import { PLACE } from "./knowledge";
import { chat, type Message, parseJson } from "./llm";

export const SFX_FILES = ["whoosh.wav", "whoosh-long.wav", "swoosh.wav", "impact.wav", "punch.wav", "sub-drop.wav", "pop.wav", "pop-high.wav", "click.wav", "riser.wav", "downlifter.wav", "glitch.wav", "ding.wav", "chime.wav", "notification.wav", "shutter.wav", "typing.wav"];

export interface ChatTurn {
	role: "user" | "assistant";
	text: string;
}

export interface PlanRequest {
	request: string;
	width: number;
	height: number;
	fps: number;
	duration: number;
	playhead: number;
	alpha: boolean;
	clips: { type: string; name: string; from: number; to: number; under?: boolean }[];
	words: { text: string; start: number; end: number }[];
	/** Text already on screen under the composition (titles, captions), read-only. */
	onScreen?: string[];
	style?: string;
	/** "edit" keeps untouched layers; "variation" designs a new, different set. */
	mode?: "edit" | "variation";
	layers: { id: string; kind: string; from: number; to: number; props: Record<string, PropValue> }[];
	/** The video with the speaker: its uploaded file; source second `start` plays at composition second `at`. */
	face?: { fileId: string; start: number; length: number; at: number } | null;
	/** This composition's conversation (oldest first), so a follow-up refines the existing work. */
	history?: ChatTurn[];
	/** Auto (the agent decides), or the user's choice. */
	force?: "auto" | "quick" | "full";
	/** Where this composition sits: its name, the parent timeline and its range there (parent seconds). */
	place?: { name: string; parent: string; from: number; to: number };
	/** The user's own media inside this composition (or selected in it), already in the asset store. */
	media?: { id: string; name: string; from: number; to: number; selected?: boolean; info: import("./assets").MediaInput }[];
	/** Images the user added for this request (already in the asset store). */
	provided?: { name: string; title: string; credit?: string; mediaId?: string; w?: number; h?: number }[];
	/** Templates → «Create with Gaziyav AI»: one element for the user's library, `brief` = the user's own words. */
	preset?: boolean;
	brief?: string;
	/** The interface language: the labels of the layer's fields are written in it. */
	uiLang?: string;
}

export interface PlannedLayer {
	id?: string;
	kind: string;
	from: number;
	to: number;
	props: Record<string, PropValue>;
}

export interface PlannedSfx {
	at: number;
	/** Bundled file (public/sfx) … */
	file?: string;
	/** … or a sound library id (/api/library/file/<id>). */
	id?: string;
	name?: string;
	dur?: number;
}

export interface PlanResult {
	comment: string;
	mode: "quick" | "full";
	layers: PlannedLayer[];
	sfx: PlannedSfx[];
	calls: number;
	/** Ids of current layers the answer left out: they stay exactly as they are. */
	keep?: string[];
	/** The plan in one line (shown before building). */
	plan?: string;
	/** What happens to the user's own media the new layers animate (one undo step with the layers). */
	original?: { id: string; action: "hide" | "remove" }[];
	/** Instead of guessing: one short question with quick answers ("add-image" asks the user for a picture). */
	/** `query`: the picture the plan needs (fal.ai can make it from these words). */
	question?: { text: string; options: string[]; action?: "add-image"; query?: string };
}

const REMOVE = /удал|убер|убрать|без |замен|вместо|заново|с нуля|переделай|remove|delete|drop|replace|instead|from scratch|start over|redo/i;

/**
 * Current layers the answer did not return stay as they are, unless the request asks to remove or rebuild something
 * (a follow-up builds on what is there; "variation" designs a new set).
 */
export function untouched(r: PlanRequest, returned: { id?: string }[]): string[] {
	if (r.mode === "variation" || REMOVE.test(r.request)) return [];
	const ids = new Set(returned.map((l) => l.id).filter(Boolean));
	return r.layers.filter((l) => !ids.has(l.id)).map((l) => l.id);
}

export type Log = (text: string) => void;

const SYSTEM = `You are the motion designer of a top ad production studio, working inside ONE "Remotion AI Composition" of a video editor (like a DaVinci compound clip). You design premium motion graphics for short vertical ads (Reels/TikTok/Shorts) from a ready motion kit; the user sees only editable layers on the timeline.

## What you see
This composition (size, fps, duration, playhead, its own AI layers, its own conversation) and, READ-ONLY, what lies under its time range: clip names, the speech transcript with word timings, the speaker's face box and text already on screen. Nothing else exists.

## Do exactly what is asked (most important)
- Make ONLY the elements the request names. If it says "a hook", return one hook; nothing else. Never add captions, CTAs, stickers, counters, a Finish layer or SFX unless the request asks for them (or says "full montage" / "do everything").
- Positions in the request are binding: "сверху/top" → y 0.12–0.2, "снизу/bottom" → y 0.6–0.68, "по центру/center" → y 0.4–0.5.
- In "edit" mode change only what the request mentions; keep every other layer exactly as it is.
- Calm, readable motion: a layer stays on screen long enough to read (≥ 1.5 s for short text, ≥ 0.3 s per word).

## Facts: never invent
On-screen text uses ONLY words from the speech, the request or the clip names. Never invent people's names, brands, roles, numbers, prices, dates or claims. No speaker name in the speech or the request → no LowerThird with a name. No numbers said → no Counter/PriceCard/Badge with a number. No speech → keep text short and use only the request's words. Swear words never go on screen as they are (skip them or mask the middle: б**).

## Answer: ONLY a JSON object
{"comment": "one short sentence in English: what you did",
 "layers": [{"id"?: "keep the id of an existing layer you keep or edit", "kind": "<Kind>", "from": seconds, "to": seconds, "props": {...}}],
 "sfx": [{"at": seconds, "file": "<one of the SFX files>"}]}
"layers" is the COMPLETE new set of AI layers of the composition. Times are seconds of the composition (0 = its start), inside [0, duration].
Edits: when layers already exist and the request asks for a change ("bigger", "move it up", "another colour", "remove it"), change ONLY the layers it names and copy every other layer exactly (same id, times and props). "Bigger/smaller" = props.scale ×1.25/×0.8 (or size); "up/down" = y −/+ 0.06.

## Kit kinds (props)
${MONTAGE_KINDS.filter((k) => k.doc && k.kind !== "Custom")
	.map((k) => `- ${k.doc}`)
	.join("\n")}
Every kind also takes "accent" (hex colour), only when the user asks for a colour. y/x are fractions of the frame (centre of the block).

## Design system (the style does the look)
The composition has ONE style (given below); the kit draws fonts, colours, plates, captions and motion from it — do NOT set fonts.
- One idea per screen, ≤ 7 words, accent on 1–2 words (*word*). Short and punchy, in the language of the speech, built from the speaker's own words.
- A hook is a complete thought that makes people stay (the core claim or tension of the speech, condensed from his words), never a fragment cut mid-sentence.
- Tie graphics to the words they amplify (word timings). Hook in 0–2.5 s; captions follow the speech; CTA in the last 2–3 s; text stays ≥ 1.2 s.
- 9:16 safe zone: key graphics in y 0.12–0.62, captions around y 0.64, nothing below 0.70, right 13 % kept clear. Never cover the face box with big text.
- Never two text layers at the same spot at the same time.
SFX files (only when asked): ${SFX_FILES.join(", ")}.

${PLACE}`;

const f2 = (n: number) => n.toFixed(2);

/** The composition as the model sees it: ONLY this request's inputs. */
export function context(r: PlanRequest, face: Box | null, opts: { code?: boolean } = {}): string {
	const style = styleOf(r.style);
	const clips = r.clips.length
		? r.clips.map((c) => `- ${c.type} "${c.name}" ${f2(c.from)}–${f2(c.to)} s${c.under ? " (under the composition, read-only)" : ""}`).join("\n")
		: "- none (pure motion graphics)";
	const words = r.words.length ? r.words.map((w) => `${w.text}(${f2(w.start)}–${f2(w.end)})`).join(" ") : "no speech";
	const layers = r.layers.length
		? JSON.stringify(
				r.layers.map((l) => ({
					...l,
					// Own components travel as their source so a follow-up edits the real thing.
					props: Object.fromEntries(Object.entries(l.props).filter(([k]) => opts.code || (k !== "code" && k !== "assets"))),
				})),
			)
		: "none yet";
	const onScreen = r.onScreen?.length ? r.onScreen.map((t) => `"${t}"`).join(", ") : "none";
	const variation =
		r.mode === "variation"
			? "\nRegenerate: design a NEW version that clearly differs from the previous one (other layout, timing and look where it makes sense). Do not keep ids."
			: "";
	const place = r.place
		? `Place: this is "${r.place.name}" on the "${r.place.parent}" timeline at ${f2(r.place.from)}–${f2(r.place.to)} s there; you change only its own AI layers.\n`
		: "";
	const media = r.media?.length
		? `\nYour media — the user's own files in this composition (animate THESE when the request points at "this photo / logo / clip"; use the ref in "assets"):\n${r.media
				.map((m, i) => {
					const x = m.info;
					const svg = x.svg?.paths.length ? `\n  SVG viewBox ${x.svg.viewBox}, paths: ${x.svg.paths.map((d) => JSON.stringify(d.slice(0, 600))).join(", ").slice(0, 3000)}` : "";
					return `- media:${i} "${m.name}" — ${x.kind} ${x.w}×${x.h} (aspect ${(x.w / Math.max(1, x.h)).toFixed(2)}), ${x.alpha ? "transparent background" : "opaque"}${x.colors.length ? `, colours ${x.colors.join(" ")}` : ""}${x.duration ? `, ${x.duration.toFixed(1)} s` : ""}; on this timeline ${f2(m.from)}–${f2(m.to)} s (element id ${m.id})${m.selected ? ", selected" : ""}${svg}`;
				})
				.join("\n")}`
		: "";
	return `${place}Composition: ${r.width}x${r.height}, ${r.fps} fps, duration ${f2(r.duration)} s. Playhead: ${f2(r.playhead)} s.${media}
Style: ${style.label} — ${style.direction}${style.emoji ? "" : " No emoji, no stickers."} Accent ${style.accent}.
Clips:
${clips}
${face ? `Speaker's face box (fractions of the frame, top-left origin): x ${f2(face.x)}–${f2(face.x + face.w)}, y ${f2(face.y)}–${f2(face.y + face.h)}. Keep text and graphics off the face.` : "Face: unknown."}
Speech (word timings, s): ${words}
Text already on screen: ${onScreen}
Current AI layers of this composition: ${layers}${variation}`;
}

/** Earlier turns of THIS composition's conversation (bounded). */
export function historyText(history?: ChatTurn[]): string {
	const turns = (history ?? []).filter((t) => t && typeof t.text === "string" && t.text.trim()).slice(-8);
	if (!turns.length) return "";
	return `\nThis composition's conversation so far (oldest first):\n${turns.map((t) => `${t.role === "user" ? "User" : "You"}: ${t.text.trim().slice(0, 400)}`).join("\n")}\n`;
}

export const DEFAULT_REQUEST = "Design premium motion graphics for this composition: a hook and captions of the speech.";

const FORBIDDEN =
	/\b(fetch|XMLHttpRequest|WebSocket|eval|Function|localStorage|sessionStorage|indexedDB|cookie|window|document|globalThis|process|navigator|importScripts|setTimeout|setInterval|requestAnimationFrame|postMessage|while|require)\b|\bdo\s*\{|Math\.random|import\s*\(|https?:\/\/|\btransition\s*:|\banimation\s*:/;
const ALLOWED_IMPORTS = new Set(["react", "remotion", "@remotion/noise", "@remotion/shapes", "@remotion/paths", "./kit"]);

/** TSX → CommonJS for the sandboxed loader; an error with a reason when the code breaks the sandbox rules. */
export function compileComponent(code: string): { js: string } | { error: string } {
	if (code.length > 24000) return { error: "component too long (keep it under ~220 lines)" };
	const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
	const bad = imports.find((i) => !ALLOWED_IMPORTS.has(i));
	if (bad) return { error: `import "${bad}" is not allowed` };
	const forbidden = FORBIDDEN.exec(code);
	if (forbidden) return { error: `"${forbidden[0]}" is not allowed in components` };
	try {
		const js = guardLoops(transform(code, { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "classic", production: true }).code);
		return { js };
	} catch (error) {
		return { error: `does not compile: ${(error as Error).message.slice(0, 300)}` };
	}
}

/**
 * Every `for (…) {` body starts with a call to the loader's loop guard, so a runaway loop throws (and the layer
 * draws nothing) instead of freezing the editor or the renderer. `while`/`do` are not allowed at all.
 */
export function guardLoops(js: string): string {
	let out = "";
	let i = 0;
	for (;;) {
		const at = js.indexOf("for (", i);
		if (at < 0) return out + js.slice(i);
		const prev = at > 0 ? js[at - 1] : " ";
		if (/[\w$.]/.test(prev)) {
			out += js.slice(i, at + 5);
			i = at + 5;
			continue;
		}
		let depth = 0;
		let j = at + 4;
		for (; j < js.length; j++) {
			if (js[j] === "(") depth++;
			else if (js[j] === ")" && --depth === 0) break;
		}
		let k = j + 1;
		while (k < js.length && /\s/.test(js[k])) k++;
		if (js[k] === "{") {
			out += `${js.slice(i, k + 1)} __loopGuard();`;
			i = k + 1;
		} else {
			out += `${js.slice(i, j + 1)} { __loopGuard(); `;
			// Single-statement body: close the block after the statement (up to its semicolon).
			const end = js.indexOf(";", k);
			if (end < 0) return out + js.slice(j + 1);
			out += `${js.slice(j + 1, end + 1)} }`;
			i = end + 1;
		}
	}
}

const KINDS = new Set(MONTAGE_KINDS.map((k) => k.kind));
const isHex = (v: unknown) => typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v);

/** The kit's content fields: never filled from the catalogue's placeholder defaults ("Main idea", "Tap the link"…). */
const CONTENT_FIELDS = new Set(["text", "kicker", "sub", "title", "label", "name", "role", "badge", "prefix", "suffix", "icon", "emoji", "value", "newPrice", "oldPrice", "component", "credit"]);
/** A kit layer without its main content says nothing: it is dropped instead of showing a placeholder. */
const REQUIRED: Record<string, string> = { HookTitle: "text", CTA: "text", Plate: "text", Card: "title", Counter: "value", PriceCard: "newPrice", Badge: "text", Sticker: "emoji", LowerThird: "name" };

/** A prop as the editor stores it; on-screen text gets its swear words masked. */
function propValue(v: unknown): PropValue | undefined {
	if (typeof v === "boolean") return v;
	if (typeof v === "string") return maskSwears(v);
	if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
	if (v && typeof v === "object") {
		const s = JSON.stringify(maskDeep(v));
		return s.length <= 20000 ? `${JSON_PREFIX}${s}` : undefined;
	}
	return undefined;
}

export interface CleanOptions {
	/** Compiled components by name (full mode). */
	components?: Map<string, { js: string; code: string }>;
	/** Assets JSON for a component name (full mode). */
	assetsFor?: (component: string) => string | undefined;
}

/** Validates the model's layers: known kinds, sane times, style, defaults for layout fields only. */
export function cleanLayers(r: PlanRequest, raw: any, opts: CleanOptions = {}): { layers: PlannedLayer[]; problems: string[] } {
	const problems: string[] = [];
	const style = styleOf(r.style);
	const layers: PlannedLayer[] = [];
	for (const l of Array.isArray(raw?.layers) ? raw.layers : []) {
		const kind = String(l?.kind ?? "");
		if (!KINDS.has(kind) || (kind === "Cutaway" && !opts.components)) {
			problems.push(`unknown kind "${kind}"`);
			continue;
		}
		const props: Record<string, PropValue> = {};
		for (const [k, v] of Object.entries(l?.props ?? {})) {
			if (k === "js" || k === "code" || k === "assets" || k === "style") continue;
			const pv = k === "component" || k === "bg" || k === "accent" || k === "layout" ? (typeof v === "string" ? v : undefined) : propValue(v);
			if (pv !== undefined) props[k] = pv;
		}
		if (kind === "Custom") {
			const name = String(props.component ?? "");
			const c = opts.components?.get(name);
			if (!c) {
				problems.push(`Custom layer without a valid component "${name}"`);
				continue;
			}
			props.js = c.js;
			props.code = c.code;
			const assets = opts.assetsFor?.(name);
			if (assets) props.assets = assets;
		}
		const layout = String(l?.layout ?? props.layout ?? "overlay");
		props.layout = kind === "Custom" && layout === "scene" ? "scene" : "overlay";
		if (!isHex(props.accent)) props.accent = style.accent;
		props.style = style.id;
		if (!style.emoji && (kind === "Sticker" || (typeof props.icon === "string" && props.icon))) {
			if (kind === "Sticker") continue;
			props.icon = "";
		}
		// Layout defaults (y, x, scale…) now, so the layout guard sees the real position; never placeholder content.
		for (const f of MONTAGE_KINDS.find((k) => k.kind === kind)?.fields ?? []) {
			if (props[f.key] === undefined && f.type !== "color" && !CONTENT_FIELDS.has(f.key)) props[f.key] = f.default as PropValue;
		}
		const need = REQUIRED[kind];
		if (need && (props[need] === undefined || props[need] === "" || props[need] === 0)) {
			problems.push(`${kind} without ${need} was dropped`);
			continue;
		}
		let from = Math.max(0, Math.min(r.duration, Number(l?.from) || 0));
		let to = Math.max(0, Math.min(r.duration, Number(l?.to) || 0));
		if (to - from < 0.3) {
			to = Math.min(r.duration, from + 2);
			if (to - from < 0.3) from = Math.max(0, to - 2);
		}
		layers.push({ id: typeof l?.id === "string" ? l.id : undefined, kind, from, to, props });
	}
	return { layers, problems };
}

/** Text props of the current layers (written by an earlier request or typed by the user): already accepted facts. */
const LAYER_TEXT = /^(text|kicker|sub|title|label|name|role|badge|prefix|suffix|caption|subtitle|headline|line\d*|items?|nodes?|steps?|words?)$/i;
function layerTexts(r: PlanRequest): string[] {
	const out: string[] = [];
	const walk = (v: unknown) => {
		if (typeof v === "string") out.push(v);
		else if (Array.isArray(v)) v.forEach(walk);
		else if (v && typeof v === "object") Object.values(v).forEach(walk);
	};
	for (const l of r.layers ?? []) {
		for (const [k, v] of Object.entries(l.props ?? {})) {
			if (k === "code" || k === "js" || k === "assets" || k === "schema" || typeof v !== "string") continue;
			if (v.startsWith(JSON_PREFIX)) {
				try {
					walk(JSON.parse(v.slice(JSON_PREFIX.length)));
				} catch {}
			} else if (LAYER_TEXT.test(k) || /[\p{Lu}]/u.test(v)) out.push(v);
		}
	}
	return out.slice(0, 200);
}

/**
 * What the fact guard may read: the request, this composition's earlier requests (a follow-up like "make it bigger"
 * keeps the name it was asked for before), the text of its current layers, the speech, the clip names and the text
 * already on screen.
 */
export function factSource(r: PlanRequest): FactSource {
	const asked = (r.history ?? []).filter((t) => t?.role === "user" && typeof t.text === "string").map((t) => t.text);
	return {
		request: [r.request ?? "", ...asked, ...layerTexts(r)].join("\n"),
		words: r.words.map((w) => w.text),
		clipNames: r.clips.map((c) => c.name.replace(/\.[a-z0-9]+$/i, "")),
		onScreen: r.onScreen ?? [],
	};
}

/** The model may still add extras: a film finish and sound effects the request did not ask for go. */
export function onlyWhatIsAsked(request: string, result: { layers: PlannedLayer[]; sfx: PlannedSfx[] }) {
	const asked = request.toLowerCase();
	const wantsAll = /\bfull montage\b|everything|всё сразу|все сразу|полный монтаж|монтаж целиком/.test(asked);
	if (!wantsAll && !/finish|grain|film|vignette|плёнк|пленк|зерн|виньет|финиш/.test(asked)) {
		result.layers = result.layers.filter((l) => l.kind !== "Finish");
	}
	if (!wantsAll && !/sfx|sound|whoosh|swoosh|pop|звук|свуш|вжух|саунд|шум/.test(asked)) result.sfx = [];
}

/** Quick mode: kit layers in one DeepSeek call (+ one repair call only when it broke the rules or invented facts). */
export async function planQuick(r: PlanRequest, face: Box | null, log: Log, signal?: AbortSignal): Promise<PlanResult> {
	const s = loadSettings();
	if (!brainReadyNow() && !agentReady()) throw new StudioError(BRAIN_OFF);
	const user = `${context(r, face)}\n${historyText(r.history)}\nRequest: ${r.request.trim() || DEFAULT_REQUEST}`;
	const facts = factSource(r);
	const temperature = r.mode === "variation" ? 0.95 : 0.6;
	const ask = (messages: Message[], t: number) =>
		chat({ key: s.deepseekKey, model: s.deepseekModel, messages, json: true, temperature: t, maxTokens: 8000, thinking: false, timeout: 120, signal });
	const messages: Message[] = [
		{ role: "system", content: SYSTEM },
		{ role: "user", content: user },
	];
	log("Planning the layers…");
	let answer = await ask(messages, temperature);
	let raw = parseJson(answer);
	let calls = 1;
	let { layers, problems } = cleanLayers(r, raw);
	let invented = factProblems(layers, facts);
	if ((problems.length && !layers.length) || invented.length || problems.some((p) => p.startsWith("unknown"))) {
		const issues = [...problems, ...invented.map((x) => x.problem)];
		log(`Fixing: ${issues[0]}${issues.length > 1 ? ` (+${issues.length - 1})` : ""}`);
		try {
			answer = await ask(
				[...messages, { role: "assistant", content: answer }, { role: "user", content: `Problems: ${issues.join("; ")}.\nUse only words from the speech, the request or the clip names. Return the corrected full JSON.` }],
				0.4,
			);
			calls++;
			raw = parseJson(answer);
			const second = cleanLayers(r, raw);
			if (second.layers.length) layers = second.layers;
			invented = factProblems(layers, facts);
		} catch (error) {
			if (signal?.aborted) throw error;
		}
	}
	let comment = String(raw?.comment ?? "Done").slice(0, 200);
	// Still invented after the fix: those layers go. Never leave the user with nothing: if every layer was flagged, keep them and say so.
	if (invented.length && invented.length >= layers.length) {
		comment = `${comment} (check the names and numbers on screen: they are not in the speech)`;
		invented = [];
	}
	if (invented.length) {
		const bad = new Set(invented.map((x) => x.layer));
		layers = layers.filter((l) => !bad.has(l));
		log(`Removed ${bad.size} layer${bad.size === 1 ? "" : "s"} with invented names or numbers`);
	}
	const sfx: PlannedSfx[] = (Array.isArray(raw?.sfx) ? raw.sfx : [])
		.map((x: any) => ({ at: Math.max(0, Math.min(r.duration, Number(x?.at) || 0)), file: String(x?.file ?? "") }))
		.filter((x: { file: string }) => SFX_FILES.includes(x.file))
		.slice(0, 12);
	const keep = untouched(r, layers);
	const result: PlanResult = { comment, mode: "quick", layers, sfx, calls, keep };
	onlyWhatIsAsked(r.request, result);
	if (keep.length) log(`Kept ${keep.length} layer${keep.length === 1 ? "" : "s"} the request didn't name`);
	if (!result.layers.length && !keep.length) throw new StudioError("Gaziyav AI couldn't make usable layers from these words: nothing was changed. Say it a little differently.");
	const notes = resolveLayout(result.layers, face, r.width / Math.max(1, r.height), pinOf(r.request));
	if (notes.length) log(`Layout: ${notes.slice(0, 2).join(", ")}`);
	return result;
}

/** Why the face box is unknown (for the log): no helper, the helper failed, or there is really no face. */
export const faceNote = { last: "" };

/**
 * Face box of the speaker (Apple Vision helper shipped in the app); null when unknown. The first Vision run on a
 * fresh Mac can be slow, so it gets time, and a range with no face is retried over the whole clip.
 */
export async function faceBox(r: PlanRequest, signal?: AbortSignal): Promise<Box | null> {
	faceNote.last = "";
	const tool = process.env.STUDIO_BIN_DIR && path.join(process.env.STUDIO_BIN_DIR, "facecheck");
	if (!r.face?.fileId) return null;
	if (!tool || !fs.existsSync(tool)) {
		faceNote.last = "the face finder isn't in this build";
		return null;
	}
	let file: string;
	try {
		file = getFile(r.face.fileId).path;
	} catch (error) {
		faceNote.last = (error as Error).message;
		return null;
	}
	const attempt = async (args: string[]) => {
		const out = await run(tool, [file, ...args], { timeout: 75, signal });
		const j = JSON.parse(out.stdout.trim().split("\n").pop() || "{}");
		if (j.error) throw new Error(String(j.error));
		if (!j.found || !Array.isArray(j.box)) return null;
		const [x, y, w, h] = j.box.map(Number);
		return { x, y, w, h };
	};
	try {
		return (await attempt([r.face.start.toFixed(3), Math.max(0.5, r.face.length).toFixed(3)])) ?? (await attempt([]));
	} catch (error) {
		if (signal?.aborted) throw error;
		faceNote.last = (error as Error).message.slice(0, 120);
		return null;
	}
}
