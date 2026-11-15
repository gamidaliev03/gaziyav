// The browser edition's answers for the voice and «My voices», in the shape the Mac app's server sends them
// (app/api/studio/[...path], app/api/voice-sample/[id]):
//   GET  /api/studio/settings              → { settings, voices, tools }   (voices: «My voices» of this browser)
//   POST /api/studio/voices/rename|delete  → the same state
//   POST /api/studio/jobs/generate-voice   → JobState (polled at jobs/<id>; result { fileId, name, duration })
//   POST /api/studio/jobs/voice-clone      → JobState (result { voice })
//   POST /api/studio/prewarm/voice         → { started: false }   (nothing to warm: the voice runs on fal)
//   GET  /api/voice-sample/local:<id>      → the sample one of «My voices» was cloned from
import { chosenModel, type FalTask } from "@/fal/models";
import type { PublicSettings } from "@/studio/server/settings";
import { failure, json, jsonBody, matches, pageLang, type Route } from "../answer";
import type { WebAiAdapter } from "../lipsync/adapter";
import type { Lang } from "../lipsync/sentences";
import type { WebVoice } from "./engine";
import { publicVoice, type VoiceStore } from "./store";

const ROUTES: Route[] = [
	["GET", /^\/api\/studio\/settings$/],
	["POST", /^\/api\/studio\/voices\/(rename|delete)$/],
	["POST", /^\/api\/studio\/jobs\/(generate-voice|voice-clone)$/],
	["POST", /^\/api\/studio\/prewarm\/voice$/],
	["GET", /^\/api\/voice-sample\/[^/]+$/],
];

/** The Mac's settings file as the page reads it (studio/server/settings.ts publicSettings), for a browser with one fal key. */
export function browserSettings(hasKey: boolean, choices: Partial<Record<FalTask, string>>): PublicSettings {
	return {
		speechSpeed: 1,
		deepseekModel: "deepseek-flash",
		agentProvider: hasKey ? "fal" : "",
		agentModels: {},
		agentBaseUrl: "",
		sampleLength: 30,
		denoise: true,
		libraryFolder: "",
		youtubeBrowser: "",
		backgroundLargeModels: false,
		falModels: choices as Record<string, string>,
		aiApi: "fal",
		kieModels: {},
		lipsyncPipeline: {},
		// Gaziyav AI thinks on fal (OpenRouter's models through the one key: web/agent)
		agent: hasKey,
		brain: hasKey ? { provider: "fal", name: "fal.ai", model: chosenModel("llm", choices).id } : null,
	};
}

export function createVoiceAdapter(voice: WebVoice, voices: VoiceStore, d: { hasKey: () => boolean; choices: () => Partial<Record<FalTask, string>>; lang?: () => Lang }): WebAiAdapter {
	const lang = d.lang ?? pageLang;
	const state = async () => ({ settings: browserSettings(d.hasKey(), d.choices()), voices: (await voices.list()).map(publicVoice), tools: { ffmpeg: false, ytdlp: false, browsers: [] as string[] } });
	return {
		handles: (path, method) => matches(ROUTES, path, method),
		async answer(path, init) {
			const parts = path.split("?")[0].split("/").slice(2);
			const route = parts.slice(1).join("/");
			try {
				if (parts[0] === "voice-sample") {
					const id = decodeURIComponent(parts[1] ?? "");
					const mine = /^local:[\w-]{1,64}$/.test(id) ? await voices.sample(id) : null;
					return mine ? new Response(mine.blob, { headers: { "Content-Type": mine.blob.type || "audio/wav" } }) : json({ error: "No sample for this voice" }, 404);
				}
				if (route === "settings") return json(await state());
				if (route === "prewarm/voice") return json({ started: false });
				const body = await jsonBody<Record<string, unknown>>(init);
				if (route === "voices/rename") return await voices.rename(String(body.id), String(body.name ?? "").trim() || "Voice"), json(await state());
				if (route === "voices/delete") return await voices.remove(String(body.id)), json(await state());
				if (route === "jobs/generate-voice") return json(await voice.startGenerateVoice(body));
				if (route === "jobs/voice-clone") return json(await voice.startVoiceClone(body));
				return json({ error: "Unknown request" }, 404);
			} catch (error) {
				return failure(error, lang());
			}
		},
	};
}
