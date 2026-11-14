// The looks of Settings → Appearance (night 11–12.11, the owner: «любой цвет, тему — от стекла ликвид глас или блюрнутого
// матового до строгого»; then «подход как Эппл — минимализм», «МАКСИМАЛЬНАЯ ПРОСТОТА»). Each look is a family of one or two
// palettes (dark, light) on the app's own tokens plus a material; the engine (./engine.ts) turns a palette into CSS
// variables and makes any accent readable on it. «Минимал» is the default; «Как было» is the look before this night
// (the «Ember» skin, src/app/skin.css) — it has no palette here: choosing it simply switches every theme rule off.

/** How surfaces are made: flat (Apple-like), glass (translucent shelves over a lit room), frost (milky glass), flat
 * lines (strict), the Ember depth (solid), or high contrast. */
import { LOOKS_PACK } from "./looks";
import { LOOKS_PACK2 } from "./looks2";
import { LOOKS_PACK_3 } from "./looks3";
import type { Skin } from "./skin";

export type Material = "minimal" | "glass" | "frost" | "strict" | "solid" | "contrast";

export interface Palette {
	/** the window's canvas: behind the panels, the header, Home */
	room: string;
	/** soft light in the room (glass looks): two coloured glows; the room stays `room` under them */
	glow?: [string, string];
	/** the side panels (library, inspector) and any panel's own colour */
	panel: string;
	/** the player: the darkest (or the most neutral) place, the film is the brightest thing on it */
	stage: string;
	/** the timeline panel (always opaque) */
	timeline: string;
	/** hover, tiles, cards inside a panel (`accent`) */
	raised: string;
	/** `muted`: quiet fills, disabled buttons */
	muted: string;
	/** fields, slider tracks, a switch's track */
	well: string;
	/** the chosen segment / tab key (flat when `keyTop` is not given) */
	key: string;
	keyTop?: string;
	/** hairlines */
	border: string;
	/** menus, popovers, dialogs (laid over the window at `floatAlpha`) */
	float: string;
	floatAlpha: number;
	fg: string;
	fgMuted: string;
	destructive: string;
	constructive: string;
	caution: string;
	/** the look's own accent (the user may choose any other) */
	accent: string;
	/** the colour of the light for highlights, as hex */
	lamp: string;
}

export interface Family {
	id: string;
	/** English name; Russian in src/i18n/ru-themes.ts */
	name: string;
	note: string;
	material: Material;
	dark?: Palette;
	light?: Palette;
	/** a look of the pack (WISHES 56): the whole skin beyond colour — geometry, type, icons, motion, clips (./skin.ts) */
	skin?: Skin;
}

export const DEFAULT_FAMILY = "minimal";
/** «Как было»: the look before this night, no theme rules at all. */
export const ORIGINAL_FAMILY = "original";

// Apple's system colours (dark / light, the accessible light variants where Apple has them).
const RED_D = "#ff453a";
const GREEN_D = "#30d158";
const YELLOW_D = "#ffd60a";

export const FAMILIES: Family[] = [
	{
		id: "minimal",
		name: "Minimal look",
		note: "Quiet greys, one accent, no lines",
		material: "minimal",
		dark: {
			room: "#161618",
			panel: "#1f1f22",
			stage: "#0b0b0c",
			timeline: "#1c1c1f",
			raised: "#2a2a2e",
			muted: "#333337",
			well: "#2a2a2e",
			key: "#3d3d42",
			border: "#2c2c30",
			float: "#2a2a2d",
			floatAlpha: 0.94,
			fg: "#f5f5f7",
			fgMuted: "#a1a1a6",
			destructive: RED_D,
			constructive: GREEN_D,
			caution: YELLOW_D,
			accent: "#0a84ff",
			lamp: "#ffffff",
		},
		light: {
			room: "#e8e8ea",
			panel: "#ffffff",
			stage: "#f2f2f4",
			timeline: "#fbfbfc",
			raised: "#f0f0f2",
			muted: "#e3e3e6",
			well: "#ececee",
			key: "#ffffff",
			border: "#e2e2e5",
			float: "#f6f6f7",
			floatAlpha: 0.95,
			fg: "#1d1d1f",
			fgMuted: "#636368",
			destructive: "#d70015",
			constructive: "#1f7a36",
			caution: "#b25000",
			accent: "#007aff",
			lamp: "#ffffff",
		},
	},
	{
		id: "glass",
		name: "Liquid glass",
		note: "Clear glass shelves over soft light",
		material: "glass",
		dark: {
			room: "#0b0d13",
			glow: ["#3a5cff", "#a24bff"],
			panel: "#232633",
			stage: "#07080b",
			timeline: "#171a24",
			raised: "#2c3040",
			muted: "#353a4c",
			well: "#151824",
			key: "#3a3f55",
			keyTop: "#464c66",
			border: "#2c3142",
			float: "#262a38",
			floatAlpha: 0.8,
			fg: "#f4f6fb",
			fgMuted: "#a9afc0",
			destructive: RED_D,
			constructive: GREEN_D,
			caution: YELLOW_D,
			accent: "#0a84ff",
			lamp: "#ffffff",
		},
		light: {
			room: "#e9edf6",
			glow: ["#7aa2ff", "#ff9ccc"],
			panel: "#ffffff",
			stage: "#eef0f5",
			timeline: "#f6f8fc",
			raised: "#eef1f8",
			muted: "#e1e5ef",
			well: "#e7eaf2",
			key: "#ffffff",
			border: "#dde2ec",
			float: "#ffffff",
			floatAlpha: 0.78,
			fg: "#161a22",
			fgMuted: "#565c69",
			destructive: "#d70015",
			constructive: "#1f7a36",
			caution: "#b25000",
			accent: "#007aff",
			lamp: "#ffffff",
		},
	},
	{
		id: "frost",
		name: "Frosted glass",
		note: "Milky glass, soft and calm",
		material: "frost",
		dark: {
			room: "#121418",
			glow: ["#4f8fb0", "#6c6fb8"],
			panel: "#2a2d34",
			stage: "#0a0b0d",
			timeline: "#1d1f24",
			raised: "#33373f",
			muted: "#3b3f48",
			well: "#1b1d22",
			key: "#43474f",
			border: "#30333a",
			float: "#2c2f36",
			floatAlpha: 0.86,
			fg: "#f2f3f5",
			fgMuted: "#a8acb5",
			destructive: RED_D,
			constructive: GREEN_D,
			caution: YELLOW_D,
			accent: "#64d2ff",
			lamp: "#ffffff",
		},
		light: {
			room: "#e6e9ee",
			glow: ["#b4cbe6", "#d9cfe8"],
			panel: "#f7f8fa",
			stage: "#eceef1",
			timeline: "#f4f5f7",
			raised: "#eceef2",
			muted: "#e0e3e8",
			well: "#e9ecf0",
			key: "#ffffff",
			border: "#dadde3",
			float: "#f7f8fa",
			floatAlpha: 0.86,
			fg: "#1a1c20",
			fgMuted: "#5a5e66",
			destructive: "#d70015",
			constructive: "#1f7a36",
			caution: "#b25000",
			accent: "#0071e3",
			lamp: "#ffffff",
		},
	},
	{
		id: "strict",
		name: "Strict",
		note: "Flat and exact, the lightest on the Mac",
		material: "strict",
		dark: {
			room: "#101010",
			panel: "#181818",
			stage: "#0a0a0a",
			timeline: "#161616",
			raised: "#232323",
			muted: "#2c2c2c",
			well: "#121212",
			key: "#2f2f2f",
			border: "#2b2b2b",
			float: "#1c1c1c",
			floatAlpha: 1,
			fg: "#ededed",
			fgMuted: "#a3a3a3",
			destructive: "#f4586f",
			constructive: "#3cc7a8",
			caution: "#f2d24b",
			accent: "#e8a33d",
			lamp: "#ffffff",
		},
		light: {
			room: "#ececec",
			panel: "#fafafa",
			stage: "#f0f0f0",
			timeline: "#f7f7f7",
			raised: "#efefef",
			muted: "#e2e2e2",
			well: "#ffffff",
			key: "#ffffff",
			border: "#d9d9d9",
			float: "#ffffff",
			floatAlpha: 1,
			fg: "#161616",
			fgMuted: "#5c5c5c",
			destructive: "#c8102e",
			constructive: "#1f7a36",
			caution: "#9a5b00",
			accent: "#b8741a",
			lamp: "#ffffff",
		},
	},
	{
		id: "midnight",
		name: "Midnight",
		note: "Deep blue night, cyan light",
		material: "solid",
		dark: {
			room: "#070b16",
			panel: "#0d1424",
			stage: "#050811",
			timeline: "#0b1120",
			raised: "#16203a",
			muted: "#1c2847",
			well: "#080d1a",
			key: "#22305a",
			keyTop: "#2b3c6e",
			border: "#16203a",
			float: "#111a30",
			floatAlpha: 0.96,
			fg: "#e8eeff",
			fgMuted: "#97a6c9",
			destructive: "#ff5c7a",
			constructive: "#3ddbb0",
			caution: "#ffd166",
			accent: "#5ac8fa",
			lamp: "#c8dcff",
		},
	},
	{
		id: "sand",
		name: "Sand",
		note: "Warm paper, terracotta accent",
		material: "solid",
		light: {
			room: "#e9e1d3",
			panel: "#f6f0e6",
			stage: "#e3dacb",
			timeline: "#f3ece1",
			raised: "#ece3d4",
			muted: "#e0d5c3",
			well: "#fffaf2",
			key: "#fffdf8",
			border: "#dccfbb",
			float: "#fbf7f0",
			floatAlpha: 0.97,
			fg: "#2b241b",
			fgMuted: "#625440",
			destructive: "#b42318",
			constructive: "#2f6b3a",
			caution: "#8a5300",
			accent: "#c2410c",
			lamp: "#fffaf0",
		},
	},
	{
		id: "contrast",
		name: "High contrast",
		note: "Black and white, the clearest edges",
		material: "contrast",
		dark: {
			room: "#000000",
			panel: "#000000",
			stage: "#000000",
			timeline: "#000000",
			raised: "#1c1c1c",
			muted: "#262626",
			well: "#000000",
			key: "#333333",
			border: "#8c8c8c",
			float: "#0a0a0a",
			floatAlpha: 1,
			fg: "#ffffff",
			fgMuted: "#d6d6d6",
			destructive: "#ff6b6b",
			constructive: "#4ade80",
			caution: "#ffd60a",
			accent: "#ffd60a",
			lamp: "#ffffff",
		},
		light: {
			room: "#ffffff",
			panel: "#ffffff",
			stage: "#f2f2f2",
			timeline: "#ffffff",
			raised: "#ebebeb",
			muted: "#dedede",
			well: "#ffffff",
			key: "#ffffff",
			border: "#6b6b6b",
			float: "#ffffff",
			floatAlpha: 1,
			fg: "#000000",
			fgMuted: "#2e2e2e",
			destructive: "#b00020",
			constructive: "#006b2d",
			caution: "#7a4300",
			accent: "#0040c8",
			lamp: "#ffffff",
		},
	},
	// the looks pack (WISHES 56): «95», «Терминал», «Пиксель», «Неон» — each a whole skin (./looks.ts)
	...LOOKS_PACK,
	...LOOKS_PACK2,
	// the third piece (looks3): «Арена», «Плёнка», «Аналог» (./looks3.ts)
	...LOOKS_PACK_3,
];

export function familyById(id: string | undefined | null): Family | undefined {
	return FAMILIES.find((f) => f.id === id);
}

/** The accent swatches of the gallery: Apple's system colours, then the old amber. */
export const ACCENT_SWATCHES: Array<{ hex: string; name: string }> = [
	{ hex: "#0a84ff", name: "Blue" },
	{ hex: "#5e5ce6", name: "Indigo" },
	{ hex: "#bf5af2", name: "Purple" },
	{ hex: "#ff375f", name: "Pink" },
	{ hex: "#ff453a", name: "Red" },
	{ hex: "#ff9f0a", name: "Orange" },
	{ hex: "#e8a33d", name: "Amber" },
	{ hex: "#30d158", name: "Green" },
	{ hex: "#64d2ff", name: "Cyan" },
	{ hex: "#98989d", name: "Graphite" },
];
