// Facts from the web for Gaziyav AI (who, what, when — for titles, captions and explainers): Wikipedia's open search
// in the query's language, the top pages with their opening paragraphs. No key, nothing about the user is sent.
import { CancelledError, StudioError } from "./errors";
import { routed } from "./http";
import { webSearchByChoice } from "./providers/search";

export interface WebFact {
	title: string;
	summary: string;
	url: string;
	/** Where it came from: the service picked in Settings → Services, or Wikipedia. */
	source?: string;
	/** On the first fact only: one line when the picked service failed and Wikipedia answered instead. */
	note?: string;
}

/** Seconds per request: a slow or hanging site never holds up Gaziyav AI's whole turn. */
const TIMEOUT = 12;

async function getJson(url: string, signal?: AbortSignal) {
	const limit = AbortSignal.timeout(TIMEOUT * 1000);
	const r = await fetch(routed(url), { signal: signal ? AbortSignal.any([signal, limit]) : limit, headers: { "User-Agent": "Gaziyav/1.0 (video editor)" } });
	if (!r.ok) throw new StudioError(`The web search didn't answer (HTTP ${r.status}).`);
	return r.json();
}

export async function webSearch(query: string, lang?: string, signal?: AbortSignal): Promise<WebFact[]> {
	const q = query.trim().slice(0, 200);
	if (!q) throw new StudioError("Give the words to search.");
	// Settings → Services → Web search: Brave, Tavily or Keenable when chosen (Wikipedia below stays the default).
	// A picked service that fails (no money, a refused key, down): Wikipedia answers instead, said once (principle 1).
	let note: string | undefined;
	try {
		const by = await webSearchByChoice(q, signal);
		if (by) return by;
	} catch (error) {
		if (signal?.aborted) throw error;
		note = `The web search service picked in Settings → Services didn't answer (${(error as Error)?.message || "error"}); Wikipedia answered instead.`;
	}
	const wiki = lang && /^[a-z]{2}$/.test(lang) ? lang : /[а-яё]/i.test(q) ? "ru" : "en";
	const base = `https://${wiki}.wikipedia.org`;
	let hits: { title: string }[] = [];
	try {
		const s = await getJson(`${base}/w/api.php?action=query&list=search&format=json&srlimit=4&srsearch=${encodeURIComponent(q)}`, signal);
		hits = s?.query?.search ?? [];
	} catch (error) {
		if (signal?.aborted) throw error;
		if ((error as Error)?.name === "TimeoutError") throw new StudioError(`The web search didn't answer within ${TIMEOUT} s. Try again in a minute.`);
		throw new StudioError("The web search is not reachable. Check the internet connection.");
	}
	// The top pages at once (one slow page doesn't wait for the others), in the search's order.
	const pages = await Promise.all(
		hits.slice(0, 3).map(async (h): Promise<WebFact | null> => {
			try {
				const p = await getJson(`${base}/api/rest_v1/page/summary/${encodeURIComponent(h.title.replace(/ /g, "_"))}`, signal);
				return p?.extract ? { title: p.title, summary: String(p.extract).slice(0, 900), url: p.content_urls?.desktop?.page ?? `${base}/wiki/${encodeURIComponent(h.title)}` } : null;
			} catch {
				return null;
			}
		}),
	);
	if (signal?.aborted) throw new CancelledError();
	const facts = pages.filter((p): p is WebFact => !!p).map((p) => ({ ...p, source: "Wikipedia" }));
	if (note && facts[0]) facts[0] = { ...facts[0], note };
	return facts;
}
