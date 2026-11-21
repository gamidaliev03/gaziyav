// Audit 21.11 (gz1-audit-63.md): a title's effects get a home, and «Paste attributes → Speed» only moves a speed
// between clips that have one.
import { describe, expect, test } from "bun:test";
import { buildAttributesPatch, captureAttributes } from "@/actions/timeline-edits";
import { COLOR_EFFECT_TYPE, colorEffect } from "@/effects/definitions/studio/color";
import { CHROMA_KEY_EFFECT_TYPE, hasListedClipEffects } from "@/effects/clip-effect-list";
import type { TimelineElement } from "@/timeline/types";

const clip = (type: string, extra: Record<string, unknown> = {}): TimelineElement =>
	({ id: type, name: type, type, mediaId: "m", startTime: 0, duration: 100, trimStart: 0, trimEnd: 0, params: { opacity: 1 }, ...extra }) as unknown as TimelineElement;

describe("paste attributes → speed", () => {
	const twice = { rate: 2 };

	test("a photo, a title or a sticker never resets a video's speed", () => {
		const video = clip("video", { retime: twice });
		for (const type of ["image", "text", "sticker", "graphic"]) {
			const patch = buildAttributesPatch({ source: captureAttributes(clip(type)), target: video });
			expect(patch === null || !("retime" in patch)).toBe(true);
		}
	});

	test("a video's speed doesn't land on a photo or a title", () => {
		const source = captureAttributes(clip("video", { retime: twice }));
		for (const type of ["image", "text", "sticker"]) {
			const patch = buildAttributesPatch({ source, target: clip(type) });
			expect(patch === null || !("retime" in patch)).toBe(true);
		}
	});

	test("video → video and video → audio still paste the speed", () => {
		const source = captureAttributes(clip("video", { retime: twice }));
		expect((buildAttributesPatch({ source, target: clip("video") }) as { retime?: unknown } | null)?.retime).toEqual(twice);
		expect((buildAttributesPatch({ source, target: clip("audio") }) as { retime?: unknown } | null)?.retime).toEqual(twice);
	});
});

describe("a title's Effects tab", () => {
	const defaults = Object.fromEntries(colorEffect.params.map((param) => [param.key, param.default]));
	const glitch = { id: "g", type: "pro.fx.bloom", enabled: true, params: {} };

	test("shown once an effect is on it, not for a filter (Colour) or a chroma key (Cutout) alone", () => {
		expect(hasListedClipEffects(undefined)).toBe(false);
		expect(hasListedClipEffects([])).toBe(false);
		expect(hasListedClipEffects([{ id: "c", type: COLOR_EFFECT_TYPE, enabled: true, params: { ...defaults, look: "warm" } }])).toBe(false);
		expect(hasListedClipEffects([{ id: "k", type: CHROMA_KEY_EFFECT_TYPE, enabled: true, params: {} }])).toBe(false);
		expect(hasListedClipEffects([glitch])).toBe(true);
	});
});
