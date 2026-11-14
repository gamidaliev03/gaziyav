/**
 * CapCut 9.5's Captions → Templates groups, in its order (docs/capcut/compare/captions-templates-*-capcut.png). Favorites
 * holds the starred templates and the user's own; NEW starts with Gaziyav AI's «New» (a template from a sentence).
 */
export const TEMPLATE_GROUPS = [
	{ key: "tpl-favorites", label: "Favorites", ids: [] },
	{ key: "tpl-trending", label: "Trending", ids: ["hormozi", "karaoke", "word-pop", "word-box", "one-word", "ad-montserrat-yellow", "ad-rubik-pop", "ad-manrope-cyan", "cc-glow-pink", "cc-words-rise", "cc-pop-up", "cc-x-beast", "cc-x-hormozi-green", "cc-x-pop-up", "cc-x-neon-pink", "cc-x-emoji-bold", "cc-x-sunset"] },
	{ key: "tpl-classic", label: "Classic", ids: ["clean", "cc-classic-yellow", "cc-classic-serif", "cc-classic-outline", "cc-basic-caps", "cc-x-serif-quiet", "cc-x-typewriter", "cc-x-shadow-soft"] },
	{ key: "tpl-new", label: "NEW", ids: ["cc-x-emoji-bold", "cc-x-emoji-pop", "cc-x-emoji-clean", "cc-x-pixel", "cc-x-glitch", "cc-x-arcade", "cc-x-shadow-pink", "cc-x-shadow-double", "cc-x-rise", "cc-x-fly-in", "cc-x-bounce", "cc-x-neon-pink", "cc-words-rise", "cc-letters-pop", "cc-karaoke-glow", "cc-pop-up", "cc-scatter", "cc-glow-pink", "cc-word-box", "cc-lyrics-gradient", "cc-aesthetic-script", "cc-boxed-black", "cc-multi-two"] },
	{ key: "tpl-hits", label: "Hits", ids: ["hormozi", "ad-montserrat-yellow", "ad-inter-green", "ad-golos-yellow", "word-pop", "karaoke", "ad-golos-red", "cc-x-hormozi-green", "cc-x-beast", "cc-x-beast-red", "cc-x-hormozi-jump", "cc-x-violet-pop"] },
	{ key: "tpl-word", label: "Word", ids: ["one-word", "cc-letters-pop", "ad-montserrat-one", "cc-word-box", "cc-word-glow", "cc-x-pop-up", "cc-x-rise", "cc-x-fly-in", "cc-x-bounce", "cc-x-fly-caps"] },
	{ key: "tpl-glow", label: "Glow", ids: ["neon", "cc-glow-pink", "cc-glow-blue", "cc-glow-gold", "cc-word-glow", "cc-x-neon-pink", "cc-x-neon-cyan", "cc-x-neon-lime", "cc-x-gold-glow", "cc-x-purple-glow", "cc-x-jump-neon"] },
	{ key: "tpl-lyrics", label: "Lyrics", ids: ["karaoke", "cc-karaoke-glow", "ad-manrope-karaoke", "cc-lyrics-soft", "cc-lyrics-gradient", "cc-x-karaoke-pink", "cc-x-karaoke-gold", "cc-x-karaoke-soft", "cc-x-purple-glow"] },
	{ key: "tpl-basic", label: "Basic", ids: ["clean", "tiktok", "cc-basic-white", "cc-basic-caps", "cc-x-thin", "cc-x-dim-bright", "cc-x-shadow-soft"] },
	{ key: "tpl-aesthetic", label: "Aesthetic", ids: ["cc-aesthetic-serif", "cc-aesthetic-script", "cc-aesthetic-thin", "cc-classic-serif", "cc-x-rise-serif", "cc-x-gold-glow", "cc-x-serif-quiet", "cc-x-caps-line"] },
	{ key: "tpl-monoline", label: "Monoline", ids: ["cc-mono-line", "cc-mono-caps", "one-word", "ad-montserrat-one", "cc-x-caps-line", "cc-x-typewriter"] },
	{ key: "tpl-multiline", label: "Multiline", ids: ["cc-multi-two", "cc-multi-three", "clean", "karaoke", "cc-x-karaoke-soft", "cc-x-dim-bright"] },
	{ key: "tpl-highlight", label: "Highlight", ids: ["hormozi", "word-box", "word-pop", "ad-inter-green", "ad-manrope-cyan", "ad-golos-red", "ad-inter-box", "cc-x-cyan-word", "cc-x-lime-word", "cc-x-underline-yellow", "cc-x-underline-pink", "cc-x-sunset", "cc-x-ice"] },
	{ key: "tpl-bw", label: "B&W", ids: ["cc-bw-white", "cc-bw-black", "clean", "cc-classic-outline", "cc-x-thick-white", "cc-x-thin", "cc-x-shadow-hard"] },
	{ key: "tpl-boxed", label: "Boxed", ids: ["word-box", "tiktok", "ad-inter-box", "ad-rubik-lime", "cc-boxed-black", "cc-boxed-white", "cc-word-box", "cc-x-plate-black", "cc-x-plate-white", "cc-x-plate-yellow", "cc-x-plate-glass", "cc-x-plate-red", "cc-x-plate-purple", "cc-x-pop-box", "cc-x-typewriter-box"] },
] as const satisfies readonly { key: string; label: string; ids: readonly string[] }[];
export type TemplateGroupKey = (typeof TEMPLATE_GROUPS)[number]["key"];
