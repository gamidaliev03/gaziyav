// Client side of the Graphics section: the user's Kadr library (read through /api/text/graphics) plus
// .json files the user imports (kept in this browser profile). Nothing here is bundled with the app.
import { create } from "zustand";
import { parseLottie } from "./player";

export interface GraphicItem {
	id: string;
	name: string;
	category: string;
	w: number;
	h: number;
	fps: number;
	duration: number;
	texts: number;
	/** Kadr library path (server) or undefined for imported files. */
	file?: string;
	/** A still picture for the tile (the animation loads when the pointer rests on it, or when it is added). */
	preview?: string;
}

export const IMPORTED_CATEGORY = "Imported";
/** Graphics of the app: Noto Animated Emoji — the catalog and a still per tile inside (public/stickers/noto-animated:
 * catalog.json, LICENSE.txt; noto-animated-preview), each animation from the content cloud when it is used. */
const BUNDLED_CATALOG = "/stickers/noto-animated/catalog.json";
const IMPORTED_KEY = "opencut.graphics.imported";
const jsonCache = new Map<string, string>();

interface StoredImport {
	item: GraphicItem;
	json: string;
}

function readImported(): StoredImport[] {
	try {
		const raw = globalThis.localStorage?.getItem(IMPORTED_KEY);
		const list = raw ? (JSON.parse(raw) as StoredImport[]) : [];
		for (const entry of list) jsonCache.set(entry.item.id, entry.json);
		return list;
	} catch {
		return [];
	}
}

interface GraphicsState {
	status: "idle" | "loading" | "ready" | "missing" | "error";
	items: GraphicItem[];
	imported: GraphicItem[];
	load: () => Promise<void>;
	importFile: (file: File) => Promise<GraphicItem>;
}

export const useGraphicsLibrary = create<GraphicsState>((set, get) => ({
	status: "idle",
	items: [],
	imported: [],
	load: async () => {
		if (get().status === "loading" || get().status === "ready") return;
		set({ status: "loading", imported: readImported().map((entry) => entry.item) });
		// the graphics inside the app (Google's Noto Animated Emoji, CC BY 4.0) come first; the user's Kadr library after
		const bundled = await fetch(BUNDLED_CATALOG)
			.then((response) => (response.ok ? (response.json() as Promise<GraphicItem[]>) : []))
			.then((items) =>
				items.map((item) => {
					const name = (item.file ?? "").split("/").pop() ?? "";
					return { ...item, file: `/api/content/file/stickers/noto-animated/${encodeURIComponent(name)}`, preview: `/stickers/noto-animated-preview/${encodeURIComponent(name.replace(/\.json$/, ".webp"))}` };
				}),
			)
			.catch(() => [] as GraphicItem[]);
		try {
			const response = await fetch("/api/text/graphics");
			const data = (await response.json()) as { available?: boolean; items?: GraphicItem[] };
			const items = [...bundled, ...(data.items ?? [])];
			set({ status: data.available || bundled.length ? "ready" : "missing", items });
		} catch {
			set({ status: bundled.length ? "ready" : "error", items: bundled });
		}
	},
	importFile: async (file) => {
		const json = await file.text();
		const data = parseLottie(json);
		if (!data) throw new Error(`«${file.name}» is not a Lottie animation (.json from Lottie/Bodymovin).`);
		const fps = Number((data as { fr?: number }).fr) || 30;
		const item: GraphicItem = {
			id: `import:${file.name}:${json.length}`,
			name: file.name.replace(/\.json$/i, ""),
			category: IMPORTED_CATEGORY,
			w: data.w,
			h: data.h,
			fps,
			duration: Math.max(0.1, (data.op - data.ip) / fps),
			texts: 0,
		};
		jsonCache.set(item.id, json);
		const list = [...readImported().filter((entry) => entry.item.id !== item.id), { item, json }];
		try {
			globalThis.localStorage?.setItem(IMPORTED_KEY, JSON.stringify(list));
		} catch {
			// Storage full: the graphic still works in this session and inside the project.
		}
		set({ imported: list.map((entry) => entry.item) });
		return item;
	},
}));

/** The animation JSON of an item (cached). */
export async function fetchGraphicJson(item: GraphicItem): Promise<string> {
	const cached = jsonCache.get(item.id);
	if (cached) return cached;
	if (!item.file) throw new Error("This imported graphic is no longer available. Import the .json again.");
	// a graphic inside the app is a file of the app itself; the Kadr library is read through the server
	const response = await fetch(item.file.startsWith("/") ? item.file : `/api/text/graphics?file=${encodeURIComponent(item.file)}`);
	if (!response.ok) {
		const data = (await response.json().catch(() => ({}))) as { error?: string };
		throw new Error(data.error || "Couldn't read this graphic.");
	}
	const json = await response.text();
	jsonCache.set(item.id, json);
	return json;
}
