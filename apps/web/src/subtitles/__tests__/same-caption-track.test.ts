import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let insert: typeof import("../insert");
let TICKS: number;
beforeAll(async () => {
	await installOpenCutWasm();
	insert = await import("../insert");
	({ TICKS_PER_SECOND: TICKS } = await import("@/wasm"));
});

const cue = (seconds: number, content: string) => ({ startTime: Math.round(seconds * TICKS), params: { content } });

describe("a second captions run over the same speech", () => {
	test("is recognised as the track already there (no duplicate)", () => {
		const first = [cue(0, "В 2026"), cue(1.2, "ГОДУ ВСЁ"), cue(2.5, "ИЗМЕНИТСЯ")];
		const again = [cue(2.5, "ИЗМЕНИТСЯ"), cue(0.004, "В 2026"), cue(1.2, "ГОДУ ВСЁ")];
		expect(insert.isSameCaptionTrack(first, again)).toBe(true);
	});

	test("other speech, another count or an empty track is a new track", () => {
		const first = [cue(0, "В 2026"), cue(1.2, "ГОДУ ВСЁ")];
		expect(insert.isSameCaptionTrack(first, [cue(0, "В 2026"), cue(1.2, "ГОДУ ТАК")])).toBe(false);
		expect(insert.isSameCaptionTrack(first, [cue(0, "В 2026")])).toBe(false);
		expect(insert.isSameCaptionTrack([], [])).toBe(false);
		expect(insert.isSameCaptionTrack(first, [cue(0.2, "В 2026"), cue(1.2, "ГОДУ ВСЁ")])).toBe(false);
	});
});
