// Settings → Services → «Проверить»: one light call per service with its kept key (a model list, the account, a one-word
// search) and its answer as one human line, in Russian and English. Nothing is generated and nothing is charged, but
// Tavily's search, which counts one credit.
import { checkKey as checkFal } from "@/fal/server";
import { checkKieKey } from "@/kie/server";
import { checkArgoKey } from "@/argo/server";
import { routed } from "../http";
import { SERVICES } from "./registry";
import { serviceKey } from "./services";

export interface Line {
	ok: boolean;
	ru: string;
	en: string;
}

const yes = (ru = "Работает: ключ принят.", en = "Works: the key is accepted."): Line => ({ ok: true, ru, en });
const no = (ru: string, en: string): Line => ({ ok: false, ru, en });
const NO_KEY = no("Нужен ключ: вставьте его в строке сервиса.", "Needs a key: paste it in the service's row.");
const REFUSED = no("Ключ не принят: скопируйте его заново на сайте сервиса.", "The key isn't accepted: copy it again from the service's site.");
const OFFLINE = no("Сервис не отвечает: проверьте интернет.", "The service doesn't answer: check the internet connection.");
const BROKE = no("Ключ принят, но на счёте сервиса нет денег.", "The key works, but the account has no money left.");

/** What an answer means for the key. */
function said(status: number): Line {
	if (status >= 200 && status < 300) return yes();
	if (status === 401 || status === 403 || status === 400) return REFUSED;
	if (status === 402 || status === 432 || status === 433) return BROKE;
	if (status === 429) return yes("Ключ принят; сервис сейчас занят — попробуйте позже.", "The key is accepted; the service is busy right now.");
	return no("Сервис ответил ошибкой: попробуйте через минуту.", "The service answered with an error: try again in a minute.");
}

async function get(url: string, headers: Record<string, string> = {}, init: RequestInit = {}): Promise<Line> {
	try {
		const r = await fetch(routed(url), { ...init, headers: { "User-Agent": "Gaziyav/1.0 (video editor)", ...headers }, signal: AbortSignal.timeout(15_000) });
		return said(r.status);
	} catch {
		return OFFLINE;
	}
}

/** The check of one service. */
export async function checkService(id: string): Promise<Line> {
	if (!SERVICES.some((s) => s.id === id)) return no("Такого сервиса нет.", "There is no such service.");
	if (id === "fal" || id === "kie" || id === "argo") {
		const r = await (id === "fal" ? checkFal() : id === "kie" ? checkKieKey() : checkArgoKey()).catch(() => ({ ok: false as const, error: "" }));
		if (r.ok) return yes();
		return serviceKey(id) ? REFUSED : NO_KEY;
	}
	const key = serviceKey(id);
	if (id === "keenable") {
		const r = await get(`https://api.keenable.ai/v1/search?${new URLSearchParams({ query: "test" })}`, key ? { "x-api-key": key } : {});
		return r.ok ? (key ? yes() : yes("Работает без ключа.", "Works with no key.")) : r;
	}
	if (!key) return NO_KEY;
	switch (id) {
		case "elevenlabs":
			return get("https://api.elevenlabs.io/v1/user", { "xi-api-key": key });
		case "inworld":
			return get("https://api.inworld.ai/tts/v1/voices", { authorization: `Basic ${key}` });
		case "cartesia":
			return get("https://api.cartesia.ai/voices?limit=1", { "x-api-key": key, "cartesia-version": "2025-04-16" });
		case "openai":
			return get("https://api.openai.com/v1/models", { authorization: `Bearer ${key}` });
		case "google":
			return get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { "x-goog-api-key": key });
		case "openrouter":
			return get("https://openrouter.ai/api/v1/key", { authorization: `Bearer ${key}` });
		case "groq":
			return get("https://api.groq.com/openai/v1/models", { authorization: `Bearer ${key}` });
		case "azure": {
			const m = /^([a-z0-9-]+):(.+)$/i.exec(key);
			if (!m) return no("Вставьте ключ Azure как регион:ключ, например eastus:a1b2…", "Paste the Azure key as region:key, e.g. eastus:a1b2…");
			return get(`https://${m[1].toLowerCase()}.tts.speech.microsoft.com/cognitiveservices/voices/list`, { "ocp-apim-subscription-key": m[2] });
		}
		case "mimo":
			return get("https://api.xiaomimimo.com/v1/models", { "api-key": key });
		case "doubao":
			return yes("Ключ сохранён; он проверится при первой расшифровке.", "The key is kept; it is checked on the first transcription.");
		case "pexels":
			return get("https://api.pexels.com/v1/search?query=sun&per_page=1", { authorization: key });
		case "pixabay":
			return get(`https://pixabay.com/api/?${new URLSearchParams({ key, q: "sun", per_page: "3" })}`);
		case "brave":
			return get("https://api.search.brave.com/res/v1/web/search?q=test&count=1", { accept: "application/json", "x-subscription-token": key });
		case "tavily":
			return get("https://api.tavily.com/search", { authorization: `Bearer ${key}`, "content-type": "application/json" }, { method: "POST", body: JSON.stringify({ query: "test", max_results: 1 }) });
	}
	return NO_KEY;
}

/** The check of a free source (no key): one tiny search. */
export async function checkFree(option: string): Promise<Line> {
	const url =
		option === "free-media"
			? "https://api.openverse.org/v1/images/?q=sun&page_size=1"
			: option === "archive"
				? "https://archive.org/advancedsearch.php?q=sun&fl[]=identifier&rows=1&output=json"
				: option === "commons"
					? "https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=sun&srlimit=1"
					: "https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=sun&srlimit=1";
	const r = await get(url);
	return r.ok ? yes("Работает без ключа.", "Works with no key.") : r;
}
