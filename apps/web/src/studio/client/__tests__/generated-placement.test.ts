// B10/C12, 10.11: generated clips landed above the titles (Claude moved the titles to a new top track every round), and a
// clip «parked» past the cut went onto the magnetic main track, which moved it to the cut's end while the answer said
// the time asked. The placement keeps it under every text/graphic/adjustment track, uses the main track only where it
// lands as asked, and honours track:"new".
import { describe, expect, test } from "bun:test";
import type { SceneTracks } from "@/timeline";
import { generatedPlacement as place } from "../generated-placement";

const generatedPlacement = (tracks: SceneTracks, start: number, duration: number, want?: string, slack?: number) => place(tracks, start as never, duration as never, want, slack);

const S = 1000;
const clip = (id: string, s: number, d = 5) => ({ id, type: "video", startTime: s * S, duration: d * S, trimStart: 0, trimEnd: 0, params: {} });
const track = (id: string, type: string, elements: unknown[] = []) => ({ id, type, elements });
const scene = (overlay: unknown[], main: unknown[]) => ({ overlay, main: track("main", "video", main), audio: [track("a1", "audio")] }) as unknown as SceneTracks;

describe("where a generated visual goes", () => {
	const titles = track("txt", "text", [{ id: "t1", type: "text", startTime: 0, duration: 30 * S }]);
	const broll = track("v1", "video", [clip("b", 2)]);
	const cut = [clip("m1", 0), clip("m2", 5)];

	test("under the titles: the topmost free video track below them, never above", () => {
		const above = track("v0", "video");
		expect(generatedPlacement(scene([above, titles, broll], cut), 12 * S, 5 * S)).toEqual({ mode: "explicit", trackId: "v1" });
		// the B-roll track is taken there: a new track right under the titles (index 2 = under «txt» at 1)
		expect(generatedPlacement(scene([above, titles, broll], cut), 3 * S, 5 * S)).toEqual({ mode: "auto", newTrack: true, insertIndex: 2 });
	});

	test("past the end of the cut it is not put on the magnetic main track (that moved it); at its end it is", () => {
		expect(generatedPlacement(scene([titles], cut), 40 * S, 5 * S)).toEqual({ mode: "auto", newTrack: true, insertIndex: 1 });
		expect(generatedPlacement(scene([titles], cut), 10 * S, 5 * S, undefined, 20)).toEqual({ mode: "explicit", trackId: "main" });
		expect(generatedPlacement(scene([titles], []), 0, 5 * S)).toEqual({ mode: "explicit", trackId: "main" });
		expect(generatedPlacement(scene([titles], []), 4 * S, 5 * S)).toEqual({ mode: "auto", newTrack: true, insertIndex: 1 });
	});

	test('track:"new" is a new track under the titles; a named track is used where it is free', () => {
		expect(generatedPlacement(scene([titles, broll], cut), 20 * S, 5 * S, "new")).toEqual({ mode: "auto", newTrack: true, insertIndex: 1 });
		expect(generatedPlacement(scene([titles, broll], cut), 20 * S, 5 * S, "v1")).toEqual({ mode: "explicit", trackId: "v1" });
		expect(generatedPlacement(scene([titles, broll], cut), 3 * S, 5 * S, "v1")).toEqual({ mode: "auto", newTrack: true, insertIndex: 1 });
		expect(generatedPlacement(scene([], cut), 3 * S, 5 * S, "main")).toEqual({ mode: "explicit", trackId: "main" });
		// no titles at all: a new track goes on top of the overlays
		expect(generatedPlacement(scene([broll], cut), 3 * S, 5 * S)).toEqual({ mode: "auto", newTrack: true, insertIndex: 0 });
	});
});
