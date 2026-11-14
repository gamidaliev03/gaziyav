import { describe, expect, test } from "bun:test";
import { RAMP_SETTLE_MS, ZoomRampStore } from "@/timeline/zoom-ramp";

// speed, 11.11: while the zoom moves nothing becomes whole; RAMP_SETTLE_MS after the last step the waiting clips do,
// one frame at a time, until no track has any left; a new step in the middle starts over without a pending frame.
function fakeClock() {
	let now = 0;
	let id = 0;
	const timers = new Map<number, { at: number; fn: () => void }>();
	const frames = new Map<number, () => void>();
	return {
		clock: {
			setTimeout: (fn: () => void, ms: number) => {
				timers.set(++id, { at: now + ms, fn });
				return id;
			},
			clearTimeout: (handle: unknown) => void timers.delete(handle as number),
			requestFrame: (fn: () => void) => {
				frames.set(++id, fn);
				return id;
			},
			cancelFrame: (handle: unknown) => void frames.delete(handle as number),
		},
		advance(ms: number) {
			now += ms;
			for (const [key, timer] of [...timers]) {
				if (timer.at <= now) {
					timers.delete(key);
					timer.fn();
				}
			}
		},
		frame() {
			const due = [...frames];
			frames.clear();
			for (const [, fn] of due) fn();
		},
		pendingFrames: () => frames.size,
	};
}

describe("zoom ramp", () => {
	test("the level the timeline opens at moves nothing", () => {
		const { clock } = fakeClock();
		const ramp = new ZoomRampStore(clock);
		expect(ramp.snapshotFor(1)).toBe(0);
		ramp.noteZoom(1);
		expect(ramp.snapshotFor(1)).toBe(0);
		expect(ramp.state().phase).toBe("rest");
	});

	test("a step is «moving» for its own draw and until the zoom has stood still; then one frame at a time until nothing waits", () => {
		const time = fakeClock();
		const ramp = new ZoomRampStore(time.clock);
		let emitted = 0;
		ramp.subscribe(() => emitted++);
		ramp.noteZoom(1);
		// the tracks draw the next level before the store is told: that draw is already «moving»
		expect(ramp.snapshotFor(1.1)).toBe(1);
		ramp.noteZoom(1.1);
		expect(ramp.snapshotFor(1.1)).toBe(1);
		expect(emitted).toBe(0); // no second draw for the step
		time.advance(RAMP_SETTLE_MS - 1);
		expect(ramp.snapshotFor(1.1)).toBe(1);
		// another step before it settled: the wait starts again
		ramp.noteZoom(1.2);
		time.advance(RAMP_SETTLE_MS - 1);
		expect(ramp.snapshotFor(1.2)).toBe(1);
		time.advance(1);
		expect(ramp.snapshotFor(1.2)).toBe(2); // the first frame of the ramp
		expect(emitted).toBe(1);
		ramp.reportWaiting("main", 20);
		ramp.reportWaiting("titles", 0);
		time.frame();
		expect(ramp.snapshotFor(1.2)).toBe(3);
		ramp.reportWaiting("main", 12);
		time.frame();
		expect(ramp.snapshotFor(1.2)).toBe(4);
		ramp.reportWaiting("main", 0);
		time.frame();
		expect(ramp.snapshotFor(1.2)).toBe(0); // at rest
		expect(ramp.state().phase).toBe("rest");
		expect(time.pendingFrames()).toBe(0);
		expect(emitted).toBe(4);
	});

	test("a step in the middle of the ramp stops it: no frame is left to run, and the wait starts again", () => {
		const time = fakeClock();
		const ramp = new ZoomRampStore(time.clock);
		ramp.noteZoom(1);
		ramp.noteZoom(2);
		time.advance(RAMP_SETTLE_MS);
		ramp.reportWaiting("main", 50);
		time.frame();
		expect(ramp.snapshotFor(2)).toBe(3);
		ramp.noteZoom(2.2);
		expect(ramp.snapshotFor(2.2)).toBe(1);
		expect(time.pendingFrames()).toBe(0);
		time.frame();
		expect(ramp.snapshotFor(2.2)).toBe(1);
		time.advance(RAMP_SETTLE_MS);
		expect(ramp.snapshotFor(2.2)).toBe(2);
	});

	test("a track that is gone no longer holds the ramp open", () => {
		const time = fakeClock();
		const ramp = new ZoomRampStore(time.clock);
		ramp.noteZoom(1);
		ramp.noteZoom(2);
		time.advance(RAMP_SETTLE_MS);
		ramp.reportWaiting("gone", 9);
		ramp.forget("gone");
		time.frame();
		expect(ramp.state().phase).toBe("rest");
	});
});
