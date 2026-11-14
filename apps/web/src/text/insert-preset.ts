import type { EditorCore } from "@/core";
import { primeFont } from "@/fonts/bundled";
import { DEFAULTS } from "@/timeline/defaults";
import { buildTextElement } from "@/timeline/element-utils";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";
import { getDesign } from "./design";
import { buildPresetParams, type TextPreset } from "./presets";
import { t } from "@/i18n";

const ticks = (seconds: number) => mediaTime({ ticks: Math.round(seconds * TICKS_PER_SECOND) });

/**
 * A text clip for a preset: at the playhead, at the end of the video (CTA) or
 * across the whole video (ad label). `content` replaces the sample text.
 * Loads the preset's local font first so the first frame already uses it.
 */
export async function buildPresetElement({
	editor,
	preset,
	content,
	at,
}: {
	editor: EditorCore;
	preset: TextPreset;
	content?: string;
	/** Seconds; defaults to the preset's placement rule. */
	at?: number;
}) {
	const project = editor.project.getActive();
	// a downloaded font: the clip lands at once with its stand-in and redraws when the file is here
	await primeFont(String(preset.params.fontFamily ?? ""));
	const canvasHeight = project.settings.canvasSize.height;
	const total = editor.timeline.getTotalDuration() / TICKS_PER_SECOND;
	let start = at ?? editor.playback.getCurrentTime() / TICKS_PER_SECOND;
	let duration = preset.duration;
	if (at == null && preset.place === "end" && total > preset.duration) {
		start = total - preset.duration;
	} else if (at == null && preset.place === "whole" && total > 0) {
		start = 0;
		duration = total;
	}
	const element = buildTextElement({
		raw: {
			...DEFAULTS.text.element,
			name: t(preset.name),
			duration: ticks(duration),
			params: {
				...DEFAULTS.text.element.params,
				...buildPresetParams({ preset, canvasHeight }),
				// the sample text in the UI language (a Russian line for Russian, when the dictionary has one)
				...(content ? { content } : { content: t(preset.content) }),
				...(typeof preset.params["design.sub"] === "string" && preset.params["design.sub"] ? { "design.sub": t(preset.params["design.sub"]) } : {}),
			},
		},
		startTime: ticks(start),
	});
	return { element, start, duration };
}

/** Frame 0 of an In animation is often empty: park the paused playhead where the text has appeared. */
export function settlePlayhead({
	editor,
	preset,
	start,
	duration,
}: {
	editor: EditorCore;
	preset: TextPreset;
	start: number;
	duration: number;
}): void {
	// the title had come in (blind1 S3-2: from 0 to 1:03). Kept as a call so its callers stay as they are.
	void editor;
	void preset;
	void start;
	void duration;
}

/** Seconds into the clip when a preset has fully come in: its text, every layer, the count (the tile's still too). */
export function settleSeconds(preset: TextPreset): number {
	const p = preset.params;
	const inDuration = Number(p["anim.inDuration"] ?? 0);
	const delay = Number(p["anim.inDelay"] ?? 0);
	let end = (p["anim.in"] && p["anim.in"] !== "none" ? inDuration : 0) + delay;
	// word-by-word highlights: the still shows the line well into it (not just its first word)
	if (p["highlight.mode"] && p["highlight.mode"] !== "none") end = Math.max(end, preset.duration * 0.62);
	const design = getDesign(p["design.id"]);
	if (design) {
		const k = Math.min(3, Math.max(0.25, (inDuration || design.nominal) / design.nominal));
		for (const layer of design.layers) if (layer.motion && layer.kind !== "cursor" && layer.kind !== "sparks") end = Math.max(end, (layer.motion.delay + layer.motion.dur) * k);
		if (design.sub?.motion) end = Math.max(end, (design.sub.motion.delay + design.sub.motion.dur) * k);
		if (design.count) end = Math.max(end, delay + 1.15 * k);
		// a button is shown just before the cursor presses it
		if (design.pressAt != null) end = Math.min(end + 0.1, design.pressAt * k - 0.08);
	}
	return Math.max(0, Math.min(preset.duration - 0.4, end + 0.06));
}
