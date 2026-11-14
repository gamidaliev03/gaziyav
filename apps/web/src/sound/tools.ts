// ⌘K entries of the sound department (listed by components/editor/tool-search/tools.ts). Each one acts at once.
import type { Tool } from "@/components/editor/tool-search/tools";
import { SOUND_BALANCE, SOUND_MIXER, SOUND_SYNC } from "./features";
import { useSoundUi } from "./ui-store";

/** The meter and the mixer live in the timeline (the one view there is). */
const onTimeline = (run: () => unknown) => () => {
	void run();
	return true;
};

const ALL_SOUND_TOOLS: Tool[] = [
	{
		id: "sound-loudness",
		title: "Loudness and target",
		where: "Timeline · level meter",
		words: ["lufs", "loudness", "loudness meter", "true peak", "integrated", "short-term", "target", "громкость", "измерить громкость", "измеритель громкости", "истинный пик", "цель громкости", "лафс"],
		primary: ["lufs", "loudness", "громкость lufs"],
		target: { kind: "run", run: onTimeline(() => useSoundUi.getState().setLoudnessOpen(true)) },
	},
	{
		id: "sound-bring-to-target",
		title: "Bring to target loudness",
		where: "Timeline · level meter",
		words: ["bring to target", "normalize", "normalise", "loudness", "lufs", "−14", "-14", "master", "довести громкость", "довести до цели", "нормализовать", "выровнять громкость", "целевая громкость", "мастер"],
		target: { kind: "run", run: onTimeline(() => import("./actions").then((m) => m.runBringToTarget())) },
	},
	{
		id: "sound-balance",
		title: "Balance the mix",
		where: "Timeline · mixer",
		words: ["balance", "auto mix", "automix", "mix", "duck", "ducking", "music under voice", "even the voice", "level the voice", "баланс", "свести", "сведение", "автосведение", "автомикс", "музыка под голосом", "приглушить музыку", "выровнять голос", "выровнять звук"],
		target: { kind: "run", run: onTimeline(() => { useSoundUi.getState().setMixerOpen(true); return import("./actions").then((m) => m.runBalance()); }) },
	},
	{
		id: "sound-sync",
		title: "Sync by waveform",
		where: "Timeline · clip menu",
		words: ["sync", "synchronize", "synchronise", "waveform", "multicam", "external sound", "separate sound", "recorder", "line up", "синхронизировать", "синхронизация", "синхронизация по звуку", "по волне", "по звуку", "совместить звук", "внешний звук", "рекордер", "мультикам"],
		target: { kind: "run", run: onTimeline(() => import("./actions").then((m) => m.runSync())) },
	},
	{
		id: "sound-mixer",
		title: "Mixer",
		where: "Timeline · bar",
		words: ["mixer", "faders", "fader", "track volume", "tracks volume", "pan", "solo", "mute track", "console", "микшер", "фейдер", "фейдеры", "громкость дорожек", "громкость дорожки", "панорама", "соло", "пульт", "микшерный пульт"],
		primary: ["mixer", "микшер"],
		target: { kind: "run", run: onTimeline(() => useSoundUi.getState().setMixerOpen(true)) },
	},
];

/** Only what is switched on (sound/features.ts). */
const SWITCHED: Record<string, boolean> = { "sound-balance": SOUND_BALANCE, "sound-sync": SOUND_SYNC, "sound-mixer": SOUND_MIXER };
export const SOUND_TOOLS: Tool[] = ALL_SOUND_TOOLS.filter((tool) => SWITCHED[tool.id] ?? true);
