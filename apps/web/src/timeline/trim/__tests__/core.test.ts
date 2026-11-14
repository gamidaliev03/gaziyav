import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks, TimelineElement } from "@/timeline/types";
import type { TrimTarget } from "../types";

// The trim model's rules (core.ts) on plain tracks: what each of the four trims changes, to the frame, at 23.976, 25
// and 29.97 fps; where each stops; what follows on linked tracks.
let core: typeof import("../core");
let linkage: typeof import("@/timeline/linkage");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("../core");
	linkage = await import("@/timeline/linkage");
}, 120_000);

const S = 120000;
const RATES = {
	"23.976": { numerator: 24000, denominator: 1001 },
	"25": { numerator: 25, denominator: 1 },
	"29.97": { numerator: 30000, denominator: 1001 },
} as const;
type Rate = keyof typeof RATES;
const tpf = (rate: Rate) => (S * RATES[rate].denominator) / RATES[rate].numerator;

/** A clip from frame `start` for `length` frames, showing its file (`source` frames long) from frame `trim`. */
function clip(rate: Rate, id: string, start: number, length: number, trim = 0, source: number | null = 400, extra: Record<string, unknown> = {}): TimelineElement {
	const f = tpf(rate);
	return {
		id,
		name: id,
		type: source === null ? "text" : "video",
		...(source === null ? {} : { mediaId: `m-${id[0]}`, sourceDuration: source * f }),
		startTime: start * f,
		duration: length * f,
		trimStart: trim * f,
		trimEnd: source === null ? 0 : (source - trim - length) * f,
		params: {},
		...extra,
	} as unknown as TimelineElement;
}
/** The detached sound of a picture, in step with it. */
const soundOf = (picture: TimelineElement, id = `s${picture.id}`): TimelineElement =>
	({ ...picture, id, name: id, type: "audio", sourceType: "upload", isSourceAudioEnabled: undefined }) as unknown as TimelineElement;
const detached = (picture: TimelineElement): TimelineElement => ({ ...picture, isSourceAudioEnabled: false }) as unknown as TimelineElement;

function scene({ main = [], overlay = [], audio = [], text = [] }: { main?: TimelineElement[]; overlay?: TimelineElement[]; audio?: TimelineElement[]; text?: TimelineElement[] }): SceneTracks {
	return {
		overlay: [
			{ id: "t", name: "Text", type: "text", elements: text, hidden: false },
			{ id: "o", name: "Overlay", type: "video", elements: overlay, muted: false, hidden: false },
		],
		main: { id: "main", name: "Main", type: "video", elements: main, muted: false, hidden: false },
		audio: [{ id: "a", name: "Audio", type: "audio", elements: audio, muted: false }],
	} as unknown as SceneTracks;
}
const all = (tracks: SceneTracks) => [...tracks.overlay, tracks.main, ...tracks.audio].flatMap((track) => track.elements as TimelineElement[]);
const get = (tracks: SceneTracks, id: string) => all(tracks).find((element) => element.id === id) as TimelineElement;
/** [start, length, first file frame] in frames. */
const at = (rate: Rate, tracks: SceneTracks, id: string) => {
	const f = tpf(rate);
	const element = get(tracks, id);
	return [element.startTime / f, element.duration / f, element.trimStart / f];
};
const offGrid = (rate: Rate, tracks: SceneTracks) => all(tracks).filter((e) => !Number.isInteger(e.startTime / tpf(rate)) || !Number.isInteger((e.startTime + e.duration) / tpf(rate))).map((e) => e.id);
const plan = (rate: Rate, tracks: SceneTracks, target: TrimTarget, linkSound = true) => {
	const made = core.planTrim({ tracks, target, fps: RATES[rate], linkSound });
	if (!made) throw new Error("no plan");
	return made;
};
/** Three clips on the main track: a 0–100, b 100–200 (from frame 50 of its file), c 200–300 (from frame 20). */
const three = (rate: Rate) => scene({ main: [clip(rate, "a", 0, 100, 10), clip(rate, "b", 100, 100, 50), clip(rate, "c", 200, 100, 20)] });

for (const rate of Object.keys(RATES) as Rate[]) {
	const f = tpf(rate);
	describe(`at ${rate} fps`, () => {
		test("roll: the cut moves, one clip longer, the other shorter, the third and the length untouched", () => {
			const tracks = three(rate);
			const roll = plan(rate, tracks, { kind: "roll", trackId: "main", leftId: "a", rightId: "b" });
			const later = roll.apply(12 * f);
			expect(later.delta).toBe(12 * f);
			expect(at(rate, later.tracks, "a")).toEqual([0, 112, 10]);
			expect(at(rate, later.tracks, "b")).toEqual([112, 88, 62]);
			expect(at(rate, later.tracks, "c")).toEqual([200, 100, 20]);
			expect(later.tracks.overlay).toBe(tracks.overlay);
			const earlier = roll.apply(-7 * f);
			expect(at(rate, earlier.tracks, "a")).toEqual([0, 93, 10]);
			expect(at(rate, earlier.tracks, "b")).toEqual([93, 107, 43]);
			expect(offGrid(rate, later.tracks).concat(offGrid(rate, earlier.tracks))).toEqual([]);
			// a pointer between frames lands the cut on the nearest frame
			expect(roll.apply(Math.round(12.4 * f)).delta).toBe(12 * f);
			expect(roll.apply(Math.round(12.6 * f)).delta).toBe(13 * f);
		});

		test("roll stops where a file ends and where a clip would lose its last frame", () => {
			const tracks = three(rate);
			const roll = plan(rate, tracks, { kind: "roll", trackId: "main", leftId: "a", rightId: "b" });
			// b is 100 frames long: the cut can go 99 later; a's file has 290 frames after its end
			expect([roll.max / f, roll.maxLimit]).toEqual([99, "length"]);
			// b's file has 50 frames before its start; a is 100 long
			expect([roll.min / f, roll.minLimit]).toEqual([-50, "media"]);
			const far = roll.apply(1000 * f);
			expect([far.delta / f, far.limit]).toEqual([99, "length"]);
			expect(at(rate, far.tracks, "b")).toEqual([199, 1, 149]);
			const back = roll.apply(-1000 * f);
			expect([back.delta / f, back.limit]).toEqual([-50, "media"]);
			expect(at(rate, back.tracks, "b")).toEqual([50, 150, 0]);
			// a's file ends 5 frames after its end: that is as far as the cut goes
			const short = scene({ main: [clip(rate, "a", 0, 100, 10, 115), clip(rate, "b", 100, 100, 50)] });
			const tight = plan(rate, short, { kind: "roll", trackId: "main", leftId: "a", rightId: "b" });
			expect([tight.max / f, tight.maxLimit]).toEqual([5, "media"]);
			expect(tight.apply(5 * f).limit).toBeNull();
			expect(tight.apply(5 * f + 1).limit).toBe("media");
		});

		test("a limit between frames is not reached: the cut stops on the last whole frame", () => {
			// a's file ends 5.6 frames after its end
			const a = { ...clip(rate, "a", 0, 100, 10, 116), trimEnd: Math.round(5.6 * f), sourceDuration: Math.round(115.6 * f) } as TimelineElement;
			const tracks = scene({ main: [a, clip(rate, "b", 100, 100, 50)] });
			const roll = plan(rate, tracks, { kind: "roll", trackId: "main", leftId: "a", rightId: "b" });
			expect(roll.max / f).toBe(5);
			const far = roll.apply(40 * f);
			expect(far.delta / f).toBe(5);
			expect(offGrid(rate, far.tracks)).toEqual([]);
			expect(get(far.tracks, "a").trimEnd as number).toBe(Math.round(5.6 * f) - 5 * f);
		});

		test("ripple: the edge changes its clip, the clip keeps its start, every clip after it moves along", () => {
			const tracks = three(rate);
			const tail = plan(rate, tracks, { kind: "ripple", trackId: "main", elementId: "a", side: "right" });
			const shorter = tail.apply(-30 * f);
			expect(at(rate, shorter.tracks, "a")).toEqual([0, 70, 10]);
			expect(at(rate, shorter.tracks, "b")).toEqual([70, 100, 50]);
			expect(at(rate, shorter.tracks, "c")).toEqual([170, 100, 20]);
			const longer = tail.apply(15 * f);
			expect(at(rate, longer.tracks, "a")).toEqual([0, 115, 10]);
			expect(at(rate, longer.tracks, "c")).toEqual([215, 100, 20]);
			// the head of b pushed in 20 frames: b starts where it did, 20 frames later in its file; c closes up
			const head = plan(rate, tracks, { kind: "ripple", trackId: "main", elementId: "b", side: "left" });
			const cut = head.apply(20 * f);
			expect(at(rate, cut.tracks, "a")).toEqual([0, 100, 10]);
			expect(at(rate, cut.tracks, "b")).toEqual([100, 80, 70]);
			expect(at(rate, cut.tracks, "c")).toEqual([180, 100, 20]);
			// pulled out 30: 30 earlier frames show, c is pushed
			const open = head.apply(-30 * f);
			expect(at(rate, open.tracks, "b")).toEqual([100, 130, 20]);
			expect(at(rate, open.tracks, "c")).toEqual([230, 100, 20]);
			expect([head.min / f, head.minLimit, head.max / f, head.maxLimit]).toEqual([-50, "media", 99, "length"]);
			expect([tail.min / f, tail.minLimit, tail.max / f, tail.maxLimit]).toEqual([-99, "length", 290, "media"]);
			for (const result of [shorter, longer, cut, open]) expect(offGrid(rate, result.tracks)).toEqual([]);
		});

		test("ripple on a layer track moves that track's later clips and nothing else", () => {
			const tracks = scene({ main: [clip(rate, "a", 0, 300)], overlay: [clip(rate, "p", 10, 40, 5), clip(rate, "q", 60, 40), clip(rate, "r", 120, 30)] });
			const tail = plan(rate, tracks, { kind: "ripple", trackId: "o", elementId: "p", side: "right" });
			const longer = tail.apply(25 * f);
			// p grows over the gap and past where q was: q and r are pushed by the same 25, the gaps between them kept
			expect(at(rate, longer.tracks, "p")).toEqual([10, 65, 5]);
			expect(at(rate, longer.tracks, "q")).toEqual([85, 40, 0]);
			expect(at(rate, longer.tracks, "r")).toEqual([145, 30, 0]);
			expect(longer.tracks.main).toBe(tracks.main);
		});

		test("slip: the clip stays, its content moves; the file's ends stop it", () => {
			const tracks = three(rate);
			const slip = plan(rate, tracks, { kind: "slip", trackId: "main", elementId: "b" });
			// + moves the picture later: the clip starts earlier in its file
			const later = slip.apply(12 * f);
			expect(at(rate, later.tracks, "b")).toEqual([100, 100, 38]);
			expect(get(later.tracks, "b").trimEnd as number).toBe((400 - 38 - 100) * f);
			expect(at(rate, later.tracks, "a")).toEqual([0, 100, 10]);
			expect(at(rate, later.tracks, "c")).toEqual([200, 100, 20]);
			const earlier = slip.apply(-40 * f);
			expect(at(rate, earlier.tracks, "b")).toEqual([100, 100, 90]);
			expect([slip.min / f, slip.max / f]).toEqual([-250, 50]);
			const far = slip.apply(1000 * f);
			expect([far.delta / f, far.limit]).toEqual([50, "media"]);
			expect(at(rate, far.tracks, "b")).toEqual([100, 100, 0]);
			const back = slip.apply(-1000 * f);
			expect([back.delta / f, back.limit]).toEqual([-250, "media"]);
			expect(get(back.tracks, "b").trimEnd as number).toBe(0);
			// a title has no file to slip in
			expect(core.planTrim({ tracks: scene({ text: [clip(rate, "x", 0, 50, 0, null)] }), target: { kind: "slip", trackId: "t", elementId: "x" }, fps: RATES[rate] })).toBeNull();
		});

		test("slide: the clip moves with its content; the neighbours give and take the frames", () => {
			const tracks = three(rate);
			const slide = plan(rate, tracks, { kind: "slide", trackId: "main", elementId: "b" });
			const later = slide.apply(15 * f);
			expect(at(rate, later.tracks, "a")).toEqual([0, 115, 10]);
			expect(at(rate, later.tracks, "b")).toEqual([115, 100, 50]);
			expect(at(rate, later.tracks, "c")).toEqual([215, 85, 35]);
			const earlier = slide.apply(-15 * f);
			expect(at(rate, earlier.tracks, "a")).toEqual([0, 85, 10]);
			expect(at(rate, earlier.tracks, "b")).toEqual([85, 100, 50]);
			expect(at(rate, earlier.tracks, "c")).toEqual([185, 115, 5]);
			// later: c keeps a frame (99); a's file has 290 more. Earlier: c's file has 20 frames before its start; a keeps a frame.
			expect([slide.min / f, slide.minLimit, slide.max / f, slide.maxLimit]).toEqual([-20, "media", 99, "length"]);
			expect(offGrid(rate, later.tracks).concat(offGrid(rate, earlier.tracks))).toEqual([]);
			// the first clip of the main track stays at 0
			const first = plan(rate, tracks, { kind: "slide", trackId: "main", elementId: "a" });
			expect([first.min, first.max, first.apply(10 * f).limit]).toEqual([0, 0, "start"]);
			// the last clip: only its left neighbour gives and takes
			const last = plan(rate, tracks, { kind: "slide", trackId: "main", elementId: "c" }).apply(-10 * f);
			expect(at(rate, last.tracks, "b")).toEqual([100, 90, 50]);
			expect(at(rate, last.tracks, "c")).toEqual([190, 100, 20]);
		});
	});
}

describe("linked tracks", () => {
	const rate: Rate = "25";
	const f = tpf(rate);
	const kinds = new Set(["text", "sticker", "effect", "audio", "overlay"] as const);
	/** The trim, then what the editor's Linkage adds to every edit. */
	const linked = (tracks: SceneTracks, target: TrimTarget, delta: number) => {
		const result = plan(rate, tracks, target).apply(delta * f);
		return linkage.applyLinkage({ before: tracks, after: result.tracks, kinds });
	};
	/** Three pictures with their sound detached on the audio track and a title over the middle one. */
	const film = () => {
		const [a, b, c] = [clip(rate, "a", 0, 100, 10), clip(rate, "b", 100, 100, 50), clip(rate, "c", 200, 100, 20)].map(detached);
		return scene({ main: [a, b, c], audio: [soundOf(a), soundOf(b), soundOf(c)], text: [clip(rate, "x", 120, 40, 0, null)] });
	};
	const inStep = (tracks: SceneTracks) => ["a", "b", "c"].every((id) => linkage.isLockstepPair(get(tracks, `s${id}`), get(tracks, id)));

	test("the pictures' detached sounds stay in step through every trim (the same place in the same file)", () => {
		const tracks = film();
		expect(inStep(tracks)).toBe(true);
		const cases: Array<[TrimTarget, number]> = [
			[{ kind: "roll", trackId: "main", leftId: "a", rightId: "b" }, 12],
			[{ kind: "roll", trackId: "main", leftId: "b", rightId: "c" }, -9],
			[{ kind: "ripple", trackId: "main", elementId: "a", side: "right" }, -30],
			[{ kind: "ripple", trackId: "main", elementId: "b", side: "left" }, 20],
			[{ kind: "ripple", trackId: "main", elementId: "b", side: "left" }, -20],
			[{ kind: "slip", trackId: "main", elementId: "b" }, 17],
			[{ kind: "slip", trackId: "main", elementId: "b" }, -17],
			[{ kind: "slide", trackId: "main", elementId: "b" }, 15],
			[{ kind: "slide", trackId: "main", elementId: "b" }, -15],
		];
		for (const [target, delta] of cases) {
			const after = linked(tracks, target, delta);
			expect([target.kind, delta, inStep(after)]).toEqual([target.kind, delta, true]);
			expect([target.kind, delta, offGrid(rate, after)]).toEqual([target.kind, delta, []]);
		}
	});

	test("a file that ends between frames: a slip stops on its last whole frame, and the title it carries stays on frames", () => {
		for (const r of ["23.976", "29.97"] as Rate[]) {
			// a 12 s file (287.7 frames at 23.976, 359.6 at 29.97), c showing 96 frames of it with less than six left after
			const fr = tpf(r);
			const src = 12 * S;
			const k = Math.floor(src / fr + 1e-9) - 101;
			const c = detached(clip(r, "c", 192, 96, k, 1, { sourceDuration: src, trimEnd: src - (k + 96) * fr }));
			const tracks = scene({ main: [c], audio: [soundOf(c)], text: [clip(r, "y", 230, 30, 0, null)] });
			const room = (c.trimEnd as number) / fr;
			const made = plan(r, tracks, { kind: "slip", trackId: "main", elementId: "c" }).apply(-30 * fr);
			const after = linkage.applyLinkage({ before: tracks, after: made.tracks, kinds });
			expect([r, made.delta / fr, made.limit]).toEqual([r, -Math.floor(room + 1e-9), "media"]);
			expect((get(after, "c").trimEnd as number) / fr).toBeCloseTo(room - Math.floor(room + 1e-9), 9);
			expect([r, offGrid(r, after)]).toEqual([r, []]);
			expect(at(r, after, "y")[0]).toBe(230 - Math.floor(room + 1e-9));
			expect(linkage.isLockstepPair(get(after, "sc"), get(after, "c"))).toBe(true);
		}
	});

	test("the title over a clip goes with that clip's picture", () => {
		const tracks = film();
		// a ripple before it: the title moves with b
		expect(at(rate, linked(tracks, { kind: "ripple", trackId: "main", elementId: "a", side: "right" }, -30), "x")).toEqual([90, 40, 0]);
		// b slid 15 later: so is its title
		expect(at(rate, linked(tracks, { kind: "slide", trackId: "main", elementId: "b" }, 15), "x")).toEqual([135, 40, 0]);
		// the cut a|b rolled 12 later: b's picture did not move, nor does the title
		expect(at(rate, linked(tracks, { kind: "roll", trackId: "main", leftId: "a", rightId: "b" }, 12), "x")).toEqual([120, 40, 0]);
		// b slipped 17 later: the title stays on the frame of the picture it was put on
		expect(at(rate, linked(tracks, { kind: "slip", trackId: "main", elementId: "b" }, 17), "x")).toEqual([137, 40, 0]);
	});

	test("a picture on a layer track takes its detached sound along (Linkage does not follow layer clips)", () => {
		const p = detached(clip(rate, "p", 20, 60, 30));
		const q = detached(clip(rate, "q", 80, 40, 10));
		const tracks = scene({ main: [clip(rate, "a", 0, 300)], overlay: [p, q], audio: [soundOf(p), soundOf(q)] });
		const pair = (after: SceneTracks, id: string) => linkage.isLockstepPair(get(after, `s${id}`), get(after, id));
		const rolled = plan(rate, tracks, { kind: "roll", trackId: "o", leftId: "p", rightId: "q" }).apply(8 * f).tracks;
		expect([at(rate, rolled, "p"), at(rate, rolled, "sp"), pair(rolled, "p"), pair(rolled, "q")]).toEqual([[20, 68, 30], [20, 68, 30], true, true]);
		const slipped = plan(rate, tracks, { kind: "slip", trackId: "o", elementId: "p" }).apply(-10 * f).tracks;
		expect([at(rate, slipped, "sp"), pair(slipped, "p")]).toEqual([[20, 60, 40], true]);
		const rippled = plan(rate, tracks, { kind: "ripple", trackId: "o", elementId: "p", side: "right" }).apply(-10 * f).tracks;
		expect([at(rate, rippled, "q"), at(rate, rippled, "sq"), pair(rippled, "p"), pair(rippled, "q")]).toEqual([[70, 40, 10], [70, 40, 10], true, true]);
		// with Linkage off (or sounds taken off its list) the picture is trimmed alone
		const alone = plan(rate, tracks, { kind: "slip", trackId: "o", elementId: "p" }, false).apply(-10 * f).tracks;
		expect(at(rate, alone, "sp")).toEqual([20, 60, 30]);
		// linkage itself leaves what the trim did as it is
		expect(linkage.applyLinkage({ before: tracks, after: rolled, kinds })).toBe(rolled);
	});

	test("a ripple on a sound track stops before a sound that is in step with its picture", () => {
		const b = detached(clip(rate, "b", 100, 100, 50));
		const music = (id: string, start: number, length: number) => ({ ...clip(rate, id, start, length), type: "audio", sourceType: "upload" }) as unknown as TimelineElement;
		const tracks = scene({ main: [clip(rate, "a", 0, 100), b, clip(rate, "c", 200, 100)], audio: [music("m", 0, 40), music("n", 50, 30), soundOf(b), music("z", 220, 30)] });
		const tail = plan(rate, tracks, { kind: "ripple", trackId: "a", elementId: "m", side: "right" });
		// n may be pushed 20 frames, up to b's sound
		expect([tail.max / f, tail.maxLimit]).toEqual([20, "linked"]);
		const pushed = tail.apply(60 * f);
		expect([pushed.delta / f, pushed.limit]).toEqual([20, "linked"]);
		expect([at(rate, pushed.tracks, "m"), at(rate, pushed.tracks, "n"), at(rate, pushed.tracks, "sb"), at(rate, pushed.tracks, "z")]).toEqual([[0, 60, 0], [70, 30, 0], [100, 100, 50], [220, 30, 0]]);
		const pulled = tail.apply(-25 * f).tracks;
		expect([at(rate, pulled, "n"), at(rate, pulled, "sb"), at(rate, pulled, "z")]).toEqual([[25, 30, 0], [100, 100, 50], [220, 30, 0]]);
		expect(linkage.isLockstepPair(get(pulled, "sb"), get(pulled, "b"))).toBe(true);
		// with sounds off Linkage's list nothing holds the ripple
		const free = plan(rate, tracks, { kind: "ripple", trackId: "a", elementId: "m", side: "right" }, false);
		expect(free.maxLimit).toBe("media");
		expect(at(rate, free.apply(-25 * f).tracks, "sb")).toEqual([75, 100, 50]);
	});

	test("a locked track, a missing clip and clips that no longer touch give no trim", () => {
		const tracks = three(rate);
		const locked = { ...tracks, main: { ...tracks.main, locked: true } } as SceneTracks;
		expect(core.planTrim({ tracks: locked, target: { kind: "slip", trackId: "main", elementId: "b" }, fps: RATES[rate] })).toBeNull();
		expect(core.planTrim({ tracks, target: { kind: "slide", trackId: "main", elementId: "gone" }, fps: RATES[rate] })).toBeNull();
		const apart = scene({ overlay: [clip(rate, "p", 0, 40), clip(rate, "q", 50, 40)] });
		expect(core.planTrim({ tracks: apart, target: { kind: "roll", trackId: "o", leftId: "p", rightId: "q" }, fps: RATES[rate] })).toBeNull();
	});
});

describe("keyframes and speed", () => {
	const rate: Rate = "25";
	const f = tpf(rate);
	const keyed = (element: TimelineElement, times: number[]) =>
		({
			...element,
			animations: {
				opacity: { kind: "scalar", keys: times.map((time, i) => ({ id: `k${i}`, time: time * f, value: i / 10, interpolation: "linear" })) },
			},
		}) as unknown as TimelineElement;
	/** Where the keys the user set are now, in frames from the clip's start (the edit's own keys at a cut edge left out). */
	const keyTimes = (tracks: SceneTracks, id: string) => {
		const channel = (get(tracks, id).animations as Record<string, { keys: Array<{ id: string; time: number }> }> | undefined)?.opacity;
		return channel?.keys.filter((key) => /^k\d$/.test(key.id)).map((key) => key.time / f) ?? [];
	};

	test("keyframes keep their place in the picture: a slip and a moved head carry them, a moved tail leaves them", () => {
		const tracks = scene({ main: [clip(rate, "a", 0, 100, 10), keyed(clip(rate, "b", 100, 100, 50), [20, 60]), clip(rate, "c", 200, 100, 20)] });
		// slip 10 later: the picture and its keys sit 10 frames later in the clip
		expect(keyTimes(plan(rate, tracks, { kind: "slip", trackId: "main", elementId: "b" }).apply(10 * f).tracks, "b")).toEqual([30, 70]);
		// the cut a|b 12 later: b starts 12 later and so its keys are 12 earlier in it — the same frames of the film
		expect(keyTimes(plan(rate, tracks, { kind: "roll", trackId: "main", leftId: "a", rightId: "b" }).apply(12 * f).tracks, "b")).toEqual([8, 48]);
		// the cut b|c: b's tail moves, its keys stay
		expect(keyTimes(plan(rate, tracks, { kind: "roll", trackId: "main", leftId: "b", rightId: "c" }).apply(-10 * f).tracks, "b")).toEqual([20, 60]);
		// slide: b's content and keys are untouched
		expect(keyTimes(plan(rate, tracks, { kind: "slide", trackId: "main", elementId: "b" }).apply(15 * f).tracks, "b")).toEqual([20, 60]);
		// a slip that carries a key past the clip's end cuts it there, as a tail trim does; one that does not adds no key
		const slip = plan(rate, tracks, { kind: "slip", trackId: "main", elementId: "b" });
		const count = (after: SceneTracks) => (get(after, "b").animations as unknown as Record<string, { keys: unknown[] }>).opacity.keys.length;
		expect([keyTimes(slip.apply(45 * f).tracks, "b"), count(slip.apply(45 * f).tracks), count(slip.apply(10 * f).tracks)]).toEqual([[65], 2, 2]);
	});

	test("a clip at 2× gives and takes twice the file per frame of timeline", () => {
		const fast = { ...clip(rate, "b", 100, 100, 50, 400), trimEnd: (400 - 50 - 200) * f, retime: { rate: 2 } } as unknown as TimelineElement;
		const tracks = scene({ main: [clip(rate, "a", 0, 100, 10), fast, clip(rate, "c", 200, 100, 20)] });
		const rolled = plan(rate, tracks, { kind: "roll", trackId: "main", leftId: "a", rightId: "b" }).apply(10 * f).tracks;
		expect(at(rate, rolled, "b")).toEqual([110, 90, 70]);
		const slip = plan(rate, tracks, { kind: "slip", trackId: "main", elementId: "b" });
		// 50 file frames before its start at 2× are 25 frames of timeline
		expect([slip.max / f, slip.min / f]).toEqual([25, -75]);
		expect(at(rate, slip.apply(10 * f).tracks, "b")).toEqual([100, 100, 30]);
	});
});
