import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TimelineTrack } from "@/timeline/types";

let closeGapAt: typeof import("@/timeline/gaps").closeGapAt;
let closeAllGaps: typeof import("@/timeline/gaps").closeAllGaps;
beforeAll(async () => {
	await installOpenCutWasm();
	({ closeGapAt, closeAllGaps } = await import("@/timeline/gaps"));
});

const S = 120000;
const track = (spans: Array<[number, number]>) =>
	({
		id: "t",
		name: "Video",
		type: "video",
		muted: false,
		hidden: false,
		elements: spans.map(([start, end], i) => ({ id: `c${i}`, type: "video", startTime: start * S, duration: (end - start) * S })),
	}) as unknown as TimelineTrack;
const spans = (elements: ReadonlyArray<{ startTime: number; duration: number }> | null) =>
	elements?.map((e) => [e.startTime / S, (e.startTime + e.duration) / S]) ?? null;

// CapCut's track menu: «Close gap» (the gap under the pointer), «Close all gaps» (back to back from the first clip).
test("Close gap moves the clips after that gap left by its length; outside a gap it does nothing", () => {
	const t = track([[0, 2], [5, 7], [9, 10]]);
	expect(spans(closeGapAt(t, 3 * S))).toEqual([[0, 2], [2, 4], [6, 7]]);
	expect(spans(closeGapAt(t, 8 * S))).toEqual([[0, 2], [5, 7], [7, 8]]);
	expect(closeGapAt(t, 1 * S)).toBeNull();
	expect(closeGapAt(t, 11 * S)).toBeNull();
});

test("Close all gaps puts the clips back to back from the first one; none to close → null", () => {
	expect(spans(closeAllGaps(track([[1, 2], [5, 7], [9, 10]])))).toEqual([[1, 2], [2, 4], [4, 5]]);
	expect(closeAllGaps(track([[0, 2], [2, 4]]))).toBeNull();
});
