import { describe, expect, test } from "bun:test";
import { isStale, type Made, soundOfFile, soundUnder, spanOf } from "../stale";

// the clip at 2 s for 6 s; the voice under it from 1 s, 10 s long, its file from 0.5 s
const clip = { at: 2, length: 6 };
const voice = { mediaId: "voice", start: 1, length: 10, trimStart: 0.5 };
const made = (sound: string, trimStart = 0, length = 6): Made => ({ sound, span: spanOf({ trimStart, length }) });
const base = made(soundUnder(clip, [voice]));

describe("stale lips (rule G)", () => {
	test("nothing changed: fresh", () => {
		expect(isStale(base, made(soundUnder(clip, [voice])))).toBe(false);
	});
	test("the sound moved: stale; moved back: fresh", () => {
		expect(isStale(base, made(soundUnder(clip, [{ ...voice, start: 1.5 }])))).toBe(true);
		expect(isStale(base, made(soundUnder(clip, [{ ...voice, start: 1 }])))).toBe(false);
	});
	test("the sound trimmed at its head or its tail inside the clip, or slipped: stale; a head trim before the clip: fresh", () => {
		expect(isStale(base, made(soundUnder(clip, [{ ...voice, trimStart: 2, start: 2.5, length: 8.5 }])))).toBe(true);
		expect(isStale(base, made(soundUnder(clip, [{ ...voice, trimStart: 0.9, start: 1.4, length: 9.6 }])))).toBe(false);
		expect(isStale(base, made(soundUnder(clip, [{ ...voice, trimStart: 0.9 }])))).toBe(true);
		expect(isStale(base, made(soundUnder(clip, [{ ...voice, length: 5 }])))).toBe(true);
	});
	test("a trim of the sound outside the clip changes nothing under it: fresh", () => {
		expect(isStale(base, made(soundUnder(clip, [{ ...voice, length: 9 }])))).toBe(false);
	});
	test("the sound replaced by another file: stale", () => {
		expect(isStale(base, made(soundUnder(clip, [{ ...voice, mediaId: "other" }])))).toBe(true);
	});
	test("the sound muted, or a second sound under the clip: stale", () => {
		expect(isStale(base, made(soundUnder(clip, [{ ...voice, muted: true }])))).toBe(true);
		expect(isStale(base, made(soundUnder(clip, [voice, { mediaId: "sfx", start: 3, length: 1, trimStart: 0 }])))).toBe(true);
	});
	test("a sound outside the clip does not count; order does not matter", () => {
		const far = { mediaId: "music", start: 20, length: 5, trimStart: 0 };
		expect(isStale(base, made(soundUnder(clip, [far, voice])))).toBe(false);
		const two = soundUnder(clip, [voice, { mediaId: "sfx", start: 3, length: 1, trimStart: 0 }]);
		expect(soundUnder(clip, [{ mediaId: "sfx", start: 3, length: 1, trimStart: 0 }, voice])).toBe(two);
	});
	test("the clip moved over the sound: stale; clip and sound moved together: fresh", () => {
		expect(isStale(base, made(soundUnder({ at: 3, length: 6 }, [voice])))).toBe(true);
		expect(isStale(base, made(soundUnder({ at: 3, length: 6 }, [{ ...voice, start: 2 }])))).toBe(false);
	});
	test("the clip's own trim changes the span: stale; within a frame: fresh", () => {
		expect(isStale(base, made(base.sound, 0.5, 5.5))).toBe(true);
		expect(isStale(base, made(base.sound, 0, 5))).toBe(true);
		expect(isStale(base, made(base.sound, 0.01, 6))).toBe(false);
	});
	test("a voice file re-made (another file): stale; the same file: fresh", () => {
		const a = made(soundOfFile("f1"));
		expect(isStale(a, made(soundOfFile("f2")))).toBe(true);
		expect(isStale(a, made(soundOfFile("f1")))).toBe(false);
		expect(isStale(a, made(soundUnder(clip, [voice])))).toBe(true);
	});
});
