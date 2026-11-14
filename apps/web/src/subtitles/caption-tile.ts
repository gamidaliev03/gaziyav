// A caption style's tile: the style on a caption that speaks a short sample (word timings every 0.45 s), shared by the
// Templates gallery and the maker of the tiles' still pictures (text/components/preset-thumb.tsx).
import type { TextElement } from "@/timeline";
import { buildTextElement } from "@/timeline/element-utils";
import { DEFAULTS } from "@/timeline/defaults";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";
import type { CaptionStyle } from "./styles";

// The sample in the interface language (Russian shows each font's Cyrillic); «fire» / «огонь» shows the emoji accents.
const SAMPLE = { ru: ["Это", "просто", "огонь"], en: ["This", "is", "fire"] } as const;
export const CAPTION_SAMPLE_SECONDS = 1.8;

export function captionTileElement(style: CaptionStyle, lang: string): TextElement {
	const words = SAMPLE[lang === "ru" ? "ru" : "en"];
	const one = style.limits.maxWords === 1;
	const built = buildTextElement({
		raw: {
			...DEFAULTS.text.element,
			name: style.name,
			duration: mediaTime({ ticks: Math.round(CAPTION_SAMPLE_SECONDS * TICKS_PER_SECOND) }),
			params: { ...DEFAULTS.text.element.params, ...style.params, content: one ? words[2] : words.join(" "), "caption.words": one ? "0" : "0 0.45 0.9", "transform.positionY": 0 },
		},
		startTime: mediaTime({ ticks: 0 }),
	});
	return { ...built, id: `caption:${style.id}` } as TextElement;
}

/** The moment the still shows: the last word spoken and settled. */
export const captionStill = (style: CaptionStyle) => (style.limits.maxWords === 1 ? 0.5 : 1.12);
