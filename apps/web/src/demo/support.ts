// What this browser can do, checked before the editor starts (Chrome, Edge and Safari — Mac and iPhone: WebCodecs, OPFS). What is
// missing is said in one calm sentence with what still works; only a browser that cannot keep the clips at all gets the
// sentence instead of the editor.
import { setLanguage } from "@/i18n";

export interface Support {
	/** The editor cannot run here (it could not keep the clips). */
	fatal: boolean;
	/** The one sentence, or "" when everything is here. */
	en: string;
	ru: string;
}

export interface Features {
	indexedDB: boolean;
	opfs: boolean;
	opfsWrite: boolean;
	wasm: boolean;
	videoEncoder: boolean;
	audioEncoder: boolean;
	/** Safari's engine without WebGPU (Safari up to 18; every browser of an iPhone below iOS 26): the player stays white there. */
	oldSafari?: boolean;
}

export function features(): Features {
	const w = globalThis as unknown as Record<string, unknown>;
	const handle = w.FileSystemFileHandle as { prototype?: Record<string, unknown> } | undefined;
	return {
		indexedDB: typeof w.indexedDB !== "undefined",
		opfs: typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function",
		// createWritable (Chrome, Edge, Safari 26+) or a worker's sync handle (Safari ≤ 18: services/storage/opfs-write.ts)
		opfsWrite: (!!handle?.prototype && "createWritable" in handle.prototype) || typeof w.Worker === "function",
		wasm: typeof w.WebAssembly === "object",
		videoEncoder: typeof w.VideoEncoder === "function",
		audioEncoder: typeof w.AudioEncoder === "function",
		// (measured 14.11 in WebKit 18.6: the engine starts on WebGL2 there and the player never draws a frame; with
		// WebGPU — Safari 26 / iOS 26 — it takes the same path as Chrome. `webkit` is Safari's own object: Chrome on a
		// computer has none, Chrome on an iPhone is Safari's engine and has it.)
		oldSafari: typeof w.webkit === "object" && typeof navigator !== "undefined" && !(navigator as { gpu?: unknown }).gpu,
	};
}

/** The verdict for a set of features (pure: tested in __tests__/support.test.ts). */
export function verdict(f: Features): Support {
	if (!f.indexedDB || !f.opfs || !f.opfsWrite || !f.wasm)
		return {
			fatal: true,
			en: "This browser can't keep video files for the editor yet. Open the demo in Chrome or Edge — or get the app.",
			ru: "Этот браузер пока не умеет хранить видео для редактора. Откройте демо в Chrome или Edge — или скачайте приложение.",
		};
	if (f.oldSafari)
		return {
			fatal: true,
			en: "The player needs Safari 26 / iOS 26 or newer here. Update, or open the editor in Chrome or Edge on a computer.",
			ru: "Плееру здесь нужен Safari 26 / iOS 26 или новее. Обновите — или откройте редактор в Chrome или Edge на компьютере.",
		};
	// (no audio encoder alone — Safari up to 18 — is not said: the export writes its sound uncompressed there,
	// export/encoder-config.ts)
	if (!f.videoEncoder)
		return {
			fatal: false,
			en: "Editing and playback work here; export needs Chrome or Edge (this browser has no video encoder for pages).",
			ru: "Монтаж и просмотр здесь работают; для экспорта нужен Chrome или Edge (в этом браузере нет видеокодера для страниц).",
		};
	return { fatal: false, en: "", ru: "" };
}

export const missingFeatures = (): Support => verdict(features());

/** The demo speaks Russian or English: the visitor's choice on the site, else the browser's languages. */
export function pickLanguage(stored: string | null, languages: readonly string[]): "ru" | "en" {
	if (stored === "ru" || stored === "en") return stored;
	for (const tag of languages) {
		const base = tag.toLowerCase().split("-")[0];
		if (base === "ru") return "ru";
		if (base === "en") return "en";
	}
	return "en";
}

const KEY = "gaziyav.language";

export function demoLanguage(): "ru" | "en" {
	let stored: string | null = null;
	try {
		stored = localStorage.getItem(KEY);
	} catch {}
	const lang = pickLanguage(stored, typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]));
	setLanguage(lang);
	return lang;
}
