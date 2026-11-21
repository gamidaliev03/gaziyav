// The chat's voices (principle 5, 21.11): Claude gets the SAME voices the app's picker offers for the chosen speech model,
// by language — read from the one list the pickers use (fal/model-voices.ts), the ready voices, the trending looks, the
// services' voices and «My voices» — and a voice it names is checked against that list: an unknown name is an error with
// the nearest real ones, never a silent default (the owner's Vietnamese voice-over, 21.11: a MiniMax name typed from
// memory was taken silently and spoken by another voice). The language goes to the model (MiniMax language_boost, Qwen
// language, ElevenLabs language_code) and the answer says the model, voice and language really used.
import { familyOf, LANGS, type Lang, languagesOf, MINIMAX_DEFAULT, MINIMAX_VOICE_LIST, MM_PREFIX, voicesOf } from "@/fal/model-voices";
import { ELEVEN_FAL_VOICES, ELEVEN_PREFIX } from "@/fal/eleven-voices";
import { ELEVEN_DEFAULT, type FalModel, falModel } from "@/fal/models";
import { VOICES } from "@/generate/voices";
import { TREND_VOICES } from "@/trending/voices";
import { useStudioStore } from "@/studio/client/studio-store";

export interface VoiceChoice {
	/** What generate {kind:"voice", speaker} takes (the picker's card id). */
	id: string;
	name: string;
	/** ISO code of the voice's own language; "" = speaks every language of its model. */
	lang: string;
	/** The model family it runs on: the chosen one, or the one it switches to (MiniMax / ElevenLabs voices). */
	runsOn: "chosen" | "minimax" | "eleven" | "service" | "clone";
	note?: string;
}

/** A language by ISO code, English or Russian name, or MiniMax's boost name («vi», «Vietnamese», «вьетнамский»). */
export function langOf(word: unknown): Lang | undefined {
	const w = String(word ?? "").trim().toLowerCase();
	if (!w || w === "auto") return undefined;
	return LANGS.find((l) => l.code === w || l.en.toLowerCase() === w || l.ru.toLowerCase() === w || l.boost.toLowerCase() === w) ?? LANGS.find((l) => w.length > 3 && (l.en.toLowerCase().startsWith(w.slice(0, 5)) || l.ru.toLowerCase().startsWith(w.slice(0, 5))));
}

type ServiceVoice = { id: string; name: string; service: string; serviceName: string; gender: string; language: string; ready: boolean };
let services: { at: number; list: ServiceVoice[] } = { at: 0, list: [] };
async function serviceVoices(): Promise<ServiceVoice[]> {
	if (Date.now() - services.at < 60_000) return services.list;
	try {
		const r = await fetch("/api/services/voices", { headers: { "X-Studio": "1" } });
		const j = (await r.json()) as { voices?: ServiceVoice[] };
		services = { at: Date.now(), list: Array.isArray(j.voices) ? j.voices : [] };
	} catch {
		services = { at: Date.now(), list: [] };
	}
	return services.list;
}

/** Every voice the picker offers under this speech model (its own first), each with its language. */
export async function voiceChoices(model: FalModel): Promise<VoiceChoice[]> {
	const family = familyOf(model.id);
	const mine = (useStudioStore.getState().server as { voices?: Array<{ id: string; name: string }> } | null)?.voices ?? [];
	const own = voicesOf(model.id).map((v): VoiceChoice => ({ id: v.id, name: v.name, lang: family === "eleven" || family === "kie" ? "" : v.lang, runsOn: "chosen" }));
	const minimax = family === "minimax" ? [] : MINIMAX_VOICE_LIST.map((v): VoiceChoice => ({ id: v.id, name: v.name, lang: v.lang, runsOn: "minimax" }));
	const eleven = family === "eleven" || family === "kie" ? [] : ELEVEN_FAL_VOICES.map((v): VoiceChoice => ({ id: `${ELEVEN_PREFIX}${v.name}`, name: v.name, lang: "", runsOn: "eleven", note: v.accent }));
	const svc = (await serviceVoices()).map((v): VoiceChoice => ({ id: v.id, name: v.name, lang: langOf(v.language)?.code ?? "", runsOn: "service", note: `${v.serviceName}${v.ready ? "" : ", needs its key"}` }));
	return [
		...mine.map((v): VoiceChoice => ({ id: v.id, name: v.name, lang: "", runsOn: "clone", note: "my voice" })),
		...VOICES.map((v): VoiceChoice => ({ id: v.id, name: v.name, lang: "", runsOn: "chosen", note: v.tone })),
		...TREND_VOICES.map((v): VoiceChoice => ({ id: `trend:${v.id}`, name: v.name, lang: "", runsOn: "chosen", note: `${v.use} (${v.speaker})` })),
		...own,
		...minimax,
		...eleven,
		...svc,
	];
}

/** The model a voice really speaks on (a MiniMax or ElevenLabs voice switches to its model, as the picker does). */
export function modelFor(choice: VoiceChoice, chosen: FalModel): FalModel {
	if (choice.runsOn === "minimax") return falModel(MINIMAX_DEFAULT) ?? chosen;
	if (choice.runsOn === "eleven") return falModel(ELEVEN_DEFAULT) ?? chosen;
	return chosen;
}

/** Whether the voice is of that language (or speaks every language of a model that takes it). */
export const speaks = (choice: VoiceChoice, lang: Lang, chosen: FalModel) =>
	choice.runsOn === "service" ? !choice.lang || choice.lang === lang.code : (choice.lang ? choice.lang === lang.code : true) && languagesOf(modelFor(choice, chosen).id).some((l) => l.code === lang.code);

const norm = (s: string) => s.toLowerCase().replace(/^(mm:|fal-el:|trend:)/, "").replace(/[\s_-]+/g, "");
/** Edit distance, for «the nearest real names». */
function distance(a: string, b: string): number {
	const d = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let prev = d[0];
		d[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const tmp = d[j];
			d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
			prev = tmp;
		}
	}
	return d[b.length];
}

/** The voice a name means: the card id, a model's own id without the prefix (Vietnamese_kindhearted_girl), or a name. */
export function findVoice(list: VoiceChoice[], said: string): VoiceChoice | undefined {
	const s = said.trim();
	const n = norm(s);
	return list.find((v) => v.id === s) ?? list.find((v) => v.id === `${MM_PREFIX}${s}` || v.id === `${ELEVEN_PREFIX}${s}`) ?? list.find((v) => norm(v.id) === n) ?? list.find((v) => norm(v.name) === n);
}

/** The nearest real voices to a name that isn't one (those of the language first). */
export function nearest(list: VoiceChoice[], said: string, lang?: Lang, chosen?: FalModel, n = 6): VoiceChoice[] {
	const s = norm(said);
	const pool = lang && chosen ? list.filter((v) => speaks(v, lang, chosen) && v.lang === lang.code) : [];
	const scored = list.map((v) => ({ v, d: Math.min(distance(s, norm(v.id)), distance(s, norm(v.name))) / Math.max(4, s.length) }));
	const near = scored.filter((x) => x.d < 0.5).sort((a, b) => a.d - b.d).map((x) => x.v);
	return [...new Set([...pool.slice(0, 4), ...near, ...(pool.length ? [] : list.slice(0, 4))])].slice(0, n);
}

export const line = (v: VoiceChoice) => `${v.id} (${[v.name !== v.id ? v.name : "", v.lang ? langOfCode(v.lang) : "", v.note ?? "", v.runsOn === "minimax" ? "MiniMax" : v.runsOn === "eleven" ? "ElevenLabs, any language" : ""].filter(Boolean).join(", ")})`;
const langOfCode = (code: string) => LANGS.find((l) => l.code === code)?.en ?? code;

/** find_content {kind:"voice", query}: the voices for the chosen model, by language (and gender / name words). */
export async function voiceListing(query: string, chosen: FalModel, saved: Array<{ name: string; speaker: string }>): Promise<string> {
	const list = await voiceChoices(chosen);
	const words = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
	const lang = words.map(langOf).find(Boolean);
	const rest = words.filter((w) => !langOf(w));
	const gender = rest.find((w) => /^(wom|fem|girl|lady|жен|дев)/.test(w)) ? /woman|girl|lady|female|wise|calm|sweet|lively|exuberant|inspir/i : rest.find((w) => /^(man|male|guy|boy|муж|пар)/.test(w)) ? /man|guy|boy|male|knight|deep|patient|determined|elegant/i : null;
	const other = rest.filter((w) => !/^(wom|fem|girl|lady|жен|дев|man|male|guy|boy|муж|пар|voice|голос)/.test(w));
	let hits = lang ? list.filter((v) => speaks(v, lang, chosen)) : list;
	// a language's own voices before the ones that speak every language
	if (lang) hits = [...hits.filter((v) => v.lang === lang.code), ...hits.filter((v) => v.lang !== lang.code)];
	if (gender) hits = hits.filter((v) => gender.test(`${v.id} ${v.name} ${v.note ?? ""}`));
	if (other.length) hits = hits.filter((v) => other.some((w) => `${v.id} ${v.name} ${v.note ?? ""}`.toLowerCase().includes(w)));
	const head = `Speech model in Settings: ${chosen.title} (${chosen.id}) — speaks ${languagesOf(chosen.id).map((l) => l.code).join(", ")}.`;
	const how = `generate {kind:"voice", text, speaker:"<id>", language:"<code>"} — the language goes to the model; a MiniMax (mm:) or ElevenLabs (fal-el:) voice switches the speech model to its own, as the picker does.`;
	if (!lang && !other.length && !gender) {
		const byLang = new Map<string, number>();
		for (const v of list) if (v.lang) byLang.set(v.lang, (byLang.get(v.lang) ?? 0) + 1);
		return `${head}\nReady voices (every language of the model): ${list.filter((v) => !v.lang && (v.runsOn === "chosen" || v.runsOn === "clone")).slice(0, 24).map(line).join(" · ")}\nVoices by language (ask find_content {kind:"voice", query:"<language>"}): ${[...byLang].map(([c, k]) => `${c} ${k}`).join(", ")}; ElevenLabs on fal: ${ELEVEN_FAL_VOICES.length} voices for any language.${saved.length ? `\nSaved: ${saved.map((v) => `${v.name}=${v.speaker}`).join(", ")}` : ""}\n${how}`;
	}
	if (!hits.length) return `${head}\nNo voice for «${query}»${lang && !languagesOf(chosen.id).some((l) => l.code === lang.code) ? ` (${chosen.title} doesn't speak ${lang.en})` : ""}. ${how}`;
	return `${head}\n${lang ? `${lang.en} (${lang.code}): ` : ""}${hits.slice(0, 40).map(line).join(" · ")}${hits.length > 40 ? ` · … ${hits.length - 40} more (add a word: woman, man, a name)` : ""}\n${how}`;
}
