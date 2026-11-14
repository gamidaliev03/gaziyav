import type { TBackground } from "@/project/types";

export const DEFAULT_BACKGROUND_COLOR = "#000000";

/** Whether two canvas fills look the same (a colour typed in another case is the same colour). */
export function isSameBackground({ a, b }: { a: TBackground | null; b: TBackground | null }): boolean {
	if (!a || !b || a.type !== b.type) return a === b;
	return a.type === "color" && b.type === "color"
		? a.color.toLowerCase() === b.color.toLowerCase()
		: JSON.stringify(a) === JSON.stringify(b);
}
