import { effectsRegistry } from "@/effects/registry";
import type { ParamValues } from "@/params";
import { buildDefaultParamValues } from "@/params/registry";

// Kadr ".kadrpreset" looks (a saved effect stack, JSON written by Kadr's
// PresetStore) → our effect instances. Kadr effect ids that exist here
// (kadr.effect.*) keep their parameters; Kadr's built-ins we cover with our
// own effects are mapped (colorAdjust/lut → Color, blur, shake, …).

export interface StudioLook {
	id: string;
	name: string;
	effects: Array<{ type: string; params: ParamValues }>;
	skipped: string[];
}

type KadrValue =
	| { number: { _0: number } }
	| { bool: { _0: boolean } }
	| { choice: { _0: string } }
	| { text: { _0: string } }
	| { color: { _0: { r: number; g: number; b: number; a?: number } } }
	| { point: { _0: { x: number; y: number } } };

interface KadrPresetFile {
	id?: string;
	name?: string;
	effects?: Array<{ pluginID: string; isEnabled?: boolean; params?: Record<string, { value?: KadrValue }> }>;
}

const hex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");

/** Flattens Kadr parameter values: points become <key>X / <key>Y, colours hex. */
function readParams(params: Record<string, { value?: KadrValue }> = {}): ParamValues {
	const out: ParamValues = {};
	for (const [key, entry] of Object.entries(params)) {
		const value = entry?.value;
		if (!value) continue;
		if ("number" in value) out[key] = value.number._0;
		else if ("bool" in value) out[key] = value.bool._0;
		else if ("choice" in value) out[key] = value.choice._0;
		else if ("text" in value) out[key] = value.text._0;
		else if ("color" in value) out[key] = `#${hex(value.color._0.r)}${hex(value.color._0.g)}${hex(value.color._0.b)}`;
		else if ("point" in value) {
			out[`${key}X`] = value.point._0.x;
			out[`${key}Y`] = value.point._0.y;
		}
	}
	return out;
}

const n = (p: ParamValues, key: string, fallback: number) => (typeof p[key] === "number" ? (p[key] as number) : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const KADR_LOOKS: Record<string, string> = {
	"look.tealOrange": "tealOrange",
	"look.warmFilm": "film90s",
	"look.coolFade": "coolTech",
	"look.bleachBypass": "softContrast",
	"look.monoContrast": "bwContrast",
};

/** Kadr built-ins we implement under our own ids. */
function mapBuiltin(id: string, p: ParamValues): { type: string; params: ParamValues } | null {
	switch (id) {
		case "kadr.effect.colorAdjust":
			return {
				type: "studio.color",
				params: {
					exposure: clamp(n(p, "exposure", 0), -3, 3),
					contrast: clamp((n(p, "contrast", 1) - 1) * 100, -100, 100),
					saturation: clamp((n(p, "saturation", 1) - 1) * 100, -100, 100),
					vibrance: clamp(n(p, "vibrance", 0) * 100, -100, 100),
					temperature: clamp((n(p, "temperature", 6500) - 6500) / 55, -100, 100),
					tint: clamp(n(p, "tint", 0), -100, 100),
					highlights: clamp((n(p, "highlights", 1) - 1) * 100, -100, 100),
					shadows: clamp(n(p, "shadows", 0) * 100, -100, 100),
				},
			};
		case "kadr.effect.lut": {
			const look = KADR_LOOKS[String(p.lut ?? "")];
			return look ? { type: "studio.color", params: { look, lookIntensity: clamp(n(p, "intensity", 1) * 100, 0, 100) } } : null;
		}
		case "kadr.effect.gaussianBlur":
			return { type: "blur", params: { intensity: clamp(n(p, "radius", 10) * 5, 0, 100) } };
		case "kadr.effect.sharpen":
			return { type: "studio.sharpen", params: { amount: n(p, "amount", 0.5), radius: n(p, "radius", 2.5) } };
		case "kadr.effect.vignette":
			return { type: "studio.vignette", params: { intensity: n(p, "intensity", 0.5), radius: n(p, "radius", 0.9), softness: n(p, "softness", 0.6) } };
		case "kadr.effect.filmGrain":
			return { type: "studio.grain", params: { amount: n(p, "amount", 0.25), size: n(p, "size", 1) } };
		case "kadr.effect.kenBurns": {
			const start = n(p, "startScale", 1);
			const end = n(p, "endScale", 1.15);
			return { type: "studio.kenBurns", params: { amount: clamp(Math.abs(end - start) * 100, 0, 40), zoomOut: end < start } };
		}
		case "kadr.effect.shake":
			return {
				type: "studio.shake",
				params: {
					amplitude: clamp((n(p, "amplitude", 12) / 1920) * 100, 0, 10),
					frequency: n(p, "frequency", 6),
					rotation: n(p, "rotation", 0.8),
					decay: 0,
					seed: n(p, "seed", 0),
				},
			};
		case "kadr.effect.glitch":
			return { type: "studio.glitch", params: { intensity: n(p, "intensity", 0.6), frequency: n(p, "frequency", 0.5), split: clamp((n(p, "split", 14) / 1920) * 100, 0, 4) } };
		case "kadr.effect.vhs":
			return { type: "studio.vhs", params: { amount: n(p, "amount", 0.7), tracking: p.tracking !== false } };
		case "kadr.effect.zoomBlur":
			return { type: "studio.zoomBlur", params: { amount: clamp(n(p, "amount", 20) / 240, 0, 0.8) } };
		case "kadr.effect.lightLeak":
			return { type: "studio.lightLeak", params: { amount: n(p, "amount", 0.6), ...(typeof p.color === "string" ? { color: p.color } : {}) } };
		default:
			return null;
	}
}

export function parseKadrPreset(text: string, fallbackName: string): StudioLook {
	let data: KadrPresetFile;
	try {
		data = JSON.parse(text) as KadrPresetFile;
	} catch {
		throw new Error("Not a .kadrpreset file (invalid JSON).");
	}
	if (!Array.isArray(data.effects)) throw new Error("Not a .kadrpreset file (no effects list).");
	const effects: StudioLook["effects"] = [];
	const skipped: string[] = [];
	for (const item of data.effects) {
		if (item.isEnabled === false) continue;
		const params = readParams(item.params);
		if (effectsRegistry.has(item.pluginID)) {
			const defaults = buildDefaultParamValues(effectsRegistry.get(item.pluginID).params);
			effects.push({ type: item.pluginID, params: { ...defaults, ...params } });
			continue;
		}
		const mapped = mapBuiltin(item.pluginID, params);
		if (!mapped) {
			skipped.push(item.pluginID.replace(/^kadr\.effect\./, ""));
			continue;
		}
		const defaults = buildDefaultParamValues(effectsRegistry.get(mapped.type).params);
		// colorAdjust + lut both land on one Color effect
		const existing = mapped.type === "studio.color" ? effects.find((e) => e.type === "studio.color") : undefined;
		if (existing) Object.assign(existing.params, mapped.params);
		else effects.push({ type: mapped.type, params: { ...defaults, ...mapped.params } });
	}
	return {
		id: data.id ?? `${Date.now()}`,
		name: (data.name ?? fallbackName).replace(/_/g, " "),
		effects,
		skipped,
	};
}

const STORE_KEY = "studio.kadrLooks";

export function loadSavedLooks(): StudioLook[] {
	try {
		const raw = localStorage.getItem(STORE_KEY);
		const list = raw ? (JSON.parse(raw) as StudioLook[]) : [];
		return Array.isArray(list) ? list : [];
	} catch {
		return [];
	}
}

export function saveLook(look: StudioLook): StudioLook[] {
	const list = [look, ...loadSavedLooks().filter((l) => l.id !== look.id)].slice(0, 50);
	try {
		localStorage.setItem(STORE_KEY, JSON.stringify(list));
	} catch {
		// storage full or blocked: the look still applies to this clip
	}
	return list;
}
