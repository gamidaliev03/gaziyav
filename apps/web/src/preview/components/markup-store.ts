// Preview · markup: which guides are on, remembered per project aspect (for the app, never saved in the project).
import { create } from "zustand";
import { MARKUP_LAYERS, type MarkupAspect, type MarkupLayer } from "./markup-geometry";
import { VERTICAL_PLATFORMS } from "./markup-zones";

export interface AspectMarkup {
	on: boolean;
	layers: MarkupLayer[];
	/** 9:16 only: «all» (the union) or one platform */
	platform: string;
	labels: boolean;
}

export const MARKUP_STORE_KEY = "gaziyav.preview.markup";
const OLD_SAFE_ZONES_KEY = "gaziyav.preview.safeZones";

/** What the guides show the first time they are turned on for a shape. */
export function defaultMarkup(aspect: MarkupAspect): AspectMarkup {
	return { on: false, layers: aspect === "custom" ? ["broadcast"] : ["social"], platform: "all", labels: true };
}

function clean(aspect: MarkupAspect, raw: unknown): AspectMarkup {
	const base = defaultMarkup(aspect);
	if (!raw || typeof raw !== "object") return base;
	const r = raw as Partial<AspectMarkup>;
	const layers = Array.isArray(r.layers) ? MARKUP_LAYERS.filter((l) => r.layers?.includes(l)) : base.layers;
	const platform = r.platform === "all" || VERTICAL_PLATFORMS.some((p) => p.id === r.platform) ? (r.platform as string) : "all";
	return { on: r.on === true, layers, platform, labels: r.labels !== false };
}

export function readSavedMarkup(storage: Pick<Storage, "getItem"> | undefined): Partial<Record<MarkupAspect, AspectMarkup>> {
	if (!storage) return {};
	try {
		const raw = JSON.parse(storage.getItem(MARKUP_STORE_KEY) ?? "null") as Record<string, unknown> | null;
		if (raw && typeof raw === "object") {
			const out: Partial<Record<MarkupAspect, AspectMarkup>> = {};
			for (const aspect of ["9:16", "16:9", "1:1", "4:5", "custom"] as const) if (aspect in raw) out[aspect] = clean(aspect, raw[aspect]);
			return out;
		}
		// the 9:16 safe zones of before (one platform or «universal») become the 9:16 social frame
		const old = JSON.parse(storage.getItem(OLD_SAFE_ZONES_KEY) ?? "null") as { zone?: string | null } | null;
		if (old?.zone) return { "9:16": { on: true, layers: ["social"], platform: old.zone === "universal" ? "all" : old.zone, labels: true } };
	} catch {}
	return {};
}

interface MarkupState {
	byAspect: Partial<Record<MarkupAspect, AspectMarkup>>;
}

export const useMarkup = create<MarkupState>()(() => ({
	byAspect: typeof localStorage === "undefined" ? {} : readSavedMarkup(localStorage),
}));

export function markupFor(aspect: MarkupAspect, state: MarkupState = useMarkup.getState()): AspectMarkup {
	return state.byAspect[aspect] ?? defaultMarkup(aspect);
}

export function setMarkup(aspect: MarkupAspect, patch: Partial<AspectMarkup>) {
	const next = { ...markupFor(aspect), ...patch };
	if (patch.layers) next.layers = MARKUP_LAYERS.filter((l) => patch.layers?.includes(l));
	useMarkup.setState((s) => ({ byAspect: { ...s.byAspect, [aspect]: next } }));
	try {
		localStorage.setItem(MARKUP_STORE_KEY, JSON.stringify(useMarkup.getState().byAspect));
	} catch {}
}

/** The key (⇧⌘;): the guides of this shape on / off; on with nothing chosen shows the shape's default. */
export function toggleMarkup(aspect: MarkupAspect) {
	const current = markupFor(aspect);
	if (current.on) return setMarkup(aspect, { on: false });
	setMarkup(aspect, { on: true, layers: current.layers.length ? current.layers : defaultMarkup(aspect).layers });
}

export function toggleMarkupLayer(aspect: MarkupAspect, layer: MarkupLayer) {
	const current = markupFor(aspect);
	const adding = !current.layers.includes(layer);
	const layers = adding ? [...current.layers, layer] : current.layers.filter((l) => l !== layer);
	// adding a layer shows the guides; taking the last one away hides them
	setMarkup(aspect, { layers, on: adding ? true : current.on && layers.length > 0 });
}

/** The aspect id of a canvas as the guides use it. */
export function markupAspect(format: string | null): MarkupAspect {
	return format === "9:16" || format === "16:9" || format === "1:1" || format === "4:5" ? format : "custom";
}

interface SafeZonesState {
	/** «Under {ui} UI» on text that reaches into the social frame's covered bands */
	warn: boolean;
	/** text / caption / sticker boxes at the playhead that reach into them (the button's dot) */
	outside: number;
	setWarn: (warn: boolean) => void;
}

function readWarn(): boolean {
	try {
		const saved = JSON.parse(localStorage.getItem(OLD_SAFE_ZONES_KEY) ?? "{}") as { warn?: unknown };
		return typeof saved.warn === "boolean" ? saved.warn : true;
	} catch {
		return true;
	}
}

/** The warnings' switch and count (the key of the 9:16 safe zones of before keeps the switch). */
export const useSafeZones = create<SafeZonesState>()((set) => ({
	warn: typeof localStorage === "undefined" ? true : readWarn(),
	outside: 0,
	setWarn: (warn) => {
		set({ warn });
		try {
			localStorage.setItem(OLD_SAFE_ZONES_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(OLD_SAFE_ZONES_KEY) ?? "{}"), warn }));
		} catch {}
	},
}));
