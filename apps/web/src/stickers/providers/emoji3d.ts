// 3D emoji stickers: the same UGC-ad set as Emoji (reactions, hands, hearts, marks, money) plus every face, in
// Microsoft's Fluent Emoji 3D (MIT). The app carries the catalog (public/stickers/emoji3d/catalog.json: name, group,
// source and licence of each; LICENSE.txt) and a 64 px picture per tile; the 256 px PNG comes from the content cloud
// the first time the sticker is used (content/server/cloud.ts).
import { smartFilter } from "@/search/smart";
import { buildStickerId, parseStickerId } from "../sticker-id";
import type { StickerBrowseResult, StickerItem, StickerProvider, StickerSearchResult } from "../types";

const EMOJI3D_PROVIDER_ID = "emoji3d";
const BASE = "/stickers/emoji3d";

type Entry = { id: string; name: string; group: string; file: string; keywords?: string[] };

let catalog: Promise<StickerItem[]> | null = null;
function items(): Promise<StickerItem[]> {
	catalog ??= fetch(`${BASE}/catalog.json`)
		.then((response) => (response.ok ? (response.json() as Promise<Entry[]>) : []))
		.then((entries) =>
			entries.map((entry) => ({
				id: buildStickerId({ providerId: EMOJI3D_PROVIDER_ID, providerValue: entry.id }),
				provider: EMOJI3D_PROVIDER_ID,
				name: entry.name,
				// The tile shows the app's own 64 px picture; the sticker itself comes from the content cloud when used.
				previewUrl: `${BASE}-preview/${encodeURIComponent(entry.file.replace(/\.png$/, ".webp"))}`,
				metadata: { group: entry.group, keywords: entry.keywords ?? [] },
			})),
		)
		.catch(() => {
			catalog = null; // try again next time
			return [];
		});
	return catalog;
}

export const emoji3dProvider: StickerProvider = {
	id: EMOJI3D_PROVIDER_ID,
	async search({ query, options }): Promise<StickerSearchResult> {
		const all = await items();
		const q = query.trim();
		const found = q ? smartFilter({ items: all, query: q, fields: (item) => [item.name, String(item.metadata.group ?? ""), ...((item.metadata.keywords as string[]) ?? [])] }) : all;
		const limit = options?.limit ?? 100;
		return { items: found.slice(0, limit), total: found.length, hasMore: found.length > limit };
	},
	async browse(): Promise<StickerBrowseResult> {
		const all = await items();
		const groups = [...new Set(all.map((item) => String(item.metadata.group)))];
		return {
			sections: groups.map((group) => ({
				id: `emoji3d-${group.toLowerCase().replace(/\W+/g, "-")}`,
				title: group,
				items: all.filter((item) => item.metadata.group === group),
				layout: "grid" as const,
			})),
		};
	},
	resolveUrl({ stickerId }) {
		return `/api/content/file/stickers/emoji3d/${encodeURIComponent(parseStickerId({ stickerId }).providerValue)}.png`;
	},
};
