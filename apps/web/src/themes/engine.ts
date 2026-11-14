// The theme engine: a look (./families.ts) + the user's accent, tint and glass sliders → the app's own CSS variables, with
// every text colour moved until it is readable (WCAG AA) on every surface it sits on — over the worst backdrop for glass.
// The result is one CSS text for both modes (`html.dark[…]` / `html:not(.dark)[…]`); ./themes.css holds the rules that read
// the variables (materials, type, icons, motion). Pure: runs on the server for the boot script's default and in the page.
import {
	contrast,
	ensureApca,
	ensureContrast,
	ensureContrastAt,
	ensureDeltaL,
	labL,
	luminance,
	sideOf,
	fromOklch,
	isHex,
	minContrast,
	over,
	parseHex,
	rgba,
	tintKeepL,
	toOklch,
	triplet,
} from "./color";
import { DEFAULT_FAMILY, type Family, familyById, type Material, ORIGINAL_FAMILY, type Palette } from "./families";
import { type Guard, skinGuards, skinVars } from "./skin";

export type Mode = "dark" | "light";

/** What the user chose; stored as JSON in localStorage «gz-theme» (with the CSS made from it). */
export interface ThemeState {
	v: 1;
	/** a family id, or "original" («Как было») */
	family: string;
	/** null: the look's own accent */
	accent: string | null;
	/** null: no tint */
	tint: string | null;
	/** 0–100: how strongly the tint colours the surfaces */
	tintAmount: number;
	/** 0–100: glass transparency (glass looks only) */
	clarity: number;
	/** 0–100: blur behind menus, popovers and sheets (glass looks only) */
	blur: number;
}

export const DEFAULT_STATE: ThemeState = { v: 1, family: DEFAULT_FAMILY, accent: null, tint: null, tintAmount: 50, clarity: 50, blur: 50 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : d);

/** A stored or half-made state made whole and safe (unknown family → the default). */
export function normalizeState(raw: unknown): ThemeState {
	const s = (raw && typeof raw === "object" ? raw : {}) as Partial<ThemeState>;
	const family = s.family === ORIGINAL_FAMILY || familyById(s.family) ? (s.family as string) : DEFAULT_FAMILY;
	return {
		v: 1,
		family,
		accent: isHex(s.accent) ? s.accent.toLowerCase() : null,
		tint: isHex(s.tint) ? s.tint.toLowerCase() : null,
		tintAmount: num(s.tintAmount, DEFAULT_STATE.tintAmount),
		clarity: num(s.clarity, DEFAULT_STATE.clarity),
		blur: num(s.blur, DEFAULT_STATE.blur),
	};
}

export const isGlass = (m: Material) => m === "glass" || m === "frost";

/** A text/background pair the engine promises (the contrast test reads these). */
export interface Check {
	what: string;
	fg: string;
	bg: string;
	min: number;
}

export interface Resolved {
	family: Family;
	mode: Mode;
	material: Material;
	vars: Record<string, string>;
	panel: Record<string, string>;
	float: Record<string, string>;
	checks: Check[];
	/** the surface levels as seen, for the rules S1–S4 (glass: every backdrop) */
	surfaces: { s0: string[]; s1: string[]; s2: string; s3: string[]; s4: string[]; s4Track: string; s4Card: string; line: string; lineFloat: string; lineIn: string; scrim: string; shadowFloat: string; shadowModal: string };
	/** opaque colours for the gallery's preview tile; a look of the pack adds its skin's own tokens (the honest swatch) */
	tile: { room: string; roomImage: string; panel: string; panelFill: string; stage: string; timeline: string; fg: string; fgMuted: string; accent: string; fill: string; fillFg: string; raised: string; border: string; skin?: TileSkin };
	/** a look of the pack: the «does not distract from editing» guards on its numbers (./skin.ts) */
	guards: Guard[];
}

/** What the gallery's tile draws of a skin: the same values the window gets. */
export interface TileSkin {
	rPanel: string;
	rControl: string;
	raise: string;
	panelShadow: string;
	head: string;
	headCase: string;
	clips: string[];
	label: string;
	sel: string;
	selEdge: string;
	playhead: string;
	playheadEdge: string;
	clipR: string;
}

const WHITE = "#ffffff";
const INK = "#0b0b0c";

/** The label colour for a filled control: white when the fill allows it (darkening a deep colour a little), else ink. */
function fillFor(accent: string): { fill: string; fg: string } {
	if (contrast(accent, WHITE) >= 4.5) return { fill: accent, fg: WHITE };
	const darker = ensureContrast(accent, [WHITE], 4.5, -1);
	if (toOklch(accent).l - toOklch(darker).l <= 0.12) return { fill: darker, fg: WHITE };
	return { fill: accent, fg: contrast(accent, INK) >= 4.5 ? INK : "#000000" };
}

/** A status colour readable as text on `bgs`, and its label colour when used as a fill. */
function status(hex: string, bgs: string[]): { text: string; fg: string } {
	const text = ensureContrast(hex, bgs, 4.5);
	const fg = contrast(text, WHITE) >= 4.5 ? WHITE : contrast(text, INK) >= 4.5 ? INK : contrast(text, WHITE) > contrast(text, INK) ? WHITE : "#000000";
	return { text, fg };
}

/** C1: the player's surround of every look of the pack — the default look's dark stage, with its own neutral text. */
export const SKIN_STAGE = "#0b0b0c";
const SKIN_STAGE_FG = "#f5f5f7";
const SKIN_STAGE_FG_MUTED = "#a1a1a6";
/** a muted fill on the stage (a disabled key in the source viewer): the muted text keeps 4.5 : 1 on it */
const SKIN_STAGE_MUTED = "#2c2c2e";

export function resolve(family: Family, mode: Mode, raw: ThemeState): Resolved | null {
	const P0 = family[mode];
	if (!P0) return null;
	const st = normalizeState(raw);
	const dark = mode === "dark";
	const material = family.material;
	const glassy = isGlass(material);

	// ---- tint: surfaces lean towards a colour, their lightness kept (contrast barely moves; it is checked again below)
	const tint = st.tint;
	const k = tint ? (st.tintAmount / 100) * 0.32 : 0;
	const T = (hex: string, w = 1) => (tint ? tintKeepL(hex, tint, k * w) : hex);
	const P: Palette = {
		...P0,
		room: T(P0.room),
		panel: T(P0.panel),
		timeline: T(P0.timeline, 0.8),
		raised: T(P0.raised),
		muted: T(P0.muted),
		well: T(P0.well),
		key: T(P0.key),
		keyTop: P0.keyTop ? T(P0.keyTop) : undefined,
		border: T(P0.border),
		float: T(P0.float),
		fg: T(P0.fg, 0.25),
		fgMuted: T(P0.fgMuted, 0.5),
		// the player's surround stays neutral: colour is judged there — a look of the pack takes the default look's dark
		// stage whatever its own mode (C1: the same in every look; looksfix 14.11)
		stage: family.skin ? SKIN_STAGE : P0.stage,
	};
	// S1: the timeline is a panel on the frame too — ≥ 4 L* from the room, by the smallest step (not in «Высокий
	// контраст»: there every panel is the room's black or white and the hairline carries the edge)
	if (material !== "contrast") P.timeline = ensureDeltaL(P.timeline, [P.room], 4.3, sideOf(P.timeline, P.room, dark ? 1 : -1));

	// ---- glass: how much of the room shows through the shelves and the floating things
	const c = st.clarity / 100;
	const panelAlpha = !glassy ? 1 : material === "glass" ? (dark ? 0.9 - 0.46 * c : 0.92 - 0.42 * c) : dark ? 0.96 - 0.3 * c : 0.97 - 0.3 * c;
	const floatAlpha = !glassy ? P.floatAlpha : material === "glass" ? (dark ? 0.95 - 0.3 * c : 0.94 - 0.26 * c) : 0.97 - 0.2 * c;
	const blurPx = glassy ? Math.round((material === "glass" ? 0.44 : 0.5) * st.blur + (material === "glass" ? 2 : 8)) : 0;

	// the room: its colour, plus two soft glows for the glass looks
	const glowA = dark ? [0.56, 0.46] : [0.62, 0.52];
	const glows = P.glow ? P.glow.map((g) => T(g, 0.6)) : [];
	const roomImage = glows.length
		? `radial-gradient(1100px 760px at 12% -8%, ${rgba(glows[0], glowA[0])}, transparent 62%), radial-gradient(1000px 720px at 100% 108%, ${rgba(glows[1], glowA[1])}, transparent 64%)`
		: "none";
	// what can be behind a shelf: the room, and the room under the strongest point of each glow
	const backdrops = [P.room, ...glows.map((g, i) => over(g, glowA[i], P.room))];
	const average = glows.length ? over(glows[0], glowA[0] * 0.3, over(glows[1], glowA[1] * 0.25, P.room)) : P.room;
	const panelMatte = glassy ? over(P.panel, panelAlpha, average) : P.panel;
	const panelSeen = glassy ? backdrops.map((b) => over(P.panel, panelAlpha, b)) : [P.panel];
	// floating things can be over anything: judge them over black and over white
	const floatSeen = floatAlpha >= 1 ? [P.float] : [over(P.float, floatAlpha, "#000000"), over(P.float, floatAlpha, "#ffffff")];
	const floatMatte = floatAlpha >= 1 ? P.float : over(P.float, floatAlpha, dark ? "#000000" : "#ffffff");
	const floatRaised = dark ? over("#ffffff", 0.08, floatMatte) : over("#000000", 0.05, floatMatte);

	// ---- text: every colour readable where it is drawn
	// the header and Home sit on the room itself: under its glows too
	const surfaces = [...panelSeen, ...backdrops, P.timeline, P.raised, P.well];
	const fg = ensureContrast(P.fg, [...surfaces, P.muted, P.key, P.keyTop ?? P.key, ...floatSeen], 7);
	// secondary text is often drawn a little dimmer still (the ruler's figures at 85 %): it keeps 4.5:1 even then
	// and APCA |Lc| ≥ 61 (T2's secondary floor 60, one point of margin for the hover and the glass's tint): 4.5 : 1 alone
	// left light-on-dark labels at Lc 48–51 in most looks (design linter, 14.11: 36 failures per context menu)
	const SECONDARY_LC = 61;
	// a look of the pack draws the player in its own neutral text (--gz-stage-fg*), so its text is not judged on the stage
	const onStage = family.skin ? [] : [P.stage];
	const fgMuted = ensureApca(ensureContrastAt(ensureContrast(P.fgMuted, [...surfaces, P.muted, ...onStage], 4.5), 0.85, [...surfaces, ...onStage], 4.5), [...panelSeen, P.raised, P.timeline], SECONDARY_LC);
	const fgMutedFloat = ensureApca(ensureContrast(P.fgMuted, [...floatSeen, floatRaised], 4.5), [...floatSeen, floatRaised], SECONDARY_LC);

	// ---- the one accent: as text and lines (primary), as a fill (the one filled button), as the focus ring
	const accentIn = st.accent ?? P.accent;
	const primary = ensureContrast(accentIn, [...surfaces, ...onStage], 4.5);
	const { fill, fg: fillFg } = fillFor(accentIn);
	// the focus ring is drawn whole (themes.css: `:focus-visible` outline at 100 %), a shape: 3:1 on everything it can sit on
	const ring = ensureContrast(primary, [...surfaces, ...floatSeen, P.muted, P.key], 3);

	const red = status(P.destructive, [...surfaces, ...floatSeen]);
	const green = status(P.constructive, [...surfaces, ...floatSeen]);
	const yellow = status(P.caution, [...surfaces, ...floatSeen]);

	const lamp = triplet(P.lamp);
	const keyTop = P.keyTop ?? P.key;
	const hairline = P.border;

	// ---- the material's shapes
	let edge = "transparent";
	let sheen = "none";
	let shadow = "none";
	let rPanel = "10px";
	let rDialog = "12px";
	let rMenu = "8px";
	let floatFilter = "blur(20px) saturate(1.5)";
	let veil = dark ? "rgb(0 0 0 / 0.38)" : "rgb(0 0 0 / 0.16)";
	let veilFilter = "blur(4px)";
	let cardShadow = dark ? "none" : "0 1px 2px rgb(0 0 0 / 0.06)";
	let accentGlow = "none";
	let keyShadow = dark ? "none" : "0 1px 2px rgb(0 0 0 / 0.12), 0 0 0 0.5px rgb(0 0 0 / 0.06)";
	if (material === "glass") {
		edge = dark ? "rgb(255 255 255 / 0.12)" : "rgb(255 255 255 / 0.7)";
		sheen = dark
			? "linear-gradient(135deg, rgb(255 255 255 / 0.09), rgb(255 255 255 / 0.015) 42%, rgb(255 255 255 / 0) 60%)"
			: "linear-gradient(135deg, rgb(255 255 255 / 0.55), rgb(255 255 255 / 0.12) 45%, rgb(255 255 255 / 0) 65%)";
		shadow = dark
			? "inset 0 1px 0 rgb(255 255 255 / 0.2), inset 0 -1px 0 rgb(255 255 255 / 0.04), 0 22px 44px -26px rgb(0 0 0 / 0.9)"
			: "inset 0 1px 0 rgb(255 255 255 / 0.95), inset 0 -1px 0 rgb(255 255 255 / 0.35), 0 14px 34px -18px rgb(30 40 90 / 0.28)";
		rPanel = "16px";
		rDialog = "18px";
		rMenu = "12px";
		floatFilter = blurPx ? `blur(${blurPx}px) saturate(1.8)` : "saturate(1.4)";
		veil = dark ? "rgb(4 6 12 / 0.32)" : "rgb(20 30 60 / 0.12)";
		veilFilter = blurPx ? `blur(${Math.min(12, Math.round(blurPx / 3))}px)` : "none";
		cardShadow = shadow;
		keyShadow = dark ? "inset 0 1px 0 rgb(255 255 255 / 0.22), 0 1px 3px rgb(0 0 0 / 0.4)" : "inset 0 1px 0 #ffffff, 0 1px 3px rgb(30 40 90 / 0.18)";
	} else if (material === "frost") {
		edge = dark ? "rgb(255 255 255 / 0.07)" : "rgb(255 255 255 / 0.6)";
		sheen = dark ? "linear-gradient(180deg, rgb(255 255 255 / 0.04), rgb(255 255 255 / 0) 140px)" : "linear-gradient(180deg, rgb(255 255 255 / 0.5), rgb(255 255 255 / 0) 160px)";
		shadow = dark ? "inset 0 1px 0 rgb(255 255 255 / 0.08), 0 16px 36px -24px rgb(0 0 0 / 0.85)" : "inset 0 1px 0 rgb(255 255 255 / 0.8), 0 10px 28px -18px rgb(40 50 70 / 0.22)";
		rPanel = "14px";
		rDialog = "16px";
		rMenu = "10px";
		floatFilter = blurPx ? `blur(${blurPx}px) saturate(1.15)` : "none";
		veil = dark ? "rgb(10 12 16 / 0.36)" : "rgb(230 233 238 / 0.36)";
		veilFilter = blurPx ? `blur(${Math.min(14, Math.round(blurPx / 2.5))}px)` : "none";
		cardShadow = shadow;
	} else if (material === "strict") {
		edge = hairline;
		rPanel = "6px";
		rDialog = "8px";
		rMenu = "6px";
		floatFilter = "none";
		veil = dark ? "rgb(0 0 0 / 0.55)" : "rgb(0 0 0 / 0.28)";
		veilFilter = "none";
		cardShadow = "none";
		keyShadow = `inset 0 0 0 1px ${hairline}`;
	} else if (material === "solid") {
		edge = dark ? `rgb(${lamp} / 0.06)` : "rgb(0 0 0 / 0.06)";
		sheen = dark ? `linear-gradient(180deg, rgb(${lamp} / 0.035), rgb(${lamp} / 0) 120px)` : "linear-gradient(180deg, rgb(255 255 255 / 0.5), rgb(255 255 255 / 0) 120px)";
		shadow = dark ? `inset 0 1px 0 rgb(${lamp} / 0.05), 0 16px 36px -22px rgb(0 0 0 / 0.95)` : "inset 0 1px 0 rgb(255 255 255 / 0.7), 0 8px 24px -16px rgb(60 40 10 / 0.25)";
		rPanel = "14px";
		rDialog = "16px";
		rMenu = "10px";
		floatFilter = "blur(22px) saturate(1.1)";
		cardShadow = shadow;
		accentGlow = `0 6px 16px -6px ${rgba(fill, 0.5)}`;
		keyShadow = dark ? `inset 0 1px 0 rgb(${lamp} / 0.1), 0 1px 2px rgb(0 0 0 / 0.5)` : "inset 0 1px 0 #ffffff, 0 1px 2px rgb(60 40 10 / 0.2)";
	} else if (material === "contrast") {
		edge = hairline;
		rPanel = "6px";
		rDialog = "8px";
		rMenu = "6px";
		floatFilter = "none";
		veil = dark ? "rgb(0 0 0 / 0.7)" : "rgb(255 255 255 / 0.7)";
		veilFilter = "none";
		cardShadow = "none";
		keyShadow = `inset 0 0 0 1px ${fg}`;
	}

	// ── Surfaces: five levels (docs/DESIGN.md §1, S1–S5). Every look keeps its own colours where the numbers already
	// hold; a level that misses one moves by the smallest lightness step, on the side it already lies (the owner 13.11:
	// «где путаница может возникнуть или разметки чёткой нет — поправить», not a repaint). Glass is judged over its
	// worst backdrop (each glow of the room for panels; black and white under floating things).
	const up: 1 | -1 = dark ? 1 : -1;
	const dialogAlpha = floatAlpha >= 1 ? 1 : Math.min(1, floatAlpha + (glassy ? 0.06 : 0.04));
	const s0 = P.room;
	const s1 = panelMatte;
	// L2: a tile or a card on a panel — ≥ 4 L* from the panel as seen
	// glass: the panel's sheen (a 135° light from its top-left corner) lies under the first tiles too — judged with it
	// (des2 D1: Media's first tile, next to the panel's edge since its places column went, read ΔL 2.9 in glass dark)
	const sheenStop = glassy ? /rgb\(([\d\s]+)\/\s*([\d.]+)\)/.exec(sheen) : null;
	const sheenHex = sheenStop ? `#${sheenStop[1].trim().split(/\s+/).map((x) => Number(x).toString(16).padStart(2, "0")).join("")}` : null;
	const panelLit = sheenHex && sheenStop ? panelSeen.map((c) => over(sheenHex, Number(sheenStop[2]), c)) : [];
	const s2 = ensureDeltaL(P.raised, [...panelSeen, ...panelLit], 4.3, sideOf(P.raised, s1, up));
	// the hairline between L1 and L2 (and a panel's own edge): ≥ 1.25 : 1 to both neighbours, beyond both
	const line = ensureContrast(hairline, [...panelSeen, s2, ...backdrops], 1.25, up);
	// L3: menus, popovers, tooltips; L4: sheets (Settings, Export) — as seen over black and over white
	const s3 = floatMatte;
	// (an opaque-enough sheet of a flat look is judged over its own mode's dark or light: it never lies over the other)
	const s3Seen = glassy ? floatSeen : [floatMatte];
	const s4 = dialogAlpha >= 1 ? P.float : over(P.float, dialogAlpha, dark ? "#000000" : "#ffffff");
	// glass: over black, over white, and over what really lies under a sheet — the room and a panel under the scrim
	const veilA = Number(/\/\s*([\d.]+)\)/.exec(veil)?.[1] ?? "0.4");
	const s4Seen =
		dialogAlpha >= 1 || !glassy
			? [s4]
			: ["#000000", "#ffffff", over("#000000", veilA, P.room), over("#000000", veilA, panelMatte)].map((b) => over(P.float, dialogAlpha, b));
	// the edge of a floating thing: against itself and everything it may lie over
	const lineFloat = ensureContrast(hairline, [...s3Seen, ...s4Seen, ...panelSeen, s2, ...backdrops], 1.35, up);
	// inside a sheet: the tab strip's track and the cards are objects on it (≥ 4 L*; aimed at 5: a sheet's 2–4 % of
	// translucency lets the film under it tint it), each with its hairline (aimed at 1.35 for the same reason)
	let s4Track = ensureDeltaL(P.well, s4Seen, 5, sideOf(P.well, s4, up));
	// the chosen tab's key stays a key on that track (≥ 4 L*): else the track sinks to the other side of the sheet
	if (Math.abs(labL(s4Track) - labL(P.key)) < 5) s4Track = ensureDeltaL(P.well, [...s4Seen, P.key], 5, sideOf(P.key, s4, up) === 1 ? -1 : 1);
	// (glass: aimed at 6 — a card lower on the sheet lies over a lighter part of the editor and read ΔL 3.8, des2 D1)
	const s4Card = ensureDeltaL(P.raised, s4Seen, glassy ? 6 : 5, sideOf(P.raised, s4, up));
	const lineIn = ensureContrast(hairline, [...s4Seen, s4Card, s4Track], 1.35, up);
	// the scrim under a sheet dims what is under it by ≥ 35 % (S4): the look's veil, only made deeper when it is not
	const veilAlpha = Number(/\/\s*([\d.]+)\)/.exec(veil)?.[1] ?? "0.4");
	const veilRgb = /rgb\(([\d\s]+)\//.exec(veil)?.[1]?.trim() ?? "0 0 0";
	const dimOf = (rgb: string, a: number) => {
		const [r, g, b] = rgb.split(/\s+/).map(Number);
		const hex = `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
		return Math.min(...["#ffffff", "#808080"].map((bg) => 1 - luminance(over(hex, a, bg)) / luminance(bg)));
	};
	let scrimRgb = veilRgb;
	let scrimAlpha = veilAlpha;
	if (dimOf(scrimRgb, 0.7) < 0.35) {
		scrimRgb = "0 0 0";
		scrimAlpha = 0.1;
	}
	while (dimOf(scrimRgb, scrimAlpha) < 0.35 && scrimAlpha < 0.9) scrimAlpha = Math.round((scrimAlpha + 0.01) * 100) / 100;
	// a look of the pack: the scrim is at least 35 % black by alpha too (each channel of the picture dims by ≥ 35 %:
	// the critic measured «95»'s 28 % on the pixels — S4 read per channel, looksfix)
	if (family.skin && scrimAlpha < 0.35) scrimAlpha = 0.35;
	const scrim = scrimAlpha === veilAlpha && scrimRgb === veilRgb ? veil : `rgb(${scrimRgb} / ${scrimAlpha})`;
	// the two shadows: floating (menus, popovers, tooltips) and modal (sheets); flat looks get a quiet one, never none
	const flat = material === "strict" || material === "contrast";
	const shadowFloat = flat ? "0 4px 12px -4px rgb(0 0 0 / 0.32)" : dark ? "0 12px 32px -10px rgb(0 0 0 / 0.6)" : "0 10px 28px -10px rgb(0 0 0 / 0.22)";
	const shadowModal = flat ? "0 12px 32px -12px rgb(0 0 0 / 0.45)" : dark ? "0 24px 64px -16px rgb(0 0 0 / 0.7)" : "0 22px 56px -18px rgb(0 0 0 / 0.3)";
	veil = scrim;
	// a panel that sits closer than 4 L* to the frame and has no edge of its own («Полночь») gets the hairline
	if (material === "solid" && Math.min(...backdrops.map((b, i) => Math.abs(labL(b) - labL(panelSeen[i] ?? panelSeen[0])))) < 4) edge = line;
	// «Строгая» draws its panels by the hairline: the one that holds 1.25 : 1 to the panel and the frame
	if (material === "strict") edge = line;
	// a glass rim (white at a few per cent) at least 1.25 : 1 to every panel it rims, the timeline included
	if (glassy && dark) {
		const m = /\/\s*([\d.]+)\)/.exec(edge);
		let a = m ? Number(m[1]) : 0.1;
		const rimmed = [...panelSeen, P.timeline];
		while (a < 0.4 && rimmed.some((x) => contrast(over("#ffffff", a, x), x) < 1.27)) a = Math.round((a + 0.01) * 100) / 100;
		edge = `rgb(255 255 255 / ${a})`;
	}

	const panelFill = glassy ? rgba(P.panel, panelAlpha) : P.panel;
	const floatFill = floatAlpha >= 1 ? P.float : rgba(P.float, floatAlpha);
	const dialogFill = floatAlpha >= 1 ? P.float : rgba(P.float, dialogAlpha);
	const sliderFill = ensureContrast(fgMuted, [P.well], 3);
	// the light looks' thumb edge: 45 % black, deeper only where a mid-grey panel («95») needs it for 3 : 1
	let thumbA = 0.45;
	while (!dark && thumbA < 0.8 && [...panelSeen, P.well].some((bg) => contrast(over("#000000", thumbA, bg), bg) < 3)) thumbA = Math.round((thumbA + 0.01) * 100) / 100;
	const scroll = over(fg, dark ? 0.2 : 0.22, P.panel);
	const scrollHover = over(fg, dark ? 0.36 : 0.4, P.panel);

	const vars: Record<string, string> = {
		"--background": P.room,
		"--foreground": fg,
		"--card": panelMatte,
		"--card-foreground": fg,
		"--popover": floatFill,
		"--popover-hover": floatRaised,
		"--popover-foreground": fg,
		"--primary": primary,
		"--primary-foreground": fillFg,
		"--secondary": P.raised,
		"--secondary-border": hairline,
		"--secondary-foreground": fg,
		"--muted": P.muted,
		"--muted-foreground": fgMuted,
		"--accent": P.raised,
		"--accent-foreground": fg,
		"--destructive": red.text,
		"--destructive-foreground": red.fg,
		"--constructive": green.text,
		"--constructive-foreground": green.fg,
		"--caution": yellow.text,
		"--caution-foreground": yellow.fg,
		"--border": hairline,
		"--input": P.well,
		"--ring": ring,
		"--sidebar-background": panelMatte,
		"--sidebar-foreground": fg,
		"--sidebar-primary": fg,
		"--sidebar-primary-foreground": panelMatte,
		"--sidebar-accent": P.raised,
		"--sidebar-accent-foreground": fg,
		"--sidebar-border": hairline,
		"--sidebar-ring": ring,
		"--sidebar": P.room,
		"--pc-card-shadow": cardShadow,
		"--pc-card-shadow-hover": cardShadow,
		"--pc-glass": floatFill,
		"--pc-glass-border": dark ? "rgb(255 255 255 / 0.08)" : "rgb(0 0 0 / 0.08)",
		"--gz-light": lamp,
		"--gz-well": P.well,
		"--gz-key-top": keyTop,
		"--gz-key": P.key,
		"--gz-key-fg": fg,
		"--gz-key-shadow": keyShadow,
		"--gz-ease": "cubic-bezier(0, 0, 0.2, 1)",
		"--gz-room": P.room,
		"--gz-room-image": roomImage,
		"--gz-stage": P.stage,
		"--gz-timeline": P.timeline,
		"--gz-panel-fill": panelFill,
		"--gz-panel-matte": panelMatte,
		"--gz-panel-edge": edge,
		"--gz-panel-sheen": sheen,
		"--gz-panel-shadow": shadow,
		"--gz-float": floatFill,
		"--gz-float-matte": floatMatte,
		"--gz-dialog": dialogFill,
		"--gz-float-filter": floatFilter,
		"--gz-veil": veil,
		"--gz-veil-filter": veilFilter,
		"--gz-accent-fill": fill,
		"--gz-accent-glow": accentGlow,
		"--gz-slider-fill": sliderFill,
		"--gz-thumb": dark ? "#f5f5f7" : "#ffffff",
		// the light looks' white thumb on a light track: its edge carries the 3:1 of a control
		"--gz-thumb-ring": dark ? "rgb(0 0 0 / 0.25)" : `rgb(0 0 0 / ${thumbA})`,
		"--gz-switch-off": P.muted,
		"--gz-scroll": scroll,
		"--gz-scroll-hover": scrollHover,
		"--gz-r-panel": rPanel,
		"--gz-r-dialog": rDialog,
		"--gz-r-menu": rMenu,
		"--gz-hairline": hairline,
		// the five surface levels (docs/DESIGN.md §1): components take a surface only from these
		"--gz-s0": s0,
		"--gz-s1": s1,
		"--gz-s2": s2,
		"--gz-s3": s3,
		"--gz-s4": s4,
		"--gz-s4-track": s4Track,
		"--gz-s4-card": s4Card,
		"--gz-scrim": scrim,
		"--gz-line": line,
		"--gz-line-float": lineFloat,
		"--gz-line-in": lineIn,
		"--gz-shadow-float": shadowFloat,
		"--gz-shadow-modal": shadowModal,
	};
	const panel: Record<string, string> = {
		"--background": panelMatte,
		"--foreground": fg,
		"--card": panelMatte,
		"--card-foreground": fg,
		"--secondary": P.raised,
		"--secondary-border": hairline,
		"--secondary-foreground": fg,
		"--muted": P.muted,
		"--muted-foreground": fgMuted,
		"--accent": P.raised,
		"--accent-foreground": fg,
		"--border": hairline,
		"--input": P.well,
		"--ring": ring,
	};
	const float: Record<string, string> = {
		"--background": floatMatte,
		"--accent": floatRaised,
		"--secondary": floatRaised,
		"--secondary-border": hairline,
		"--border": dark ? over("#ffffff", 0.1, floatMatte) : over("#000000", 0.1, floatMatte),
		"--input": dark ? over("#000000", 0.25, floatMatte) : over("#ffffff", 0.6, floatMatte),
		"--muted-foreground": fgMutedFloat,
	};

	// ── a look of the pack: its skin (./skin.ts) on top — every token of the contract, and the textures, bevels and
	// shadows in the variables the existing rules already draw (the room's image, the panel's sheen, the keys)
	const sk = family.skin;
	let tileSkin: TileSkin | undefined;
	let roomShown = roomImage;
	if (sk) {
		const sv = skinVars(sk);
		Object.assign(vars, sv);
		if (sk.texture.room !== "none") roomShown = sk.texture.room;
		vars["--gz-room-image"] = roomShown;
		vars["--gz-panel-sheen"] = sk.texture.panel;
		vars["--gz-key-shadow"] = sk.geometry.sink;
		vars["--gz-accent-glow"] = sk.geometry.raiseFill;
		vars["--pc-card-shadow"] = sk.geometry.raise;
		vars["--pc-card-shadow-hover"] = sk.geometry.raise;
		// the filled key's label, floored on its fill (the skin's --gz-fill-fg defaults to it), and the player's own
		// neutral text and accent (C1: the stage is the same in every look of the pack)
		vars["--gz-on-fill"] = fillFg;
		vars["--gz-stage-fg"] = SKIN_STAGE_FG;
		vars["--gz-stage-fg-muted"] = SKIN_STAGE_FG_MUTED;
		vars["--gz-stage-muted"] = SKIN_STAGE_MUTED;
		vars["--gz-stage-accent"] = ensureContrast(primary, [P.stage], 4.5);
		tileSkin = {
			rPanel: sv["--gz-r-panel"],
			rControl: sv["--gz-r-control"],
			raise: sk.geometry.raise,
			panelShadow: sk.geometry.panelShadow,
			head: sk.type.head,
			headCase: sk.type.headCase,
			clips: [sk.clip.video, sk.clip.audio, sk.clip.text],
			label: sk.clip.label,
			sel: sk.clip.sel,
			selEdge: sk.clip.selEdge,
			playhead: sk.clip.playhead,
			playheadEdge: sk.clip.playheadEdge,
			clipR: sv["--gz-clip-r"],
		};
	}
	const guards = sk ? skinGuards(sk, { room: P.room, panel: panelMatte, timeline: P.timeline, fg, fgMuted }) : [];

	const checks: Check[] = [];
	const pair = (what: string, f: string, bgs: string[], min: number) => {
		for (const bg of bgs) checks.push({ what, fg: f, bg, min });
	};
	pair("text on the room", fg, backdrops, 4.5);
	pair("secondary text on the room's glows", fgMuted, backdrops, 4.5);
	pair("text on a panel", fg, panelSeen, 4.5);
	pair("secondary text on a panel", fgMuted, panelSeen, 4.5);
	pair("secondary text on the room", fgMuted, [P.room], 4.5);
	pair("text on the timeline", fg, [P.timeline], 4.5);
	pair("secondary text on the timeline", fgMuted, [P.timeline], 4.5);
	for (const bg of [...surfaces, ...onStage]) checks.push({ what: "secondary text at 85 % (the ruler)", fg: over(fgMuted, 0.85, bg), bg, min: 4.5 });
	if (sk) {
		pair("text on the player (the pack's neutral stage)", SKIN_STAGE_FG, [P.stage], 7);
		pair("secondary text on the player (the pack's neutral stage)", SKIN_STAGE_FG_MUTED, [P.stage, SKIN_STAGE_MUTED], 4.5);
		pair("accent on the player (the pack's neutral stage)", ensureContrast(primary, [P.stage], 4.5), [P.stage], 4.5);
	} else pair("secondary text on the player", fgMuted, [P.stage], 4.5);
	pair("text on a raised fill", fg, [P.raised], 4.5);
	pair("secondary text on a raised fill", fgMuted, [P.raised], 4.5);
	pair("secondary text on muted", fgMuted, [P.muted], 4.5);
	pair("text in a field", fg, [P.well], 4.5);
	pair("placeholder in a field", fgMuted, [P.well], 4.5);
	pair("text on the chosen key", fg, [P.key, keyTop], 4.5);
	pair("text on a menu (worst backdrop)", fg, floatSeen, 4.5);
	pair("secondary text on a menu (worst backdrop)", fgMutedFloat, floatSeen, 4.5);
	pair("secondary text on a menu's hover", fgMutedFloat, [floatRaised], 4.5);
	pair("accent text and icons", primary, [...surfaces, ...onStage], 4.5);
	pair("label on the filled button", fillFg, [fill], 4.5);
	pair("red text", red.text, [...surfaces, ...floatSeen], 4.5);
	pair("label on red", red.fg, [red.text], 4.5);
	pair("green text", green.text, [...surfaces, ...floatSeen], 4.5);
	pair("label on green", green.fg, [green.text], 4.5);
	pair("yellow text", yellow.text, [...surfaces, ...floatSeen], 4.5);
	pair("label on yellow", yellow.fg, [yellow.text], 4.5);
	pair("focus ring (a shape)", ring, [...surfaces, ...floatSeen, P.muted, P.key], 3);
	pair("a slider's filled part on its track (a shape)", sliderFill, [P.well], 3);
	if (dark) pair("a slider's thumb on its track (a shape)", "#f5f5f7", [P.well, ...panelSeen], 3);
	else for (const bg of [...panelSeen, P.well]) checks.push({ what: "a slider thumb's edge (a shape)", fg: over("#000000", thumbA, bg), bg, min: 3 });
	pair("icons (text colour) on a panel", fg, panelSeen, 3);

	return {
		family,
		mode,
		material,
		vars,
		panel,
		float,
		checks,
		surfaces: { s0: backdrops, s1: panelSeen, s2, s3: s3Seen, s4: s4Seen, s4Track, s4Card, line, lineFloat, lineIn, scrim, shadowFloat: sk ? sk.geometry.floatShadow : shadowFloat, shadowModal: sk ? sk.geometry.modalShadow : shadowModal },
		tile: { room: P.room, roomImage: roomShown, panel: panelMatte, panelFill, stage: P.stage, timeline: P.timeline, fg, fgMuted, accent: primary, fill, fillFg, raised: P.raised, border: hairline, skin: tileSkin },
		guards,
	};
}

const block = (selector: string, vars: Record<string, string>) =>
	`${selector}{${Object.entries(vars)
		.map(([k, v]) => `${k}:${v}`)
		.join(";")}}`;

/** The CSS text for a state: the variables of each mode the look has. Empty for «Как было». */
export function themeCss(raw: ThemeState): string {
	const st = normalizeState(raw);
	const family = familyById(st.family);
	if (!family) return "";
	let css = "";
	for (const mode of ["dark", "light"] as const) {
		const r = resolve(family, mode, st);
		if (!r) continue;
		const s = mode === "dark" ? `html.dark[data-gz-theme="${family.id}"]` : `html:not(.dark)[data-gz-theme="${family.id}"]`;
		css += block(s, r.vars) + block(`${s} .panel`, r.panel) + block(`${s} .bg-popover`, r.float);
	}
	return css;
}

/** The modes a look has; the other mode shows «Как было» (the look stays chosen and comes back with its mode). */
export function familyModes(id: string): Mode[] {
	const f = familyById(id);
	if (!f) return [];
	return (["dark", "light"] as const).filter((m) => !!f[m]);
}

/** Everything the page needs to put a state on screen, also before React (the boot script reads this from storage). */
export interface ThemeRecord {
	state: ThemeState;
	css: string;
	modes: Mode[];
	material: Material | "";
	/** a look of the pack: <html data-gz-skin> turns on themes.css §14 (the skin layer) */
	skin?: boolean;
	/** the engine's version: a record made by another version is made again by the page */
	ev: number;
}

// 2: the surface levels (13.11 night, docs/DESIGN.md §1); 3: the looks pack's skins (14.11, WISHES 56)
export const ENGINE_VERSION = 3;

export function makeRecord(raw: ThemeState): ThemeRecord {
	const state = normalizeState(raw);
	const family = familyById(state.family);
	return { state, css: themeCss(state), modes: familyModes(state.family), material: family?.material ?? "", skin: !!family?.skin, ev: ENGINE_VERSION };
}

/** A colour from a hue for the tile previews (`oklch` in hex). */
export const hueToHex = (h: number, l = 0.7, c = 0.15) => fromOklch({ l, c, h });

export { contrast, minContrast, parseHex, isHex, clamp01 };
