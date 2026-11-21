import { describe, expect, test } from "bun:test";
import { BLOCK_ORDER, placeOf } from "../layout-places";

// The inspector's tabs by sphere (properties/layout-places.ts — the owner, 14.11): every section has its tab — the clip
// itself, its sound, speed, colour, effects, AI; a section nobody placed is never lost.
describe("the inspector's tabs", () => {
	test("the tabs stand in one order", () => {
		expect([...BLOCK_ORDER]).toEqual(["main", "audio", "speed", "color", "effects", "tools"]);
	});
	test("a video: where it sits in «Video», its sound in «Audio», speed, colour, effects and AI each in their tab", () => {
		for (const id of ["transform@basic", "opacity@basic", "shadow", "canvas"]) expect(placeOf(id, "video").block).toBe("main");
		for (const id of ["audio.volume@audio", "audio.pan@audio", "audio.cleanup@audio", "audio.effects@audio", "audio.voiceChanger", "audio.separate"]) expect(placeOf(id, "video").block).toBe("audio");
		expect(placeOf("speed", "video").block).toBe("speed");
		for (const id of ["adjust.color", "adjust.autoColor", "adjust.colorMatch"]) expect(placeOf(id, "video").block).toBe("color");
		for (const id of ["effects", "clip.animation", "masks", "cutout.remove", "cutout.chroma", "motion.tracker", "motion.follow"]) expect(placeOf(id, "video").block).toBe("effects");
		for (const id of ["studio.lipsync", "faceswap", "ai.upscale", "fix.enhance", "fix.denoise", "cleanup", "retouch.face", "stabilize", "video.deflicker", "motion.make-vertical"])
			expect(placeOf(id, "video").block).toBe("tools");
	});
	test("one section lies open in a tab: Transform, Volume, Speed, Colour, the effects; the rest are rows", () => {
		expect(placeOf("transform@basic", "video").folded).toBeFalsy();
		expect(placeOf("opacity@basic", "video").folded).toBe(true);
		expect(placeOf("audio.volume@audio", "video").folded).toBeFalsy();
		expect(placeOf("audio.pan@audio", "video").folded).toBe(true);
		expect(placeOf("speed", "video").folded).toBeFalsy();
		expect(placeOf("adjust.color", "video").folded).toBeFalsy();
		expect(placeOf("adjust.autoColor", "video").folded).toBe(true);
		expect(placeOf("effects", "video").folded).toBeFalsy();
		expect(placeOf("masks", "video").folded).toBe(true);
	});
	test("Lipsync is a tool: in «AI», first of the tools, never in the clip's own tab", () => {
		const lip = placeOf("studio.lipsync", "video");
		expect(lip.block).toBe("tools");
		for (const id of ["faceswap", "ai.upscale", "fix.enhance", "stabilize"]) expect(placeOf(id, "video").rank).toBeGreaterThan(lip.rank);
		expect(placeOf("studio.lipsync", "audio").block).toBe("tools");
	});
	test("an AI plate's In / Out lie open in «Effects», where a text plate's do", () => {
		const ai = placeOf("clip.animation", "ai");
		const text = placeOf("text.animation", "text");
		expect(ai.block).toBe(text.block);
		expect(ai.folded).toBeFalsy();
		expect(ai.rank).toBe(text.rank);
	});
	test("a sound clip's sound is its own first tab", () => {
		expect(placeOf("audio.volume@basic", "audio").block).toBe("main");
		expect(placeOf("speed", "audio").block).toBe("speed");
	});
	test("a text: its words, font and look first; where it sits is a row under them; its animation in «Effects»", () => {
		const order = ["text.content", "text.style", "transform@basic", "opacity@basic"].map((id) => placeOf(id, "text"));
		expect(order.every((place) => place.block === "main")).toBe(true);
		expect(order.map((place) => place.rank)).toEqual([...order.map((place) => place.rank)].sort((a, b) => a - b));
		expect(placeOf("transform@basic", "text").folded).toBe(true);
		expect(placeOf("text.animation", "text").block).toBe("effects");
		expect(placeOf("adjust.color", "text").block).toBe("color");
	});
	test("a section nobody placed lands in «AI», folded", () => {
		expect(placeOf("some.plugin", "video")).toEqual({ block: "tools", rank: 900, folded: true });
	});
});
