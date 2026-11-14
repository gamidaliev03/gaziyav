import { describe, expect, test } from "bun:test";
import { placeOf } from "../layout-places";

// The one list (properties/layout.ts): every section of the ten old tabs has a place, the properties first in
// Premiere's order, the sound under Audio, the tools folded at the end; a section nobody placed is never lost.
describe("one list", () => {
	test("a video's properties in Premiere's order, then its sound, then the tools", () => {
		const ranks = ["transform@basic", "opacity@basic", "speed", "adjust.color", "effects"].map((id) => placeOf(id, "video"));
		expect(ranks.every((place) => place.block === "main")).toBe(true);
		expect(ranks.map((place) => place.rank)).toEqual([...ranks.map((place) => place.rank)].sort((a, b) => a - b));
		for (const id of ["audio.volume@audio", "audio.pan@audio", "audio.cleanup@audio", "audio.effects@audio"]) expect(placeOf(id, "video").block).toBe("audio");
		for (const id of ["cutout.remove", "cutout.chroma", "masks", "clip.animation", "motion.tracker", "stabilize", "video.deflicker", "fix.enhance", "cleanup", "retouch.face", "faceswap", "ai.upscale"])
			expect(placeOf(id, "video").block).toBe("tools");
	});
	test("Lipsync is a tool: among the tools for every kind of clip, never above Transform and the other basics", () => {
		const lip = placeOf("studio.lipsync", "video");
		expect(lip).toEqual({ block: "tools", rank: 600 });
		for (const id of ["transform@basic", "opacity@basic", "speed", "adjust.color", "effects"]) expect(placeOf(id, "video").block).toBe("main");
		// first of the AI tools: before face swap, upscale, voice
		for (const id of ["faceswap", "ai.upscale", "text.tts"]) expect(placeOf(id, "video").rank).toBeGreaterThan(lip.rank);
		expect(placeOf("studio.lipsync", "audio")).toEqual({ block: "tools", rank: 600 });
	});
	test("an audio clip's sound is its own part; its speed folded after it", () => {
		expect(placeOf("audio.volume@basic", "audio").block).toBe("main");
		expect(placeOf("speed", "audio")).toEqual({ block: "main", rank: 260, folded: true });
	});
	test("a text: its words, font, animation, then where it sits", () => {
		const order = ["text.content", "text.style", "text.animation", "transform@basic", "opacity@basic"].map((id) => placeOf(id, "text").rank);
		expect(order).toEqual([...order].sort((a, b) => a - b));
		expect(placeOf("text.highlight@text", "text")).toEqual({ block: "main", rank: 50, folded: true });
		expect(placeOf("adjust.color", "text").block).toBe("tools");
	});
	test("a section nobody placed lands among the tools", () => {
		expect(placeOf("some.plugin", "video").block).toBe("tools");
	});
});
