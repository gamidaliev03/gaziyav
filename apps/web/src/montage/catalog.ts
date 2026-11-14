// The AI layer catalogue: every kind of AI layer inside a Remotion AI Composition, its name and editable fields.
// Used by the timeline (graphic definitions ai.<Kind>), the properties panel (fields) and the DeepSeek prompt (API).
// Must stay free of Remotion imports — it is loaded by the editor core.
import type { ParamDefinition, ParamValues } from "@/params";
import { MOGRAPH_KINDS } from "./mograph";

export const AI_PREFIX = "ai.";

type Field = ParamDefinition;

const text = (key: string, label: string, def = ""): Field => ({ key, label, type: "text", default: def });
const num = (key: string, label: string, def: number, min: number, max: number, step: number): Field => ({
	key,
	label,
	type: "number",
	default: def,
	min,
	max,
	step,
});
const color = (key: string, label: string, def: string): Field => ({ key, label, type: "color", default: def });
const select = (key: string, label: string, def: string, options: [string, string][]): Field => ({
	key,
	label,
	type: "select",
	default: def,
	options: options.map(([value, l]) => ({ value, label: l })),
});
const bool = (key: string, label: string, def: boolean): Field => ({ key, label, type: "boolean", default: def });

const ACCENT = color("accent", "Accent", "#FFD23F");
const Y = (def: number) => num("y", "Vertical position", def, 0, 1, 0.01);
const X = (def: number) => num("x", "Horizontal position", def, 0, 1, 0.01);

export interface MontageKind {
	kind: string;
	/** Name on the timeline. */
	label: string;
	/** One line for the DeepSeek prompt: when to use it and what the props mean. Empty = not offered to DeepSeek. */
	doc: string;
	fields: Field[];
}

const SIZE = num("scale", "Size", 1, 0.5, 2, 0.05);

export const MONTAGE_KINDS: MontageKind[] = [
	{
		kind: "HookTitle",
		label: "Hook",
		doc: 'HookTitle {text: "2–6 words from the speech; \\n = line break; *word* = accent", kicker?: "1–3 words above", y?: 0.24, dim?: 0–0.4} — the hook in the first 0–2.5 s; words rise out of masks one by one',
		fields: [text("text", "Text", "Main *idea*"), text("kicker", "Kicker"), ACCENT, Y(0.24), num("dim", "Dim video", 0.28, 0, 0.8, 0.02)],
	},
	{
		kind: "Captions",
		label: "Captions",
		doc: "Captions {maxWords?: 1–5, y?: 0.64} — word-synced captions of the speech (the words come from the speech by themselves; the look comes from the style); one layer for the whole speech",
		fields: [num("maxWords", "Words on screen", 3, 1, 6, 1), SIZE, ACCENT, Y(0.64)],
	},
	{
		kind: "LowerThird",
		label: "Lower third",
		doc: "LowerThird {name, role?} — who is speaking or what this is about; top-left; ONLY a name or role that is said in the speech or given in the request, never invented",
		fields: [text("name", "Name", "Name"), text("role", "Role"), ACCENT, X(0.06), Y(0.17)],
	},
	{
		kind: "CTA",
		label: "CTA",
		doc: 'CTA {text: "1–3 words from the speech or the request", icon?: "one emoji"} — call to action pill with a pulse; the last 2–3 s',
		fields: [text("text", "Text", "Tap the link"), text("icon", "Emoji"), ACCENT, Y(0.56)],
	},
	{
		kind: "Plate",
		label: "Plate",
		doc: 'Plate {text: "1–3 words from the speech", sub?: "small line from the speech"} — offer / benefit plate with a light sweep',
		fields: [text("text", "Text", "Offer"), text("sub", "Subline"), ACCENT, Y(0.32)],
	},
	{
		kind: "Card",
		label: "Card",
		doc: 'Card {title: "a fact from the speech in 1–4 words", text?: "one line from the speech", icon?: "emoji"} — fact card',
		fields: [text("title", "Title", "Fact"), text("text", "Text"), text("icon", "Emoji"), ACCENT, Y(0.3)],
	},
	{
		kind: "Counter",
		label: "Counter",
		doc: 'Counter {value: number, from?: 0, prefix?, suffix?: "unit said with the number", label?} — a number counts up and punches; ONLY numbers said in the speech or given in the request',
		fields: [num("value", "Number", 100, -1e9, 1e9, 1), text("prefix", "Prefix"), text("suffix", "Suffix"), text("label", "Label"), ACCENT, Y(0.3)],
	},
	{
		kind: "PriceCard",
		label: "Price",
		doc: 'PriceCard {newPrice: number, oldPrice?: number, badge?: "discount said in the speech", title?} — price tag; ONLY prices from the speech or the request',
		fields: [num("newPrice", "Price", 990, 0, 1e9, 1), num("oldPrice", "Old price", 0, 0, 1e9, 1), text("badge", "Badge"), text("title", "Title"), ACCENT, Y(0.4)],
	},
	{
		kind: "Badge",
		label: "Badge",
		doc: 'Badge {text: "1–2 words or a number from the speech", x?: 0.78, y?: 0.22} — round stamp badge',
		fields: [text("text", "Text", "-50%"), ACCENT, X(0.78), Y(0.22)],
	},
	{
		kind: "Sticker",
		label: "Sticker",
		doc: 'Sticker {emoji: "one emoji", burst?: true, x?: 0.78, y?: 0.3, scale?: 1} — emoji sticker with a burst (only styles that allow emoji)',
		fields: [text("emoji", "Emoji", "🔥"), bool("burst", "Burst", true), X(0.78), Y(0.3), SIZE],
	},
	{
		kind: "ProgressBar",
		label: "Progress bar",
		doc: "ProgressBar {} — thin progress bar at the top for the whole composition",
		fields: [ACCENT, Y(0.13)],
	},
	{
		kind: "Finish",
		label: "Film finish",
		doc: "Finish {grain?: 0.05, vignette?: 0.28, leak?: true} — grain + vignette + light leak at the start, whole composition",
		fields: [num("grain", "Grain", 0.05, 0, 0.3, 0.01), num("vignette", "Vignette", 0.28, 0, 0.8, 0.02), bool("leak", "Light leak", true), ACCENT],
	},
	{
		kind: "Cutaway",
		label: "Cutaway",
		doc: "",
		fields: [
			select("mode", "Mode", "card", [
				["card", "Card"],
				["full", "Full frame"],
			]),
			text("label", "Label"),
			ACCENT,
			Y(0.36),
			text("credit", "Source and licence"),
		],
	},
	{
		kind: "Custom",
		label: "Motion",
		doc: "Custom {component: \"<Name from components>\", ...your own props} — only when the kit has nothing close",
		fields: [text("title", "Text"), ACCENT, text("component", "Component")],
	},
	// Ready-made motion graphics (Templates → Motion graphics): our own code, never offered to DeepSeek.
	...MOGRAPH_KINDS.map((k): MontageKind => ({ kind: k.kind, label: k.label, doc: "", fields: k.fields })),
];

export const KIND_BY_ID = new Map(MONTAGE_KINDS.map((k) => [k.kind, k]));

export const isAiDefinition = (definitionId: string | undefined) => !!definitionId?.startsWith(AI_PREFIX);

export function kindOf(definitionId: string): MontageKind | undefined {
	return KIND_BY_ID.get(definitionId.slice(AI_PREFIX.length));
}

/** Props of an element = its params minus the editor's own transform/opacity keys. */
export function propsFromParams(params: ParamValues): Record<string, string | number | boolean> {
	const out: Record<string, string | number | boolean> = {};
	for (const [k, v] of Object.entries(params)) {
		if (k.startsWith("transform.") || k.startsWith("motion.") || k === "opacity" || k === "blendMode") continue;
		out[k] = v;
	}
	return out;
}
