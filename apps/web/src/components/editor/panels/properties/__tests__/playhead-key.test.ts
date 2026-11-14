import { describe, expect, test } from "bun:test";
import { playheadKey } from "@/components/editor/panels/properties/hooks/use-element-playhead";
import type { MediaTime } from "@/wasm";

const t = (n: number) => n as MediaTime;
const clip = { startTime: t(1000), duration: t(500) };

// Dragging the playhead over a clip without keyframes re-rendered every inspector row on every frame.
describe("what the inspector re-renders for, while the playhead moves", () => {
	test("dragging over a clip without keyframes: only entering or leaving it counts", () => {
		const at = (time: number) => playheadKey({ playheadTime: t(time), isScrubbing: true, animated: false, ...clip });
		expect(at(1100)).toBe(at(1400));
		expect(at(200)).toBe(at(1700));
		expect(at(1100)).not.toBe(at(200));
	});
	test("an animated clip follows every frame", () => {
		const at = (time: number) => playheadKey({ playheadTime: t(time), isScrubbing: true, animated: true, ...clip });
		expect(at(1100)).not.toBe(at(1400));
	});
	test("a single seek, or the end of a drag, gives the exact time back", () => {
		expect(playheadKey({ playheadTime: t(1234), isScrubbing: false, animated: false, ...clip })).toBe(1234);
	});
});
