// The looks pack (WISHES item 56, docs/DESIGN.md §8 / §8a): each look is a palette + a skin (./skin.ts) — a whole skin,
// not a recolour. Genre only: no publisher's, film's, game's or system's names, logos, characters, wallpapers or
// signature assets. Fonts: only faces on every Mac (system-ui, SF Mono, Menlo, Monaco) or bundled with the app.
// Russian names in src/i18n/ru-looks.ts. Order of making (the brief): «95», «Терминал», «Пиксель», «Неон».
import type { Family } from "./families";
import { COMMON_DECISIONS, type Decision, type LookKind } from "./skin";

const tok = (via: string): Decision => ({ by: "tokens", via });
const keep = (why: string): Decision => ({ inherit: "by design", why });
/** a look's own checklist: the shared base, re-stated per look (the unit test fails a look whose map IS the base) */
const decide = (own: Partial<Record<LookKind, Decision>>): Partial<Record<LookKind, Decision>> => ({ ...COMMON_DECISIONS, ...own });
const CH = (n: number) => `polygon(${n}px 0, 100% 0, 100% calc(100% - ${n}px), calc(100% - ${n}px) 100%, 0 100%, 0 ${n}px)`;

const SYS = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, Monaco, monospace`;

// ── «95»: the spirit of old desktop software — flat greys, hard bevels (light top-left, dark bottom-right), 1 px rules,
// navy bars on panels and sheets, square keys that press in, inset white fields, the system font, instant motion.
// No blur, no gradient, no texture: the cheapest look to draw (the one for weak Macs).
const B_HI = "#ffffff";
const B_LO = "#808080";
const B_DK = "#0a0a0a";
const B_MID = "#dfdfdf";
const NAVY = "#000080";
const raised95 = `inset -1px -1px 0 ${B_DK}, inset 1px 1px 0 ${B_HI}, inset -2px -2px 0 ${B_LO}, inset 2px 2px 0 ${B_MID}`;
const sunk95 = `inset 1px 1px 0 ${B_DK}, inset -1px -1px 0 ${B_HI}, inset 2px 2px 0 ${B_LO}, inset -2px -2px 0 ${B_MID}`;
const field95 = `inset 1px 1px 0 ${B_LO}, inset -1px -1px 0 ${B_HI}, inset 2px 2px 0 ${B_DK}, inset -2px -2px 0 ${B_MID}`;

export const LOOK_95: Family = {
	id: "retro95",
	name: "95 look",
	note: "Grey keys, hard bevels, instant — the lightest",
	material: "strict",
	light: {
		room: "#a8a8a8",
		panel: "#c0c0c0",
		stage: "#0b0b0c",
		timeline: "#c6c6c6",
		raised: "#d8d8d8",
		muted: "#b4b4b4",
		well: "#ffffff",
		key: "#c0c0c0",
		border: "#808080",
		float: "#c0c0c0",
		floatAlpha: 1,
		fg: "#000000",
		fgMuted: "#3a3a3a",
		destructive: "#a00000",
		constructive: "#006000",
		caution: "#705000",
		accent: NAVY,
		lamp: "#ffffff",
	},
	skin: {
		motionNote: "instant: no easing, things simply appear; a key goes in by its bevel",
		geometry: {
			panel: 0,
			dialog: 0,
			menu: 0,
			control: 0,
			tile: 0,
			raise: raised95,
			sink: sunk95,
			field: field95,
			raiseFill: `inset -1px -1px 0 ${B_DK}, inset 1px 1px 0 #5a5ad0`,
			// a raised panel with a navy bar along its top edge (the title bar's spirit, no text over it)
			panelShadow: `inset 0 3px 0 ${NAVY}, ${raised95}`,
			floatShadow: `${raised95}, 2px 2px 0 rgb(0 0 0 / 0.5)`,
			// the title band carries the navy now; the era's black outer edge round the sheet (S2 on the light frame)
			modalShadow: `${raised95}, 0 0 0 1px ${B_DK}, 3px 3px 0 rgb(0 0 0 / 0.55)`,
			// the era's focus: a 1 px dotted black frame INSIDE the key
			ring: { width: 1, offset: -4, style: "dotted", filter: "none" },
			knob: "0px",
		},
		type: { head: SYS, digits: SYS, label: SYS, headWeight: 700, headTracking: "0", headCase: "none", numeric: "tabular-nums", smoothing: "auto" },
		icon: { stroke: 2.25, cap: "square", join: "miter", rendering: "crispEdges", active: "none" },
		motion: { appear: 1, press: 1, land: 1, ease: "linear", appearEase: "linear", appearKind: "none", pressShift: "translate(1px, 1px)" },
		cursor: { action: "default", text: "text", caret: "#000000", caretShape: "auto", selectBg: "#000080", selectFg: "#ffffff" },
		clip: {
			radius: 0,
			// the clip's name bar is a title bar: grey when not chosen, navy when chosen (the active window's bar)
			video: "#5c5c5c",
			text: "#6a2c6a",
			audio: "#2c5a2c",
			graphic: "#7a1e1e",
			effect: "#3d4a7a",
			label: "#ffffff",
			sel: NAVY,
			selEdge: "#ffffff",
			selWidth: 2,
			selBar: NAVY,
			playhead: "#000000",
			playheadEdge: "#ffffff",
			wave: "#e8e8e8",
		},
		texture: { room: "none", panel: "none" },
		keys: { bg: "var(--gz-accent-fill)", fg: "var(--gz-on-fill)", bgHover: "var(--gz-accent-fill)", fgHover: "var(--gz-on-fill)", bgPress: "var(--gz-accent-fill)", fgPress: "var(--gz-on-fill)", shadowPress: sunk95, hoverFilter: "none" },
		thumb: { bg: "#c0c0c0", shadow: raised95 },
		tip: { bg: "#ffffe1", fg: "#000000", shadow: `0 0 0 1px ${B_DK}, 1px 1px 0 rgb(0 0 0 / 0.35)` },
		rowHover: { bg: NAVY, fg: "#ffffff" },
		titlebar: { bg: NAVY, fg: "#ffffff", inset: 3 },
		ringColor: "#000000",
		scroll: { thumb: "#c0c0c0", track: "repeating-conic-gradient(#c0c0c0 0 25%, #ffffff 0 50%) 0 0 / 2px 2px" },
		check: { bg: "#ffffff", mark: "#000000" },
		tileFrame: `0 0 0 1px var(--gz-line-float), ${sunk95}`,
		headerShadow: `inset 0 -1px 0 ${B_LO}, inset 0 -2px 0 ${B_HI}`,
		decided: decide({
			"button.quiet": keep("quiet header keys stay flat until pressed, as the toolbars of that era did; pressed they take the sunk bevel"),
			"button.primary": tok("the navy fill, white label (16 : 1), the raised fill bevel; pressed = the sunk bevel (--gz-fill-*)"),
			slider: tok("--gz-thumb-bg / --gz-thumb-shadow: a raised grey key with the 4-layer bevel, square (--gz-r-knob 0)"),
			tooltip: tok("--gz-tip-*: the era's pale tip #ffffe1, 1 px black, a hard 1 px shadow, square"),
			segmented: tok("square track and keys (--gz-r-control 0), the chosen key sunk (--gz-sink)"),
			tabs: tok("the chosen tab sunk (--gz-sink), square; the inspector's tabs too"),
			"menu.context": tok("square menu, raised bevel, a navy row with white text under the pointer (--gz-row-hover-*)"),
			"select.list": tok("square list, raised bevel, navy row under the pointer (--gz-row-hover-*)"),
			checkbox: tok("--gz-check-*: a white inset well with a black tick"),
			dialog: tok("a navy title band with the white title (--gz-titlebar-*), raised bevel, the black outer edge"),
			sheet: tok("a navy title band (--gz-titlebar-*), raised bevel, black outer edge, hard shadow"),
			"panel.header": tok("a titled panel's header is a navy title band with its name in white (--gz-titlebar-*)"),
			scrollbar: tok("--gz-scroll-*: a grey square thumb on the era's checkered track"),
			"focus-ring": tok("--gz-ring-*: a 1 px dotted black frame inside the key"),
			"home.tile": tok("--gz-tile-frame: the project tile sits in a sunken bevel frame (the picture untouched)"),
			"player.bar": tok("C1: the player's surround is the pack's neutral dark (--gz-stage-*), its keys the raised bevel"),
			"timeline.selection": tok("a 2 px navy ring between white edges over the clip, the name bar turns navy (--gz-clip-sel*)"),
			"media.tile.selected": keep("the chosen tile is the default's accent ring (--ring): its shape is the same in every look, only its colour is the look's accent"),
			toast: keep("a toast is a floating card: --gz-r-menu 0 and the float bevel as every floating thing (not reachable on a key-less profile)"),
			"progress.line": keep("a line progress is the navy accent's bar, square (--gz-r-control 0); the era drew it as the accent"),
			"empty-state": keep("a line of text and one icon in the body face; the icon takes the heavier square stroke"),
			"drag-ghost": keep("the ghost reads the top-surface tokens: a raised grey card, square"),
		}),
	},
};

// ── «Терминал»: a green-phosphor terminal (the genre — no film marks, no falling glyphs): black, phosphor green in three
// strengths, mono type for headings, digits, clip names, menu rows and tooltips, hairlines instead of fills (the filled
// key too: a phosphor line, inverse only while pressed), a block caret, faint scanlines on the frame drawn in code, and a
// scan reveal: things arrive like a line written on the screen.
const PH = "#39ff7a";
const PH_MID = "#22c55e";
const PH_DIM = "#145c2c";
export const LOOK_TERMINAL: Family = {
	id: "terminal",
	name: "Terminal look",
	note: "Green phosphor on black, mono type, scanlines",
	material: "strict",
	dark: {
		room: "#000000",
		panel: "#0b1a0f",
		stage: "#0b0b0c",
		timeline: "#020803",
		raised: "#0a1d0f",
		muted: "#0d2613",
		well: "#000000",
		key: "#103a1b",
		border: PH_DIM,
		float: "#030a05",
		floatAlpha: 1,
		fg: "#b8ffcf",
		fgMuted: PH_MID,
		destructive: "#ff5f56",
		constructive: PH,
		caution: "#ffbd2e",
		accent: PH,
		lamp: "#b8ffcf",
	},
	skin: {
		motionNote: "a scan reveal: a line written top-down in a few steps, nothing glides",
		geometry: {
			panel: 2,
			dialog: 2,
			menu: 2,
			control: 2,
			tile: 2,
			raise: `inset 0 0 0 1px ${PH_DIM}`,
			sink: `inset 0 0 0 1px ${PH_MID}`,
			field: `inset 0 0 0 1px ${PH_DIM}`,
			raiseFill: `inset 0 0 0 1px ${PH}`,
			panelShadow: `inset 0 0 0 1px ${PH_DIM}`,
			floatShadow: `0 0 0 1px ${PH_MID}, 0 8px 20px -8px rgb(0 0 0 / 0.9)`,
			modalShadow: `0 0 0 1px ${PH_MID}, 0 16px 40px -12px rgb(0 0 0 / 0.95)`,
			ring: { width: 2, offset: 2, style: "solid", filter: "none" },
			knob: "1px",
		},
		type: { head: MONO, digits: MONO, label: MONO, body: MONO, headWeight: 500, headTracking: "0.02em", headCase: "uppercase", numeric: "tabular-nums slashed-zero", smoothing: "antialiased" },
		// a hairline: the thinnest stroke that still holds the icon floor on black (C4)
		icon: { stroke: 1.25, cap: "square", join: "miter", rendering: "geometricPrecision", active: `drop-shadow(0 0 2px rgb(57 255 122 / 0.55))` },
		motion: { appear: 120, press: 1, land: 90, ease: "steps(3, end)", appearEase: "steps(4, end)", appearKind: "scan", pressShift: "none" },
		cursor: { action: "default", text: "text", caret: PH, caretShape: "block", selectBg: "#39ff7a", selectFg: "#000000" },
		clip: {
			radius: 1,
			video: "#0d3a1c",
			// the text clip: a brighter phosphor body, one hue step from the video clip (the olive read as disabled)
			text: "#17502a",
			audio: "#0b3634",
			graphic: "#3a2a0c",
			effect: "#1a2f3f",
			label: "#c8ffd8",
			sel: PH,
			selEdge: "#000000",
			selWidth: 2,
			selBar: "#1f7a3c",
			// one value on every path: a white core, a black edge (a green line vanished into the green waves)
			playhead: "#eaffef",
			playheadEdge: "#000000",
			wave: "#7dffaa",
		},
		// scanlines: a 1 px phosphor line every 3 px at 2.5 % on the editor's frame, 1.5 % on Home
		texture: { room: "repeating-linear-gradient(0deg, rgb(57 255 122 / 0.025) 0 1px, rgb(0 0 0 / 0) 1px 3px)", panel: "none" },
		homeTexture: "repeating-linear-gradient(0deg, rgb(57 255 122 / 0.015) 0 1px, rgb(0 0 0 / 0) 1px 3px)",
		keys: { bg: "transparent", fg: PH, bgHover: "#0b2a14", fgHover: PH, bgPress: PH, fgPress: "#000000", shadowHover: `inset 0 0 0 1px ${PH}`, shadowPress: "none", hoverFilter: "none" },
		thumb: { bg: "#000000", shadow: `inset 0 0 0 2px ${PH}` },
		tip: { bg: "#000000", fg: "#b8ffcf", shadow: `0 0 0 1px ${PH_MID}` },
		rowHover: { bg: PH_DIM, fg: "#eaffef" },
		ringColor: PH,
		scroll: { thumb: PH_DIM, track: "transparent" },
		check: { bg: "#000000", mark: PH },
		tileFrame: "0 0 0 1px var(--gz-line-float)",
		headerShadow: `inset 0 -1px 0 ${PH_DIM}`,
		progress: "repeating-linear-gradient(90deg, rgb(0 0 0 / 0) 0 3px, rgb(0 0 0 / 0.45) 3px 4px)",
		decided: decide({
			"button.primary": tok("a phosphor hairline and phosphor text on black (--gz-fill-*: transparent fill, --gz-raise-fill 1 px PH); inverse only while pressed"),
			"button.pressed": tok("inverse: black on phosphor (--gz-fill-bg-press / -fg-press), no movement"),
			slider: tok("--gz-thumb-*: a hollow phosphor block (black, 2 px phosphor line), corner 1 px"),
			tooltip: tok("--gz-tip-*: black, phosphor-white mono text, a PH_MID hairline, corner 2 px"),
			segmented: tok("track and keys at --gz-r-control 2 px; the chosen key a PH_MID hairline (--gz-sink)"),
			tabs: tok("the chosen tab a PH_MID hairline (--gz-sink), corner 2 px; the inspector's tabs too"),
			"menu.context": tok("mono rows (--gz-font-body), a dim phosphor row under the pointer (--gz-row-hover-*), PH_MID edge"),
			"select.list": tok("mono rows, the dim phosphor row under the pointer (--gz-row-hover-*)"),
			checkbox: tok("--gz-check-*: a black well with a phosphor tick"),
			scrollbar: tok("--gz-scroll-*: a dim phosphor thumb on no track"),
			"focus-ring": tok("--gz-ring-*: a 2 px phosphor ring 2 px off"),
			"progress.line": tok("--gz-progress-image: the phosphor bar cut into 4 px cells"),
			"home.tile": tok("--gz-tile-frame: a PH_DIM hairline frame; Home's scanlines at 1.5 % (--gz-tex-home)"),
			"player.bar": keep("C1: the player's surround is the pack's neutral dark, the same as the default look's (--gz-stage-*); its mono timecode is the default's face too"),
			"timeline.playhead": tok("--gz-playhead #eaffef + a black edge on every path (the rule no longer hangs on the translated label)"),
			"timeline.selection": tok("a 2 px phosphor ring between black edges over the clip; the name bar turns phosphor-dim (--gz-clip-sel*)"),
			"media.tile.selected": keep("the chosen tile is the default's accent ring (--ring): its shape is the same in every look, only its colour is the look's accent"),
			toast: keep("a toast is a floating card in the float tokens (PH_MID hairline): not reachable on a key-less profile"),
			"empty-state": keep("a line of text and one icon: the icon takes the hairline stroke"),
			"drag-ghost": keep("the ghost reads the top-surface tokens: black, a PH_MID hairline"),
		}),
	},
};

// ── «Пиксель»: 8-bit and cute — pastels on deep navy, hard square corners, 2 px edges, stepped (unblurred, offset)
// shadows, block fills, a dithered frame drawn in code, a pixel-crisp face (a system monospace with smoothing off: see
// PIXEL_FACE), pixel-snapped icons, stepped motion in 4 frames, a key that drops 2 px when pressed.
const PX_EDGE = "#6a6fd8";
const PX_SH = "#000000";
const PX_INK = "#12143a";
const PX_PINK = "#ff9ad2";
/** the pixel face: chosen on screen in Russian among the Mac's monospaces with smoothing off (looksfix, 14.11) */
// Candidates captured in Russian at 10–15 px, 1× and 2× (Monaco, Menlo, SF Mono, PT Mono, Andale Mono, Courier New,
// Geneva, Silom — Silom has no Cyrillic): Andale Mono with smoothing off draws the squarest, most bitmap-like Cyrillic.
const PIXEL_FACE = `"Andale Mono", Monaco, ${MONO}`;
export const LOOK_PIXEL: Family = {
	id: "pixel",
	name: "Pixel look",
	note: "8-bit and cute: pastels on navy, square, stepped",
	material: "strict",
	dark: {
		room: "#12143a",
		panel: "#1d2058",
		stage: "#0b0b0c",
		timeline: "#181a4a",
		raised: "#2a2e72",
		muted: "#30357e",
		well: "#0d0f2e",
		key: "#3a3f96",
		border: "#4a50b0",
		float: "#20235e",
		floatAlpha: 1,
		fg: "#fff6fb",
		fgMuted: "#cfc8f5",
		destructive: "#ff7a90",
		constructive: "#7ee8a8",
		caution: "#ffd86b",
		accent: PX_PINK,
		lamp: "#fff6fb",
	},
	skin: {
		motionNote: "stepped: 4 frames, no easing; a key drops 2 px",
		geometry: {
			panel: 0,
			dialog: 0,
			menu: 0,
			control: 0,
			tile: 0,
			// a key: a 2 px edge, a 2 px light step at its top-left, a hard offset shadow (no blur)
			raise: `inset 0 0 0 2px ${PX_EDGE}, inset 2px 2px 0 2px #8f94f0, 2px 2px 0 0 ${PX_SH}`,
			sink: `inset 0 0 0 2px ${PX_EDGE}, inset 2px 2px 0 0 #07081f`,
			field: `inset 0 0 0 2px ${PX_EDGE}, inset 2px 2px 0 2px #07081f`,
			raiseFill: `inset 0 -2px 0 rgb(0 0 0 / 0.28), 2px 2px 0 0 ${PX_SH}`,
			panelShadow: `inset 0 0 0 2px #2c3080, 4px 4px 0 ${PX_SH}`,
			floatShadow: `0 0 0 2px ${PX_EDGE}, 4px 4px 0 ${PX_SH}, 6px 6px 0 rgb(0 0 0 / 0.5)`,
			modalShadow: `0 0 0 2px ${PX_EDGE}, 6px 6px 0 ${PX_SH}, 8px 8px 0 rgb(0 0 0 / 0.5)`,
			ring: { width: 2, offset: 2, style: "solid", filter: "none" },
			knob: "0px",
		},
		type: { head: PIXEL_FACE, digits: PIXEL_FACE, label: PIXEL_FACE, headWeight: 400, headTracking: "0.04em", headCase: "none", numeric: "tabular-nums", smoothing: "none" },
		// pixel icons: a whole-pixel stroke, square caps and mitred joins, snapped to the grid
		icon: { stroke: 2, cap: "square", join: "miter", rendering: "crispEdges", active: "none" },
		motion: { appear: 160, press: 1, land: 120, ease: "steps(3, end)", appearEase: "steps(4, end)", appearKind: "step", pressShift: "translateY(2px)" },
		cursor: { action: "default", text: "text", caret: PX_PINK, caretShape: "block", selectBg: PX_PINK, selectFg: PX_INK },
		clip: {
			radius: 0,
			// the pastel set: lilac, peach, mint, rose, sky — each deep enough for the white name
			video: "#4a4ea8",
			text: "#8f4f3f",
			audio: "#2f6b5b",
			graphic: "#8a3a5a",
			effect: "#2f5f8f",
			label: "#ffffff",
			// one accent (T3): the selection is the pink, the playhead pink-white
			sel: PX_PINK,
			selEdge: "#07081f",
			selWidth: 2,
			selBar: "#6b3a78",
			playhead: "#ffe0f0",
			playheadEdge: "#07081f",
			wave: "#f0eeff",
		},
		// a dither: a 2 px checker of white at 2.5 % on the frame (an 8-bit screen's half-tone), never in the timeline
		texture: { room: "repeating-conic-gradient(rgb(255 255 255 / 0.025) 0 25%, rgb(0 0 0 / 0) 0 50%) 0 0 / 4px 4px", panel: "none" },
		keys: { bg: PX_PINK, fg: PX_INK, bgHover: "#ffb8e0", fgHover: PX_INK, bgPress: "#e07ab4", fgPress: PX_INK, shadowHover: `inset 0 -2px 0 rgb(0 0 0 / 0.28), 2px 2px 0 0 ${PX_SH}`, shadowPress: "inset 0 2px 0 rgb(0 0 0 / 0.28)", hoverFilter: "none" },
		thumb: { bg: PX_PINK, shadow: `inset 0 0 0 2px #07081f, 2px 2px 0 0 ${PX_SH}` },
		tip: { bg: "#fff6fb", fg: PX_INK, shadow: `0 0 0 2px ${PX_EDGE}, 3px 3px 0 ${PX_SH}` },
		rowHover: { bg: PX_PINK, fg: PX_INK },
		// a title block on dialogs: lavender with the navy title (an 8-bit window's bar)
		titlebar: { bg: "#8f94f0", fg: PX_INK, inset: 2 },
		scroll: { thumb: PX_EDGE, track: "#0d0f2e" },
		check: { bg: PX_PINK, mark: PX_INK },
		tileFrame: `0 0 0 2px ${PX_EDGE}, 3px 3px 0 0 ${PX_SH}`,
		headerShadow: `inset 0 -2px 0 #2c3080`,
		// progress as blocks: 6 px cells, 2 px gaps
		progress: `repeating-linear-gradient(90deg, rgb(0 0 0 / 0) 0 6px, ${PX_INK} 6px 8px)`,
		decided: decide({
			"button.primary": tok("a pink block, navy label (≈ 9 : 1), a hard 2 px offset shadow; pressed it drops 2 px (--gz-fill-*)"),
			"button.secondary": tok("a 2 px lavender edge, a 2 px light step at the top-left, a hard offset shadow (--gz-raise)"),
			slider: tok("--gz-thumb-*: a pink square block with a 2 px navy edge and a hard shadow"),
			tooltip: tok("--gz-tip-*: a cream block, navy text, 2 px edge, a hard 3 px shadow, square"),
			segmented: tok("square track and keys; the chosen key sunk with a 2 px edge (--gz-sink)"),
			tabs: tok("square, the chosen tab sunk with a 2 px edge (--gz-sink)"),
			"menu.context": tok("square, 2 px edge, stepped double shadow (--gz-shadow-float), the pink row under the pointer"),
			"select.list": tok("square, 2 px edge, stepped shadow, the pink row under the pointer (--gz-row-hover-*)"),
			checkbox: tok("--gz-check-*: a pink block with a navy tick"),
			scrollbar: tok("--gz-scroll-*: a lavender block thumb on a navy track, square"),
			"focus-ring": tok("--gz-ring-*: a 2 px pink ring 2 px off, square"),
			"progress.line": tok("--gz-progress-image: blocks — 6 px cells with 2 px gaps"),
			"home.tile": tok("--gz-tile-frame: a 2 px lavender edge with a hard offset shadow; Home's dither"),
			"player.bar": keep("C1: the player's surround is the pack's neutral dark, the same as the default look's (--gz-stage-*)"),
			"timeline.selection": tok("a 2 px pink ring between navy edges over the clip, the name bar turns pink-plum (--gz-clip-sel*)"),
			"media.tile.selected": keep("the chosen tile is the default's accent ring (--ring): its shape is the same in every look, only its colour is the look's accent"),
			toast: keep("a toast is a floating block: the float tokens (2 px edge, stepped shadow): not reachable on a key-less profile"),
			"empty-state": keep("a line of text and one icon: the icon takes the pixel stroke"),
			"drag-ghost": keep("the ghost reads the top-surface tokens: a square block with the stepped shadow"),
		}),
	},
};

// ── «Неон»: cyberpunk — near-black and TWO luminous inks used by rule: magenta = action (the filled key, progress),
// cyan = state (the selection, the focus ring, the chosen key and tab, the playhead). Chamfered corners (clip-path, never
// on anything in the timeline), a lit corner mark on menus and dialogs, mono digits, condensed headings. Glow ONLY as an
// answer (pointer over / press / Tab), never at rest and never in the timeline or near the picture.
const NE = "#ff3dd8";
const CY = "#22e6ff";
const NE_LINE = "#3a2a5c";
const CHAMFER = CH(5);
export const LOOK_NEON: Family = {
	id: "neon",
	name: "Neon look",
	note: "Cyberpunk: near-black, magenta action, cyan state",
	material: "strict",
	dark: {
		room: "#07060d",
		panel: "#171428",
		stage: "#0b0b0c",
		timeline: "#0c0a16",
		raised: "#1a1630",
		muted: "#201b3a",
		well: "#06050c",
		key: "#2a2250",
		border: NE_LINE,
		float: "#110f1f",
		floatAlpha: 1,
		fg: "#f4efff",
		fgMuted: "#b3a8d9",
		destructive: "#ff5577",
		constructive: "#2ff5c8",
		caution: "#ffd23f",
		accent: NE,
		lamp: "#ffd6f6",
	},
	skin: {
		motionNote: "a short glow fade: things light up and settle, 140 ms — only as an answer",
		geometry: {
			panel: 0,
			dialog: 0,
			menu: 0,
			control: 0,
			tile: 0,
			raise: `inset 0 0 0 1px ${NE_LINE}`,
			// the chosen key: the cyan state line, no glow at rest
			sink: `inset 0 0 0 1px ${CY}`,
			field: `inset 0 0 0 1px ${NE_LINE}`,
			raiseFill: "none",
			panelShadow: `inset 0 0 0 1px ${NE_LINE}, inset 0 1px 0 rgb(34 230 255 / 0.18)`,
			floatShadow: `0 0 0 1px #5a3f8a, 0 10px 28px -10px rgb(0 0 0 / 0.9)`,
			modalShadow: `0 0 0 1px #5a3f8a, 0 22px 56px -16px rgb(0 0 0 / 0.95)`,
			ring: { width: 2, offset: 2, style: "solid", filter: "drop-shadow(0 0 3px rgb(34 230 255 / 0.7))" },
			knob: "0px",
		},
		type: { head: SYS, digits: MONO, label: SYS, headWeight: 600, headTracking: "0.08em", headCase: "uppercase", headStretch: "condensed", numeric: "tabular-nums slashed-zero", smoothing: "antialiased" },
		// a luminous thin line: the thinnest stroke (glow comes from the key that answers, never from an icon at rest)
		icon: { stroke: 1.25, cap: "butt", join: "miter", rendering: "geometricPrecision", active: "none" },
		motion: { appear: 140, press: 40, land: 140, ease: "cubic-bezier(0.2, 0, 0, 1)", appearEase: "cubic-bezier(0.2, 0, 0, 1)", appearKind: "glow", pressShift: "none" },
		cursor: { action: "default", text: "text", caret: CY, caretShape: "bar", selectBg: CY, selectFg: "#001418" },
		clip: {
			radius: 0,
			// the two inks in the timeline: violet video, deep-cyan text, magenta-dim sound
			video: "#241a3a",
			text: "#0f3a44",
			audio: "#3a1438",
			graphic: "#5a1f2f",
			effect: "#1f2f6a",
			label: "#ffffff",
			sel: CY,
			selEdge: "#000000",
			selWidth: 2,
			selBar: "#124a57",
			// the playhead in cyan alone tells Неон from Пиксель at a glance
			playhead: CY,
			playheadEdge: "#000000",
			wave: "#6ff2ff",
		},
		texture: { room: "none", panel: "none" },
		chamfer: CHAMFER,
		// the lit chamfer on menus and dialogs: a cyan cut at the top-left, a magenta one at the bottom-right
		corner: `linear-gradient(135deg, ${CY} 0 6px, rgb(0 0 0 / 0) 6px), linear-gradient(315deg, ${NE} 0 6px, rgb(0 0 0 / 0) 6px)`,
		keys: { bg: "var(--gz-accent-fill)", fg: "var(--gz-on-fill)", bgHover: "var(--gz-accent-fill)", fgHover: "var(--gz-on-fill)", bgPress: "var(--gz-accent-fill)", fgPress: "var(--gz-on-fill)", shadowHover: "inset 0 0 0 1px #ffd6f6, inset 0 0 10px rgb(255 214 246 / 0.45)", shadowPress: "inset 0 0 0 1px #ffffff, inset 0 0 14px rgb(255 255 255 / 0.5)", hoverFilter: "none" },
		thumb: { bg: CY, shadow: "none", clip: CH(3) },
		tip: { bg: "#110f1f", fg: "#f4efff", shadow: `0 0 0 1px ${CY}, 0 8px 20px -8px rgb(0 0 0 / 0.9)` },
		rowHover: { bg: "#0f3a44", fg: "#e8fdff" },
		ringColor: CY,
		scroll: { thumb: "#3a2a5c", track: "transparent" },
		check: { bg: CY, mark: "#001418" },
		tileFrame: "0 0 0 1px var(--gz-line-float)",
		headerShadow: `inset 0 -1px 0 ${NE_LINE}`,
		decided: decide({
			"button.primary": tok("the magenta fill (action ink), chamfered (--gz-chamfer); it lights only under the pointer / pressed (--gz-fill-shadow-*), never at rest"),
			"button.secondary": tok("a violet hairline, chamfered corners (--gz-raise, --gz-chamfer)"),
			"button.pressed": tok("the key lights from inside (--gz-fill-shadow-press), no movement"),
			slider: tok("--gz-thumb-*: a cyan chamfered block (state ink)"),
			tooltip: tok("--gz-tip-*: near-black, a cyan hairline and a deep shadow, square (a chamfer would cut its edge, S2)"),
			segmented: tok("the chosen key a cyan line (--gz-sink), chamfered"),
			tabs: tok("the chosen tab a cyan line, chamfered; the inspector's tabs too"),
			"menu.context": tok("square, a violet edge, the lit corner mark (--gz-corner), a deep-cyan row under the pointer"),
			"select.list": tok("square, the lit corner mark, the deep-cyan row under the pointer (--gz-row-hover-*)"),
			dialog: tok("square, a violet edge, the lit corner mark (--gz-corner)"),
			sheet: tok("square, a violet edge, the lit corner mark (--gz-corner)"),
			checkbox: tok("--gz-check-*: a cyan block with a dark tick"),
			scrollbar: tok("--gz-scroll-*: a violet thumb on no track"),
			"focus-ring": tok("--gz-ring-*: a 2 px cyan ring 2 px off with a cyan glow (an answer to Tab)"),
			"home.tile": tok("--gz-tile-frame: a violet hairline frame, square"),
			"player.bar": keep("C1: the player's surround is the pack's neutral dark, the same as the default look's (--gz-stage-*)"),
			"timeline.playhead": tok("--gz-playhead: cyan with a black edge (the state ink)"),
			"timeline.selection": tok("a 2 px cyan ring between black edges over the clip; the name bar turns deep cyan (--gz-clip-sel*)"),
			"media.tile.selected": keep("the chosen tile is the default's accent ring (--ring): its shape is the same in every look, only its colour is the look's accent"),
			toast: keep("a toast is a floating card in the float tokens: not reachable on a key-less profile"),
			"progress.line": keep("progress is the magenta action ink's bar, square: the default bar in the look's corner"),
			"empty-state": keep("a line of text and one icon: the icon takes the thin line"),
			"drag-ghost": keep("the ghost reads the top-surface tokens: near-black, violet edge"),
		}),
	},
};

export const LOOKS_PACK: Family[] = [LOOK_95, LOOK_TERMINAL, LOOK_PIXEL, LOOK_NEON];
