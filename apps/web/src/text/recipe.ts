import type { TextPreset } from "./presets";

/** Numbers the eye does not tell apart at this grain: 7 vs 8 em, 0.8 vs 0.9 s, a 10 vs 12 px shadow. */
const GRAIN: Record<string, number> = { fontSize: 2, duration: 0.5, "anim.inDuration": 0.5, "anim.outDuration": 0.5, "anim.loopDuration": 0.5, "shadow.blur": 6, "stroke.width": 2 };

/**
 * A preset's look without its colours, words and theme — layout, fonts, layers and motion, with sizes and timings
 * rounded to what the eye tells apart. Two presets with the same recipe are the same preset in another colour (the
 * packs cycle their fonts, so variant 4 of 3 fonts was variant 1 recoloured), and the colour or size is one click in
 * the inspector: only the first of each is offered.
 */
export function presetRecipe(preset: Pick<TextPreset, "duration" | "params" | "plate">): string {
	const look = (key: string, value: unknown): unknown => {
		if (typeof value === "string" && /^(#|rgb|hsl)/i.test(value)) return "colour";
		if (typeof value === "number" && GRAIN[key]) return Math.round(value / GRAIN[key]);
		if (Array.isArray(value)) return value.map((item) => look(key, item));
		if (value && typeof value === "object") {
			const record = value as Record<string, unknown>;
			return Object.fromEntries(
				Object.keys(record)
					.sort()
					.map((k) => [k, look(k, record[k])]),
			);
		}
		return value;
	};
	const plate = preset.plate ? { padX: preset.plate.padX, padY: preset.plate.padY, radius: preset.plate.radius } : null;
	return JSON.stringify(look("", { duration: preset.duration, plate, params: preset.params }));
}
