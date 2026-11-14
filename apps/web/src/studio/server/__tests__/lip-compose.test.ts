import { describe, expect, test } from "bun:test";
import { lipOptions, lipOptionsKey, lipsyncInput } from "@/fal/wire";
import { alphaAt, blendFace, maskOf, trustedBoxes } from "../lip-compose";

const W = 64;
const H = 48;
const frame = (v: number) => new Uint8Array((W * H * 3) / 2).fill(v);

describe("the composite back", () => {
	test("outside the grown box every byte is the base's; inside the core, the answer's", () => {
		const base = frame(10);
		const answer = frame(200);
		const m = maskOf([20, 10, 16, 16], W, H);
		const out = Uint8Array.from(base);
		const touched = blendFace(out, answer, W, H, m);
		expect(touched).toBeGreaterThan(0);
		let outside = 0;
		let outsideSame = 0;
		let core = 0;
		let coreAnswer = 0;
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const a = alphaAt(m, x, y);
				const v = out[y * W + x];
				if (a === 0) {
					outside++;
					if (v === 10) outsideSame++;
				} else if (a === 1) {
					core++;
					if (v === 200) coreAnswer++;
				}
			}
		expect(outsideSame).toBe(outside);
		expect(coreAnswer).toBe(core);
		expect(core).toBeGreaterThan(0);
		// chroma: outside the box's chroma samples, the base's too
		const cw = W / 2;
		const u0 = W * H;
		for (let y = 0; y < H / 2; y++)
			for (let x = 0; x < cw; x++) if (2 * x + 1 < m.x0 || 2 * x >= m.x1 || 2 * y + 1 < m.y0 || 2 * y >= m.y1) expect(out[u0 + y * cw + x]).toBe(10);
	});

	test("the mask is the box grown (more below: the jaw), on even pixels, inside the frame", () => {
		const m = maskOf([20, 10, 20, 20], W, H);
		expect(m.x0 % 2 + m.y0 % 2 + m.x1 % 2 + m.y1 % 2).toBe(0);
		expect(m.x0).toBeLessThan(20);
		expect(m.y1 - 30).toBeGreaterThan(10 - m.y0);
		const edge = maskOf([55, 40, 20, 20], W, H);
		expect(edge.x1).toBe(W);
		expect(edge.y1).toBe(H);
	});

	test("a box that jumps or a low-confidence frame is not trusted (that frame takes the provider's whole frame)", () => {
		const b = (x: number, conf = 0.9) => ({ box: [x, 10, 20, 20] as [number, number, number, number], conf });
		const marks = [b(10), b(11), b(40), b(12), b(12, 0.1), null, b(13)];
		const t = trustedBoxes(marks);
		expect(t[0]).not.toBeNull();
		expect(t[2]).toBeNull(); // jumped
		expect(t[4]).toBeNull(); // low confidence
		expect(t[5]).toBeNull(); // no face
		expect(t[6]).not.toBeNull();
	});
});

describe("the take's knobs on the wire", () => {
	test("LatentSync gets seed and guidance_scale, Sync its sync_mode; nothing out of range passes", () => {
		const o = lipOptions({ seed: 42, guidance: 1.5, syncMode: "bounce" });
		expect(lipsyncInput("fal-ai/latentsync", "v", "a", o)).toEqual({ video_url: "v", audio_url: "a", loop_mode: "loop", seed: 42, guidance_scale: 1.5 });
		expect(lipsyncInput("fal-ai/sync-lipsync/v2", "v", "a", o)).toEqual({ video_url: "v", audio_url: "a", sync_mode: "bounce" });
		expect(lipOptions({ seed: -1, guidance: 9, syncMode: "zoom" })).toEqual({ guidance: 2 });
		expect(lipOptionsKey({})).toBe("");
		expect(lipOptionsKey({ seed: 7 })).toBe("seed7");
	});
});

describe("the picture's own cuts", () => {
	test("a dim cut (0.14) standing out of a moving face (0.01–0.03) is a cut; motion alone is not", async () => {
		const { cutsInScores } = await import("../lip-media");
		const scores = Array.from({ length: 100 }, (_, i) => ({ t: i / 25, s: 0.01 + ((i * 7) % 3) / 100 }));
		scores[50].s = 0.14;
		scores[51].s = 0.12;
		expect(cutsInScores(scores, 4)).toEqual([2]);
		expect(cutsInScores(scores.map((x, i) => ({ ...x, s: i === 50 || i === 51 ? 0.05 : x.s })), 4)).toEqual([]);
		// a bright flash of 0.35 always counts
		expect(cutsInScores(scores.map((x, i) => ({ ...x, s: i === 20 ? 0.35 : i === 50 || i === 51 ? 0.02 : x.s })), 4)).toEqual([0.8]);
	});
});
