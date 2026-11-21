// Web images for the Media panel (Kadr A12): a keyed Pixabay / Pexels first when its key is pasted, then the free web
// (Wikimedia Commons, Openverse, NASA). Each picture says where it came from.
export type WebImageProvider = "commons" | "pixabay" | "pexels" | "openverse" | "nasa";

/** The site's name for a picture's corner and its credit. */
export const PROVIDER_NAME: Record<WebImageProvider, string> = { commons: "Wikimedia Commons", pixabay: "Pixabay", pexels: "Pexels", openverse: "Openverse", nasa: "NASA" };

export interface WebImage {
	id: string;
	provider: WebImageProvider;
	title: string;
	author: string;
	license: string;
	/** Page of the image on its site (credit link). */
	sourceUrl: string;
	thumbUrl: string;
	/** Full image, ≤ 1920 px wide when the site offers a resized copy. */
	fullUrl: string;
	width: number;
	height: number;
}

export interface WebImageSearchResult {
	items: WebImage[];
	hasMore: boolean;
	providers: WebImageProvider[];
	/** The sites asked, in order (by name). */
	searched?: string[];
	/** One line: a picked service without its key, or a keyed service that failed (the free web answered). */
	note?: string;
	error?: string;
}

/** One credit line: "<title> — <author> · <license>". */
export function creditLine(image: Pick<WebImage, "title" | "author" | "license">): string {
	return [image.title, image.author].filter(Boolean).join(" — ") + (image.license ? ` · ${image.license}` : "");
}
