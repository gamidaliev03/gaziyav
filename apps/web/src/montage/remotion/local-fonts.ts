// @remotion/google-fonts fetches every face from fonts.gstatic.com. The same files are part of the app
// (scripts/fetch-montage-fonts.mjs → public/montage-fonts, copied into the renderer's bundle): those requests go there, in
// the player and in the renderer, so Gaziyav doesn't call Google for its own AI layers. Import this before loading a font.
const GOOGLE = "https://fonts.gstatic.com/s/";

if (typeof globalThis.fetch === "function" && !(globalThis as { __gzLocalFonts?: boolean }).__gzLocalFonts) {
	(globalThis as { __gzLocalFonts?: boolean }).__gzLocalFonts = true;
	const real = globalThis.fetch.bind(globalThis);
	globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		return real(url.startsWith(GOOGLE) ? `/montage-fonts/${url.slice(GOOGLE.length).replaceAll("/", "_")}` : input, init);
	}) as typeof fetch;
}

export {};
