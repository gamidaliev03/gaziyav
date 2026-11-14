// The looks pack, third piece (WISHES 56, DESIGN.md §8 / §8a): «Арена», «Плёнка», «Аналог» — each a whole skin.
// Genre only: no game's, platform's, film's, film stock's or hardware maker's names, logos or panel copies.
// Fonts: only faces on every Mac (/System/Library/Fonts and its Supplemental folder, all with Cyrillic, checked 14.11):
// DIN Condensed / DIN Alternate, PT Sans Narrow, PT Mono, American Typewriter, Gill Sans, Copperplate, Helvetica Neue.
// Textures are drawn in code (gradients, one SVG noise tile), each layer ≤ 3 %, on the frame and panels only (C3, C5).
import type { Family } from "./families";
import { COMMON_DECISIONS } from "./skin";

const tok = (via: string) => ({ by: "tokens" as const, via });
const keep = (why: string) => ({ inherit: "by design" as const, why });

const SYS = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, Monaco, monospace`;

// ── «Арена»: a dark cockpit for people who live in games. Graphite, ONE electric accent (re-tintable), tight angular
// corners, a condensed technical face for headings, tabular digits, HUD-thin frames (a 1 px rule along the top of
// every panel), quick decisive motion without bounce; the selection reads as a lock-on (an accent ring + a black
// keyline). Calm at rest: nothing glows, nothing pulses, no animated border.
const AR = "#b8ff2c";
const AR_LINE = "#2e3640";
const AR_RULE = "#3b4552";
export const LOOK_ARENA: Family = {
	id: "arena",
	name: "Arena look",
	note: "Gamer cockpit: graphite, one electric accent, angular",
	material: "strict",
	dark: {
		room: "#08090b",
		panel: "#16191e",
		stage: "#0b0b0c",
		timeline: "#111418",
		raised: "#222730",
		muted: "#272d36",
		well: "#07080a",
		key: "#2c333e",
		border: AR_LINE,
		float: "#14171c",
		floatAlpha: 1,
		fg: "#eef3f7",
		fgMuted: "#9eabb8",
		destructive: "#ff4d5e",
		constructive: "#3ddc84",
		caution: "#ffc531",
		accent: AR,
		lamp: "#eef3f7",
	},
	skin: {
		motionNote: "sharp and fast: a short decisive slide-in, no easing tail, no bounce",
		geometry: {
			panel: 2,
			dialog: 2,
			menu: 2,
			control: 2,
			tile: 2,
			raise: `inset 0 0 0 1px ${AR_LINE}, inset 0 1px 0 rgb(255 255 255 / 0.04)`,
			sink: `inset 0 0 0 1px ${AR_RULE}, inset 0 -2px 0 ${AR}`,
			field: `inset 0 0 0 1px ${AR_LINE}, inset 0 -1px 0 ${AR_RULE}`,
			raiseFill: `inset 0 -2px 0 rgb(0 0 0 / 0.28)`,
			// a HUD frame: a thin rule along the panel's top edge, the hairline around it
			panelShadow: `inset 0 1px 0 ${AR_RULE}, inset 0 0 0 1px #1d2229`,
			floatShadow: `0 0 0 1px ${AR_RULE}, 0 12px 28px -12px rgb(0 0 0 / 0.9)`,
			modalShadow: `inset 0 2px 0 ${AR}, 0 0 0 1px ${AR_RULE}, 0 20px 48px -16px rgb(0 0 0 / 0.95)`,
			ring: { width: 2, offset: 2, style: "solid", filter: "none" },
			// the slider thumb and the switch: a square-cut knob
			knob: "1px",
		},
		type: {
			head: `"DIN Condensed", "PT Sans Narrow", "Arial Narrow", ${SYS}`,
			digits: `"DIN Alternate", ${MONO}`,
			label: `"PT Sans Narrow", ${SYS}`,
			headWeight: 700,
			headTracking: "0.08em",
			headCase: "uppercase",
			numeric: "tabular-nums slashed-zero",
			smoothing: "antialiased",
		},
		icon: { stroke: 1.5, cap: "butt", join: "miter", rendering: "geometricPrecision", active: "none" },
		motion: { appear: 110, press: 1, land: 90, ease: "cubic-bezier(0.3, 0, 0, 1)", appearEase: "cubic-bezier(0.3, 0, 0, 1)", appearKind: "step", pressShift: "translateY(1px)" },
		cursor: { action: "default", text: "text", caret: AR, caretShape: "bar", selectBg: AR, selectFg: "#0a0d00" },
		clip: {
			radius: 1,
			video: "#1d4668",
			text: "#4a2a70",
			audio: "#1b5643",
			graphic: "#6c2a2c",
			effect: "#4d4a1c",
			label: "#ffffff",
			sel: AR,
			selEdge: "#000000",
			playhead: "#ffffff",
			playheadEdge: "#000000",
			wave: "#a8f0cc",
		},
		// a HUD grid on the frame only: 1 px lines every 24 px at 2.5 %
		texture: {
			room: "repeating-linear-gradient(90deg, rgb(255 255 255 / 0.025) 0 1px, rgb(0 0 0 / 0) 1px 24px), repeating-linear-gradient(0deg, rgb(255 255 255 / 0.025) 0 1px, rgb(0 0 0 / 0) 1px 24px)",
			panel: "none",
		},
		decided: {
			...COMMON_DECISIONS,
			tooltip: tok("--gz-r-menu 2: a square-cut HUD chip, --gz-shadow-float with the 1 px rule, no glow"),
			scrollbar: tok("--gz-scroll: a 2 px-cornered graphite thumb (--gz-r-control), no track chrome"),
			segmented: tok("--gz-sink: the chosen key drops in with a 2 px accent underline, --gz-r-control 2"),
			tabs: tok("--gz-sink: the chosen tab carries the 2 px accent underline (a HUD tab)"),
			toast: tok("--gz-r-menu 2, --gz-shadow-float: a HUD notice, arrives by the 110 ms step"),
			"progress.line": tok("a straight accent bar, --gz-r-control 2 corners (no rounded pill)"),
			"empty-state": keep("one line of text and one icon: a cockpit says nothing when there is nothing to show"),
			"drag-ghost": tok("--gz-s3 + --gz-shadow-float rule + --gz-r-menu 2: the ghost is a HUD chip"),
			"home.tile": tok("--gz-r-tile 2, --gz-panel-shadow HUD rule on the tile, accent ring when chosen"),
			"panel.header": tok("--gz-panel-shadow: a 1 px HUD rule along each panel's top edge; --gz-font-head: DIN Condensed caps, 0.08em"),
			"timeline.selection": tok("a lock-on: --gz-clip-sel (the electric accent) inside a black keyline --gz-clip-sel-edge; nothing pulses"),
			"player.bar": tok("--gz-font-digits: DIN Alternate tabular timecode, the icon voice (1.5 butt / miter), --gz-raise keys"),
			dialog: tok("--gz-shadow-modal: a 2 px accent rule along the top like a HUD frame, --gz-r-dialog 2, --gz-anim-appear step"),
			slider: tok("--gz-r-knob 1px: a square-cut thumb, --gz-slider-fill in the accent"),
		},
	},
};

// ── «Плёнка»: vintage film for film people. Screening-room warm blacks, cream text like paper, tungsten amber, the
// colours of stock and leader on the clips (strips on a bench), a typewriter heading with a humanist grotesque for
// labels and a typewriter mono for digits; the frame between panels carries a perforation ladder (it never scrolls),
// the faintest grain drawn in code; motion with the weight of a mechanical transport (ease-in-out, a soft dissolve).
const FL_LINE = "#4a3a2a";
const FL_CREAM = "rgb(243 230 204 / 0.03)";
// one 128 px SVG noise tile: fractal noise, alpha scaled to ≤ 3 %, warm cream; drawn once, cached by the browser
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.95 0 0 0 0 0.9 0 0 0 0 0.8 0 0 0 0.03 0'/%3E%3C/filter%3E%3Crect width='128' height='128' filter='url(%23n)'/%3E%3C/svg%3E")`;
export const LOOK_FILM: Family = {
	id: "film",
	name: "Film look",
	note: "Vintage film: warm blacks, cream, tungsten amber",
	material: "strict",
	dark: {
		room: "#080604",
		panel: "#211913",
		stage: "#0b0b0c",
		timeline: "#251c15",
		raised: "#2b2219",
		muted: "#33291e",
		well: "#0c0906",
		key: "#3b2e21",
		border: FL_LINE,
		float: "#231b14",
		floatAlpha: 1,
		fg: "#f3e6cc",
		fgMuted: "#c4ae8a",
		destructive: "#e8604a",
		constructive: "#94c46c",
		caution: "#e8b04a",
		accent: "#e8a33d",
		lamp: "#ffe2b0",
	},
	skin: {
		motionNote: "a mechanical transport: things dissolve in with weight (a fade and a 3 px settle), ease-in-out, a touch longer than default",
		geometry: {
			panel: 4,
			dialog: 6,
			menu: 4,
			control: 3,
			tile: 3,
			raise: `inset 0 0 0 1px ${FL_LINE}, inset 0 1px 0 rgb(255 230 190 / 0.05)`,
			sink: `inset 0 0 0 1px #5c4833, inset 0 2px 0 rgb(0 0 0 / 0.45)`,
			field: `inset 0 0 0 1px ${FL_LINE}, inset 0 1px 0 rgb(0 0 0 / 0.5)`,
			raiseFill: `inset 0 -1px 0 rgb(0 0 0 / 0.28)`,
			panelShadow: `inset 0 0 0 1px #2c2219, inset 0 1px 0 rgb(255 230 190 / 0.04)`,
			floatShadow: `0 0 0 1px #5c4833, 0 10px 26px -10px rgb(0 0 0 / 0.85)`,
			modalShadow: `0 0 0 1px #5c4833, 0 20px 50px -16px rgb(0 0 0 / 0.9)`,
			ring: { width: 2, offset: 2, style: "solid", filter: "none" },
			// the slider thumb and the switch: a round knob
			knob: "50%",
		},
		type: {
			head: `"American Typewriter", "Courier New", ui-serif, serif`,
			digits: `"PT Mono", "Courier New", ${MONO}`,
			label: `"Gill Sans", "PT Sans", ${SYS}`,
			headWeight: 600,
			headTracking: "0.02em",
			headCase: "none",
			numeric: "tabular-nums",
			smoothing: "antialiased",
		},
		icon: { stroke: 1.5, cap: "round", join: "round", rendering: "geometricPrecision", active: "none" },
		motion: { appear: 220, press: 60, land: 200, ease: "cubic-bezier(0.65, 0, 0.35, 1)", appearEase: "cubic-bezier(0.65, 0, 0.35, 1)", appearKind: "pop", pressShift: "translateY(1px)" },
		cursor: { action: "default", text: "text", caret: "#e8a33d", caretShape: "underscore", selectBg: "#e8a33d", selectFg: "#1a1008" },
		clip: {
			radius: 2,
			video: "#5a3a1e",
			text: "#2f4a3c",
			audio: "#22404c",
			graphic: "#6c2a22",
			effect: "#4a3a5c",
			label: "#fff4dc",
			sel: "#fff0c8",
			selEdge: "#0f0b08",
			playhead: "#ffb347",
			playheadEdge: "#000000",
			wave: "#e8d2a8",
		},
		texture: {
			// the frame only: a perforation ladder (4 px holes every 10 px) in the gutters between panels + the faintest grain
			room: `repeating-linear-gradient(0deg, ${FL_CREAM} 0 4px, rgb(0 0 0 / 0) 4px 10px), ${GRAIN}`,
			// none on the panels: the contract lays the panel texture on the player's panel too, which C1 keeps neutral
			panel: "none",
		},
		decided: {
			...COMMON_DECISIONS,
			tooltip: tok("--gz-r-menu 4: a small warm card with the leader-brown keyline, --gz-shadow-float"),
			scrollbar: tok("--gz-scroll: a 3 px-cornered warm thumb (--gz-r-control)"),
			slider: tok("--gz-r-knob 50%: a round knob raised by --gz-raise, the track a warm well"),
			segmented: tok("--gz-sink: the chosen key sinks 2 px into the bench, --gz-r-control 3"),
			tabs: tok("--gz-sink on the chosen tab, American Typewriter headings"),
			toast: tok("--gz-r-menu 4, --gz-shadow-float, arrives by the 220 ms ease-in-out dissolve"),
			"progress.line": tok("a tungsten-amber bar, --gz-r-control 3"),
			"drag-ghost": tok("--gz-s3 + --gz-shadow-float + --gz-r-menu 4: a strip lifted off the bench"),
			"home.tile": tok("--gz-r-tile 3, the warm keyline --gz-line-float, the cream title"),
			"panel.header": tok("--gz-font-head: American Typewriter semibold; the panel edge --gz-panel-shadow a warm keyline"),
			"clip.video": tok("strips on a bench: --gz-clip-video (stock brown), --gz-clip-r 2, Gill Sans label --gz-font-label"),
			"clip.text": tok("--gz-clip-text: leader green"),
			"clip.sticker": tok("--gz-clip-graphic: leader red"),
			"player.bar": tok("--gz-font-digits: PT Mono typewriter timecode, round-capped icons, --gz-raise keys"),
			"empty-state": keep("a line of text in the body face; the film motifs stay in the frame (C5), never inside a panel"),
		},
	},
};

// ── «Аналог»: honest studio-hardware skeuomorphism. Brushed-aluminium panels (fine lines drawn in code) with one light
// from the top, a darker brushed frame, raised keys (a lit top edge, a hard shadow below), inset wells for every value, an amber lamp
// for the timecode and the accent, a red needle for the playhead, engraved small-caps headings; a mechanical press
// (2 px travel, transform only) and a small overshoot like a key or a needle settling.
export const LOOK_ANALOG: Family = {
	id: "analog",
	name: "Analog look",
	note: "Studio hardware: brushed metal, raised keys, amber lamp",
	material: "strict",
	// light: a brushed-aluminium desk (the only metal look of the pack — told apart from «Плёнка»'s dark brown at a glance)
	light: {
		room: "#abaeb3",
		panel: "#cdd0d3",
		stage: "#f2f2f2",
		timeline: "#c2c5c9",
		raised: "#dde0e2",
		muted: "#b8bbbf",
		well: "#bfc2c5",
		key: "#d3d6d9",
		keyTop: "#eef0f2",
		border: "#868a90",
		float: "#d9dcdf",
		floatAlpha: 1,
		fg: "#131417",
		fgMuted: "#3a3d42",
		destructive: "#b3261e",
		constructive: "#1e6b2e",
		caution: "#7a4a00",
		accent: "#e07a00",
		lamp: "#ffffff",
	},
	skin: {
		motionNote: "mechanical: a key goes 2 px in, things arrive with a small overshoot like a needle settling",
		geometry: {
			panel: 6,
			dialog: 8,
			menu: 6,
			control: 4,
			tile: 4,
			// raised key: lit top edge, dark bottom edge, a hard shadow under it (no blur anywhere)
			raise: `inset 0 1px 0 rgb(255 255 255 / 0.85), inset 0 -1px 0 rgb(0 0 0 / 0.28), 0 2px 0 rgb(0 0 0 / 0.32)`,
			// pressed key / chosen: the shadow moves inside, the lit edge goes to the bottom lip
			sink: `inset 0 2px 0 rgb(0 0 0 / 0.3), inset 0 0 0 1px rgb(0 0 0 / 0.35), 0 1px 0 rgb(255 255 255 / 0.7)`,
			// an inset well: dark top lip, a lit bottom lip
			field: `inset 0 2px 0 rgb(0 0 0 / 0.22), inset 0 0 0 1px rgb(0 0 0 / 0.4), 0 1px 0 rgb(255 255 255 / 0.75)`,
			raiseFill: `inset 0 1px 0 rgb(255 255 255 / 0.45), inset 0 -1px 0 rgb(0 0 0 / 0.3), 0 2px 0 rgb(0 0 0 / 0.35)`,
			// a panel plate: a lit top edge, a dark bottom edge
			panelShadow: `inset 0 1px 0 rgb(255 255 255 / 0.8), inset 0 -1px 0 rgb(0 0 0 / 0.22), 0 1px 0 rgb(0 0 0 / 0.35)`,
			floatShadow: `inset 0 1px 0 rgb(255 255 255 / 0.85), 0 0 0 1px #5d6168, 0 12px 24px -8px rgb(0 0 0 / 0.45)`,
			modalShadow: `inset 0 1px 0 rgb(255 255 255 / 0.85), 0 0 0 1px #4c5056, 0 24px 48px -12px rgb(0 0 0 / 0.55)`,
			ring: { width: 2, offset: 2, style: "solid", filter: "none" },
			// the slider thumb and the switch: a round knob
			knob: "50%",
		},
		type: {
			head: `Copperplate, "PT Sans", ${SYS}`,
			digits: `"DIN Alternate", ${MONO}`,
			label: `"Helvetica Neue", ${SYS}`,
			headWeight: 400,
			headTracking: "0.08em",
			headCase: "uppercase",
			numeric: "tabular-nums",
			smoothing: "antialiased",
		},
		// engraved: a hard 1 px light lip under an active icon (no blur), nothing at rest
		icon: { stroke: 1.75, cap: "round", join: "round", rendering: "geometricPrecision", active: "drop-shadow(0 1px 0 rgb(255 255 255 / 0.8))" },
		motion: { appear: 180, press: 40, land: 160, ease: "cubic-bezier(0.34, 1.3, 0.64, 1)", appearEase: "cubic-bezier(0.34, 1.3, 0.64, 1)", appearKind: "pop", pressShift: "translateY(2px)" },
		cursor: { action: "default", text: "text", caret: "#ff9f1a", caretShape: "bar", selectBg: "#ff9f1a", selectFg: "#120c00" },
		clip: {
			radius: 3,
			video: "#2c4a6a",
			text: "#583a6a",
			audio: "#2a5a3a",
			graphic: "#6a3020",
			effect: "#5a5020",
			label: "#ffffff",
			sel: "#ffb02e",
			selEdge: "#000000",
			playhead: "#c8180c",
			playheadEdge: "#ffffff",
			wave: "#d8f0d8",
		},
		texture: {
			// brushed lines on the frame (horizontal, 3 px period), a top-lit sheen on the panels' plastic
			room: "repeating-linear-gradient(0deg, rgb(255 255 255 / 0.03) 0 1px, rgb(0 0 0 / 0.025) 1px 2px, rgb(255 255 255 / 0) 2px 3px)",
			// none on the panels (C1: the panel texture would reach the player's panel); the plates read by --gz-panel-shadow
			panel: "none",
		},
		decided: {
			...COMMON_DECISIONS,
			tooltip: tok("--gz-r-menu 6: a small raised aluminium plate, lit top lip in --gz-shadow-float"),
			scrollbar: tok("--gz-scroll: a 4 px-cornered thumb (--gz-r-control) like a fader cap"),
			segmented: tok("a row of latching keys: the chosen one sunk (--gz-sink) and 2 px in (--gz-press-shift)"),
			tabs: tok("latching keys: the chosen tab sunk by --gz-sink"),
			toast: tok("--gz-r-menu 6: a raised plate, --gz-shadow-float lit top lip, the 180 ms needle settle"),
			"progress.line": tok("an amber lamp bar in an inset well (--gz-field around it), --gz-r-control 4"),
			"empty-state": keep("one line of text and one icon: hardware shows a blank panel, not a picture"),
			"drag-ghost": tok("--gz-s3 + --gz-shadow-float + --gz-r-menu 6: a lifted plate"),
			"home.tile": tok("--gz-r-tile 4, --gz-panel-shadow (lit top lip, dark bottom lip), the amber ring when chosen"),
			"button.secondary": tok("a raised key: --gz-raise (lit top lip, hard 2 px shadow), --gz-key-top → --gz-key face"),
			"button.pressed": tok("--gz-sink + --gz-press-shift translateY(2px): the key travels 2 px in, transform only"),
			"field.text": tok("an inset well: --gz-field (dark top lip, lit bottom lip), --well"),
			"field.number": tok("an inset well with the amber lamp digits: --gz-field, --gz-font-digits DIN Alternate"),
			slider: tok("a fader: --gz-r-knob 50% thumb raised by --gz-raise, the track an inset --gz-well"),
			switch: tok("a toggle with a round knob (--gz-r-knob 50%), --gz-accent-fill amber when on"),
			"panel.header": tok("--gz-font-head: Copperplate engraved caps 0.08em; the plate edge --gz-panel-shadow (light from the top)"),
			"timeline.playhead": tok("a red needle --gz-playhead with a light keyline --gz-playhead-edge"),
			"player.bar": tok("--gz-font-digits: the amber lamp timecode (DIN Alternate tabular), raised transport keys"),
		},
	},
};

export const LOOKS_PACK_3: Family[] = [LOOK_ARENA, LOOK_FILM, LOOK_ANALOG];
