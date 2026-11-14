import { describe, expect, test } from "bun:test";
import { ffmpegFilterFor, parseFxChain, readFxChain } from "../fx";

describe("audio fx chain", () => {
	test("reads enabled switches in processing order", () => {
		const chain = readFxChain({ params: { "fx.limiter": true, "fx.isolate": true, "fx.voice": true, "fx.reverb": false } });
		expect(chain).toEqual(["isolate", "voice", "limiter"]);
	});
	test("parse rejects unknown ids and keeps canonical order", () => {
		expect(parseFxChain("limiter,voice")).toEqual(["voice", "limiter"]);
		expect(parseFxChain("voice,rm -rf")).toBeNull();
		expect(parseFxChain("")).toBeNull();
	});
	test("ffmpeg graph skips the native isolation step and compensates the limiter look-ahead", () => {
		expect(ffmpegFilterFor(["isolate"])).toBe("");
		const g = ffmpegFilterFor(["isolate", "compressor", "limiter"]);
		expect(g.startsWith("acompressor=")).toBe(true);
		expect(g).toContain("latency=1");
		expect(g).toContain("level=false");
	});
});

describe("CapCut audio: reduce noise, normalize loudness", () => {
	test("reduce noise cleans first, normalize sets the level last (before the limiter)", () => {
		const chain = readFxChain({ params: { "fx.reverb": true, "fx.denoise": true, "fx.normalize": true, "fx.limiter": true } });
		expect(chain).toEqual(["denoise", "reverb", "normalize", "limiter"]);
		expect(parseFxChain("normalize,denoise")).toEqual(["denoise", "normalize"]);
		expect(parseFxChain("vc.robot")).toBeNull();
	});
	test("normalize splits the graph: before it, then after it", () => {
		const chain = ["denoise", "reverb", "normalize", "limiter"] as const;
		const before = ffmpegFilterFor(chain, { before: "normalize" });
		expect(before.startsWith("afftdn=")).toBe(true);
		expect(before).toContain("aecho=");
		expect(before).not.toContain("alimiter");
		expect(ffmpegFilterFor(chain, { after: "normalize" })).toStartWith("alimiter=");
		expect(ffmpegFilterFor(["normalize"])).toBe("");
	});
});
