import { describe, expect, test } from "bun:test";
import { audioKey, canonical, type TracksLike, transitionReach, videoKeys } from "../key";
import { cutFrames, segmentRanges } from "../segments";

const TPS = 120000;
const TPF = 4000;
const sec = (s: number) => Math.round(s * TPS);
const file = (text: string, size = 4000) => new Blob([text.padEnd(size, "x")], { type: "video/mp4" });

function project() {
	const assets = [
		{ id: "aaaaaaaa-0000-4000-8000-000000000001", name: "A.mp4", type: "video", duration: 600, width: 1280, height: 720, file: file("clip A") },
		{ id: "aaaaaaaa-0000-4000-8000-000000000002", name: "B.mp4", type: "video", duration: 600, width: 1280, height: 720, file: file("clip B") },
	];
	const tracks: TracksLike = {
		main: {
			id: "main",
			type: "video",
			muted: false,
			hidden: false,
			elements: [
				{ id: "v1", type: "video", mediaId: assets[0].id, startTime: 0, duration: sec(300), trimStart: 0, trimEnd: 0, params: { opacity: 1, volume: 1 } },
				{ id: "v2", type: "video", mediaId: assets[1].id, startTime: sec(300), duration: sec(300), trimStart: 0, trimEnd: 0, params: { opacity: 1, volume: 1 } },
			],
		},
		overlay: [
			{
				id: "titles",
				type: "text",
				hidden: false,
				elements: [
					{ id: "t1", type: "text", startTime: sec(60), duration: sec(3), trimStart: 0, trimEnd: 0, params: { content: "Chapter one" } },
					{ id: "t2", type: "text", startTime: sec(400), duration: sec(3), trimStart: 0, trimEnd: 0, params: { content: "Chapter two" } },
				],
			},
		],
		audio: [{ id: "music", type: "audio", muted: false, elements: [{ id: "m1", type: "audio", sourceType: "upload", mediaId: assets[1].id, startTime: 0, duration: sec(600), trimStart: 0, trimEnd: 0, params: { volume: 0.5 } }] }],
	};
	return { assets, tracks };
}
const visual = (tracks: TracksLike) => [...tracks.overlay, tracks.main].flatMap((t) => t.elements);
const frames = (tracks: TracksLike) => Math.ceil(Math.max(...visual(tracks).map((e) => e.startTime + e.duration)) / TPF);
const rangesOf = (tracks: TracksLike) => segmentRanges({ cuts: cutFrames({ elements: visual(tracks), ticksPerFrame: TPF, frameCount: frames(tracks) }), frameCount: frames(tracks), fps: 30 });
const keysOf = (p: ReturnType<typeof project>, global: unknown = { size: [1280, 720] }) => videoKeys({ tracks: p.tracks, assets: p.assets, ranges: rangesOf(p.tracks), ticksPerFrame: TPF, ticksPerSecond: TPS, global });
const clone = <T>(p: T): T => structuredClone(p);

describe("what a stretch of the film is", () => {
	test("the same content is the same text, whatever the order of its fields", () => {
		expect(canonical({ b: 1, a: [1, { d: 2, c: undefined, e: () => 1 }], url: "blob:http://x/1" })).toBe(canonical({ url: "blob:http://x/2", a: [1, { d: 2 }], b: 1 }));
		expect(canonical({ a: 1 })).not.toBe(canonical({ a: 1, later: true }));
		expect(canonical(new Float32Array([1, 2, 3]))).not.toBe(canonical(new Float32Array([1, 2, 4])));
	});
	test("two exports of the same project have the same keys", async () => {
		const a = await keysOf(project());
		const b = await keysOf(project());
		expect(a.length).toBeGreaterThan(100);
		expect(new Set(a).size).toBeGreaterThan(1);
		expect(b).toEqual(a);
	});
	test("one changed title changes only the stretches it can reach", async () => {
		const before = project();
		const after = project();
		(after.tracks.overlay[0].elements[0].params as { content: string }).content = "Chapter 1";
		const ranges = rangesOf(before.tracks);
		const [a, b] = [await keysOf(before), await keysOf(after)];
		const changed = ranges.filter((_r, i) => a[i] !== b[i]);
		expect(changed.length).toBeGreaterThan(0);
		// the title is at 60–63 s; a transition's reach here is 1 s: nothing outside 59–64 s is made again
		for (const r of changed) {
			expect((r.start + r.frames) / 30).toBeGreaterThan(59);
			expect(r.start / 30).toBeLessThan(64);
		}
		expect(changed.length).toBeLessThanOrEqual(3);
	});
	test("a part that only moved by whole frames keeps its keys; moved by part of a frame it does not", async () => {
		const before = project();
		const moved = (ticks: number) => {
			const p = project();
			const [v1, v2] = p.tracks.main.elements as unknown as Array<{ startTime: number; duration: number }>;
			v1.duration -= ticks;
			v2.startTime -= ticks;
			(p.tracks.overlay[0].elements[1] as { startTime: number }).startTime -= ticks;
			return p;
		};
		const tail = async (p: ReturnType<typeof project>, fromSeconds: number) => {
			const ranges = rangesOf(p.tracks);
			const keys = await keysOf(p);
			return keys.filter((_k, i) => ranges[i].start / 30 >= fromSeconds);
		};
		const whole = moved(sec(2));
		expect(await tail(whole, 300)).toEqual(await tail(before, 302));
		const part = moved(sec(2) + 1234);
		expect(await tail(part, 300)).not.toEqual(await tail(before, 302));
	});
	test("a file that holds something else under the same id and size is another file", async () => {
		const before = project();
		const after = project();
		after.assets[1].file = file("clip B, made again");
		const ranges = rangesOf(before.tracks);
		const [a, b] = [await keysOf(before), await keysOf(after)];
		for (let i = 0; i < ranges.length; i++) {
			// the second clip starts at 300 s (and reaches 1 s before it)
			if (ranges[i].start / 30 >= 300) expect(b[i]).not.toBe(a[i]);
			if ((ranges[i].start + ranges[i].frames) / 30 <= 298) expect(b[i]).toBe(a[i]);
		}
	});
	test("a field nobody knew of, a hidden track, the export's size: each makes other keys", async () => {
		const base = await keysOf(project());
		const extra = project();
		(extra.tracks.main.elements[0] as Record<string, unknown>).somethingNew = { strength: 0.3 };
		expect((await keysOf(extra))[0]).not.toBe(base[0]);
		const hidden = project();
		(hidden.tracks.overlay[0] as Record<string, unknown>).hidden = true;
		expect((await keysOf(hidden))[5]).not.toBe(base[5]);
		expect((await keysOf(project(), { size: [1920, 1080] }))[0]).not.toBe(base[0]);
		// a track's name, a clip's name or group: nothing on the picture
		const named = project();
		(named.tracks.main as Record<string, unknown>).name = "A-roll";
		(named.tracks.main.elements[0] as Record<string, unknown>).name = "Interview";
		expect(await keysOf(named)).toEqual(base);
	});
	test("what is only heard — level, pan, fades, audio effects, their keys — leaves the picture's keys alone", async () => {
		const base = await keysOf(project());
		const heard = project();
		const clip = heard.tracks.main.elements[0] as Record<string, unknown>;
		clip.params = { ...(clip.params as object), volume: -6, pan: 0.3, muted: true, fadeIn: 1.5, fadeOut: 2, duckUnderVoice: true, voiceRole: "voice", "fx.denoise": true, "fx.denoise.amount": 12 };
		clip.animations = { volume: { keys: [{ time: 0, value: 0 }, { time: 120000, value: -12 }] } };
		clip.isSourceAudioEnabled = false;
		expect(await keysOf(heard)).toEqual(base);
		// what is seen still counts: the same clip a little less opaque, or with a key on its opacity
		const seen = project();
		(seen.tracks.main.elements[0].params as Record<string, unknown>).opacity = 0.9;
		expect((await keysOf(seen))[0]).not.toBe(base[0]);
		const keyed = project();
		(keyed.tracks.main.elements[0] as Record<string, unknown>).animations = { opacity: { keys: [{ time: 0, value: 1 }] } };
		expect((await keysOf(keyed))[0]).not.toBe(base[0]);
		// a title's own «fadeIn» (were there one) is not a clip's sound: only clips with sound are read this way
		const title = project();
		(title.tracks.overlay[0].elements[0].params as Record<string, unknown>).fadeIn = 1;
		const ranges = rangesOf(title.tracks);
		const changed = (await keysOf(title)).filter((k, i) => k !== base[i] && ranges[i]);
		expect(changed.length).toBeGreaterThan(0);
	});
	test("a transition reaches across its cut", async () => {
		const p = project();
		expect(transitionReach(p.tracks, TPS)).toBe(TPS);
		const withTransition = clone(p);
		withTransition.assets = p.assets;
		(withTransition.tracks.main as Record<string, unknown>).transitions = [{ id: "x1", type: "studio.transition.whip", fromElementId: "v1", toElementId: "v2", duration: sec(4), params: {} }];
		expect(transitionReach(withTransition.tracks, TPS)).toBe(sec(4));
		const ranges = rangesOf(p.tracks);
		const [a, b] = [await keysOf(p), await keysOf(withTransition)];
		const changed = ranges.filter((_r, i) => a[i] !== b[i]).map((r) => [r.start / 30, (r.start + r.frames) / 30]);
		expect(changed.some(([from, to]) => from <= 299 && to >= 299)).toBe(true);
		expect(changed.some(([from, to]) => from <= 301 && to >= 301)).toBe(true);
	});
	test("the mix has one key: a title does not change it, a volume does, a muted track does", async () => {
		const audible = (p: ReturnType<typeof project>) => [...p.tracks.main.elements, ...p.tracks.audio[0].elements];
		const keyOf = (p: ReturnType<typeof project>) => audioKey({ elements: audible(p), tracks: p.tracks, assets: p.assets, global: { lufs: -14 } });
		const base = await keyOf(project());
		const title = project();
		(title.tracks.overlay[0].elements[0].params as { content: string }).content = "Another title";
		expect(await keyOf(title)).toBe(base);
		const quiet = project();
		(quiet.tracks.audio[0].elements[0].params as { volume: number }).volume = 0.25;
		expect(await keyOf(quiet)).not.toBe(base);
		const muted = project();
		(muted.tracks.audio[0] as Record<string, unknown>).muted = true;
		expect(await keyOf(muted)).not.toBe(base);
	});
});
