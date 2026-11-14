// What a template's card draws, worked out once per template (the templates are static): the text layers' words,
// spots and CSS, whether it has motion graphics, its length. Free of React: the card and the tests read it.
import type { CSSProperties } from "react";
import { TEXT_PRESETS } from "@/text/presets";
import { textParamsToCss } from "@/text/preview-css";
import { type Template, templateSeconds } from "./catalog";

/** Where each text part sits on the cover: first near the top, the last near the bottom (as on the video). */
const COVER_SPOTS = ["18%", "52%", "80%"];
export const presetSeconds = (id: string) => TEXT_PRESETS.find((p) => p.id === id)?.duration ?? 3;

function plateParams(preset: (typeof TEXT_PRESETS)[number]) {
	if (!preset.plate) return {};
	return {
		"background.enabled": true,
		"background.color": preset.plate.color,
		"background.paddingX": preset.plate.padX * 320,
		"background.paddingY": preset.plate.padY * 320,
		"background.cornerRadius": preset.plate.radius,
	};
}

/** A text layer on the cover, worked out once per template (the templates are static): its words, spot and CSS. */
interface CoverText {
	key: string;
	content: string;
	top: string;
	style: CSSProperties;
}
interface CoverData {
	texts: CoverText[];
	motion: boolean;
	seconds: number;
}
const COVER_DATA = new Map<string, CoverData>();
/** What a card draws, worked out once (53 cards mount together: nothing to look up or build on each render). */
export function coverData(template: Template): CoverData {
	let data = COVER_DATA.get(template.id);
	if (data) return data;
	const texts = template.parts.flatMap((p, index) => {
		const preset = "text" in p ? TEXT_PRESETS.find((x) => x.id === p.text) : undefined;
		if (!preset || !("text" in p)) return [];
		return [
			{
				key: `${preset.id}-${index}`,
				content: p.content ?? preset.content,
				top: COVER_SPOTS[Math.min(index, COVER_SPOTS.length - 1)],
				style: { ...textParamsToCss({ params: { ...preset.params, ...plateParams(preset) }, px: 9 }), display: "inline-block" } as CSSProperties,
			},
		];
	});
	data = { texts, motion: template.parts.some((p) => "mg" in p), seconds: Math.round(templateSeconds(template, presetSeconds)) };
	COVER_DATA.set(template.id, data);
	return data;
}

