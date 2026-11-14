import { describe, expect, test } from "bun:test";
import { platformSpec } from "@/platforms/table";
import type { MaterialBrief, Word } from "../material";
import type { MediaRef } from "../plan";
import { presetOf } from "../presets";
import { recipeOf } from "../recipes";
import { inferRecipe, platformFor, type ReviewElement, type ReviewInput, reuseOf, runReview, topPictures, vocalSpans } from "../review";

// The night of 09.11: a real Claude made the owner's music videos — half of each a slideshow of stills, the same AI
// clips 8–9 times, avatars sung for 135.17 s placed at 129.97 and 140.27, the singer never on screen in most verses —
// and review said 92/100 (it judged them as YouTube videos: no apply_plan record). A music video is judged as one now.

const T = 120000;
let n = 0;
const el = (over: Partial<ReviewElement>): ReviewElement => ({ id: `e${(n++).toString(16).padStart(8, "0")}`, type: "video", track: "main", trackType: "video", trackRole: "main", name: "x", start: 0, end: 1, params: {}, ...over });
const brief = (over: Partial<MaterialBrief>): MaterialBrief =>
	({ key: "k", name: "x", kind: "video", seconds: 5, width: 1080, height: 1920, hasAudio: false, shot: "medium", faces: 0.8, motion: "medium", motionScore: 6, scenes: [], exposure: { luma: 0.45, clipHi: 0.01, clipLo: 0.01, verdict: "ok" }, cast: { r: 0, b: 0, verdict: "neutral" }, frames: [], looks: [], tags: [], analysedAt: 0, version: 4, ...over }) as MaterialBrief;
const words = (spans: Array<[number, number]>): Word[] => spans.flatMap(([a, b]) => Array.from({ length: Math.floor((b - a) / 0.5) }, (_, i) => ({ text: `сл${i}`, start: a + i * 0.5, end: a + i * 0.5 + 0.4 })));

// The song: 60 s, sung 5–20 s and 30–45 s (two sections).
const SONG: MediaRef = { id: "song0001", name: "мама.mp3", type: "audio", duration: 60, brief: brief({ key: "song", name: "мама.mp3", kind: "audio", seconds: 60, hasAudio: true, speech: { language: "ru", words: words([[5, 20], [30, 45]]), sentences: [], quotes: [], retakes: [], fillers: [], deadAir: 0, fillerShare: 0, pause: 0.4, cuts: [] } }) };
const clip = (i: number, seconds = 5): MediaRef => ({ id: `clip${String(i).padStart(4, "0")}`, name: `AI Seedance ${i}.mp4`, type: "video", duration: seconds, width: 1080, height: 1920, brief: brief({ key: `c${i}`, name: `c${i}` }) });
const still = (i: number): MediaRef => ({ id: `pic${String(i).padStart(5, "0")}`, name: `AI Nano Banana ${i}.jpg`, type: "image", width: 1080, height: 1920, brief: brief({ key: `p${i}`, kind: "image", motion: "static", seconds: 0 }) });
const AVATAR_A: MediaRef = { id: "avat0001", name: "AI Kling AI Avatar 2 c90fd9.mp4", type: "video", duration: 3, width: 1080, height: 1920, brief: brief({ key: "a1", faces: 1 }) };
const AVATAR_B: MediaRef = { id: "avat0002", name: "AI Kling AI Avatar 2 d1e2f3.mp4", type: "video", duration: 3, width: 1080, height: 1920, brief: brief({ key: "a2", faces: 1 }) };

function input(elements: ReviewElement[], media: MediaRef[], over: Partial<ReviewInput> = {}): ReviewInput {
	return {
		platform: platformSpec("reels")!,
		preset: presetOf("energetic-reel"),
		recipe: recipeOf("music-video"),
		canvas: { width: 1080, height: 1920 },
		fps: 30,
		elements,
		transitions: [],
		media,
		measured: { lufs: -14, truePeak: -1.5, speechOverMusic: 3, sections: [{ from: 0, to: 30, lufs: -14 }, { from: 30, to: 60, lufs: -13 }], holes: [] },
		frames: [],
		seams: null,
		exportNormalizes: true,
		waived: [],
		provenance: [],
		sync: { avat0001: { at: 6, sound: "song0001", soundFrom: 6 }, avat0002: { at: 31, sound: "song0001", soundFrom: 31 } },
		song: { name: "мама.mp3", vocals: vocalSpans(SONG.brief!.speech!.words, { start: 0, end: 60, trimStart: 0 }), hasVocals: true },
		...over,
	};
}

const songEl = () => el({ type: "audio", track: "a1", trackType: "audio", trackRole: "audio", name: "мама.mp3", mediaId: SONG.id, start: 0, end: 60, trimStart: 0, params: { volume: 0 } });

/** A proper music video: 20 different moving shots of 3 s, the singer on screen at her own lines (5–20 s, 30–45 s). */
function proper() {
	const media: MediaRef[] = [SONG, AVATAR_A, AVATAR_B, still(1)];
	const elements: ReviewElement[] = [songEl()];
	for (let i = 0; i < 20; i++) {
		const m = clip(i);
		media.push(m);
		elements.push(el({ mediaId: m.id, name: m.name, start: i * 3, end: i * 3 + 3, trimStart: 0, layer: 1e6 }));
	}
	// a 1 s still flash (under 10 %), the avatars over the main track at their sound's time
	elements.push(el({ type: "image", trackRole: "overlay", track: "o1", mediaId: "pic00001", name: "AI Nano Banana 1.jpg", start: 25, end: 26, layer: 0 }));
	elements.push(el({ trackRole: "overlay", track: "o1", mediaId: AVATAR_A.id, name: AVATAR_A.name, start: 6, end: 9, trimStart: 0, layer: 0 }));
	elements.push(el({ trackRole: "overlay", track: "o1", mediaId: AVATAR_B.id, name: AVATAR_B.name, start: 31.5, end: 34, trimStart: 0.5 * T, layer: 0 }));
	return { media, elements };
}

/** Last night's: 30 % stills on main, one AI clip four times, an avatar sung for 31 s placed at 25 s, nobody singing 5–20 s. */
function slideshow() {
	const media: MediaRef[] = [SONG, AVATAR_B];
	const elements: ReviewElement[] = [songEl()];
	for (let i = 0; i < 6; i++) {
		const p = still(i);
		media.push(p);
		elements.push(el({ type: "image", mediaId: p.id, name: p.name, start: i * 3, end: i * 3 + 3, layer: 1e6, animated: true }));
	}
	const again = clip(99);
	media.push(again);
	for (let i = 6; i < 20; i++) {
		const m = i % 3 === 0 ? again : clip(i);
		if (m !== again) media.push(m);
		elements.push(el({ mediaId: m.id, name: m.name, start: i * 3, end: i * 3 + 3, trimStart: ((i % 2) * 1 + 0) * T, layer: 1e6 }));
	}
	elements.push(el({ trackRole: "overlay", track: "o1", mediaId: AVATAR_B.id, name: AVATAR_B.name, start: 25, end: 28, trimStart: 0, layer: 0 }));
	return { media, elements };
}

describe("a music video is judged as one", () => {
	test("last night's slideshow fails: stills, reuse, lips off their sound, nobody singing", () => {
		const { media, elements } = slideshow();
		const r = runReview(input(elements, media));
		expect(r.hardFailed).toEqual(expect.arrayContaining(["stills", "reuse", "lipsync", "singing"]));
		expect(r.score).toBeLessThan(85);
		const stills = r.checks.find((c) => c.id === "stills")!;
		expect(stills.detail).toMatch(/^30 %/);
		expect(r.checks.find((c) => c.id === "reuse")!.detail).toMatch(/AI Seedance 99\.mp4» [45]×/);
		const lips = r.checks.find((c) => c.id === "lipsync")!;
		expect(lips.detail).toMatch(/at 25 s \(its sound is at 31 s/);
		expect(lips.fixes[0].steps[0]).toEqual({ op: "move", id: expect.any(String), start: 31 });
		expect(r.checks.find((c) => c.id === "singing")!.detail).toMatch(/2 of 2 sung section\(s\) \(5–19\.9 s, 30–44\.9 s\)/);
	});

	test("a proper music video passes every hard check", () => {
		const { media, elements } = proper();
		const r = runReview(input(elements, media));
		expect(r.hardFailed).toEqual([]);
		for (const id of ["stills", "reuse", "lipsync", "singing"]) expect(r.checks.find((c) => c.id === id)?.score).toBe(1);
		expect(r.score).toBeGreaterThanOrEqual(85);
	});

	test("no B-roll share, end screen or jump cuts are asked of it; on YouTube neither", () => {
		const { media, elements } = proper();
		const yt = runReview({ ...input(elements, media), platform: platformSpec("youtube")!, canvas: { width: 1920, height: 1080 } });
		expect(yt.checks.find((c) => c.id === "ending")).toBeUndefined();
		expect(yt.checks.some((c) => c.id === "broll")).toBe(false);
		expect(yt.hardFailed).not.toContain("jumpcuts");
		expect(yt.checks.find((c) => c.id === "music-level")).toBeUndefined();
	});

	test("an avatar placed twice without its sound time stored: one of them is off", () => {
		const { media, elements } = proper();
		const twice = [...elements, el({ trackRole: "overlay", track: "o1", mediaId: AVATAR_A.id, name: AVATAR_A.name, start: 40, end: 43, trimStart: 0, layer: 0 })];
		const r = runReview(input(twice, media, { sync: {} }));
		expect(r.hardFailed).toContain("lipsync");
		expect(r.checks.find((c) => c.id === "lipsync")!.detail).toMatch(/placed 2×/);
	});

	test("the lips follow the song where it lies now: the song moved 2 s later, the avatar must too", () => {
		const { media, elements } = proper();
		const moved = elements.map((e) => (e.mediaId === SONG.id ? { ...e, start: 2, end: 62 } : e));
		const r = runReview(input(moved, media));
		expect(r.checks.find((c) => c.id === "lipsync")!.detail).toMatch(/its sound is at 8 s/);
	});

	test("the top picture decides: a still under a video is no still; a small picture-in-picture is no top", () => {
		const v = el({ start: 0, end: 4, layer: 1e6, mediaId: "clip0001" });
		const pic = el({ type: "image", trackRole: "overlay", track: "o1", start: 1, end: 3, layer: 0, mediaId: "pic00001" });
		const small = el({ type: "image", trackRole: "overlay", track: "o0", start: 0, end: 4, layer: 0, mediaId: "pic00002", params: { "transform.scaleX": 0.3, "transform.scaleY": 0.3 } });
		expect(topPictures([v, pic]).map((p) => [p.start, p.end, p.e?.type])).toEqual([[0, 1, "video"], [1, 3, "image"], [3, 4, "video"]]);
		expect(topPictures([v, small]).map((p) => p.e?.type)).toEqual(["video"]);
	});

	test("one shot cut away from and back to is one use; a long take's other parts are no reuse", () => {
		const m = clip(1, 12);
		const long = { ...clip(2), duration: 120 };
		const a = el({ mediaId: m.id, start: 0, end: 2, trimStart: 0 });
		const b = el({ mediaId: m.id, start: 4, end: 6, trimStart: 4 * T }); // the same offset: the shot goes on
		const c = el({ mediaId: long.id, start: 6, end: 8, trimStart: 10 * T });
		const d = el({ mediaId: long.id, start: 8, end: 10, trimStart: 50 * T });
		const uses = reuseOf([a, b, c, d], [m, long]);
		expect(uses.find((u) => u.id === m.id)?.uses).toBe(1);
		expect(uses.find((u) => u.id === long.id)?.uses).toBe(1);
	});
});

describe("what the edit is without a plan, and for which platform", () => {
	test("a song with vocals under the edit → music-video (stems, the hearing, a beat with sung words)", () => {
		const { media, elements } = proper();
		const heard = inferRecipe({ elements, media, heard: { music: 0.9, singing: 0.6, speech: 0 } });
		expect(heard?.recipe).toBe("music-video");
		expect(heard?.why).toMatch(/мама\.mp3/);
		// separated: the voice and music stems on the timeline, the song itself not
		const voice: MediaRef = { id: "voic0001", name: "мама · voice.m4a", type: "audio", duration: 60, stem: "voice", stemOf: SONG.id, brief: SONG.brief };
		const music: MediaRef = { id: "musi0001", name: "мама · music.m4a", type: "audio", duration: 60, stem: "music", stemOf: SONG.id };
		const stems = [...elements.filter((e) => e.mediaId !== SONG.id), { ...songEl(), mediaId: voice.id }, { ...songEl(), mediaId: music.id, track: "a2" }];
		expect(inferRecipe({ elements: stems, media: [...media, voice, music] })?.recipe).toBe("music-video");
		// a beat grid with sung words, no hearing model
		const gridSong: MediaRef = { ...SONG, brief: { ...SONG.brief!, music: { bpm: 172, beats: [], downbeats: [], bar: 1.4 } } };
		expect(inferRecipe({ elements, media: media.map((m) => (m.id === SONG.id ? gridSong : m)) })?.recipe).toBe("music-video");
	});

	test("a voice-over or a short sting is not a song", () => {
		const { media, elements } = proper();
		expect(inferRecipe({ elements, media, heard: { music: 0.1, singing: 0, speech: 0.9 } })).toBeNull();
		const sting = elements.map((e) => (e.mediaId === SONG.id ? { ...e, end: 4 } : e));
		expect(inferRecipe({ elements: sting, media, heard: { music: 0.9, singing: 0.6, speech: 0 } })).toBeNull();
	});

	test("the platform from the project's frame: 16:9 → YouTube, 9:16 → Reels, a 9:16 past 3 min → TikTok", () => {
		expect(platformFor({ width: 1920, height: 1080 }, 200, ["reels"]).id).toBe("youtube");
		expect(platformFor({ width: 1080, height: 1920 }, 60, ["reels"]).id).toBe("reels");
		expect(platformFor({ width: 1080, height: 1920 }, 60, ["youtube"]).id).toBe("reels");
		expect(platformFor({ width: 1080, height: 1920 }, 220, ["reels", "tiktok", "shorts"]).id).toBe("tiktok");
		expect(platformFor({ width: 1080, height: 1350 }, 30, ["reels"]).id).toBe("feed");
	});

	test("sung sections from the song's words: lines closer than 3.5 s are one section, a credit line is no singing", () => {
		const w = [...words([[5, 12], [14, 20]]), { text: "Субтитры", start: 55, end: 55.6 }, { text: "сделал", start: 55.7, end: 56.1 }, { text: "DimaTorzok", start: 56.2, end: 57 }, { text: "x", start: 57.1, end: 57.3 }];
		expect(vocalSpans(w, { start: 10, end: 80, trimStart: 0 })).toEqual([{ start: 15, end: 29.9 }]);
	});
});

// The review waits ≤ 10 s for briefs now (A8): a clip imported a moment ago has none yet. Its rendered frame's own
// exposure and watermark verdicts then stand (unless the edit's own text is on screen), and the review says so.
describe("frames of a clip whose brief isn't ready", () => {
	const frame = (t: number) => ({ t, verdict: { t, score: 60, flags: ["overexposed", "watermark"], why: "overexposed, watermark" }, faces: [], luma: 0.92 });
	test("its own verdict stands, the review names the media not analysed yet", () => {
		const pic = el({ type: "image", mediaId: "fresh001", start: 0, end: 4, layer: 1e6 });
		const r = runReview(input([pic], [{ id: "fresh001", name: "p3-overexposed.jpg", type: "image" }], { recipe: recipeOf("photo-story"), frames: [frame(2)], song: null }));
		expect(r.checks.find((c) => c.id === "beauty")!.detail).toMatch(/2 s overexposed/);
		expect(r.notes.join(" ")).toMatch(/1 media not analysed yet \(p3-overexposed\.jpg\)/);
	});
	test("with the edit's own title on screen the frame's exposure isn't the clip's", () => {
		const pic = el({ type: "image", mediaId: "fresh001", start: 0, end: 4, layer: 1e6 });
		const title = el({ type: "text", trackRole: "overlay", track: "t", start: 1, end: 3, params: { content: "HELLO", fontSize: 8 } });
		const r = runReview(input([pic, title], [{ id: "fresh001", name: "p3.jpg", type: "image" }], { recipe: recipeOf("photo-story"), frames: [frame(2)], song: null }));
		expect(r.checks.find((c) => c.id === "beauty")!.detail).not.toMatch(/overexposed/);
	});
});
