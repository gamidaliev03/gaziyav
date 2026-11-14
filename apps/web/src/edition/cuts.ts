// (src/family/edition.ts), and any one of them comes back in his edition with the build flag NEXT_PUBLIC_GAZIYAV_KEEP
// (comma-separated names: `NEXT_PUBLIC_GAZIYAV_KEEP=stickers,templates`). Only the ways to ADD new ones are cut — the
// panels, ⌘K, the connector's tools: projects that already use them open and render exactly as before (their
// renderers, readers and files stay).

const KEEP = new Set(
	String(process.env.NEXT_PUBLIC_GAZIYAV_KEEP ?? "")
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean),
);
const kept = (name: string) => KEEP.has(name);

export const EDITION = {
	/** The sticker packs — Animated (Noto), 3D (Fluent emoji), Graphics (Lottie arrows, callouts, badges): the Stickers
	 * tab's sections, their ⌘K entries, the connector's `sticker` kind. Shapes are not stickers: they stay. */
	stickers: kept("stickers"),
	/** All the multi-layer template packs. His edition keeps the text-motion packs (Titles, Talking head) and the ones
	 * his projects were made with (flash-sale: its five layers in his projects 18–26 times; product-launch: once). */
	templatePacks: kept("templates"),
} as const;

/** The template packs his edition keeps (templates/catalog.ts): text motion, and the ones his projects use. */
export const KEPT_TEMPLATE_PACKS: ReadonlySet<string> = new Set([
	"expert", "story", "hook-caption", "quote-card", // Talking head
	"promo", "trailer", "neon-night", "glitch-intro", // Titles
	"flash-sale", "product-launch", // used in his projects (11.11 scan of his backup)
]);
