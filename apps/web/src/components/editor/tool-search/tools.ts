// ⌘K «Find a tool»: every function of the editor by its name in Russian or English, and where it lives
// (docs/EDITOR-MAP.md). A clip tool opens its section in the selected clip's inspector; a library thing (an effect)
// is applied to the selection; a place opens its Media tab and section. The e2e map test reads this same list.
import type { Tab } from "@/components/editor/panels/assets/assets-panel-store";
import { effectsRegistry } from "@/effects";
import { ru } from "@/i18n/ru";
import { TRANSITIONS } from "@/transitions/definitions";
import { GENERATOR_PRESETS, generatorSpec } from "@/generators/catalog";
import { COLOUR_TOOLS } from "@/colour/tools";
import { SOUND_TOOLS } from "@/sound/tools";
import { THEME_TOOLS } from "@/themes/tools";
import { actionTools } from "./action-tools";

export type ToolTarget =
	/** A section of the selected clip's inspector (the first of `sections` the clip has). */
	| { kind: "section"; sections: string[]; neural?: { family: string; preset?: Record<string, string | number> } }
	/** A place of the left panel. */
	| { kind: "media"; tab: Tab; section?: string }
	/** An effect from the library: onto the selected clips, else an effect layer at the playhead. */
	| { kind: "effect"; effectType: string }
	/** A command of the editor (a toggle with a key), run as its key would. */
	| { kind: "action"; action: string }
	| { kind: "run"; run: () => boolean };

export interface Tool {
	id: string;
	/** English name (the key of its Russian one). */
	title: string;
	/** Where it lives, as the list shows it (English; translated where drawn). */
	where: string;
	/** Other words people type for it, both languages. */
	words: string[];
	primary?: string[];
	target: ToolTarget;
}

const section = (id: string, title: string, where: string, words: string[], sections: string[] = [id], neural?: { family: string; preset?: Record<string, string | number> }): Tool => ({
	id,
	title,
	where,
	words,
	target: { kind: "section", sections, ...(neural ? { neural } : {}) },
});
const place = (id: string, title: string, where: string, words: string[], tab: Tab, sectionKey?: string): Tool => ({ id, title, where, words, target: { kind: "media", tab, section: sectionKey } });

/** The clip's tools, in their one home each. */
const withPrimary = (tool: Tool, primary: string[]): Tool => ({ ...tool, primary });

export const CLIP_TOOLS: Tool[] = [
	section("transform@basic", "Transform", "Inspector", ["position", "scale", "size", "rotate", "crop", "keyframes", "трансформ", "положение", "позиция", "масштаб", "размер", "поворот", "ключевые кадры", "ключи"]),
	section("opacity@basic", "Blend", "Inspector", ["opacity", "blend mode", "прозрачность", "наложение", "режим смешивания", "непрозрачность"]),
	section("canvas", "Canvas: blurred background", "Inspector", ["blur", "background blur", "fill", "background colour", "размытие", "размытый фон", "размытие фона", "фон холста", "заливка фона"]),
	withPrimary(section("cutout.remove", "Remove background", "Inspector · Tools", ["remove bg", "background removal", "cut out", "cutout", "удалить фон", "убрать фон", "вырезать фон", "вырезание", "без фона"]), ["remove bg", "remove background", "удалить фон", "убрать фон"]),
	section("cutout.blur", "Blur background (AI)", "Inspector · Tools", ["blur", "portrait", "bokeh", "размытие", "размыть фон", "портрет", "боке"], ["cutout.remove"], { family: "background", preset: { mode: "blur" } }),
	withPrimary(section("cutout.chroma", "Chroma key", "Inspector · Tools", ["green screen", "chromakey", "key", "хромакей", "зелёный фон", "зеленый экран", "кеинг"]), ["chroma", "chroma key", "хромакей", "green screen"]),
	withPrimary(section("masks", "Mask", "Inspector · Tools", ["masks", "shape mask", "маска", "маски", "маскирование"]), ["mask", "маска"]),
	section("adjust.color", "Color", "Inspector", ["colour", "grading", "adjust", "brightness", "contrast", "saturation", "temperature", "lut", "look", "filter", "hsl", "curves", "цвет", "коррекция", "цветокоррекция", "яркость", "контраст", "насыщенность", "температура", "фильтр", "лут"]),
	section("adjust.autoColor", "AI color correction", "Inspector", ["ai color", "neural color", "ии цвет", "нейросеть цвет", "автоматическая цветокоррекция"]),
	section("adjust.colorMatch", "Color match", "Inspector", ["match", "подобрать цвет", "совпадение цвета"]),
	section("effects", "Applied effects", "Inspector", ["effects", "fx", "эффекты", "наложенные эффекты"]),
	section("clip.animation", "Animation", "Inspector · Tools", ["in", "out", "loop", "intro", "outro", "анимация", "появление", "исчезновение", "цикл"], ["clip.animation", "text.animation"]),
	withPrimary(section("motion.tracker", "Tracking", "Inspector · Tools", ["tracker", "track", "follow face", "трекинг", "трекер", "отслеживание", "слежение"], ["motion.tracker", "text.tracking"]), ["tracking", "трекинг", "tracker", "трекер"]),
	section("motion.follow", "Follow a tracker", "Inspector · Tools", ["follow", "attach", "следовать", "привязать"]),
	section("motion.make-vertical", "Make vertical", "Inspector · Tools", ["reframe", "9:16", "vertical", "вертикальное", "вертикально", "кадрирование"]),
	section("stabilize", "Stabilize", "Inspector · Tools", ["shake", "stabilization", "стабилизация", "стабилизировать", "тряска"]),
	withPrimary(section("video.deflicker", "Remove flickers", "Inspector · Tools", ["deflicker", "flicker", "strobe", "мерцание", "убрать мерцание", "мерцания", "мигание"]), ["deflicker", "flicker", "мерцание", "мерцания"]),
	section("fix.enhance", "Enhance picture", "Inspector · Tools", ["enhance", "sharpen", "quality", "улучшить", "качество", "резкость"]),
	section("fix.denoise", "Reduce noise", "Inspector · Tools", ["denoise", "noise", "grain", "шум", "шумоподавление", "убрать шум", "зерно"]),
	section("cleanup", "Remove objects", "Inspector · Tools", ["cleanup", "eraser", "watermark", "удалить объект", "убрать объект", "ластик", "водяной знак"]),
	section("speed", "Speed", "Inspector", ["slow motion", "fast", "ramp", "скорость", "замедление", "ускорение", "слоумо"]),
	section("audio.volume@audio", "Volume and fades", "Inspector · Audio", ["volume", "fade", "mute", "pan", "loudness", "громкость", "звук", "затухание", "фейд", "панорама"], ["audio.volume@audio", "audio.volume@basic"]),
	section("audio.eq", "Equalizer", "Inspector · Audio", ["eq", "equaliser", "bass", "treble", "эквалайзер", "эквалайзер звука", "басы", "высокие"], ["audio.effects@audio", "audio.effects@basic"]),
	section("audio.compressor", "Compressor", "Inspector · Audio", ["compression", "dynamics", "компрессор", "компрессия"], ["audio.effects@audio", "audio.effects@basic"]),
	section("audio.reverb", "Reverb", "Inspector · Audio", ["echo", "room", "hall", "реверб", "ревербация", "реверберация", "эхо", "зал"], ["audio.effects@audio", "audio.effects@basic"]),
	section("audio.gate", "Noise gate", "Inspector · Audio", ["gate", "гейт", "шумовой гейт"], ["audio.effects@audio", "audio.effects@basic"]),
	section("audio.deesser", "De-esser", "Inspector · Audio", ["sibilance", "деэссер", "шипящие"], ["audio.effects@audio", "audio.effects@basic"]),
	section("audio.normalize", "Normalize loudness", "Inspector · Audio", ["normalize", "loudness", "lufs", "нормализация", "громкость lufs", "выровнять громкость"], ["audio.effects@audio", "audio.effects@basic"]),
	section("audio.limiter", "Limiter", "Inspector · Audio", ["limit", "peaks", "лимитер", "пики"], ["audio.effects@audio", "audio.effects@basic"]),
	section("audio.denoise", "Reduce noise in the sound", "Inspector · Audio", ["audio noise", "hiss", "шум в звуке", "шипение", "шумоподавление звука"], ["audio.effects@audio", "audio.effects@basic"]),
	section("audio.enhanceVoice@audio", "Enhance voice", "Inspector · Audio", ["voice", "clean voice", "улучшить голос", "чистый голос", "шум в голосе"], ["audio.enhanceVoice@audio", "audio.enhanceVoice@basic"]),
	section("audio.separate@audio", "Separate voice and music", "Inspector · Audio", ["stems", "vocals", "разделить голос", "голос и музыка", "вокал"], ["audio.separate@audio", "audio.separate@basic"]),
	section("audio.parts@basic", "Split into parts", "Inspector · Audio", ["stems", "multitrack", "drums", "bass", "партии", "мультитрек", "барабаны", "разложить"], ["audio.parts@basic", "audio.parts@audio"]),
	section("audio.voiceChanger@audio", "Voice changer", "Inspector · Audio", ["voice effect", "изменить голос", "смена голоса"], ["audio.voiceChanger@audio", "audio.voiceChanger@basic"]),
	section("retouch.face", "Retouch face", "Inspector · Tools", ["beauty", "face", "skin", "ретушь", "лицо", "кожа", "бьюти"]),
	{ id: "studio.lipsync", title: "Lipsync", where: "Inspector", words: ["lip sync", "mouth", "липсинк", "синхронизация губ", "губы"], target: { kind: "action", action: "lipsync-open" } },
	section("faceswap", "Face swap", "Inspector · Tools", ["swap face", "замена лица", "поменять лицо"]),
	section("ai.upscale", "Upscale", "Inspector · Tools", ["resolution", "4k", "апскейл", "увеличить разрешение", "разрешение"]),
	section("text.tts", "Text-to-speech", "Inspector · Tools", ["tts", "read aloud", "озвучка", "озвучить", "синтез речи"]),
	section("text.bubble", "Bubble", "Inspector · Tools", ["plate", "пузырь", "плашка"]),
	section("text.wordart", "Word art", "Inspector · Tools", ["text effects", "glow", "gradient text", "эффекты текста", "свечение"]),
	section("text.font@text", "Font", "Inspector", ["typeface", "шрифт", "размер текста"]),
	section("graphic", "Shape fill and stroke", "Inspector", ["fill", "stroke", "corners", "заливка", "обводка", "углы"]),
	section("ai.fields", "Template fields", "Inspector", ["plate text", "поля шаблона", "текст плашки"]),
	section("shadow@basic", "Shadow", "Inspector", ["drop shadow", "shadow", "тень", "отбросить тень", "падающая тень", "тень слоя", "тень фигуры", "тень видео"], ["shadow@basic", "text.shadow@text"]),
	section("layer.transition", "Transition on an adjustment layer", "Inspector · Effect layer", ["adjustment layer transition", "transition on layer", "transition over everything below", "переход на корректирующем слое", "переход на слое", "корректирующий слой", "переход на слое эффекта"]),
];

/** The places of the left panel (what you add). */
export const PLACES: Tool[] = [
	place("media.import", "Import media", "Media", ["files", "import", "импорт", "мои файлы", "медиа"], "media", "media"),
	place("media.downloads", "Downloads", "Media", ["download", "загрузки", "скачанное"], "media", "downloads"),
	place("audio.music", "Music", "Audio", ["song", "track", "музыка", "песня", "трек"], "sounds", "music"),
	place("audio.sfx", "Sound effects", "Audio", ["sfx", "whoosh", "звуки", "звуковые эффекты", "вжух"], "sounds", "sfx"),
	place("audio.voice", "Voice (AI)", "Audio", ["voiceover", "tts", "голос", "закадровый голос", "озвучка"], "sounds", "tts"),
	place("text.add", "Add text", "Text", ["title", "текст", "заголовок", "надпись"], "text", "add"),
	place("text.captions", "Captions", "Text", ["subtitles", "auto captions", "субтитры", "титры", "автосубтитры"], "captions"),
	// Shapes and motion graphics are Text's categories now; Stickers and Templates are gone (the owner, 12.11)
	place("text.shapes", "Shapes", "Text", ["rectangle", "rounded", "ellipse", "circle", "line", "triangle", "star", "фигуры", "прямоугольник", "круг", "эллипс", "линия", "треугольник", "звезда"], "text", "shapes"),
	place("text.motion", "Motion graphics", "Text", ["motion", "lower third", "counter", "intro", "моушн", "моушн-графика", "анимированные титры", "плашка", "счётчик"], "text", "motion"),
	place("text.ai", "Create with Gaziyav AI: plate or template", "Text · Yours", ["ai template", "ai plate", "generate template", "создать с ии", "создать шаблон", "плашка ии", "ии шаблон", "my templates", "мои шаблоны"], "text", "yours"),
	place("effects.library", "Effects library", "Effects", ["effects", "fx", "эффекты", "библиотека эффектов"], "effects"),
	place("effects.transitions", "Transitions", "Effects", ["transition", "переходы", "переход"], "transitions"),
	place("effects.filters", "Filters and LUTs", "Effects", ["filter", "lut", "look", "adjustment layer", "фильтры", "фильтр", "лут", "корректирующий слой"], "filters"),
	place("ai.image", "AI image", "AI", ["generate image", "picture", "картинка", "изображение", "сгенерировать картинку", "ии картинка"], "avatar", "ai-image"),
	place("ai.video", "AI video", "AI", ["generate video", "ии видео", "сгенерировать видео"], "avatar", "ai-video"),
	place("ai.avatar", "Talking avatar (lipsync)", "AI", ["avatar", "photo avatar", "аватар", "говорящее фото", "липсинк"], "avatar", "photo"),
	place("ai.translator", "Video translator", "AI", ["translate", "dub", "перевод", "переводчик", "дубляж"], "avatar", "translator"),
	place("effects.generators", "Generators", "Effects", ["generator", "solid", "gradient", "background", "ramp", "генераторы", "генератор", "сплошной", "заливка", "градиент", "фон", "подложка"], "generators"),
];

// constant false in the owner's build, which carries none of these modules: src/family/edition.ts).

/** Commands that have no panel of their own and are not actions of definitions.ts (those come generated, below). */
const HAND_COMMANDS: Tool[] = [
	// the timeline «⋯» Auto color (assist/auto-color.ts, by the clip's own statistics) — not the AI section above
	{ id: "auto-color", title: "Auto color", where: "Timeline · ⋯", words: ["auto color", "balance", "автоцвет", "баланс цвета", "автобаланс"], target: { kind: "run", run: () => (void import("@/assist/auto-color").then((m) => m.autoColor()), true) } },
	// «Claude at work» (src/agentview)
	{ id: "agent-card", title: "Claude: what was done", where: "Header · Claude", words: ["claude", "agent", "steps", "what was done", "history", "клод", "агент", "шаги", "что сделано", "что сделал"], target: { kind: "action", action: "agent-card" } },
	{ id: "agent-stop", title: "Claude: stop", where: "Header · Claude", words: ["claude", "stop claude", "cancel", "клод", "стоп", "остановить", "прервать"], target: { kind: "action", action: "agent-stop" } },
	{ id: "agent-pause", title: "Claude: pause", where: "Header · Claude", words: ["claude", "pause claude", "wait", "клод", "пауза", "подождать", "приостановить"], target: { kind: "action", action: "agent-pause" } },
	{ id: "agent-resume", title: "Claude: continue", where: "Header · Claude", words: ["claude", "resume", "continue", "клод", "продолжить", "возобновить"], target: { kind: "action", action: "agent-resume" } },
	// Colour (src/colour): the scopes strip under the player.
	...COLOUR_TOOLS,
	...THEME_TOOLS,
	// Sound (src/sound): the loudness meter, the mixer, the mix by the machine, sync by waveform.
	...SOUND_TOOLS,
];

/** Found here by name, run like their key: the hand-made ones, then every action of definitions.ts (./action-tools.ts). */
export const COMMANDS: Tool[] = [
	...HAND_COMMANDS,
	...actionTools(new Set(HAND_COMMANDS.flatMap((tool) => (tool.target.kind === "action" ? [tool.target.action] : [])))),
];

let library: Tool[] | null = null;

/** Effects and transitions of the libraries (built once, on the first search). */
export function libraryTools(): Tool[] {
	if (library) return library;
	const effects: Tool[] = effectsRegistry
		.getAll()
		.filter((effect) => !effect.hidden)
		.map((effect) => ({
			id: `effect:${effect.type}`,
			title: effect.name,
			where: "Effects library",
			words: [ru(effect.name), ...(effect.keywords ?? []), effect.category ?? ""].filter(Boolean),
			target: { kind: "effect", effectType: effect.type } as const,
		}));
	const transitions: Tool[] = TRANSITIONS.map((transition) => ({
		id: `transition:${transition.type}`,
		title: transition.name,
		where: "Effects · Transitions",
		words: [ru(transition.name), "transition", "переход"],
		target: { kind: "media", tab: "transitions" } as const,
	}));
	const generators: Tool[] = GENERATOR_PRESETS.map((preset) => ({
		id: `generator:${preset.id}`,
		title: preset.name,
		where: "Effects · Generators",
		words: [preset.proper ? preset.name : ru(preset.name), preset.family ?? "", "generator", "генератор", ...(generatorSpec(preset.generator)?.keywords ?? [])].filter(Boolean),
		target: { kind: "media", tab: "generators" } as const,
	}));
	library = [...effects, ...transitions, ...generators];
	return library;
}

/** Lower case, ё as е, no punctuation: «Хромакей», «хромакей» and «chroma-key» compare alike. */
export const normalize = (text: string) =>
	text
		.toLowerCase()
		.replace(/ё/g, "е")
		.replace(/[^\p{L}\p{N}:]+/gu, " ")
		.trim();

/** How well a tool answers the query (0 = not at all): its name first, then its words, then anywhere. */
export function scoreTool(tool: Tool, query: string, ruTitle = ru(tool.title)): number {
	const q = normalize(query);
	if (!q) return 0;
	if (tool.primary?.some((word) => normalize(word) === q)) return 110;
	const names = [normalize(tool.title), normalize(ruTitle)];
	const words = tool.words.map(normalize);
	if (names.some((n) => n === q)) return 100;
	if (names.some((n) => n.startsWith(q))) return 80;
	if (words.some((w) => w === q)) return 70;
	if (names.some((n) => n.split(" ").some((part) => part.startsWith(q)))) return 60;
	if (words.some((w) => w.startsWith(q) || w.split(" ").some((part) => part.startsWith(q)))) return 50;
	const parts = q.split(" ");
	const all = [...names, ...words].join(" ");
	if (parts.length > 1 && parts.every((part) => all.includes(part))) return 30;
	if (q.length >= 3 && all.includes(q)) return 20;
	return 0;
}

/** The tools that answer a query, best first (clip tools before the library, ties by name). */
export function findTools(query: string, limit = 12): Tool[] {
	const all = [...CLIP_TOOLS, ...PLACES, ...COMMANDS, ...libraryTools()];
	const kindRank = (tool: Tool) => (tool.target.kind === "section" ? 0 : tool.target.kind === "media" || tool.target.kind === "action" || tool.target.kind === "run" ? 1 : 2);
	return all
		.map((tool) => ({ tool, score: scoreTool(tool, query) }))
		.filter((hit) => hit.score > 0)
		.sort((a, b) => b.score - a.score || kindRank(a.tool) - kindRank(b.tool) || a.tool.title.localeCompare(b.tool.title))
		.slice(0, limit)
		.map((hit) => hit.tool);
}
