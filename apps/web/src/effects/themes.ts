// Content themes for the effect, transition and filter tiles (gaming, wedding, food, sports…), as for motion graphics
// and templates: the theme chips narrow a panel to a theme, and each tile is previewed over a photo of its theme
// instead of the same portrait everywhere. A tile's themes come from words in its name (a heart → wedding, pixels →
// gaming) and then from its category. Free of React.
import { MOGRAPH_THEMES, type Theme, themePhoto } from "@/montage/mograph";

export type { Theme };
export { MOGRAPH_THEMES as THEMES, themePhoto };

/** What the words of a name say about its theme, strongest first. */
const BY_WORD: Array<[RegExp, Theme[]]> = [
	[/heart|love|kiss|wedding|romance|petal|rose/i, ["wedding", "beauty"]],
	[/game|gamer|pixel|8.?bit|arcade|cyber|hud|matrix|glitch|vaporwave|sci.?fi|\bcode\b/i, ["gaming", "tech"]],
	[/food|juicy|tasty|bakery|coffee|dessert|warm phone|cafe|kitchen|product/i, ["food"]],
	[/sport|fitness|gym|stadium|hero|epic|impact|earthquake|speed|punch|whip|shake|bounce|action|vivid/i, ["sports", "fitness"]],
	[/news|ticker|breaking|broadcast|\blive\b/i, ["news"]],
	[/classroom|school|lesson|education|chalk|paper|book|page/i, ["education"]],
	[/office|business|clean|minimal|corporate|slide|push|wipe/i, ["business", "education"]],
	[/snow|rain|fog|sun|sky|ocean|sea|mountain|tropical|safari|drone|landscape|travel|summer|autumn|winter|desert/i, ["travel"]],
	[/kid|cartoon|comic|toy|bubble|jelly|confetti|\bpop\b|pastel|mint|candy|rainbow|y2k/i, ["kids"]],
	[/beauty|skin|portrait|soft|smooth|glow|bloom|bokeh|dream|pastel|peach|lavender/i, ["beauty", "wedding"]],
	[/music|disco|party|concert|strobe|laser|beat|neon/i, ["music"]],
	[/fashion|vogue|noir|mono|black|duotone|b&w|chrome/i, ["fashion"]],
	[/tech|digital|data|scan|signal|hologram|steel/i, ["tech"]],
	[/workout|pulse|heartbeat|breathe/i, ["fitness"]],
	[/house|home|room|interior|real estate|window|door|city/i, ["real-estate"]],
];

/** Each category's themes (effects, transitions and filters share some names: Trending, Film, Glitch, Retro…). */
const BY_CATEGORY: Record<string, Theme[]> = {
	Trending: ["music", "fashion", "sports"],
	Sets: ["music", "travel", "kids"],
	AI: ["tech", "business", "beauty"],
	Camera: ["sports", "travel", "fitness"],
	Light: ["wedding", "food", "music"],
	Retro: ["music", "fashion", "news"],
	Tools: ["business", "education", "news"],
	Style: ["fashion", "music", "kids"],
	Lens: ["travel", "food", "real-estate"],
	Blur: ["beauty", "news", "wedding"],
	Film: ["wedding", "travel", "music"],
	Glitch: ["gaming", "tech", "music"],
	Party: ["music", "kids", "fitness"],
	Mirror: ["fashion", "music", "tech"],
	Distort: ["gaming", "kids", "music"],
	Distortion: ["gaming", "kids", "music"],
	Frame: ["real-estate", "business", "education"],
	Weather: ["travel", "kids", "wedding"],
	Seamless: ["travel", "food", "real-estate"],
	"Slide & Push": ["business", "education", "news"],
	Shape: ["kids", "education", "business"],
	"3D": ["tech", "gaming", "business"],
	Basic: ["business", "education", "news"],
	Pattern: ["kids", "fashion", "music"],
	Life: ["food", "travel", "beauty"],
	Movies: ["travel", "real-estate", "music"],
	Mood: ["fashion", "music", "beauty"],
	Food: ["food", "travel"],
	Travel: ["travel", "real-estate"],
	Night: ["music", "gaming", "news"],
	Mono: ["fashion", "news", "music"],
	Portrait: ["beauty", "wedding", "fashion"],
	Landscape: ["travel", "real-estate"],
	Cinematic: ["travel", "music", "real-estate"],
	Vintage: ["wedding", "fashion", "music"],
};
const FALLBACK: Theme[] = ["travel", "music", "business"];

/** A tile's themes, at most three: its name's first, then its category's. */
export function themesOf({ name, category, keywords = [] }: { name: string; category: string; keywords?: readonly string[] }): Theme[] {
	const words = [name, ...keywords].join(" ");
	const out: Theme[] = [];
	for (const [pattern, themes] of BY_WORD) if (pattern.test(words)) out.push(...themes);
	out.push(...(BY_CATEGORY[category] ?? FALLBACK));
	return [...new Set(out)].slice(0, 3);
}

/** The photo a tile is previewed over: the chosen theme's, else its own first theme's. */
export function previewPhotoFor(themes: readonly Theme[], chosen: Theme | null): string {
	return themePhoto(chosen ?? themes[0] ?? FALLBACK[0]);
}
