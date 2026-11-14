// Where each inspector section goes in the one list (./layout.ts) — kept free of the editor's modules (type imports
// only) so the table is cheap to read and to test.
import type { ElementKind } from "./registry";

export type BlockId = "main" | "audio" | "tools";

export type Place = { block: BlockId; rank: number; folded?: boolean };

/** Where a section goes in the list of a clip of this kind. */
export function placeOf(sectionId: string, kind: ElementKind): Place {
	// a sound section is registered twice (an audio clip's own, a video's sound): one place for both
	const id = sectionId.replace(/@[a-z]+$/, "");
	const sound: BlockId = kind === "audio" ? "main" : "audio";
	const picture = kind === "video" || kind === "image" || kind === "sticker";
	switch (id) {
		// the clip itself: its words, its shape, its template, its effect
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
		case "graphic":
		case "ai.fields":
		case "effect":
			return { block: "main", rank: 10 };
		case "layer.transition":
			return { block: "main", rank: 20 };
		case "text.animation":
			return { block: "main", rank: 60 };
		// Premiere's Motion and Opacity, Time Remapping, Lumetri, then the effects in their order
		case "transform":
			return { block: "main", rank: 100 };
		case "opacity":
			return { block: "main", rank: 110 };
		case "speed":
			return kind === "audio" ? { block: "main", rank: 260, folded: true } : { block: "main", rank: 120 };
		case "adjust.color":
			return picture ? { block: "main", rank: 130 } : { block: "tools", rank: 700 };
		case "effects":
			return { block: "main", rank: 140 };
		case "shadow":
			return { block: "main", rank: 150, folded: true };
		case "canvas":
			return { block: "main", rank: 160, folded: true };
		// the sound: level, pan, clean-up, then its effects
		case "audio.volume":
			return { block: sound, rank: 200 };
		case "audio.pan":
			return { block: sound, rank: 210 };
		case "audio.cleanup":
			return { block: sound, rank: 220 };
		case "audio.enhanceVoice":
			return { block: sound, rank: 225, folded: true };
		case "audio.effects":
			return { block: sound, rank: 230 };
		// the tools, by subject: what part shows, how it moves, repairs, colour tools, AI, sound tools
		case "cutout.remove":
			return { block: "tools", rank: 400 };
		case "cutout.chroma":
			return { block: "tools", rank: 410 };
		case "masks":
			return { block: "tools", rank: 420 };
		case "captions.template":
			return { block: "tools", rank: 430 };
		case "text.bubble":
			return { block: "tools", rank: 440 };
		case "text.wordart":
			return { block: "tools", rank: 450 };
		case "clip.animation":
			return { block: "tools", rank: 460 };
		case "motion.tracker":
			return { block: "tools", rank: 470 };
		case "text.tracking":
			return { block: "tools", rank: 475 };
		case "motion.follow":
			return { block: "tools", rank: 480 };
		case "motion.make-vertical":
			return { block: "tools", rank: 490 };
		case "stabilize":
			return { block: "tools", rank: 500 };
		case "video.deflicker":
			return { block: "tools", rank: 510 };
		case "fix.enhance":
			return { block: "tools", rank: 520 };
		case "fix.denoise":
			return { block: "tools", rank: 530 };
		case "cleanup":
			return { block: "tools", rank: 540 };
		case "retouch.face":
			return { block: "tools", rank: 550 };
		case "adjust.autoColor":
			return { block: "tools", rank: 560 };
		case "adjust.colorMatch":
			return { block: "tools", rank: 570 };
		// Lipsync is an AI TOOL: it lives among the tools, first of the AI ones — never above Transform and the other
		// (⌥L), the clip's menu and ⌘K, which reveal this section; its place in the inspector is not the shortcut.
		case "studio.lipsync":
			return { block: "tools", rank: 600 };
		case "faceswap":
			return { block: "tools", rank: 610 };
		case "ai.upscale":
			return { block: "tools", rank: 620 };
		case "text.tts":
			return { block: "tools", rank: 630 };
		case "audio.separate":
			return { block: "tools", rank: 640 };
		case "audio.parts":
			return { block: "tools", rank: 650 };
		case "audio.voiceChanger":
			return { block: "tools", rank: 660 };
		default:
			// a plug-in this table does not know yet: among the tools, so it is never lost
			return { block: "tools", rank: 900 };
	}
}

