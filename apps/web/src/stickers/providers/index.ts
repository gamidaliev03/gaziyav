import { stickersRegistry } from "../registry";
import type { StickerProvider } from "@/stickers/types";
import { emoji3dProvider } from "./emoji3d";
import { shapesProvider } from "./shapes";

import { legacyEmojiProvider } from "./legacy";

const defaultProviders: StickerProvider[] = [emoji3dProvider, shapesProvider, legacyEmojiProvider];

export function registerDefaultStickerProviders({
	providersToRegister = defaultProviders,
}: {
	providersToRegister?: StickerProvider[];
} = {}): void {
	for (const provider of providersToRegister) {
		if (stickersRegistry.has(provider.id)) {
			continue;
		}
		stickersRegistry.register({ key: provider.id, definition: provider });
	}
}
