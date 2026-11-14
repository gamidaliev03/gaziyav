/**
 * Fonts shipped inside the app (OFL, all with Cyrillic). They work offline:
 * files are served from /fonts/bundled and registered with the FontFace API,
 * so the canvas renderer (preview and export) and the UI use the same files.
 * Licences: public/fonts/bundled/licenses/*-OFL.txt.
 */
import { REMOTE_FONTS } from "./remote-catalog";

export type BundledFontGroup =
	| "Sans"
	| "Display"
	| "Handwriting"
	| "Retro & pixel"
	| "Serif";

export interface BundledFont {
	family: string;
	group: BundledFontGroup;
	/** One entry per file: variable fonts carry a weight range ("100 900"). */
	faces: Array<{ file: string; weight: string }>;
}

const v = (file: string, weight: string) => ({ file, weight });

export const BUNDLED_FONTS: BundledFont[] = [
	{ family: "Montserrat", group: "Sans", faces: [v("Montserrat.ttf", "100 900")] },
	{ family: "Golos Text", group: "Sans", faces: [v("GolosText.ttf", "400 900")] },
	{ family: "Manrope", group: "Sans", faces: [v("Manrope.ttf", "200 800")] },
	{ family: "Rubik", group: "Sans", faces: [v("Rubik.ttf", "300 900")] },
	{ family: "Inter", group: "Sans", faces: [v("Inter.ttf", "100 900")] },
	{ family: "Onest", group: "Sans", faces: [v("Onest.ttf", "100 900")] },
	{ family: "Sofia Sans", group: "Sans", faces: [v("SofiaSans.ttf", "1 1000")] },
	{ family: "Nunito", group: "Sans", faces: [v("Nunito.ttf", "200 1000")] },
	{ family: "Raleway", group: "Sans", faces: [v("Raleway.ttf", "100 900")] },
	{ family: "Exo 2", group: "Sans", faces: [v("Exo2.ttf", "100 900")] },
	{ family: "Jura", group: "Sans", faces: [v("Jura.ttf", "300 700")] },
	{ family: "Comfortaa", group: "Sans", faces: [v("Comfortaa.ttf", "300 700")] },
	{
		family: "PT Sans",
		group: "Sans",
		faces: [v("PT-Sans-Web-Regular.ttf", "400"), v("PT-Sans-Web-Bold.ttf", "700")],
	},
	{ family: "Unbounded", group: "Display", faces: [v("Unbounded.ttf", "200 900")] },
	{ family: "Dela Gothic One", group: "Display", faces: [v("DelaGothicOne-Regular.ttf", "400")] },
	{ family: "Oswald", group: "Display", faces: [v("Oswald.ttf", "200 700")] },
	{ family: "Russo One", group: "Display", faces: [v("RussoOne-Regular.ttf", "400")] },
	{ family: "Rubik Mono One", group: "Display", faces: [v("RubikMonoOne-Regular.ttf", "400")] },
	{ family: "Tektur", group: "Display", faces: [v("Tektur.ttf", "400 900")] },
	{ family: "Seymour One", group: "Display", faces: [v("SeymourOne-Regular.ttf", "400")] },
	{ family: "Stalinist One", group: "Display", faces: [v("StalinistOne-Regular.ttf", "400")] },
	{ family: "Rampart One", group: "Display", faces: [v("RampartOne-Regular.ttf", "400")] },
	{ family: "Train One", group: "Display", faces: [v("TrainOne-Regular.ttf", "400")] },
	{ family: "Caveat", group: "Handwriting", faces: [v("Caveat.ttf", "400 700")] },
	{ family: "Lobster", group: "Handwriting", faces: [v("Lobster-Regular.ttf", "400")] },
	{ family: "Pacifico", group: "Handwriting", faces: [v("Pacifico-Regular.ttf", "400")] },
	{ family: "Bad Script", group: "Handwriting", faces: [v("BadScript-Regular.ttf", "400")] },
	{ family: "Marck Script", group: "Handwriting", faces: [v("MarckScript-Regular.ttf", "400")] },
	{ family: "Neucha", group: "Handwriting", faces: [v("Neucha.ttf", "400")] },
	{
		family: "Amatic SC",
		group: "Handwriting",
		faces: [v("AmaticSC-Regular.ttf", "400"), v("AmaticSC-Bold.ttf", "700")],
	},
	{ family: "Press Start 2P", group: "Retro & pixel", faces: [v("PressStart2P-Regular.ttf", "400")] },
	{ family: "Rubik Glitch", group: "Retro & pixel", faces: [v("RubikGlitch-Regular.ttf", "400")] },
	{ family: "Rubik Beastly", group: "Retro & pixel", faces: [v("RubikBeastly-Regular.ttf", "400")] },
	{ family: "Rubik Microbe", group: "Retro & pixel", faces: [v("RubikMicrobe-Regular.ttf", "400")] },
	{ family: "Rubik Wet Paint", group: "Retro & pixel", faces: [v("RubikWetPaint-Regular.ttf", "400")] },
	{ family: "Playfair Display", group: "Serif", faces: [v("PlayfairDisplay.ttf", "400 900")] },
	{
		family: "PT Serif",
		group: "Serif",
		faces: [v("PT-Serif-Web-Regular.ttf", "400"), v("PT-Serif-Web-Bold.ttf", "700")],
	},
	{
		family: "Philosopher",
		group: "Serif",
		faces: [v("Philosopher-Regular.ttf", "400"), v("Philosopher-Bold.ttf", "700")],
	},
	{ family: "Yeseva One", group: "Serif", faces: [v("YesevaOne-Regular.ttf", "400")] },
	{ family: "Kelly Slab", group: "Serif", faces: [v("KellySlab-Regular.ttf", "400")] },
	{ family: "Ruslan Display", group: "Serif", faces: [v("RuslanDisplay-Regular.ttf", "400")] },
	// Designer title faces from Google Fonts (OFL, Cyrillic), for the text presets' font pairings.
	{ family: "Jost", group: "Sans", faces: [v("Jost.ttf", "100 900")] },
	{ family: "Geologica", group: "Sans", faces: [v("Geologica.ttf", "100 900")] },
	{ family: "Montserrat Alternates", group: "Display", faces: [v("MontserratAlternates-Bold.ttf", "700"), v("MontserratAlternates-Black.ttf", "900")] },
	{ family: "Yanone Kaffeesatz", group: "Display", faces: [v("YanoneKaffeesatz.ttf", "200 700")] },
	{ family: "Poiret One", group: "Display", faces: [v("PoiretOne-Regular.ttf", "400")] },
	{ family: "Rubik Bubbles", group: "Retro & pixel", faces: [v("RubikBubbles-Regular.ttf", "400")] },
	{ family: "Rubik Spray Paint", group: "Retro & pixel", faces: [v("RubikSprayPaint-Regular.ttf", "400")] },
	{ family: "Rubik Vinyl", group: "Retro & pixel", faces: [v("RubikVinyl-Regular.ttf", "400")] },
	{ family: "Rubik Doodle Shadow", group: "Retro & pixel", faces: [v("RubikDoodleShadow-Regular.ttf", "400")] },
	{ family: "JetBrains Mono", group: "Retro & pixel", faces: [v("JetBrainsMono.ttf", "100 800")] },
	{ family: "Cormorant Garamond", group: "Serif", faces: [v("CormorantGaramond.ttf", "300 700")] },
	{ family: "Lora", group: "Serif", faces: [v("Lora.ttf", "400 700")] },
	{ family: "Forum", group: "Serif", faces: [v("Forum-Regular.ttf", "400")] },
	{ family: "Oranienbaum", group: "Serif", faces: [v("Oranienbaum-Regular.ttf", "400")] },
	{ family: "Great Vibes", group: "Handwriting", faces: [v("GreatVibes-Regular.ttf", "400")] },
	{ family: "Pangolin", group: "Handwriting", faces: [v("Pangolin-Regular.ttf", "400")] },
];

export const BUNDLED_FONT_GROUPS: BundledFontGroup[] = [
	"Sans",
	"Display",
	"Handwriting",
	"Retro & pixel",
	"Serif",
];

const BUNDLED_FONT_PATH = "/fonts/bundled/";
const byFamily = new Map(BUNDLED_FONTS.map((font) => [font.family.toLowerCase(), font]));
const registered = new Map<string, FontFace[]>();
const loading = new Map<string, Promise<void>>();

export function isBundledFont(family: string): boolean {
	return byFamily.has(family.toLowerCase());
}

/** Not inside the app: its file comes on first use (src/fonts/remote-fonts.json, /api/fonts). */
export function isRemoteFont(family: string): boolean {
	const font = byFamily.get(family.toLowerCase());
	return Boolean(font && REMOTE_FONTS[font.family]);
}

// ── Fonts downloaded on first use ──────────────────────────────────────────────────────────────────────────────
// Until a family's file is here (or with no internet) its text is drawn with a stand-in: Golos Text's file shaped to
// that font's line box and average width (FontFace ascent/descent/line-gap overrides and size-adjust), so nothing
// jumps when the real face replaces it. Every place that draws text hears when a family becomes real (onFontReady).
const standIns = new Map<string, FontFace[]>();
const ready = new Set<string>();
const failed = new Set<string>();
const pendingRemote = new Set<string>();
const listeners = new Set<(family: string) => void>();
const statusListeners = new Set<() => void>();
const statusChanged = () => {
	for (const listener of statusListeners) listener();
};

export type FontStatus = "here" | "loading" | "offline" | "cloud";
/**
 * Where a family is (as iCloud Photos shows it): inside the app or downloaded (here), coming (loading: a short ring on
 * its tile), not fetched for lack of internet (offline: the cloud mark), or not asked for yet (cloud: nothing shown).
 */
export function fontStatus(family: string): FontStatus {
	const font = byFamily.get(family.toLowerCase());
	if (!font || !REMOTE_FONTS[font.family] || ready.has(font.family)) return "here";
	if (pendingRemote.has(font.family)) return "loading";
	return failed.has(font.family) ? "offline" : "cloud";
}
/** For useSyncExternalStore: re-read fontStatus when any family's status changes. */
export const subscribeFontStatus = (listener: () => void) => {
	statusListeners.add(listener);
	return () => statusListeners.delete(listener);
};
const pct = (share: number) => `${(share * 100).toFixed(2)}%`;

/** Calls `listener` each time a downloaded family replaces its stand-in. Returns the unsubscribe. */
export function onFontReady(listener: (family: string) => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** A downloaded family that could not be fetched (offline, the source is down): its text shows the stand-in. */
export const fontFailed = (family: string) => failed.has(family);

function standInFaces(font: BundledFont): FontFace[] {
	const existing = standIns.get(font.family);
	if (existing) return existing;
	const remote = REMOTE_FONTS[font.family];
	const m = remote.metrics;
	// size-adjust scales every metric of the face, the overrides too (CSS Fonts 5): they are divided back by it, so the
	// line box is the real font's whatever its width
	const s = m.sizeAdjust;
	const faces = remote.faces.map((face) => {
		const fontFace = new FontFace(font.family, `url("${BUNDLED_FONT_PATH}GolosText.ttf") format("truetype")`, {
			weight: face.weight,
			style: "normal",
			display: "block",
			ascentOverride: pct(m.ascent / s),
			descentOverride: pct(m.descent / s),
			lineGapOverride: pct(m.lineGap / s),
			sizeAdjust: pct(s),
		} as FontFaceDescriptors);
		document.fonts.add(fontFace);
		return fontFace;
	});
	standIns.set(font.family, faces);
	return faces;
}

function loadRemote(font: BundledFont): Promise<void> {
	const remote = REMOTE_FONTS[font.family];
	const stand = standInFaces(font);
	pendingRemote.add(font.family);
	statusChanged();
	const real = remote.faces.map(
		(face) => new FontFace(font.family, `url("/api/fonts/${encodeURIComponent(face.file)}") format("truetype")`, { weight: face.weight, style: "normal", display: "block" }),
	);
	return Promise.all([...stand.map((face) => face.load().catch(() => null)), ...real.map((face) => face.load())])
		.then(() => {
			for (const face of stand) document.fonts.delete(face);
			standIns.delete(font.family);
			for (const face of real) document.fonts.add(face);
			registered.set(font.family, real);
			ready.add(font.family);
			failed.delete(font.family);
			pendingRemote.delete(font.family);
			for (const listener of listeners) listener(font.family);
			statusChanged();
		})
		.catch(() => {
			// no internet (or the source is down): the stand-in stays, the tile shows the cloud mark, the next use
			// tries again — no banner
			failed.add(font.family);
			pendingRemote.delete(font.family);
			loading.delete(font.family);
			statusChanged();
		});
}

/**
 * Adds the FontFace objects to document.fonts without downloading anything;
 * the file is read only when a face is used or `loadBundledFont` is awaited.
 */
function registerFamily(font: BundledFont): FontFace[] {
	const existing = registered.get(font.family);
	if (existing) return existing;
	if (typeof document === "undefined" || typeof FontFace === "undefined") return [];
	if (REMOTE_FONTS[font.family]) return standInFaces(font);
	const faces = font.faces.map((face) => {
		const fontFace = new FontFace(
			font.family,
			`url("${BUNDLED_FONT_PATH}${encodeURIComponent(face.file)}") format("truetype")`,
			{ weight: face.weight, style: "normal", display: "block" },
		);
		document.fonts.add(fontFace);
		return fontFace;
	});
	registered.set(font.family, faces);
	return faces;
}

export function registerBundledFonts(): void {
	for (const font of BUNDLED_FONTS) if (!REMOTE_FONTS[font.family]) registerFamily(font);
}

/**
 * Loads every face of a family: a base one from the app, a downloaded one from the cache or the internet (its
 * stand-in meanwhile). Resolves (never rejects) when done or given up.
 */
export function loadBundledFont(family: string): Promise<void> {
	const font = byFamily.get(family.toLowerCase());
	if (!font || typeof document === "undefined" || typeof FontFace === "undefined") return Promise.resolve();
	const pending = loading.get(font.family);
	if (pending) return pending;
	const promise = REMOTE_FONTS[font.family]
		? loadRemote(font)
		: Promise.all(registerFamily(font).map((face) => face.load().catch(() => null))).then(() => undefined);
	loading.set(font.family, promise);
	return promise;
}

/**
 * Starts loading a family and waits a moment for it: a cached file is drawn at once, a download goes on in the
 * background while its stand-in shows (applying a preset never waits for the internet).
 */
export async function primeFont(family: string, waitMs = 250): Promise<void> {
	const font = byFamily.get(family.toLowerCase());
	if (!font) return;
	// Adding a text never waits on a font for long and never fails because of one: a file that is slow or missing
	// (a stand-in draws it, the frame redraws when the file is here) must not keep the clip off the timeline.
	const load = loadBundledFont(family).catch(() => undefined);
	const settled = Promise.race([load, new Promise<void>((done) => setTimeout(done, waitMs))]);
	if (!REMOTE_FONTS[font.family] || ready.has(font.family)) return settled;
	await settled;
	// the stand-in at least, so the first frame has the right line box
	await Promise.all((standIns.get(font.family) ?? []).map((face) => face.load().catch(() => null)));
}

/**
 * Export: every family the frames use, the real files — never a stand-in. Throws a readable error when one can't be
 * downloaded.
 */
export async function requireFonts(families: string[]): Promise<void> {
	const wanted = [...new Set(families)].filter((family) => isBundledFont(family));
	await Promise.all(wanted.map((family) => loadBundledFont(family)));
	const missing = wanted.filter((family) => isRemoteFont(family) && !ready.has(byFamily.get(family.toLowerCase())?.family ?? family));
	if (missing.length) {
		const { t } = await import("@/i18n");
		throw new Error(`${t("Couldn't download the font:")} ${missing.join(", ")}. ${t("Check the internet — export never draws text with a stand-in font.")}`);
	}
}

// Register on import so the first canvas draw can already find the faces.
registerBundledFonts();
