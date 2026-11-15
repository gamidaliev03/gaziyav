// Whose shape the project has: somebody's choice, or still the one its first clip gave (CapCut's «Original»).
import type { TProjectSettings } from "@/project/types";

/**
 * True when the project's shape is a choice that stays: a format picked on the start page (9:16, 1:1 — the project is
 * born with `originalCanvasSize`), or a size picked by hand after the first clip gave one (the canvas no longer is the
 * «original»). False for a project with no shape of its own yet, and for one whose shape the first clip gave: when its
 * timeline is emptied, the next first clip gives its own — a wide clip dropped by mistake must not leave the vertical
 * one that replaces it in black bars. (Since 14.11 the first clip's size was read as a chosen format and stuck.)
 * Projects made before this flag existed have none: their shape stays, as it did.
 */
export function canvasIsChosen(settings: Pick<TProjectSettings, "canvasSize" | "originalCanvasSize" | "canvasFromClip"> | undefined | null): boolean {
	const original = settings?.originalCanvasSize;
	if (!settings || !original) return false;
	const stillOriginal = settings.canvasSize.width === original.width && settings.canvasSize.height === original.height;
	return !(settings.canvasFromClip === true && stillOriginal);
}
