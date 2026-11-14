// Web images for the Media panel (Kadr A12): Wikimedia Commons, free, no key.
export type WebImageProvider = "commons";

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
	error?: string;
}

/** One credit line: "<title> — <author> · <license>". */
export function creditLine(image: Pick<WebImage, "title" | "author" | "license">): string {
	return [image.title, image.author].filter(Boolean).join(" — ") + (image.license ? ` · ${image.license}` : "");
}
