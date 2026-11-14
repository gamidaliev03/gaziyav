// The LOOK CONTRACT (WISHES item 56, docs/DESIGN.md §8a, the owner 14.11: «тема это не только цвета, это дизайн каждой
// иконки… анимация действий… должны соответствовать теме… чтоб от монтажа не отвлекал»).
//
// A look = its palette (./families.ts) + a SKIN: one data object that sets everything else the window shows — geometry,
// type, the icon voice, motion, the cursor family, the timeline's clip skin, textures drawn in code. The engine turns a
// skin into CSS variables (`skinVars`), ./themes.css §14 only READS them; no component ever asks which look it is in.
// Fixed in every look (never a token): layout, sizes, hit zones, positions, shortcuts, behaviour, the body face (the
// look's own faces go to headings, digits and clip labels, so no box changes its width), the player's picture.
// UI sounds: the product has none, so a skin has none.
//
// when EVERY kind of thing on screen in `LOOK_KINDS` below is decided in its `decided` map — either drawn by its tokens
// (`{ by: "tokens", via }`, naming the tokens / rules that draw it) or left at the default look's value ON PURPOSE
// (`{ inherit: "by design", why }`). The unit test (__tests__/looks.test.ts) counts un-decided kinds per look: target 0.
// `COMMON_DECISIONS` holds the decisions every look of the pack shares today (spread it, then override per look); a new
// look («looks2», «looks3») copies one of ./looks.ts, changes the values, and re-decides every kind it draws otherwise.
// The capture sheet for the lead (test/looks-capture.mjs): the same twelve screens per look, <look>-<nn>-<screen>.png.
// Limits no skin may break (`skinGuards`, asserted by __tests__/looks.test.ts and test/looks-app.mjs): a press answers
// within one frame; no movement over 320 ms; only transform / opacity / filter animate; Reduce Motion = plain fades;
// nothing moves at rest; texture ≤ 3 % and text over it keeps its floor; clip labels ≥ 4.5 : 1 on every clip colour;
// the playhead and the selection ≥ 3 : 1 against every clip colour and the track; no blur or filter in the timeline.
import { contrast, over } from "./color";

export type AppearKind = "none" | "pop" | "scan" | "step" | "glow";

/** Every kind of thing on screen a look must decide (the completeness checklist). */
export const LOOK_KINDS = [
	"button.primary", "button.secondary", "button.quiet", "button.destructive", "button.disabled", "button.pressed",
	"field.text", "field.number", "select", "select.list", "slider", "switch", "checkbox", "segmented", "tabs",
	"tooltip", "menu.context", "menu.bar", "dialog", "sheet", "toast",
	"progress.line", "progress.ring", "progress.export-fill", "scrollbar", "divider", "panel.header",
	"inspector.section-header", "inspector.row", "inspector.keyframe",
	"timeline.ruler", "timeline.track-header", "clip.video", "clip.sound", "clip.text", "clip.sticker", "clip.effect", "clip.compound",
	"timeline.waveform", "timeline.filmstrip-edge", "timeline.trim-handle", "timeline.playhead", "timeline.selection", "timeline.snap-line",
	"timeline.marker", "timeline.transition-badge", "timeline.insertion-bar",
	"player.bar", "media.tile.rest", "media.tile.hover", "media.tile.selected", "media.tile.downloading", "media.tile.failed",
	"home.tile", "settings.tabs", "export.window", "lipsync.panel", "activity.chip", "activity.list", "empty-state",
	"drag-ghost", "focus-ring", "text-selection", "caret",
] as const;
export type LookKind = (typeof LOOK_KINDS)[number];
export type Decision = { by: "tokens"; via: string } | { inherit: "by design"; why: string };

const tok = (via: string): Decision => ({ by: "tokens", via });
const keep = (why: string): Decision => ({ inherit: "by design", why });
/** What every look of the pack decides alike today (each look spreads this and overrides what it draws otherwise). */
export const COMMON_DECISIONS: Record<LookKind, Decision> = {
	"button.primary": tok("--gz-accent-fill, --gz-raise-fill, --gz-r-control"),
	"button.secondary": tok("--gz-raise, --gz-r-control"),
	"button.quiet": keep("a quiet button is text and an icon until hovered in every look (no chrome to skin); hover takes the look's raised colour"),
	"button.destructive": tok("--destructive (the look's red, floored to AA by the engine) + --gz-raise"),
	"button.disabled": keep("T4: disabled = grey and 40 % in every look, so «not now» reads the same everywhere"),
	"button.pressed": tok("--gz-sink, --gz-press-shift, --gz-dur-press"),
	"field.text": tok("--gz-field, --gz-r-control, --gz-caret"),
	"field.number": tok("--gz-field, --gz-font-digits (digits outside buttons), --gz-numeric"),
	select: tok("--gz-field on the trigger, --gz-r-control"),
	"select.list": tok("--gz-r-menu, --gz-shadow-float, --gz-anim-appear; rows nest in the menu radius"),
	slider: tok("--gz-r-knob on the thumb, --gz-slider-fill"),
	switch: tok("--gz-r-knob on the track and thumb, --gz-accent-fill when on"),
	checkbox: tok("--gz-r-control, --gz-field"),
	segmented: tok("--gz-sink on the chosen key, --gz-well track"),
	tabs: tok("--gz-sink on the chosen tab"),
	tooltip: tok("--gz-shadow-float, --gz-line-float"),
	"menu.context": tok("--gz-r-menu, --gz-shadow-float, --gz-anim-appear, --gz-dur-appear"),
	"menu.bar": keep("the Mac's own menu bar is drawn by macOS, never by the page"),
	dialog: tok("--gz-r-dialog, --gz-shadow-modal, --gz-anim-appear"),
	sheet: tok("--gz-r-dialog, --gz-shadow-modal, --gz-s4-track / --gz-s4-card"),
	toast: tok("--gz-r-menu, --gz-shadow-float"),
	"progress.line": tok("--gz-r-control on [role=progressbar] and its fill"),
	"progress.ring": keep("a ring is the accent's arc in every look: its shape is its meaning (C4)"),
	"progress.export-fill": keep("the Export button's fill is the accent filling the key (exp2's file); the key itself takes --gz-raise-fill"),
	scrollbar: tok("--gz-scroll, --gz-r-control on the thumb"),
	divider: tok("--gz-line / --gz-hairline"),
	"panel.header": tok("--gz-panel-shadow (the bar of «95»), --gz-font-head on headings"),
	"inspector.section-header": keep("section headers are buttons in the body face (no box may change width); their chevron takes the icon voice"),
	"inspector.row": tok("fields and keys of the row: --gz-field, --gz-raise, --gz-font-digits"),
	"inspector.keyframe": keep("the diamond is the accent in every look: a keyframe must read the same everywhere (C4)"),
	"timeline.ruler": keep("the ruler's figures are the secondary text colour of the look; their face stays (no tick may move)"),
	"timeline.track-header": tok("the icon voice (--gz-icon-*) on the track buttons"),
	"clip.video": tok("--gz-clip-video, --gz-clip-r, --gz-clip-label, --gz-font-label"),
	"clip.sound": tok("--gz-clip-audio, --gz-wave"),
	"clip.text": tok("--gz-clip-text"),
	"clip.sticker": tok("--gz-clip-graphic"),
	"clip.effect": tok("--gz-clip-effect"),
	"clip.compound": keep("a compound clip is drawn as a video clip with its layers mark (--gz-clip-video): one body per kind of picture"),
	"timeline.waveform": tok("--gz-wave"),
	"timeline.filmstrip-edge": keep("the film strip is the user's picture: never themed (C1)"),
	"timeline.trim-handle": keep("the trim bar is the accent in every look: a gesture must look the same (tlc's file)"),
	"timeline.playhead": tok("--gz-playhead, --gz-playhead-edge"),
	"timeline.selection": tok("--gz-clip-sel, --gz-clip-sel-edge"),
	"timeline.snap-line": keep("the snap line is the accent in every look: a gesture's answer must read the same"),
	"timeline.marker": keep("markers keep the user's own colours"),
	"timeline.transition-badge": keep("the badge is a small dark chip with a white mark over the clip join in every look (legible on any clip colour)"),
	"timeline.insertion-bar": keep("the insertion bar is the accent in every look: a gesture's answer must read the same"),
	"player.bar": tok("--gz-font-digits on the timecode, the icon voice, --gz-raise on its keys"),
	"media.tile.rest": tok("--gz-s2, --gz-line, --gz-r-tile"),
	"media.tile.hover": tok("--accent (the look's raised colour), --gz-dur-land"),
	"media.tile.selected": tok("--ring / --primary: the look's accent ring on the chosen tile, --gz-r-tile"),
	"media.tile.downloading": keep("a tile's progress is the accent's line in every look (C4)"),
	"media.tile.failed": keep("failed = the look's red (--destructive) mark in every look (C4)"),
	"home.tile": tok("--gz-s1 / --gz-s2, --gz-line-float, --gz-r-tile"),
	"settings.tabs": tok("--gz-s4-track, --gz-sink on the chosen tab, --gz-s4-card cards with --gz-r-tile"),
	"export.window": tok("a sheet: --gz-r-dialog, --gz-shadow-modal, its fields and keys"),
	"lipsync.panel": tok("made of the same panels, fields, keys and menus (studio's file is not touched)"),
	"activity.chip": tok("a quiet key in the header: --gz-raise on hover, the icon voice"),
	"activity.list": tok("a popover: --gz-r-menu, --gz-shadow-float, --gz-anim-appear"),
	"empty-state": keep("an empty state is a line of text and one icon in the body face: the icon takes the icon voice"),
	"drag-ghost": tok("the top-surface tokens (--gz-s3, --gz-line-float, --gz-shadow-float, --gz-r-menu): the ghost reads them"),
	"focus-ring": tok("--ring, --gz-ring-w, --gz-ring-off, --gz-ring-style, --gz-ring-filter"),
	"text-selection": tok("--gz-select-bg, --gz-select-fg"),
	caret: tok("--gz-caret, --gz-caret-shape"),
};

export interface Skin {
	/** one line: the look's motion character (DESIGN §8a.9) */
	motionNote: string;
	geometry: {
		/** radii, px: panels, sheets, menus, controls (buttons, fields, keys), tiles */
		panel: number;
		dialog: number;
		menu: number;
		control: number;
		tile: number;
		/** a control's edge, drawn as box-shadow layers (never a border width: nothing moves) */
		raise: string;
		/** a pressed control, a chosen key, a field (sunk) */
		sink: string;
		field: string;
		/** the filled (accent) button */
		raiseFill: string;
		/** a panel's own edge and shadow, and its bar (a thin header stripe, or none) */
		panelShadow: string;
		/** floating things and sheets: always a shadow (S4) */
		floatShadow: string;
		modalShadow: string;
		/** the keyboard focus ring: width, offset, style, and a filter around it (a glow) or none */
		ring: { width: number; offset: number; style: "solid" | "dotted" | "dashed"; filter: string };
		/** a knob's corner: a slider's thumb, a switch's track and thumb (a CSS length; 50% = round) */
		knob: string;
	};
	type: {
		/** CSS font stacks — only faces on every Mac or bundled with the app */
		head: string;
		digits: string;
		label: string;
		headWeight: number;
		headTracking: string;
		headCase: "none" | "uppercase";
		/** font-variant-numeric of digits */
		numeric: string;
		/** -webkit-font-smoothing of headings, digits and labels */
		smoothing: "antialiased" | "none" | "auto";
		/** optional: menu rows and tooltips in the look's face (boxes that size to their text); default the system's */
		body?: string;
		/** optional: font-stretch of headings (a condensed face where the system has one); default normal */
		headStretch?: string;
	};
	icon: {
		/** --gz-icon-stroke (the icon wrapper reads it), its caps, joins, rendering */
		stroke: number;
		cap: "round" | "square" | "butt";
		join: "round" | "miter" | "bevel";
		rendering: "auto" | "crispEdges" | "geometricPrecision";
		/** a filter on an ACTIVE icon only (pressed, chosen): a glow or none — never at rest */
		active: string;
	};
	motion: {
		/** ms: a menu / popover / sheet arrives; a press answers; a thing lands (hover, state changes, tiles) */
		appear: number;
		press: number;
		land: number;
		ease: string;
		appearEase: string;
		appearKind: AppearKind;
		/** the transform of a pressed control (a key going in) */
		pressShift: string;
	};
	cursor: {
		/** CSS cursor keywords only */
		action: string;
		text: string;
		caret: string;
		caretShape: "auto" | "block" | "bar" | "underscore";
		/** the text selection colour and its text */
		selectBg: string;
		selectFg: string;
	};
	clip: {
		radius: number;
		video: string;
		text: string;
		audio: string;
		graphic: string;
		effect: string;
		/** the clip's name */
		label: string;
		/** the selection: the inner ring (against the clip) and its outer edge (against the track) */
		sel: string;
		selEdge: string;
		/** the playhead: its core and its 1 px edge (so it reads on every clip and on the track) */
		playhead: string;
		playheadEdge: string;
		/** the waveform's bars */
		wave: string;
		/** the selection's bright ring width in px (default 2) — drawn inside the clip, over the film strip, between two
		 *  edges in `selEdge`, and outside the clip as the `selEdge` line (so it reads on every picture and colour) */
		selWidth?: number;
		/** the selected clip's name bar takes the look's selection tint (T4: selected = accent tint + hairline) */
		selBar?: string;
	};
	texture: {
		/** CSS images drawn in code: the frame (L0) and the panels (L1); never in the timeline or the player */
		room: string;
		panel: string;
	};
	/** the completeness checklist: every kind in LOOK_KINDS decided (see the header) */
	decided: Partial<Record<LookKind, Decision>>;
	// ── optional parts (looksfix, 14.11): a look that leaves one out draws that thing as the default look does.
	/** the filled key (`bg-primary`): its fill and label at rest, under the pointer and pressed; the label is floored to
	 *  4.5 : 1 on its fill in every state (engine checks + the contrast sweep). Default: the accent fill, `--gz-on-fill`. */
	keys?: { bg: string; fg: string; bgHover: string; fgHover: string; bgPress: string; fgPress: string; shadowHover?: string; shadowPress?: string; hoverFilter?: string };
	/** the slider's thumb (a SPAN[role=slider]): fill, edges as box-shadow layers, an optional clip-path (a chamfer) */
	thumb?: { bg: string; shadow: string; clip?: string };
	/** tooltips: fill, text, edge + shadow (box-shadow layers) */
	tip?: { bg: string; fg: string; shadow: string };
	/** a menu / list row under the pointer (or chosen by the keyboard) */
	rowHover?: { bg: string; fg: string };
	/** dialog and panel title rows: a band with the title in it ("transparent" / "inherit" = none) */
	titlebar?: { bg: string; fg: string; inset?: number };
	/** the keyboard focus ring's colour (default: the engine's --ring) */
	ringColor?: string;
	/** a chamfer: a clip-path for keys, menus, dialogs, tooltips and the chosen tab (never in the timeline) */
	chamfer?: string;
	/** the scrollbar thumb and track (CSS colours or images) */
	scroll?: { thumb: string; track: string };
	/** a mark on the corners of menus and dialogs (a CSS image: a lit chamfer…); default none */
	corner?: string;
	/** Home's own frame texture (default: the room's); Home has nothing else to look at, so a look may set it fainter */
	homeTexture?: string;
	/** the frame of a project tile on Home and of a Media tile (box-shadow layers; the picture itself untouched) */
	tileFrame?: string;
	/** the editor header's own edge (box-shadow layers: a rule under it…); default none */
	headerShadow?: string;
	/** progress fills in the look's shape: a CSS image over the fill (blocks, a phosphor bar…); default none */
	progress?: string;
	/** checkbox / radio when on: the well and its mark */
	check?: { bg: string; mark: string };
}

/** The kinds a look has not decided (the target is none). */
export const undecided = (s: Skin): LookKind[] => LOOK_KINDS.filter((k) => !s.decided[k]);

/** The motion budget (DESIGN §8a.9). */
export const MOTION_MAX_MS = 320;
/** «a press still answers within one frame»: the press transition starts at once and is short */
export const PRESS_MAX_MS = 80;
/** C3: texture contrast ≤ 3 % */
export const TEXTURE_MAX_ALPHA = 0.03;

const KEYFRAMES: Record<AppearKind, string> = { none: "none", pop: "gz-pop", scan: "gz-scan", step: "gz-step", glow: "gz-glow" };

/** The CSS variables of a skin: the whole contract, by name. */
export function skinVars(s: Skin): Record<string, string> {
	const g = s.geometry;
	const px = (n: number) => `${n}px`;
	const ms = (n: number) => `${Math.max(1, Math.round(n))}ms`; // 1 ms, never 0: transitionend still fires
	return {
		// geometry
		"--gz-r-panel": px(g.panel),
		"--gz-r-dialog": px(g.dialog),
		"--gz-r-menu": px(g.menu),
		"--gz-r-control": px(g.control),
		"--gz-r-tile": px(g.tile),
		"--gz-raise": g.raise,
		"--gz-sink": g.sink,
		"--gz-field": g.field,
		"--gz-raise-fill": g.raiseFill,
		"--gz-panel-shadow": g.panelShadow,
		"--gz-shadow-float": g.floatShadow,
		"--gz-shadow-modal": g.modalShadow,
		"--gz-ring-w": px(g.ring.width),
		"--gz-ring-off": px(g.ring.offset),
		"--gz-ring-style": g.ring.style,
		"--gz-ring-filter": g.ring.filter,
		"--gz-r-knob": g.knob,
		// type
		"--gz-font-head": s.type.head,
		"--gz-font-digits": s.type.digits,
		"--gz-font-label": s.type.label,
		"--gz-head-weight": String(s.type.headWeight),
		"--gz-head-tracking": s.type.headTracking,
		"--gz-head-case": s.type.headCase,
		"--gz-numeric": s.type.numeric,
		"--gz-smoothing": s.type.smoothing,
		// icons
		"--gz-icon-stroke": String(s.icon.stroke),
		"--gz-icon-cap": s.icon.cap,
		"--gz-icon-join": s.icon.join,
		"--gz-icon-render": s.icon.rendering,
		"--gz-icon-active": s.icon.active,
		// motion
		"--gz-dur-appear": ms(s.motion.appear),
		"--gz-dur-press": ms(s.motion.press),
		"--gz-dur-land": ms(s.motion.land),
		"--gz-ease": s.motion.ease,
		"--gz-ease-appear": s.motion.appearEase,
		"--gz-anim-appear": KEYFRAMES[s.motion.appearKind],
		"--gz-press-shift": s.motion.pressShift,
		// cursor
		"--gz-cursor-action": s.cursor.action,
		"--gz-cursor-text": s.cursor.text,
		"--gz-caret": s.cursor.caret,
		"--gz-caret-shape": s.cursor.caretShape,
		"--gz-select-bg": s.cursor.selectBg,
		"--gz-select-fg": s.cursor.selectFg,
		// the clip skin
		"--gz-clip-r": px(s.clip.radius),
		"--gz-clip-video": s.clip.video,
		"--gz-clip-text": s.clip.text,
		"--gz-clip-audio": s.clip.audio,
		"--gz-clip-graphic": s.clip.graphic,
		"--gz-clip-effect": s.clip.effect,
		"--gz-clip-label": s.clip.label,
		"--gz-clip-sel": s.clip.sel,
		"--gz-clip-sel-edge": s.clip.selEdge,
		"--gz-playhead": s.clip.playhead,
		"--gz-playhead-edge": s.clip.playheadEdge,
		"--gz-wave": s.clip.wave,
		"--gz-clip-sel-w": px(s.clip.selWidth ?? 2),
		"--gz-clip-sel-bar": s.clip.selBar ?? "transparent",
		// textures (the engine also puts them into --gz-room-image / --gz-panel-sheen, which the existing rules draw)
		"--gz-tex-room": s.texture.room,
		"--gz-tex-panel": s.texture.panel,
		// the optional parts (defaults = the default look's drawing, so a look that leaves them out is unchanged)
		"--gz-fill-bg": s.keys?.bg ?? "var(--gz-accent-fill)",
		"--gz-fill-fg": s.keys?.fg ?? "var(--gz-on-fill)",
		"--gz-fill-bg-hover": s.keys?.bgHover ?? "var(--gz-fill-bg)",
		"--gz-fill-fg-hover": s.keys?.fgHover ?? "var(--gz-fill-fg)",
		"--gz-fill-bg-press": s.keys?.bgPress ?? "var(--gz-fill-bg)",
		"--gz-fill-fg-press": s.keys?.fgPress ?? "var(--gz-fill-fg)",
		"--gz-fill-shadow-hover": s.keys?.shadowHover ?? "var(--gz-raise-fill)",
		"--gz-fill-shadow-press": s.keys?.shadowPress ?? "var(--gz-raise-fill)",
		"--gz-fill-hover-filter": s.keys?.hoverFilter ?? "brightness(1.08)",
		"--gz-thumb-bg": s.thumb?.bg ?? "#ffffff",
		"--gz-thumb-shadow": s.thumb?.shadow ?? "0 1px 3px rgb(0 0 0 / 0.55), 0 0 0 0.5px rgb(0 0 0 / 0.3)",
		"--gz-thumb-clip": s.thumb?.clip ?? "none",
		"--gz-tip-bg": s.tip?.bg ?? "var(--popover)",
		"--gz-tip-fg": s.tip?.fg ?? "var(--popover-foreground)",
		"--gz-tip-shadow": s.tip?.shadow ?? "var(--gz-shadow-float)",
		"--gz-row-hover-bg": s.rowHover?.bg ?? "var(--accent)",
		"--gz-row-hover-fg": s.rowHover?.fg ?? "var(--accent-foreground)",
		"--gz-titlebar-bg": s.titlebar?.bg ?? "transparent",
		"--gz-titlebar-fg": s.titlebar?.fg ?? "inherit",
		"--gz-titlebar-inset": `${s.titlebar?.inset ?? 0}px`,
		"--gz-ring-color": s.ringColor ?? "var(--ring)",
		"--gz-chamfer": s.chamfer ?? "none",
		"--gz-scroll-thumb": s.scroll?.thumb ?? "var(--gz-scroll)",
		"--gz-scroll-track": s.scroll?.track ?? "transparent",
		"--gz-check-bg": s.check?.bg ?? "var(--gz-accent-fill)",
		"--gz-check-mark": s.check?.mark ?? "var(--gz-on-fill)",
		"--gz-font-body": s.type.body ?? "inherit",
		"--gz-head-stretch": s.type.headStretch ?? "normal",
		"--gz-corner": s.corner ?? "none",
		"--gz-tex-home": s.homeTexture ?? "var(--gz-room-image)",
		"--gz-tile-frame": s.tileFrame ?? "var(--tw-inset-shadow, 0 0 #0000), var(--tw-inset-ring-shadow, 0 0 #0000), var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow, 0 0 #0000)",
		"--gz-header-shadow": s.headerShadow ?? "none",
		"--gz-progress-image": s.progress ?? "none",
	};
}

/** Every token name of the contract (the leak test reads exactly these). */
export const SKIN_TOKENS = Object.keys(
	skinVars({
		motionNote: "",
		geometry: { panel: 0, dialog: 0, menu: 0, control: 0, tile: 0, raise: "", sink: "", field: "", raiseFill: "", panelShadow: "", floatShadow: "", modalShadow: "", ring: { width: 0, offset: 0, style: "solid", filter: "" }, knob: "" },
		type: { head: "", digits: "", label: "", headWeight: 0, headTracking: "", headCase: "none", numeric: "", smoothing: "auto" },
		icon: { stroke: 0, cap: "round", join: "round", rendering: "auto", active: "" },
		motion: { appear: 0, press: 0, land: 0, ease: "", appearEase: "", appearKind: "none", pressShift: "" },
		cursor: { action: "", text: "", caret: "", caretShape: "auto", selectBg: "", selectFg: "" },
		clip: { radius: 0, video: "", text: "", audio: "", graphic: "", effect: "", label: "", sel: "", selEdge: "", playhead: "", playheadEdge: "", wave: "" },
		texture: { room: "", panel: "" },
		decided: {},
	}),
);

export interface Guard {
	what: string;
	ok: boolean;
	value: number;
	min?: number;
	max?: number;
}

/** The colours and alphas inside a CSS image text (rgb(r g b / a), #hex). */
function textureLayers(css: string): Array<{ hex: string; a: number }> {
	const out: Array<{ hex: string; a: number }> = [];
	for (const m of css.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+))?\)/g)) {
		const hex = `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("")}`;
		out.push({ hex, a: m[4] === undefined ? 1 : Number(m[4]) });
	}
	for (const m of css.matchAll(/#([0-9a-f]{6})\b/gi)) out.push({ hex: `#${m[1]}`, a: 1 });
	return out;
}

/**
 * The «does not distract from editing» guards of a skin on its resolved palette: the numbers task 2 asks for.
 * `room`, `panel`, `timeline`: the look's surfaces; `fg`, `fgMuted`: its text (as the engine made them).
 */
export function skinGuards(s: Skin, p: { room: string; panel: string; timeline: string; fg: string; fgMuted: string }): Guard[] {
	const out: Guard[] = [];
	const atLeast = (what: string, value: number, min: number) => out.push({ what, ok: value + 1e-9 >= min, value: Math.round(value * 100) / 100, min });
	const atMost = (what: string, value: number, max: number) => out.push({ what, ok: value <= max + 1e-9, value: Math.round(value * 1000) / 1000, max });
	const clips: Array<[string, string]> = [
		["video", s.clip.video],
		["text", s.clip.text],
		["audio", s.clip.audio],
		["graphic", s.clip.graphic],
		["effect", s.clip.effect],
	];
	for (const [k, c] of clips) {
		atLeast(`clip label on the ${k} clip`, contrast(s.clip.label, c), 4.5);
		// the selection's inner ring lies on the clip; its outer edge on the track (or the next clip: then the inner ring)
		// the bright ring lies between two edges in selEdge (inside the clip too): the pair holds 3 : 1 on any clip
		atLeast(`selection ring against the ${k} clip`, Math.max(contrast(s.clip.sel, c), contrast(s.clip.selEdge, c)), 3);
		atLeast(`playhead against the ${k} clip`, Math.max(contrast(s.clip.playhead, c), contrast(s.clip.playheadEdge, c)), 3);
	}
	atLeast("selected text on its selection colour", contrast(s.cursor.selectFg, s.cursor.selectBg), 4.5);
	atLeast("waveform on the audio clip", contrast(s.clip.wave, s.clip.audio), 3);
	atLeast("selection edge against the track", Math.max(contrast(s.clip.selEdge, p.timeline), contrast(s.clip.sel, p.timeline)), 3);
	atLeast("playhead against the track", Math.max(contrast(s.clip.playhead, p.timeline), contrast(s.clip.playheadEdge, p.timeline)), 3);
	atLeast("selection: its two rings apart", contrast(s.clip.sel, s.clip.selEdge), 3);
	atLeast("selection: the bright ring's width (px)", s.clip.selWidth ?? 2, 2);
	if (s.clip.selBar && s.clip.selBar !== "transparent") atLeast("clip label on the selected name bar", contrast(s.clip.label, s.clip.selBar), 4.5);
	// the filled key: its label on its fill in every state (a transparent fill is judged on the panel)
	if (s.keys) {
		const on = (bg: string) => (/^#/.test(bg) ? bg : p.panel);
		for (const [st, fg, bg] of [["rest", s.keys.fg, s.keys.bg], ["hover", s.keys.fgHover, s.keys.bgHover], ["pressed", s.keys.fgPress, s.keys.bgPress]] as const)
			if (/^#/.test(fg)) atLeast(`filled key label, ${st}`, contrast(fg, on(bg)), 4.5);
	}
	if (s.tip && /^#/.test(s.tip.fg) && /^#/.test(s.tip.bg)) atLeast("tooltip text on its fill", contrast(s.tip.fg, s.tip.bg), 4.5);
	if (s.rowHover && /^#/.test(s.rowHover.fg) && /^#/.test(s.rowHover.bg)) atLeast("menu row under the pointer: text on its fill", contrast(s.rowHover.fg, s.rowHover.bg), 4.5);
	if (s.titlebar && /^#/.test(s.titlebar.fg) && /^#/.test(s.titlebar.bg)) atLeast("title bar: title on its band", contrast(s.titlebar.fg, s.titlebar.bg), 4.5);
	// motion
	atMost("appear (ms)", s.motion.appear, MOTION_MAX_MS);
	atMost("land (ms)", s.motion.land, MOTION_MAX_MS);
	atMost("press (ms)", s.motion.press, PRESS_MAX_MS);
	// textures: each layer at most 3 %, and text keeps its floor over the darkest and the lightest point of it
	for (const [where, css, base] of [
		["room", s.texture.room, p.room],
		["panel", s.texture.panel, p.panel],
	] as const) {
		if (!css || css === "none") continue;
		const layers = textureLayers(css);
		atMost(`${where} texture: strongest layer (alpha)`, Math.max(0, ...layers.map((l) => l.a)), TEXTURE_MAX_ALPHA);
		for (const l of layers) {
			const seen = over(l.hex, l.a, base);
			atLeast(`text over the ${where} texture (${l.hex})`, contrast(p.fg, seen), 7);
			atLeast(`secondary text over the ${where} texture (${l.hex})`, contrast(p.fgMuted, seen), 4.5);
		}
	}
	// the texture never in the timeline or the player: those keep `background-image: none` in themes.css (asserted on screen)
	return out;
}
