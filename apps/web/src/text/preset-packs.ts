// Preset packs: each recipe — a motion-title design, a designer font pairing, a choreography and sample words — is
// coloured with designer palettes (Color Hunt's Popular and Dark lists, color-hunt-palettes.json). Colours take
// roles by measure, not by order: the darkest becomes the plate, the most vivid the accent, and text on any fill is
// whichever palette colour (or white / near-black) reads best on it (WCAG contrast). Russian names and samples come
// with them (`ru` on each preset; text/presets.ts merges the offered ones into the dictionary). A variant that only
// recolours an earlier one of its recipe is not built (text/recipe.ts).
import palettesJson from "./color-hunt-palettes.json";
import type { TextPreset, TextPresetGroup } from "./presets";
import { presetRecipe } from "./recipe";
import type { Theme } from "./theme-scenes";

type Params = Record<string, string | number | boolean>;
type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => {
	const h = hex.replace("#", "");
	return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
};
const luminance = (hex: string) => {
	const lin = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};
const contrast = (a: string, b: string) => {
	const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
};
const saturation = (hex: string) => {
	const c = rgb(hex);
	const max = Math.max(...c);
	const min = Math.min(...c);
	return max === 0 ? 0 : (max - min) / max;
};
const hue = (hex: string) => {
	const [r, g, b] = rgb(hex);
	const max = Math.max(r, g, b);
	const d = max - Math.min(r, g, b);
	if (d === 0) return -1;
	const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return (h * 60 + 360) % 360;
};

interface Roles {
	dark: string;
	light: string;
	vivid: string;
	mid: string;
	all: string[];
}

function roles(palette: string[]): Roles {
	const byLum = [...palette].sort((a, b) => luminance(a) - luminance(b));
	const vivid = [...palette].sort((a, b) => saturation(b) * (0.35 + luminance(b)) - saturation(a) * (0.35 + luminance(a)))[0];
	const dark = byLum[0];
	const light = byLum[byLum.length - 1];
	const mid = palette.find((c) => c !== dark && c !== light && c !== vivid) ?? byLum[1];
	return { dark, light, vivid, mid, all: palette };
}

/** The colour that reads best on `fill`: a palette colour if it reaches 4.5:1, else white or near-black. */
function textOn(fill: string, r: Roles): string {
	const candidates = [...r.all, "#ffffff", "#111111"].filter((c) => c.toLowerCase() !== fill.toLowerCase());
	const good = candidates.filter((c) => contrast(c, fill) >= 4.5 && saturation(c) < 0.5);
	const pool = good.length ? good : candidates;
	return pool.sort((a, b) => contrast(b, fill) - contrast(a, fill))[0];
}

/** A light colour that reads on the video under a shadow (the palette's lightest when light enough, else white). */
const onVideo = (r: Roles) => (luminance(r.light) > 0.75 ? r.light : "#ffffff");

const MOODS: Array<[number, string, string]> = [
	[15, "Ruby", "Рубин"],
	[40, "Sunset", "Закат"],
	[62, "Gold", "Золото"],
	[90, "Lime", "Лайм"],
	[150, "Forest", "Лес"],
	[178, "Lagoon", "Лагуна"],
	[215, "Ocean", "Океан"],
	[245, "Midnight", "Полночь"],
	[285, "Violet", "Фиалка"],
	[330, "Berry", "Ягода"],
	[360, "Rose", "Роза"],
];
function mood(r: Roles): [string, string] {
	const h = hue(r.vivid);
	if (h < 0 || saturation(r.vivid) < 0.18) return luminance(r.vivid) > 0.5 ? ["Sand", "Песок"] : ["Stone", "Камень"];
	const hit = MOODS.find(([edge]) => h < edge) ?? MOODS[0];
	return [hit[1], hit[2]];
}

const anim = (inKind: string, inDuration: number, outKind: string, outDuration: number, delay = 0, loop = "none"): Params => ({
	"anim.in": inKind,
	"anim.inDuration": inDuration,
	"anim.out": outKind,
	"anim.outDuration": outDuration,
	"anim.loop": loop,
	"anim.inDelay": delay,
});
const softShadow: Params = { "shadow.enabled": true, "shadow.color": "#00000099", "shadow.blur": 14, "shadow.offsetX": 0, "shadow.offsetY": 5 };
const glow = (color: string): Params => ({ "shadow.enabled": true, "shadow.color": `${color}dd`, "shadow.blur": 38, "shadow.offsetX": 0, "shadow.offsetY": 0 });
const FIT: Params = { "box.width": 84, "box.autoFit": true, "box.maxLines": 3, textAlign: "center" };
const LEFT: Params = { ...FIT, "box.width": 70, "box.maxLines": 2, textAlign: "left" };

interface Colours {
	text: string;
	accent: string;
	plate?: string;
	sub?: string;
	extra?: Params;
}

interface Recipe {
	key: string;
	name: [string, string];
	group: TextPresetGroup;
	design: string;
	themes: Theme[];
	fonts: Array<[string, string]>;
	size: number;
	y: number;
	duration: number;
	box?: Params;
	style?: Params;
	anim: Params;
	icon?: string;
	samples: Array<[string, string, string?, string?]>;
	count: number;
	colours: (r: Roles) => Colours;
}

const upper: Params = { textTransform: "uppercase" };

const PEOPLE: Recipe["samples"] = [
	["Anna Petrova", "Анна Петрова", "Product expert", "Эксперт по продукту"],
	["Dr. Igor Lebedev", "Доктор Игорь Лебедев", "Cardiologist", "Кардиолог"],
	["Sofia Kim", "София Ким", "Travel blogger", "Тревел-блогер"],
	["Pavel Orlov", "Павел Орлов", "Head coach", "Главный тренер"],
	["Maria Volkova", "Мария Волкова", "Chef", "Шеф-повар"],
	["Alex Grin", "Алекс Грин", "Game streamer", "Стример"],
	["Olga Smirnova", "Ольга Смирнова", "Founder", "Основательница"],
	["Denis Frolov", "Денис Фролов", "Host", "Ведущий"],
];
const TITLES: Recipe["samples"] = [
	["Episode two", "Вторая серия", "Behind the scenes", "За кадром"],
	["Big day", "Большой день", "Our story", "Наша история"],
	["Top 5 tips", "Топ-5 советов", "Save this", "Сохрани себе"],
	["Day in my life", "Мой день", "Vlog", "Влог"],
	["How it works", "Как это работает", "Step by step", "Шаг за шагом"],
	["The final", "Финал", "Season 3", "Сезон 3"],
];
const DEALS: Recipe["samples"] = [
	["−30%", "−30%", "this week", "всю неделю"],
	["−70%", "−70%", "final sale", "финальная распродажа"],
	["New collection", "Новая коллекция", "", ""],
	["Free delivery", "Бесплатная доставка", "", ""],
	["1 490 ₽", "1 490 ₽", "2 490 ₽", "2 490 ₽"],
];

const RECIPES: Recipe[] = [
	// Lower thirds
	{ key: "bar", name: ["Accent Bar", "Акцентная полоса"], group: "Lower thirds", design: "lt-bar", themes: ["business", "news", "education", "tech"], fonts: [["Montserrat", "800"], ["Jost", "700"], ["Geologica", "700"]], size: 3.6, y: 0.26, duration: 4, box: LEFT, anim: anim("wordsUp", 0.7, "maskSink", 0.4, 0.18), samples: PEOPLE, count: 6, colours: (r) => ({ plate: `${r.dark}e6`, accent: r.vivid, text: textOn(r.dark, r), sub: `${textOn(r.dark, r)}cc` }) },
	{ key: "pills", name: ["Two Pills", "Две капсулы"], group: "Lower thirds", design: "lt-pill", themes: ["fashion", "beauty", "tech", "music"], fonts: [["Golos Text", "800"], ["Manrope", "800"], ["Montserrat Alternates", "700"]], size: 3.5, y: 0.26, duration: 4, box: LEFT, anim: anim("maskRise", 0.7, "maskSink", 0.4, 0.12), samples: PEOPLE, count: 4, colours: (r) => ({ plate: r.light, accent: r.vivid, text: textOn(r.light, r), sub: textOn(r.vivid, r) }) },
	{ key: "line", name: ["Minimal Line", "Тонкая линия"], group: "Lower thirds", design: "lt-line", themes: ["fashion", "business", "wedding"], fonts: [["Jost", "500"], ["Inter", "600"], ["Cormorant Garamond", "600"]], size: 3.8, y: 0.26, duration: 4, box: LEFT, style: softShadow, anim: anim("letters", 0.7, "lettersOut", 0.35, 0.15), samples: PEOPLE, count: 4, colours: (r) => ({ accent: r.vivid, text: "#ffffff", sub: "#ffffffd9" }) },
	{ key: "glass", name: ["Glass Card", "Стеклянная карточка"], group: "Lower thirds", design: "lt-glass", themes: ["news", "travel", "music", "sports"], fonts: [["Onest", "700"], ["Geologica", "700"]], size: 3.4, y: 0.26, duration: 4, box: LEFT, icon: "mic", anim: anim("wordsUp", 0.7, "maskSink", 0.4, 0.2), samples: PEOPLE, count: 4, colours: (r) => ({ plate: `${r.dark}a6`, accent: r.vivid, text: "#ffffff", sub: "#ffffffcc" }) },
	{ key: "split", name: ["Split Block", "Два блока"], group: "Lower thirds", design: "lt-split", themes: ["sports", "fitness", "food", "gaming"], fonts: [["Montserrat", "800"], ["Yanone Kaffeesatz", "700"]], size: 3.4, y: 0.26, duration: 4, box: LEFT, style: upper, anim: anim("maskRise", 0.7, "maskSink", 0.4, 0.12), samples: PEOPLE, count: 4, colours: (r) => ({ accent: r.vivid, plate: `${r.dark}e6`, text: textOn(r.vivid, r), sub: textOn(r.dark, r) }) },

	// Titles
	{ key: "serif", name: ["Serif Title", "Титр с засечками"], group: "Titles", design: "title-sub", themes: ["wedding", "travel", "fashion"], fonts: [["Cormorant Garamond", "600"], ["Lora", "600"], ["Forum", "400"]], size: 6.4, y: -0.08, duration: 4, box: FIT, style: softShadow, anim: anim("maskRise", 0.9, "fade", 0.5, 0.1), samples: TITLES, count: 5, colours: (r) => ({ accent: r.vivid, text: onVideo(r), sub: `${onVideo(r)}cc` }) },
	{ key: "chapter", name: ["Chapter", "Глава"], group: "Titles", design: "chapter", themes: ["education", "kids", "travel"], fonts: [["Unbounded", "700"], ["Jost", "700"], ["Geologica", "800"]], size: 5.2, y: -0.08, duration: 4, box: FIT, style: softShadow, anim: anim("maskRise", 0.8, "maskSink", 0.4, 0.25), samples: TITLES, count: 4, colours: (r) => ({ accent: r.vivid, text: "#ffffff" }) },
	{ key: "box", name: ["Box Reveal", "Плашка-раскрытие"], group: "Titles", design: "box-reveal", themes: ["news", "sports", "food", "fitness"], fonts: [["Oswald", "700"], ["Yanone Kaffeesatz", "700"], ["Montserrat Alternates", "900"]], size: 7, y: -0.18, duration: 3, box: FIT, style: { ...upper, letterSpacing: 3 }, anim: anim("maskRise", 0.7, "wipeOut", 0.35, 0.25), samples: TITLES, count: 6, colours: (r) => ({ accent: r.vivid, text: textOn(r.vivid, r) }) },
	{ key: "underline", name: ["Underline", "Подчёркивание"], group: "Titles", design: "underline", themes: ["business", "education", "tech"], fonts: [["Geologica", "800"], ["Jost", "700"]], size: 6.2, y: -0.18, duration: 3, box: FIT, style: softShadow, anim: anim("letters", 0.6, "lettersOut", 0.35), samples: TITLES, count: 4, colours: (r) => ({ accent: r.vivid, text: "#ffffff" }) },

	// Social
	{ key: "sub", name: ["Subscribe", "Подписка"], group: "Social", design: "subscribe", themes: ["gaming", "music", "tech"], fonts: [["Montserrat", "800"], ["Jost", "800"]], size: 4, y: 0.18, duration: 3, box: FIT, style: upper, anim: anim("lettersPop", 0.5, "fade", 0.3, 0.08), samples: [["Subscribe", "Подписаться"], ["Join", "Вступай"]], count: 4, colours: (r) => ({ accent: r.vivid, text: textOn(r.vivid, r) }) },
	{ key: "like", name: ["Like", "Лайк"], group: "Social", design: "like", themes: ["beauty", "food", "kids"], fonts: [["Golos Text", "700"], ["Montserrat Alternates", "700"]], size: 3.6, y: 0.18, duration: 3, box: FIT, anim: anim("letters", 0.5, "fade", 0.3, 0.15), samples: [["Like if you agree", "Лайк, если согласен"], ["Double tap", "Два тапа"]], count: 4, colours: (r) => ({ plate: r.light, accent: r.vivid, text: textOn(r.light, r) }) },
	{ key: "link", name: ["Link in Bio", "Ссылка в описании"], group: "Social", design: "link-bio", themes: ["fashion", "business", "beauty"], fonts: [["Montserrat", "800"], ["Geologica", "700"]], size: 3.8, y: 0.12, duration: 3, box: FIT, anim: anim("lettersPop", 0.5, "fade", 0.3, 0.1), samples: [["Link in bio", "Ссылка в описании"], ["Shop now", "Купить сейчас"]], count: 3, colours: (r) => ({ plate: r.dark, accent: r.vivid, text: textOn(r.dark, r) }) },
	{ key: "counter", name: ["Counter", "Счётчик"], group: "Social", design: "counter", themes: ["business", "sports", "gaming"], fonts: [["Unbounded", "800"], ["Geologica", "800"]], size: 7, y: -0.12, duration: 3.5, box: FIT, style: softShadow, anim: anim("letters", 0.6, "fade", 0.3), samples: [["100 000", "100 000", "subscribers", "подписчиков"], ["1 000 000", "1 000 000", "views", "просмотров"]], count: 4, colours: (r) => ({ accent: r.vivid, text: "#ffffff", sub: "#ffffffcc" }) },

	// Sale & ads
	{ key: "burst", name: ["Price Burst", "Ценовой взрыв"], group: "Sale & ads", design: "price-burst", themes: ["food", "fashion", "beauty"], fonts: [["Rubik", "900"], ["Montserrat Alternates", "900"]], size: 7.4, y: -0.12, duration: 3, box: FIT, anim: anim("lettersPop", 0.5, "fade", 0.25, 0.2), samples: DEALS.slice(0, 2), count: 4, colours: (r) => ({ accent: r.vivid, text: textOn(r.vivid, r), sub: textOn(r.vivid, r) }) },
	{ key: "tag", name: ["Price Tag", "Ценник"], group: "Sale & ads", design: "price-tag", themes: ["realEstate", "fashion", "tech"], fonts: [["Montserrat", "900"], ["Jost", "800"]], size: 5.6, y: -0.1, duration: 3, box: FIT, anim: anim("letters", 0.5, "fade", 0.25, 0.25), samples: [DEALS[4]], count: 4, colours: (r) => ({ accent: r.vivid, text: textOn(r.vivid, r), sub: `${textOn(r.vivid, r)}b3` }) },
	{ key: "ribbon", name: ["Ribbon", "Лента"], group: "Sale & ads", design: "sale-ribbon", themes: ["fashion", "beauty", "food"], fonts: [["Oswald", "700"], ["Yanone Kaffeesatz", "700"]], size: 5.4, y: -0.15, duration: 3, box: FIT, style: { ...upper, letterSpacing: 3 }, anim: anim("maskRise", 0.55, "wipeOut", 0.3, 0.2), samples: DEALS.slice(2, 4), count: 4, colours: (r) => ({ accent: r.vivid, plate: r.dark, text: textOn(r.vivid, r) }) },
	{ key: "button", name: ["Button", "Кнопка"], group: "Sale & ads", design: "cta-button", themes: ["business", "fashion", "tech"], fonts: [["Montserrat", "800"], ["Jost", "700"]], size: 4.4, y: 0.12, duration: 2.5, box: FIT, anim: anim("lettersPop", 0.5, "fade", 0.3, 0.1, "pulse"), samples: [["Tap the link", "Жми на ссылку"], ["Order now", "Заказать"], ["Learn more", "Подробнее"]], count: 3, colours: (r) => ({ accent: r.vivid, plate: r.mid, text: textOn(r.vivid, r) }) },

	// Cinematic
	{ key: "flank", name: ["Flank Lines", "Линии по бокам"], group: "Cinematic", design: "flank", themes: ["travel", "wedding", "music"], fonts: [["Cormorant Garamond", "500"], ["Forum", "400"], ["Oranienbaum", "400"]], size: 4.2, y: 0, duration: 4, box: FIT, style: { ...upper, letterSpacing: 16, ...softShadow }, anim: anim("tracking", 1.6, "fade", 0.6), samples: TITLES, count: 4, colours: (r) => ({ accent: r.vivid, text: onVideo(r) }) },
	{ key: "brackets", name: ["Brackets", "Уголки"], group: "Cinematic", design: "brackets", themes: ["music", "sports", "news"], fonts: [["Poiret One", "400"], ["Yanone Kaffeesatz", "400"]], size: 4.6, y: 0, duration: 4, box: FIT, style: { ...upper, letterSpacing: 12, ...softShadow }, anim: anim("wipe", 0.8, "fade", 0.5, 0.3), samples: TITLES, count: 3, colours: (r) => ({ accent: onVideo(r), text: "#ffffff" }) },
	{ key: "film", name: ["Film Title", "Титр фильма"], group: "Cinematic", design: "title-sub", themes: ["wedding", "travel"], fonts: [["Lora", "500"], ["Cormorant Garamond", "500"]], size: 6, y: -0.05, duration: 4.5, box: FIT, style: { fontStyle: "italic", ...softShadow }, anim: anim("maskRise", 0.9, "fade", 0.6, 0.1), samples: TITLES, count: 3, colours: (r) => ({ accent: r.vivid, text: onVideo(r), sub: `${onVideo(r)}cc` }) },

	// Neon, retro, handwritten, trending, minimal
	{ key: "neon", name: ["Neon Sign", "Неоновая вывеска"], group: "Neon", design: "neon-frame", themes: ["music", "food", "gaming"], fonts: [["Comfortaa", "700"], ["Poiret One", "400"], ["Montserrat Alternates", "700"]], size: 5, y: -0.15, duration: 3.5, box: FIT, style: upper, anim: anim("neon", 0.8, "fade", 0.3, 0.2, "glowPulse"), samples: [["Open 24/7", "Открыто 24/7"], ["Live music", "Живая музыка"], ["Night drive", "Ночная трасса"]], count: 4, colours: (r) => ({ accent: r.vivid, text: "#ffffff", extra: glow(r.vivid) }) },
	{ key: "neonline", name: ["Neon Underline", "Неоновое подчёркивание"], group: "Neon", design: "neon-line", themes: ["gaming", "travel", "music"], fonts: [["Exo 2", "800"], ["Jost", "700"]], size: 6, y: -0.18, duration: 3.5, box: FIT, style: { fontStyle: "italic" }, anim: anim("letters", 0.8, "lettersOut", 0.35, 0, "glowPulse"), samples: [["Game on", "Игра началась"], ["Night drive", "Ночная трасса"]], count: 3, colours: (r) => ({ accent: r.vivid, text: "#ffffff", extra: glow(r.vivid) }) },
	{ key: "sun", name: ["Sunset", "Закат"], group: "Retro", design: "retro-sun", themes: ["music", "travel"], fonts: [["Montserrat Alternates", "900"], ["Rubik Vinyl", "400"]], size: 6.4, y: -0.2, duration: 3.5, box: FIT, style: { ...upper, ...softShadow }, anim: anim("slideLeft", 0.5, "fade", 0.3, 0.25, "float"), samples: [["Retro wave", "Ретровейв"], ["Summer 86", "Лето 86"]], count: 3, colours: (r) => ({ accent: r.vivid, plate: r.light, text: "#ffffff" }) },
	{ key: "pixel", name: ["Pixel", "Пиксель"], group: "Retro", design: "pixel-shadow", themes: ["gaming", "kids"], fonts: [["Press Start 2P", "400"], ["JetBrains Mono", "800"]], size: 4, y: -0.18, duration: 3, box: FIT, style: { ...upper, lineHeight: 1.4 }, anim: anim("typewriter", 0.8, "fade", 0.2), samples: [["Level up", "Новый уровень"], ["Game over", "Игра окончена"], ["Player 1", "Игрок 1"]], count: 3, colours: (r) => ({ accent: r.vivid, text: "#ffffff" }) },
	{ key: "scribble", name: ["Note", "Заметка"], group: "Handwritten", design: "scribble", themes: ["travel", "kids", "food", "wedding"], fonts: [["Great Vibes", "400"], ["Pangolin", "400"], ["Caveat", "700"]], size: 6.4, y: -0.15, duration: 3.5, box: FIT, style: softShadow, anim: anim("wipe", 0.9, "fade", 0.3), samples: [["my favourite part", "мой любимый момент"], ["see you soon", "до встречи"], ["with love", "с любовью"]], count: 5, colours: (r) => ({ accent: r.vivid, text: "#ffffff" }) },
	{ key: "doodle", name: ["Doodle Marker", "Маркер-каракули"], group: "Handwritten", design: "marker", themes: ["kids", "education"], fonts: [["Rubik Doodle Shadow", "400"], ["Amatic SC", "700"]], size: 7, y: -0.2, duration: 3, box: FIT, anim: anim("wipe", 0.6, "fade", 0.3, 0.15), samples: [["Today's plan", "План на день"], ["Remember!", "Запомни!"]], count: 3, colours: (r) => ({ accent: r.light, text: textOn(r.light, r) }) },
	{ key: "spray", name: ["Spray Stack", "Граффити"], group: "Trending", design: "stack", themes: ["music", "sports", "fashion"], fonts: [["Rubik Spray Paint", "400"], ["Rubik Bubbles", "400"]], size: 6.4, y: -0.15, duration: 3, box: FIT, style: upper, anim: anim("lettersPop", 0.55, "scatterOut", 0.4), samples: [["No limits", "Без границ"], ["Street", "Улица"], ["Hype", "Хайп"]], count: 4, colours: (r) => ({ accent: r.vivid, text: luminance(r.vivid) > 0.25 ? r.vivid : "#ffffff" }) },
	{ key: "marker", name: ["Marker", "Маркер"], group: "Trending", design: "marker", themes: ["education", "business", "beauty"], fonts: [["Montserrat Alternates", "700"], ["Golos Text", "800"]], size: 5.2, y: -0.18, duration: 3, box: FIT, anim: anim("wipe", 0.6, "fade", 0.3, 0.15), samples: [["The secret is here", "Весь секрет здесь"], ["Read this twice", "Прочитай дважды"]], count: 3, colours: (r) => ({ accent: luminance(r.light) > 0.5 ? r.light : r.vivid, text: textOn(luminance(r.light) > 0.5 ? r.light : r.vivid, r) }) },
	{ key: "frame", name: ["Thin Frame", "Тонкая рамка"], group: "Minimal", design: "thin-frame", themes: ["realEstate", "fashion", "business"], fonts: [["Jost", "300"], ["Poiret One", "400"]], size: 4.8, y: -0.12, duration: 3.5, box: FIT, style: softShadow, anim: anim("letters", 0.8, "fade", 0.4, 0.2), samples: [["Less is more", "Меньше — лучше"], ["Calm", "Спокойствие"]], count: 3, colours: (r) => ({ accent: onVideo(r), text: "#ffffff" }) },
	{ key: "label", name: ["Label", "Метка"], group: "Minimal", design: "label-dot", themes: ["fashion", "tech", "realEstate"], fonts: [["Geologica", "600"], ["Jost", "500"]], size: 2.8, y: -0.2, duration: 3, box: FIT, style: { ...upper, letterSpacing: 10, ...softShadow }, anim: anim("wipe", 0.6, "wipeOut", 0.35, 0.1), samples: [["New collection", "Новая коллекция"], ["Now live", "Уже в эфире"]], count: 3, colours: (r) => ({ accent: r.vivid, text: "#ffffff" }) },
	{ key: "quote", name: ["Review", "Отзыв"], group: "Minimal", design: "quote-mark", themes: ["beauty", "business", "food"], fonts: [["Lora", "600"], ["Cormorant Garamond", "600"]], size: 4.6, y: -0.12, duration: 3.5, box: LEFT, style: { fontStyle: "italic", ...softShadow }, anim: anim("wordsUp", 0.7, "fade", 0.3, 0.2), samples: [["“Worked in a week”", "«Сработало за неделю»", "Maria K., customer", "Мария К., покупательница"], ["“Best purchase this year”", "«Лучшая покупка года»", "Ilya, client", "Илья, клиент"]], count: 3, colours: (r) => ({ accent: r.vivid, text: "#ffffff", sub: "#ffffffcc" }) },
];

const PALETTES = (palettesJson as { palettes: string[][] }).palettes;

function build(): TextPreset[] {
	const out: TextPreset[] = [];
	const recipes = new Set<string>();
	RECIPES.forEach((recipe, recipeIndex) => {
		const seen = new Set<string>();
		for (let i = 0; i < recipe.count; i++) {
			// spread the palettes over the recipes so neighbours don't share one; all-pastel ones (no dark to set
			// light letters on) are passed over
			let index = (recipeIndex * 7 + i * 11) % PALETTES.length;
			while (contrast(roles(PALETTES[index]).dark, roles(PALETTES[index]).light) < 3) index = (index + 1) % PALETTES.length;
			const r = roles(PALETTES[index]);
			const colours = recipe.colours(r);
			// an accent must show: against its plate, or against the video when it sits on it
			const plate = colours.plate?.slice(0, 7);
			if (plate && contrast(colours.accent, plate) < 1.6) colours.accent = textOn(plate, r);
			if (!plate && luminance(colours.accent) < 0.06) colours.accent = onVideo(r);
			const [font, weight] = recipe.fonts[i % recipe.fonts.length];
			const [content, contentRu, sub = "", subRu = ""] = recipe.samples[i % recipe.samples.length];
			const look = {
				y: recipe.y,
				duration: recipe.duration,
				params: {
					...recipe.box,
					fontFamily: font,
					fontWeight: weight,
					fontSize: recipe.size,
					color: colours.text,
					...recipe.style,
					...colours.extra,
					"design.id": recipe.design,
					"design.accent": colours.accent,
					"design.plate": colours.plate ?? "#111111",
					"design.subColor": colours.sub ?? "#ffffff",
					"design.sub": sub,
					"design.icon": recipe.icon ?? "",
					...recipe.anim,
				},
			};
			// a variant that only recolours an earlier one of this recipe is not offered (the inspector recolours any)
			const key = presetRecipe(look);
			if (recipes.has(key)) continue;
			recipes.add(key);
			let [moodEn, moodRu] = mood(r);
			if (seen.has(moodEn)) [moodEn, moodRu] = mood({ ...r, vivid: r.mid });
			if (seen.has(moodEn)) {
				moodEn = `${moodEn} ${i + 1}`;
				moodRu = `${moodRu} ${i + 1}`;
			}
			seen.add(moodEn);
			out.push({
				id: `pk-${recipe.key}-${i + 1}`,
				name: `${recipe.name[0]} · ${moodEn}`,
				group: recipe.group,
				theme: recipe.themes[i % recipe.themes.length],
				content,
				...look,
				ru: { name: `${recipe.name[1]} · ${moodRu}`, content: contentRu, ...(sub ? { sub: [sub, subRu] as [string, string] } : {}) },
			});
		}
	});
	return out;
}

export const PACK_PRESETS: TextPreset[] = build();
