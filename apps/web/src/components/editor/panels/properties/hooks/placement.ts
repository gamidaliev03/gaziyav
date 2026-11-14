import type { TimelineElement } from "@/timeline";

/** Where a clip sits and which part of its source it plays: what a drag or a trim on the timeline changes. */
const PLACEMENT_KEYS = new Set(["startTime", "duration", "trimStart", "trimEnd"]);

/** Only the clip's place changed (a timeline drag or trim), none of what the inspector shows. */
export function onlyPlacementChanged(before: TimelineElement, after: TimelineElement): boolean {
	if (before === after) return true;
	const a = before as unknown as Record<string, unknown>;
	const b = after as unknown as Record<string, unknown>;
	for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
		if (a[key] !== b[key] && !PLACEMENT_KEYS.has(key)) return false;
	}
	return true;
}

/**
 * Only a title's words changed (perf, 13.11): what typing into the inspector's own text field previews. The field
 * holds what is typed (TextParamField's draft) and the player and the timeline draw the preview; the rest of the panel
 * re-rendered on every key — ~1 100 components a key for a title (fonts list, ~30 menus, ~30 tooltips) on rc39.
 */
export function onlyTypedTextChanged(before: TimelineElement, after: TimelineElement): boolean {
	if (before === after) return true;
	const a = before as unknown as Record<string, unknown>;
	const b = after as unknown as Record<string, unknown>;
	for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
		if (a[key] === b[key]) continue;
		if (key !== "params") return false;
		const pa = (a.params ?? {}) as Record<string, unknown>;
		const pb = (b.params ?? {}) as Record<string, unknown>;
		for (const param of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
			if (pa[param] !== pb[param] && param !== "content") return false;
		}
	}
	return true;
}

/** The focus is in a field of the inspector: the one that previews what is typed shows it itself. */
export function typingInInspector(): boolean {
	if (typeof document === "undefined") return false;
	const active = document.activeElement as HTMLElement | null;
	return !!active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT") && !!active.closest("[data-inspector]");
}
