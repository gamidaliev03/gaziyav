import { describe, expect, test } from "bun:test";
import { fitOptions, resolveFit, serverFit } from "../fit";

describe("speech vs clip length", () => {
	// The charter (lipa, 14.11): new words replace the clip's speech — the clip takes the voice's length, the rest is
	// trimmed (nothing of the old words after the new line); keeping the rest or the whole clip are choices.
	test("shorter new words: the clip is trimmed to the voice first; keeping the rest or the whole clip are choices", () => {
		const options = fitOptions(4, 10, 0);
		expect(options?.map((o) => o.id)).toEqual(["trim", "loop", "pad"]);
		expect(resolveFit(undefined, options)).toBe("trim");
		expect(resolveFit("pad", options)).toBe("pad");
		expect(serverFit("trim")).toBe("loop");
	});

	test("a sound that already lies under the clip keeps the clip as it is (only the piece first)", () => {
		expect(fitOptions(4, 10, 0, false)?.map((o) => o.id)).toEqual(["loop", "trim", "pad"]);
	});

	test("slightly shorter speech can also be slowed down", () => {
		expect(fitOptions(9, 10, 0)?.map((o) => o.id)).toEqual(["trim", "loop", "pad", "speed"]);
	});

	test("longer speech: the video gets as long as the speech (loop, ping-pong, a held frame), or the voice is cut, or faster, or more video", () => {
		expect(fitOptions(11, 10, 5)?.map((o) => o.id)).toEqual(["pingpong", "loop", "freeze", "cut", "speed", "extend"]);
		// ping-pong is the default (no jump); the user's last pick wins once made
		expect(resolveFit("pad", fitOptions(11, 10, 5))).toBe("pingpong");
		expect(resolveFit("trim", fitOptions(11, 10, 5))).toBe("pingpong");
		expect(resolveFit("loop", fitOptions(11, 10, 5))).toBe("loop");
	});

	test("lengths that match need no choice", () => {
		expect(fitOptions(10.2, 10, 0)).toBeNull();
		expect(resolveFit("pad", null)).toBe("loop");
	});
});
