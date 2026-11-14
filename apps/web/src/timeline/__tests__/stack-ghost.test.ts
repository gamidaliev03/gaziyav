import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { MediaAsset } from "@/media/types";
import type { TimelineDragData } from "@/timeline/drag";

// Several Media tiles dragged together land one after another on the row under the cursor (pictures and videos); a sound
// among them starts at the same point on its own track. The ghost is that row, so its length is the row's: a picture
// (5 s) and a sound (5 s) showed a 10 s ghost and landed as 5 s (targeted test 06.11).
let getDurationForDrag: typeof import("@/timeline/controllers/drag-drop-controller").getDurationForDrag;
beforeAll(async () => {
	await installOpenCutWasm();
	({ getDurationForDrag } = await import("@/timeline/controllers/drag-drop-controller"));
});

const TPS = 120000;
const asset = (id: string, type: "image" | "video" | "audio", seconds: number) => ({ id, type, name: id, duration: seconds }) as unknown as MediaAsset;
const drag = (ids: string[]) => ({ type: "media", id: ids[0], ids, name: "x", mediaType: "video" }) as unknown as TimelineDragData;
const seconds = (assets: MediaAsset[], ids: string[]) => getDurationForDrag({ dragData: drag(ids), mediaAssets: assets }) / TPS;

test("a picture and a sound dragged together: the ghost is the picture's length, the sound is no part of the row", () => {
	const assets = [asset("p", "image", 5), asset("s", "audio", 5.04)];
	expect(seconds(assets, ["p", "s"])).toBe(5);
	expect(seconds(assets, ["s", "p"])).toBe(5);
});

test("videos and pictures lie one after another: the ghost is their sum; sounds alone are their own row", () => {
	const assets = [asset("v", "video", 8), asset("p", "image", 5), asset("a", "audio", 3), asset("b", "audio", 4)];
	expect(seconds(assets, ["v", "p"])).toBe(13);
	expect(seconds(assets, ["v", "p", "a"])).toBe(13);
	expect(seconds(assets, ["a", "b"])).toBe(7);
});
