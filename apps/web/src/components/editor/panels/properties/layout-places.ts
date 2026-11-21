// Where each inspector section goes (./layout.ts) — kept free of the editor's modules (type imports only) so the
// table is cheap to read and to test.
//
// THE INSPECTOR HAS TABS BY SPHERE (the owner, 14.11: «раздел по вкладкам в инспекторе был намного лучше, а то тут один
// список и не понятно где что… чтоб по тематике и типу эффекта было всё понятно, где что лежит, по сферам»). The one
// long list of 12.11 is gone; so are the ten icon tabs before it. A few NAMED tabs, the same for every kind of clip
// (a clip shows only the ones it has something in):
//
//   main     «Video» / «Photo» / «Text» / «Shape» / «Audio»… — the clip itself: its words or shape, where it sits,
//            how see-through, its shadow, its canvas
//   audio    «Audio»   — a picture clip's sound: level, pan, clean-up, voice, sound effects, voice tools
//   speed    «Speed»   — speed, curve, freeze, reverse
//   color    «Color»   — the filter on the clip, the colour correction, auto colour, colour match
//   effects  «Effects» — the effects on the clip, its animation, masks, cut-outs, tracking and follow
//   tools    «AI»      — the neural tools and repairs: lipsync, face swap, upscale, enhance, denoise, retouch,
//                        stabilize, deflicker, make vertical
//
// In every tab ONE section lies open (the first: Transform, Volume, Speed, Colour, the effects); the rest are rows
// that open on a click, and what the user opened stays open (inspector-ui.tsx keeps it).
import type { ElementKind } from "./registry";

export type BlockId = "main" | "audio" | "speed" | "color" | "effects" | "tools";

/** The tabs, in the order they stand. */
export const BLOCK_ORDER: readonly BlockId[] = ["main", "audio", "speed", "color", "effects", "tools"];

export type Place = { block: BlockId; rank: number; folded?: boolean };

/**
 * Sections whose tool runs on the Mac app's own models and helpers (on-device AI, the motion and voice helpers). The
 * browser edition has no place to run them yet, so its inspector does not list them — no dead ends there; each comes
 * back the day it works in a page (lipsync, chroma key, masks, colour, effects, sound level and effects already do).
 */
const NEEDS_THE_APP: ReadonlySet<string> = new Set([
	"adjust.autoColor",
	"adjust.colorMatch",
	"cutout.remove",
	"motion.tracker",
	"text.tracking",
	"motion.follow",
	"motion.make-vertical",
	"audio.enhanceVoice",
	// the clean-up and the effects of a clip's sound are rendered by the app (/api/audio/fx): in a page they answered
	// «This works in the Gaziyav app for Mac.» (the sweep of 15.11)
	"audio.cleanup",
	"audio.effects",
	"audio.voiceChanger",
	"audio.separate",
	"audio.parts",
	"text.tts",
	"faceswap",
	"ai.upscale",
	"fix.enhance",
	"fix.denoise",
	"cleanup",
	"retouch.face",
	"stabilize",
	"video.deflicker",
]);

/** Whether the browser edition's inspector shows this section. */
export const worksInABrowser = (sectionId: string): boolean => !NEEDS_THE_APP.has(sectionId.replace(/@[a-z]+$/, ""));

/** Where a section goes in the inspector of a clip of this kind. */
export function placeOf(sectionId: string, kind: ElementKind): Place {
	// a sound section is registered twice (an audio clip's own, a video's sound): one place for both
	const id = sectionId.replace(/@[a-z]+$/, "");
	// a sound clip's sound IS the clip: its first tab; a picture clip's sound has the «Audio» tab
	const sound: BlockId = kind === "audio" ? "main" : "audio";
	switch (id) {
		// ---- the clip itself: its words, its shape, its template, its effect; then where it sits
		case "subtitles.captions":
			return { block: "main", rank: 10 };
		case "text.content":
			return { block: "main", rank: 20 };
		case "text.design":
			return { block: "main", rank: 30 };
		case "text.style":
			return { block: "main", rank: 40 };
		case "text.highlight":
			return { block: "main", rank: 50, folded: true };
		case "captions.template":
			return { block: "main", rank: 60, folded: true };
		case "text.bubble":
			return { block: "main", rank: 70, folded: true };
		case "text.wordart":
			return { block: "main", rank: 80, folded: true };
		case "graphic":
		case "ai.fields":
		case "effect":
			return { block: "main", rank: 10 };
		case "layer.transition":
			return { block: "main", rank: 20 };
		case "transform":
			// a text's or a shape's own words and look come first and lie open; its place is a row under them
			return kind === "text" || kind === "shape" || kind === "ai" || kind === "effect" ? { block: "main", rank: 100, folded: true } : { block: "main", rank: 100 };
		case "opacity":
			return { block: "main", rank: 110, folded: true };
		case "shadow":
			return { block: "main", rank: 150, folded: true };
		case "canvas":
			return { block: "main", rank: 160, folded: true };

		// ---- speed
		case "speed":
			return { block: "speed", rank: 100 };

		// ---- colour: the correction (with the clip's filter on top), then the two colour tools
		case "adjust.color":
			return { block: "color", rank: 100 };
		case "adjust.autoColor":
			return { block: "color", rank: 200, folded: true };
		case "adjust.colorMatch":
			return { block: "color", rank: 210, folded: true };

		// ---- effects: what is on the clip, how it moves, what part of it shows
		case "effects":
			return { block: "effects", rank: 100 };
		case "text.animation":
			return { block: "effects", rank: 110 };
		case "clip.animation":
			// an AI plate's In / Out lie open where a built-in plate's (a text's) do
			return kind === "ai" ? { block: "effects", rank: 110 } : { block: "effects", rank: 120, folded: true };
		case "masks":
			return { block: "effects", rank: 200, folded: true };
		case "cutout.remove":
			return { block: "effects", rank: 210, folded: true };
		case "cutout.chroma":
			return { block: "effects", rank: 220, folded: true };
		case "motion.tracker":
			return { block: "effects", rank: 300, folded: true };
		case "text.tracking":
			return { block: "effects", rank: 305, folded: true };
		case "motion.follow":
			return { block: "effects", rank: 310, folded: true };

		// ---- the sound: level, pan, clean-up, voice, its effects, then the voice tools
		case "audio.volume":
			return { block: sound, rank: 200 };
		case "audio.pan":
			return { block: sound, rank: 210, folded: true };
		case "audio.cleanup":
			return { block: sound, rank: 220, folded: true };
		case "audio.enhanceVoice":
			return { block: sound, rank: 225, folded: true };
		case "audio.effects":
			return { block: sound, rank: 230 };
		case "audio.voiceChanger":
			return { block: sound, rank: 300, folded: true };
		case "audio.separate":
			return { block: sound, rank: 310, folded: true };
		case "audio.parts":
			return { block: sound, rank: 320, folded: true };
		case "text.tts":
			return { block: "tools", rank: 630, folded: true };

		// ---- AI and repairs. Lipsync is an AI TOOL: first of them, never above Transform and the other basics (the
		// clip's menu and ⌘K, which open this tab on its section.
		case "studio.lipsync":
			return { block: "tools", rank: 600, folded: true };
		case "faceswap":
			return { block: "tools", rank: 610, folded: true };
		case "ai.upscale":
			return { block: "tools", rank: 620, folded: true };
		case "fix.enhance":
			return { block: "tools", rank: 700, folded: true };
		case "fix.denoise":
			return { block: "tools", rank: 710, folded: true };
		case "cleanup":
			return { block: "tools", rank: 720, folded: true };
		case "retouch.face":
			return { block: "tools", rank: 730, folded: true };
		case "stabilize":
			return { block: "tools", rank: 800, folded: true };
		case "video.deflicker":
			return { block: "tools", rank: 810, folded: true };
		case "motion.make-vertical":
			return { block: "tools", rank: 820, folded: true };
		default:
			// a plug-in this table does not know yet: among the tools, so it is never lost
			return { block: "tools", rank: 900, folded: true };
	}
}
