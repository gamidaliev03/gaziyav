// Effect sets (Effects → Sets): a whole look in one click, as the paid «VHS / camcorder / film» packs — shaders on the
// clip and a graphic over it: a VHS deck's ▶ PLAY with the tape's date, a camcorder's ● REC with battery and timecode,
// a film leader's countdown, a cinema matte or a passe-partout as the frame. Free of React and Remotion: the panel,
// the apply and the tests read it.
import type { Theme } from "@/montage/mograph";
import type { PropValue } from "@/montage/types";

export type SetFamily = "VHS" | "Camcorder" | "Film" | "TV & games" | "Glitch" | "Dreams";

/** A graphic of the set: over the whole clip, or from its start for the graphic's own length (a countdown). */
/** A shader of the set: its id, or the id with the settings that make the set (a pink light leak). */
export type SetEffect = string | { type: string; params: Record<string, string | number | boolean> };
export const setEffectType = (effect: SetEffect): string => (typeof effect === "string" ? effect : effect.type);

export interface SetLayer {
	kind: string;
	at: "whole" | "start";
	params?: Record<string, PropValue>;
}

export interface EffectSet {
	id: string;
	name: string;
	family: SetFamily;
	/** Shaders on the clip, in order, at their defaults unless the set says otherwise. */
	effects: SetEffect[];
	/** Graphics over the clip: the content first, then a frame when there is one. */
	layers: SetLayer[];
	themes: Theme[];
}

export const SET_FAMILIES: SetFamily[] = ["VHS", "Camcorder", "Film", "TV & games", "Glitch", "Dreams"];

const whole = (kind: string, params?: Record<string, PropValue>): SetLayer => ({ kind, at: "whole", params });
const start = (kind: string, params?: Record<string, PropValue>): SetLayer => ({ kind, at: "start", params });

export const EFFECT_SETS: EffectSet[] = [
	// ── VHS: the deck's ▶ PLAY, the tape's date and clock ──
	{ id: "vhs-play", name: "VHS Play", family: "VHS", effects: ["pro.fx.vhsPro"], layers: [whole("MgVhs")], themes: ["music", "fashion", "kids"] },
	{ id: "vhs-home-video", name: "VHS Home Video", family: "VHS", effects: ["pro.fx.camcorder90s"], layers: [whole("MgVhs", { date: "JUL. 14 1996", time: "14:02:31" })], themes: ["kids", "travel", "wedding"] },
	{ id: "vhs-tracking", name: "VHS Tracking", family: "VHS", effects: ["pro.fx.vhsTracking"], layers: [whole("MgVhs", { speed: "LP", date: "MAR. 03 1991" })], themes: ["music", "fashion"] },
	{ id: "vhs-new-year", name: "VHS New Year", family: "VHS", effects: ["studio.vhs"], layers: [whole("MgVhs", { date: "DEC. 31 1999", time: "23:59:50" }), whole("MgSparks")], themes: ["music", "kids", "wedding"] },
	{ id: "vhs-night-tape", name: "VHS Night Tape", family: "VHS", effects: ["pro.fx.nightCam"], layers: [whole("MgVhs", { speed: "EP", date: "NOV. 02 1994", time: "02:13:40" })], themes: ["music", "news"] },
	{ id: "vhs-mixtape", name: "VHS Mixtape", family: "VHS", effects: ["pro.fx.vhsPro", "studio.rgbSplit"], layers: [whole("MgVhs", { date: "MAY 21 1989", time: "19:45:02" })], themes: ["music", "fashion"] },
	{ id: "vhs-clean", name: "VHS Clean Deck", family: "VHS", effects: ["studio.grain"], layers: [whole("MgVhs", { noise: false, date: "AUG. 09 2001" })], themes: ["travel", "fashion"] },
	{ id: "vhs-skate", name: "VHS Skate Tape", family: "VHS", effects: ["pro.fx.camcorder90s", "pro.fx.fisheye"], layers: [whole("MgVhs", { date: "JUN. 30 1997", time: "17:21:09" })], themes: ["sports", "music", "fashion"] },

	// ── Camcorder: ● REC, battery, timecode ──
	{ id: "rec-camcorder", name: "REC Camcorder", family: "Camcorder", effects: ["pro.fx.camcorder90s"], layers: [whole("MgViewfinder")], themes: ["travel", "kids", "music"] },
	{ id: "rec-vlog-4k", name: "REC 4K Vlog", family: "Camcorder", effects: ["studio.handheld"], layers: [whole("MgViewfinder", { info: "4K 60P  ISO 200" })], themes: ["travel", "food", "beauty"] },
	{ id: "rec-low-battery", name: "REC Low Battery", family: "Camcorder", effects: ["studio.vignette"], layers: [whole("MgViewfinder", { battery: 8 })], themes: ["travel", "kids"] },
	{ id: "rec-night-vision", name: "REC Night Vision", family: "Camcorder", effects: ["kadr.effect.nightVision"], layers: [whole("MgViewfinder", { info: "NIGHT  IR ON", accent: "#39FF6A" })], themes: ["gaming", "news", "tech"] },
	{ id: "rec-grid", name: "REC Grid", family: "Camcorder", effects: ["pro.fx.lensDirt"], layers: [whole("MgViewfinder", { grid: true })], themes: ["real-estate", "travel", "education"] },
	{ id: "rec-action-cam", name: "REC Action Cam", family: "Camcorder", effects: ["pro.fx.fisheye"], layers: [whole("MgViewfinder", { info: "2.7K 120FPS  WIDE" })], themes: ["sports", "fitness", "travel"] },
	{ id: "rec-wedding", name: "REC Wedding Day", family: "Camcorder", effects: ["pro.fx.softGlow"], layers: [whole("MgViewfinder", { info: "4K 24P  ISO 100", accent: "#FFFFFF" })], themes: ["wedding", "beauty"] },
	{ id: "rec-found-footage", name: "REC Found Footage", family: "Camcorder", effects: ["pro.fx.vhsTracking", "pro.fx.nightCam"], layers: [whole("MgViewfinder", { info: "SP  CH 2", battery: 23 })], themes: ["gaming", "kids"] },

	// ── Film: grain, scratches, the leader's countdown, the matte ──
	{ id: "film-countdown", name: "Film Countdown", family: "Film", effects: ["pro.fx.film16mm"], layers: [start("MgFilmLeader")], themes: ["wedding", "travel", "music"] },
	{ id: "film-home-movie", name: "Film Home Movie", family: "Film", effects: ["pro.fx.film8mm", "studio.lightLeak"], layers: [start("MgFilmLeader", { from: 5 })], themes: ["kids", "wedding", "travel"] },
	{ id: "film-silent", name: "Film Silent Era", family: "Film", effects: ["kadr.effect.oldFilm"], layers: [start("MgFilmLeader", { from: 9 }), whole("MgFilmMatte", { ratio: "1.33" })], themes: ["education", "news", "music"] },
	{ id: "film-scope", name: "Film Scope", family: "Film", effects: ["pro.fx.halation"], layers: [whole("MgFilmMatte", { ratio: "2.39" })], themes: ["travel", "real-estate", "music"] },
	{ id: "film-gate-weave", name: "Film Gate Weave", family: "Film", effects: ["pro.fx.gateWeave", "studio.grain"], layers: [whole("MgFilmMatte", { ratio: "1.85" })], themes: ["travel", "fashion"] },
	{ id: "film-burned", name: "Film Burned Reel", family: "Film", effects: ["pro.fx.burnedEdges"], layers: [start("MgFilmLeader", { from: 4 })], themes: ["music", "fashion"] },
	{ id: "film-noir", name: "Film Noir", family: "Film", effects: ["kadr.effect.blackWhite", "studio.grain"], layers: [whole("MgFilmMatte", { ratio: "1.85", caption: "THE END?" })], themes: ["fashion", "music", "news"] },
	{ id: "film-super8-summer", name: "Super 8 Summer", family: "Film", effects: ["pro.fx.film8mm"], layers: [whole("MgPassePartout", { caption: "Summer 1979", sub: "Super 8" })], themes: ["travel", "wedding", "food"] },

	// ── TV & games ──
	{ id: "tv-old-set", name: "Old TV 4:3", family: "TV & games", effects: ["pro.fx.crt", "pro.fx.vignetteOval"], layers: [whole("MgFilmMatte", { ratio: "1.33" })], themes: ["news", "education", "kids"] },
	{ id: "tv-breaking", name: "TV Breaking News", family: "TV & games", effects: ["pro.fx.crt"], layers: [whole("MgBreaking")], themes: ["news", "sports", "business"] },
	{ id: "tv-live", name: "TV Live Ticker", family: "TV & games", effects: ["pro.fx.scanTear"], layers: [whole("MgTicker")], themes: ["news", "business", "sports"] },
	{ id: "game-handheld", name: "Game Handheld", family: "TV & games", effects: ["pro.fx.gameboy"], layers: [whole("MgHud", { label: "PLAYER 1" })], themes: ["gaming", "kids", "tech"] },
	{ id: "game-arcade", name: "Game Arcade", family: "TV & games", effects: ["pro.fx.pixelArt"], layers: [whole("MgHud", { label: "HIGH SCORE", accent: "#FFD23F" })], themes: ["gaming", "kids"] },
	{ id: "game-sniper", name: "Game Target Lock", family: "TV & games", effects: ["studio.rgbSplit"], layers: [whole("MgHud")], themes: ["gaming", "sports", "tech"] },

	// ── Glitch ──
	{ id: "glitch-breach", name: "Glitch Breach", family: "Glitch", effects: ["pro.fx.digitalGlitch"], layers: [whole("MgHud", { label: "SYSTEM BREACH", accent: "#00FF9C" })], themes: ["gaming", "tech"] },
	{ id: "glitch-blocks", name: "Glitch Blocks", family: "Glitch", effects: ["pro.fx.blockGlitch"], layers: [whole("MgSpeedLines", { opacity: 0.5 })], themes: ["gaming", "music", "sports"] },
	{ id: "glitch-error", name: "Glitch Error", family: "Glitch", effects: ["pro.fx.dataSmear"], layers: [whole("MgTicker", { label: "ERROR", text: "SIGNAL LOST · RECONNECTING · DATA CORRUPTED · RETRYING", time: "00:00" })], themes: ["tech", "gaming"] },
	{ id: "glitch-no-signal", name: "Glitch No Signal", family: "Glitch", effects: ["pro.fx.signalLoss"], layers: [whole("MgVhs", { label: "NO SIGNAL", date: "", time: "" })], themes: ["tech", "music"] },
	{ id: "glitch-rgb", name: "Glitch RGB", family: "Glitch", effects: ["pro.fx.rgbWave", "studio.rgbSplit"], layers: [whole("MgHud", { label: "GLITCH", accent: "#FF2BD6", color2: "#00E5FF" })], themes: ["music", "fashion", "gaming"] },
	{ id: "glitch-pixel-sort", name: "Glitch Pixel Sort", family: "Glitch", effects: ["pro.fx.pixelSort"], layers: [whole("MgSpeedLines", { opacity: 0.35, amount: 40 })], themes: ["music", "fashion", "tech"] },

	// ── Dreams ──
	{ id: "dream-bokeh", name: "Dream Bokeh", family: "Dreams", effects: ["pro.fx.softGlow"], layers: [whole("MgBokeh")], themes: ["wedding", "beauty", "music"] },
	{ id: "dream-sparkle", name: "Dream Sparkle", family: "Dreams", effects: ["pro.fx.bloom"], layers: [whole("MgSparks")], themes: ["music", "wedding", "fashion"] },
	{ id: "dream-snow", name: "Dream Snow", family: "Dreams", effects: ["pro.fx.fog"], layers: [whole("MgSnow")], themes: ["travel", "kids", "wedding"] },
	{ id: "dream-fairy", name: "Dream Fairy", family: "Dreams", effects: ["pro.fx.prism"], layers: [whole("MgTwinkle")], themes: ["beauty", "kids", "fashion"] },
	{ id: "dream-love", name: "Dream Love", family: "Dreams", effects: [{ type: "studio.lightLeak", params: { color: "#ff4f9a" } }], layers: [whole("MgBokeh", { accent: "#FF8FB1", color2: "#FFD1E0", color3: "#FFB3C7" })], themes: ["wedding", "beauty", "fashion"] },
	{ id: "dream-golden-hour", name: "Dream Golden Hour", family: "Dreams", effects: ["studio.lightLeak", "pro.fx.halation"], layers: [whole("MgBokeh", { accent: "#FFD27A", color2: "#FFB86B", color3: "#FFF1C2" })], themes: ["travel", "wedding", "food"] },
];

export const EFFECT_SET_BY_ID = new Map(EFFECT_SETS.map((set) => [set.id, set]));

/** Each graphic's place on a clip of `clipSeconds` (in seconds from the clip's start): over all of it, or the
 * graphic's own length from its start (never past the clip's end). */
export function placeSetLayers({
	set,
	clipSeconds,
	graphicSeconds,
}: {
	set: EffectSet;
	clipSeconds: number;
	graphicSeconds: (kind: string) => number;
}): Array<{ layer: SetLayer; from: number; seconds: number }> {
	return set.layers.map((layer) => ({
		layer,
		from: 0,
		seconds: layer.at === "whole" ? clipSeconds : Math.min(clipSeconds, graphicSeconds(layer.kind)),
	}));
}
