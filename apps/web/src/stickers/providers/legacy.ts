// Flat emoji stickers were removed (1.0.79): one in a saved project draws as the same emoji in 3D (151 of the 152
// have a twin with the same name). Nothing is browsed or searched here.
import { parseStickerId } from "../sticker-id";
import type { StickerProvider } from "../types";
import { emoji3dProvider } from "./emoji3d";

export const legacyEmojiProvider: StickerProvider = {
	id: "emoji",
	async search() {
		return { items: [], total: 0, hasMore: false };
	},
	async browse() {
		return { sections: [] };
	},
	resolveUrl({ stickerId, options }) {
		return emoji3dProvider.resolveUrl({ stickerId: `emoji3d:${parseStickerId({ stickerId }).providerValue}`, options });
	},
};
