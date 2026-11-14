import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import { PLATFORMS, platformSpec } from "@/platforms/table";
import { BRIEF_TABLE, readBrief, secondsIn } from "../brief-words";
import { coverTransform, facePunchLimit, framingOf } from "../framing";
import { exposureOf, findRetakes, isFillerWord, judgeFrame, type JudgedFrame, type MaterialBrief, rankSentences, sentencesOf, speechFacts, type Word } from "../material";
import { type MixPart, mixGraph } from "../mix-graph";
import { autoPlan, chooseSentences, endCut, type MediaRef, startCut, tightRanges } from "../plan";
import { PRESETS, presetOf } from "../presets";
import { RECIPES, recipeOf } from "../recipes";
import { runReview, type ReviewElement, type ReviewInput } from "../review";
import { DEFAULT_TASTE, learnTaste, mergeTaste, normalizeTaste } from "../taste";

// Claude's production desk (docs/CLAUDE-PRODUCTION.md §1–6): the data is the app's own content, a brief of a few words
// is read the same way every time, the plan cuts on pauses and covers jump cuts, and the review flags what an editor
// would — with the planted ugly frames measured by native/framejudge.swift on the app's own photos.

let core: typeof import("@/core");
beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	const { registerDefaultEffects } = await import("@/effects");
	registerDefaultEffects();
}, 60_000);
afterAll(() => core?.EditorCore.reset());

describe("content the presets use exists in the app", () => {
	test("fonts, looks, transitions, motion templates, text presets, caption styles", async () => {
		const { BUNDLED_FONTS } = await import("@/fonts/bundled");
		const { LOOKS } = await import("@/effects/luts/looks");
		const { ALL_TRANSITIONS } = await import("@/transitions/definitions");
		const { MOGRAPH_BY_KIND } = await import("@/montage/mograph");
		const { TEXT_PRESETS } = await import("@/text/presets");
		const { CAPTION_STYLES } = await import("@/subtitles/styles");
		const fonts = new Set(BUNDLED_FONTS.map((f) => f.family));
		for (const p of PRESETS) {
			expect(fonts.has(p.fonts.display)).toBe(true);
			expect(fonts.has(p.fonts.text)).toBe(true);
			expect(p.fonts.display).not.toBe("Arial");
			expect(LOOKS.some((l) => l.id === p.grade.look)).toBe(true);
			if (p.transition.type) expect(ALL_TRANSITIONS.some((t) => t.type === p.transition.type)).toBe(true);
			for (const k of [p.motion.stat, p.motion.endScreen, p.motion.ctaShort, p.motion.chapter].filter(Boolean)) expect(MOGRAPH_BY_KIND.has(String(k))).toBe(true);
			for (const id of Object.values(p.text)) expect(TEXT_PRESETS.some((t) => t.id === id)).toBe(true);
			expect(CAPTION_STYLES.some((c) => c.id === p.captions.style)).toBe(true);
			// premium rules: 2–3 colours, eased moves of 0.2–0.4 s, wipes only where energetic
			expect(new Set(Object.values(p.palette)).size).toBeGreaterThanOrEqual(2);
			expect(p.moves.inSeconds).toBeGreaterThanOrEqual(0.2);
			expect(p.moves.inSeconds).toBeLessThanOrEqual(0.4);
			if (p.transition.type && /whip|spin|glitch/.test(p.transition.type)) expect(p.energetic).toBe(true);
		}
	});

	test("one platform table: export presets and the review read the same rows", async () => {
		const { EXPORT_PLATFORMS } = await import("@/export/defaults");
		expect(EXPORT_PLATFORMS.map((p) => p.id)).toEqual(PLATFORMS.map((p) => p.id));
		for (const p of PLATFORMS) {
			expect(p.export.lufs).toBe(-14);
			expect(p.safe.top + p.safe.bottom).toBeLessThan(p.size.height / 2);
			expect(EXPORT_PLATFORMS.find((e) => e.id === p.id)?.aspect).toBe(p.aspect);
		}
		expect(platformSpec("instagram")?.id).toBe("reels");
		expect(platformSpec("YouTube")?.id).toBe("youtube");
	});
});

describe("a brief of a few words", () => {
	const taste = normalizeTaste({});
	const cases: Array<[string, string, string, number | null]> = [
		["рилс из этого", "reel-talking-head", "reels", 30],
		["ютуб на 8 минут про кофе", "youtube-video", "youtube", 480],
		["промо для товара, дорого", "promo", "reels", 20],
		["нарезка из подкаста", "podcast-clips", "reels", 40],
		["tiktok from this, energetic", "reel-talking-head", "tiktok", 30],
		["3-minute YouTube explainer about solar panels", "explainer", "youtube", 180],
		["AI short from a script", "ai-short", "reels", 30],
	];
	for (const [words, recipe, platform, seconds] of cases) {
		test(words, () => {
			const b = readBrief(words, taste);
			expect(b.recipe).toBe(recipe as never);
			expect(b.platform).toBe(platform as never);
			if (seconds) expect(b.seconds).toBe(seconds);
		});
	}
	test("look and topic words", () => {
		expect(readBrief("промо для товара, дорого", taste).preset).toBe("luxury");
		expect(readBrief("ютуб на 8 минут про кофе", taste).topic).toBe("кофе");
		expect(readBrief("tiktok from this, energetic", taste).preset).toBe("energetic-reel");
		expect(secondsIn("полторы минуты")).toBe(90);
		expect(BRIEF_TABLE.length).toBeGreaterThanOrEqual(6);
	});
	test("the profile fills what the words don't say", () => {
		const mine = mergeTaste(taste, { platform: "tiktok", preset: "documentary", seconds: { short: 45 } });
		const b = readBrief("рилс из этого", mine);
		expect(b.preset).toBe("documentary");
		expect(b.seconds).toBe(45);
		expect(b.platform).toBe("reels");
		expect(readBrief("сделай из этого видео", mine).platform).toBe("tiktok");
	});
	test("learning from the user's changes", () => {
		let t = learnTaste(DEFAULT_TASTE, "captions.font", "Inter");
		t = learnTaste(t, "music.levelDb", -4);
		t = learnTaste(t, "music.levelDb", -2);
		expect(t.captions.font).toBe("Inter");
		expect(t.music.levelDb).toBe(-6);
		expect(t.learned[0].key).toBe("music.levelDb");
	});
});

// framejudge's numbers for the planted set (native/framejudge.swift on public/faces/hero.jpg and its spoiled copies).
const base: JudgedFrame = { t: 1, aesthetic: 0.98, sharp: 257, luma: 0.34, lumaStd: 0.19, clipHi: 0, clipLo: 0.011, castR: 0.067, castB: -0.051, colorful: 36, edges: 0.085, horizon: null, salient: [0.24, 0.19, 0.5, 0.6], faces: [{ box: [0.136, 0.207, 0.72, 0.72], quality: 0.58, eyes: 0.958 }] };

describe("judging a frame", () => {
	test("the good one is good, each planted fault is named", () => {
		const good = judgeFrame(base, { sharp: 250 });
		expect(good.flags).toEqual([]);
		expect(good.score).toBeGreaterThan(80);
		expect(judgeFrame({ ...base, aesthetic: -0.1, sharp: 4 }, { sharp: 250 }).flags).toContain("blurry");
		expect(judgeFrame({ ...base, aesthetic: 0.84, luma: 0.78, clipHi: 0.059 }).flags).toContain("overexposed");
		expect(judgeFrame({ ...base, faces: [], aesthetic: 0.74, horizon: 8.1 }).flags).toContain("tilted");
		const closed = judgeFrame({ ...base, aesthetic: 0.69, sharp: 81, faces: [{ box: base.faces[0].box, quality: 0.21, eyes: 0.325 }] }, { sharp: 250 });
		expect(closed.flags).toContain("eyes-closed");
		expect(closed.score).toBeLessThan(good.score - 25);
	});
});

// A talking clip: sentence 0 a greeting, 1 a retake of 2, 2 the strong line, 3 an ordinary one with a filler, 4 the end.
function talk(): { words: Word[]; brief: MaterialBrief } {
	const lines = [
		"Привет, меня зовут Анна.",
		"Главная ошибка новичков это",
		"Главная ошибка новичков это экономия на свете!",
		"Я снимаю э каждый день на телефон.",
		"Подпишись, чтобы не пропустить.",
	];
	const words: Word[] = [];
	let t = 0.5;
	for (const line of lines) {
		for (const w of line.split(" ")) {
			words.push({ text: w, start: t, end: t + 0.32 });
			t += 0.4;
		}
		t += 0.9;
	}
	const facts = speechFacts(words, t + 0.5);
	const cuts = [] as Array<{ lo: number; hi: number; end: number; start: number }>;
	for (let i = 0; i <= words.length; i++) {
		const lo = i ? words[i - 1].end : 0;
		const hi = i < words.length ? words[i].start : lo + 1.5;
		cuts.push({ lo, hi, end: Math.min(hi, lo + 0.12), start: Math.max(lo, hi - 0.1) });
	}
	const brief: MaterialBrief = {
		key: "vtalk",
		name: "talk.mp4",
		kind: "video",
		seconds: t + 0.5,
		width: 1080,
		height: 1920,
		fps: 30,
		hasAudio: true,
		shot: "close",
		faces: 1,
		faceBox: [0.3, 0.3, 0.4, 0.25],
		motion: "low",
		motionScore: 2,
		scenes: [],
		exposure: { luma: 0.4, clipHi: 0, clipLo: 0.01, verdict: "ok" },
		cast: { r: 0.02, b: -0.01, verdict: "neutral" },
		frames: [judgeFrame({ ...base, t: 2 })],
		looks: [],
		audio: { lufs: -20, truePeak: -3, lra: 4, noiseDb: -62, clipping: false, speechShare: 0.6 },
		speech: { language: "ru", words, pause: 0.3, cuts, ...facts },
		tags: ["talk", "close-up", "speech"],
		analysedAt: 0,
		version: 3,
	};
	return { words, brief };
}

describe("speech: sentences, retakes, hooks, cuts", () => {
	test("the retake is found, the strong line ranks first, the greeting last", () => {
		const { brief } = talk();
		const s = brief.speech!;
		expect(findRetakes(sentencesOf(s.words)).map((r) => r.i)).toContain(1);
		const ranked = rankSentences(sentencesOf(s.words));
		const top = [...ranked].sort((a, b) => b.hook - a.hook)[0];
		expect(top.text).toContain("экономия на свете");
		expect(ranked[0].hook).toBeLessThan(top.hook);
		expect(isFillerWord("э")).toBe(true);
	});
	test("pieces start and stop on the pause cut points; a filler splits a sentence", () => {
		const { brief } = talk();
		const s = brief.speech!;
		const strong = s.sentences[2];
		expect(startCut(s.cuts, strong.from)).toBeLessThan(strong.from);
		expect(endCut(s.cuts, strong.to)).toBeGreaterThan(strong.to);
		const withFiller = s.sentences[3];
		expect(tightRanges(withFiller, s.words, s.cuts, 0.6, isFillerWord).length).toBe(2);
		const pick = chooseSentences(s.sentences, 12, true);
		expect(pick.hook?.i).toBe(2);
		expect(pick.body.some((x) => x.retake)).toBe(false);
	});
});

function planFor(seconds: number) {
	const { brief } = talk();
	const media: MediaRef[] = [
		{ id: "talk-media-0001", name: "talk.mp4", type: "video", duration: brief.seconds, width: 1080, height: 1920, brief },
		{ id: "city-media-0002", name: "city.mp4", type: "video", duration: 6, width: 1080, height: 1920, brief: { ...brief, key: "vcity", name: "city.mp4", speech: undefined, shot: "no-face", faces: 0, faceBox: undefined, tags: ["city", "свет", "b-roll"], seconds: 6 } },
	];
	const preset = presetOf("clean-premium");
	const platform = platformSpec("reels")!;
	const plan = autoPlan({ recipe: recipeOf("reel-talking-head"), preset, platform, seconds, topic: "", language: "ru", media, input: {}, music: { id: "m1", url: "/api/library/file/m1", name: "Calm", dur: 60, gain: -2, bpm: 120, downbeats: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20] }, sfx: { hit: null, whoosh: { id: "s1", url: "/api/library/file/s1", name: "Whoosh", dur: 1 }, riser: null }, cta: "Подпишись", isFiller: isFillerWord });
	return { plan, media, preset, platform };
}

describe("the plan and its build", () => {
	test("hook first, retake out, jump cuts punched in, captions on the timeline clock, music ends on a bar", () => {
		const { plan } = planFor(12);
		expect(plan.pieces[0].role).toBe("hook");
		const { brief } = talk();
		expect(plan.pieces.some((p) => p.sentences.includes(1))).toBe(false);
		const jumps = plan.pieces.filter((p, i) => i && plan.pieces[i - 1].media === p.media);
		expect(jumps.every((p, i) => (i % 2 === 0 ? p.punch > 1 : true))).toBe(true);
		expect(plan.captions?.words[0].start).toBeLessThan(0.3);
		expect(plan.captions?.words.every((w) => w.end <= plan.seconds + 0.01)).toBe(true);
		expect(plan.music?.seconds).toBeLessThanOrEqual(plan.seconds);
		expect(plan.texts.some((t) => t.kind === "hook")).toBe(true);
		expect(plan.texts.some((t) => t.kind === "cta")).toBe(true);
		expect(brief.speech?.sentences.length).toBe(5);
	});

	test("compiled tracks commit as ONE undo step and come back whole", async () => {
		const { plan, media, preset, platform } = planFor(12);
		const { buildDefaultScene } = await import("@/timeline/scenes");
		const { compilePlan } = await import("../compile");
		const { TracksSnapshotCommand } = await import("@/commands/timeline");
		const { EditorCore } = core;
		EditorCore.reset();
		const ed = EditorCore.getInstance();
		ed.save.stop();
		const scene = buildDefaultScene({ name: "Main", isMain: true });
		ed.project.setActiveProject({ project: { metadata: { id: "p", name: "p", createdAt: new Date(0), updatedAt: new Date(0) }, scenes: [scene], currentSceneId: scene.id, settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 } }, version: 31 } as never });
		ed.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
		const before = ed.scenes.getActiveScene().tracks;
		const built = compilePlan({ plan, preset, platform, canvas: { width: 1080, height: 1920 }, media, before, fps: 30 });
		expect(built.tracks.main.elements.length).toBe(plan.pieces.length);
		// The editor's invariants: back to back to the tick, whole frames, never past a source's end.
		const mainEls = built.tracks.main.elements as Array<{ startTime: number; duration: number; trimStart: number; trimEnd: number; sourceDuration?: number }>;
		mainEls.forEach((e, i) => {
			if (i) expect(e.startTime).toBe(mainEls[i - 1].startTime + mainEls[i - 1].duration);
			expect(e.duration % 4000).toBe(0);
			expect(e.trimStart + e.duration + e.trimEnd).toBe(e.sourceDuration ?? 0);
			expect(e.trimEnd).toBeGreaterThanOrEqual(0);
		});
		const caps = built.tracks.overlay.find((t) => t.name === "Captions");
		expect(caps?.elements.length).toBeGreaterThan(0);
		// captions in the safe zone (Reels: 250 px top, 420 px bottom)
		for (const c of caps!.elements) {
			const y = 960 + Number(c.params["transform.positionY"]);
			expect(y).toBeGreaterThan(250);
			expect(y).toBeLessThan(1920 - 420);
		}
		const depth = ed.command.depth();
		ed.timeline.updateTracks(built.tracks);
		ed.command.push({ command: new TracksSnapshotCommand({ before, after: built.tracks }) });
		expect(ed.command.depth()).toBe(depth + 1);
		expect(ed.scenes.getActiveScene().tracks.main.elements.length).toBe(plan.pieces.length);
		ed.command.undo();
		expect(ed.scenes.getActiveScene().tracks.main.elements.length).toBe(0);
		ed.command.redo();
		expect(ed.scenes.getActiveScene().tracks.overlay.length).toBe(built.tracks.overlay.length);
	});
});

describe("the review", () => {
	const platform = platformSpec("reels")!;
	const preset = presetOf("clean-premium");
	const el = (over: Partial<ReviewElement>): ReviewElement => ({ id: `e${Math.random().toString(16).slice(2, 10)}`, type: "video", track: "m", trackType: "video", trackRole: "main", name: "x", start: 0, end: 1, params: {}, ...over });
	function input(over: Partial<ReviewInput> = {}): ReviewInput {
		const { brief } = talk();
		const media: MediaRef[] = [{ id: "talk", name: "talk.mp4", type: "video", duration: brief.seconds, width: 1080, height: 1920, brief }];
		const main = [
			el({ mediaId: "talk", start: 0, end: 2.5, trimStart: 0, params: { "transform.scaleX": 1, "transform.scaleY": 1 }, effects: [{ type: "studio.color", params: { look: "softContrast" } }] }),
			el({ mediaId: "talk", start: 2.5, end: 5, trimStart: 5 * 120000, params: { "transform.scaleX": 1.12, "transform.scaleY": 1.12 }, effects: [{ type: "studio.color", params: { look: "softContrast" } }] }),
			el({ mediaId: "talk", start: 5, end: 8, trimStart: 9 * 120000, params: { "transform.scaleX": 1, "transform.scaleY": 1 }, effects: [{ type: "studio.color", params: { look: "softContrast" } }] }),
		];
		const caption = (start: number, end: number, y = 230) => el({ type: "text", trackType: "text", trackRole: "overlay", start, end, params: { content: "word word", "caption.style": "karaoke", "caption.words": "0 0.2", fontSize: 4.6, "box.maxLines": 2, "transform.positionY": y, "stroke.enabled": true, fontFamily: "Inter", fontWeight: "600", color: "#FFFFFF" } });
		const elements = [
			...main,
			el({ type: "text", trackType: "text", trackRole: "overlay", name: "hook", start: 0, end: 2, params: { content: "Главная ошибка", fontSize: 6, "transform.positionY": -600, "anim.in": "fade", "anim.inDuration": 0.3, fontFamily: "Manrope", fontWeight: "800", color: "#FFFFFF" } }),
			...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => caption(k, k + 1)),
			el({ type: "video", trackRole: "overlay", trackType: "video", mediaId: "talk", start: 5.4, end: 7, params: { "transform.scaleX": 1, "transform.scaleY": 1 }, effects: [{ type: "studio.color", params: { look: "softContrast" } }] }),
			el({ type: "text", trackType: "text", trackRole: "overlay", name: "cta: Подпишись", start: 5.5, end: 8, params: { content: "Подпишись", fontSize: 4.4, "transform.positionY": 200, "anim.in": "fade", "anim.inDuration": 0.3, fontFamily: "Manrope", fontWeight: "800", color: "#FFFFFF" } }),
			el({ type: "audio", trackType: "audio", trackRole: "audio", name: "Calm", start: 0, end: 8, sourceUrl: "/api/library/file/m1", params: { duckUnderVoice: true, volume: -10, fadeOut: 1.5 } }),
		];
		return {
			platform,
			preset,
			recipe: recipeOf("reel-talking-head"),
			canvas: { width: 1080, height: 1920 },
			fps: 30,
			elements,
			transitions: [],
			media,
			measured: { lufs: -18, truePeak: -4, speechOverMusic: 16, sections: [{ from: 0, to: 4, lufs: -18 }, { from: 4, to: 8, lufs: -17 }], holes: [] },
			frames: [
				{ t: 0.6, verdict: judgeFrame(base), faces: [{ box: [0.3, 0.3, 0.4, 0.25], eyes: 0.95 }], luma: 0.4 },
				{ t: 4, verdict: judgeFrame({ ...base, t: 4 }), faces: [{ box: [0.3, 0.3, 0.4, 0.25], eyes: 0.95 }], luma: 0.4 },
			],
			seams: { problems: 0, text: "" },
			plannedSeconds: 8,
			exportNormalizes: true,
			waived: [],
			provenance: [],
			...over,
		};
	}

	test("a clean edit passes with ≥ 85 and every hard check", () => {
		const r = runReview(input());
		expect(r.hardFailed).toEqual([]);
		expect(r.score).toBeGreaterThanOrEqual(85);
		expect(r.cover?.t).toBe(0.6);
	});

	test("planted faults are named with their fixes: text over the eyes, captions under the buttons, music too loud, an eyes-closed frame", () => {
		const bad = input();
		const hook = bad.elements.find((e) => e.name === "hook")!;
		hook.params["transform.positionY"] = Math.round((0.38 - 0.5) * 1920);
		for (const c of bad.elements.filter((e) => e.params["caption.style"])) c.params["transform.positionY"] = 850;
		bad.measured = { ...bad.measured!, speechOverMusic: 6 };
		bad.frames = [...bad.frames, { t: 3, verdict: judgeFrame({ ...base, t: 3, faces: [{ box: base.faces[0].box, eyes: 0.3 }] }), faces: [{ box: [0.3, 0.3, 0.4, 0.25], eyes: 0.3 }], luma: 0.4 }];
		const r = runReview(bad);
		expect(r.hardFailed).toContain("text-face");
		expect(r.hardFailed).toContain("captions");
		expect(r.score).toBeLessThan(85);
		const ids = r.checks.filter((c) => c.score < 0.95).map((c) => c.id);
		expect(ids).toContain("music-level");
		expect(ids).toContain("beauty");
		const say = r.fixes.map((f) => f.say).join(" | ");
		expect(say).toMatch(/off the face/);
		expect(say).toMatch(/safe zone/);
		expect(r.cover?.t).not.toBe(3);
		// waived hard checks don't block
		const waived = runReview({ ...bad, waived: ["text-face", "captions"] });
		expect(waived.hardFailed).toEqual([]);
	});

	test("a wrong frame, a missing CTA and loudness off without the export's step fail hard", () => {
		const r = runReview({ ...input(), canvas: { width: 1920, height: 1080 }, exportNormalizes: false, elements: input().elements.filter((e) => !e.name.startsWith("cta")) });
		expect(r.hardFailed).toContain("aspect");
		expect(r.hardFailed).toContain("loudness");
		expect(r.checks.find((c) => c.id === "ending")?.score).toBeLessThan(1);
	});

	test("every recipe has numbers the review can use", () => {
		for (const r of RECIPES) {
			expect(r.seconds[0]).toBeLessThanOrEqual(r.seconds[1]);
			expect(r.seconds[1]).toBeLessThanOrEqual(r.seconds[2]);
			expect(platformSpec(r.platform)).toBeTruthy();
		}
	});
});

describe("genres without a talking clip", () => {
	const photo = (id: string, score = 70): MediaRef => ({ id, name: `${id}.jpg`, type: "image", width: 1920, height: 1280, brief: { ...talk().brief, key: id, name: `${id}.jpg`, kind: "image", seconds: 0, speech: undefined, shot: "no-face", faces: 0, faceBox: undefined, tags: [id], frames: [{ t: 0, score, flags: [], why: "" }] } });
	test("a photo story on the user's song: every cut on a bar, the song is the music", () => {
		const { brief } = talk();
		const song: MediaRef = { id: "song", name: "song.m4a", type: "audio", duration: 24, brief: { ...brief, key: "song", name: "song.m4a", kind: "audio", seconds: 24, speech: undefined, music: { bpm: 120, beats: [], downbeats: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22], bar: 2 }, frames: [], tags: ["music"] } };
		const plan = autoPlan({ recipe: recipeOf("photo-story"), preset: presetOf("documentary"), platform: platformSpec("reels")!, seconds: 20, topic: "", language: "ru", media: [photo("a"), photo("b"), photo("c"), song], input: {}, music: null, sfx: {}, cta: "", isFiller: isFillerWord });
		expect(plan.pieces.length).toBe(3);
		expect(new Set(plan.pieces.map((p) => p.media)).size).toBe(3);
		for (const p of plan.pieces) expect(Math.abs(p.at / 2 - Math.round(p.at / 2))).toBeLessThan(0.02);
		expect(plan.music?.pick.media).toBe("song");
	});
	test("a voice-over leads: one picture per sentence, captions from the voice", () => {
		const { brief } = talk();
		const vo: MediaRef = { id: "vo", name: "vo.m4a", type: "audio", duration: brief.seconds, brief: { ...brief, kind: "audio", frames: [] } };
		const plan = autoPlan({ recipe: recipeOf("documentary"), preset: presetOf("documentary"), platform: platformSpec("youtube")!, seconds: 60, topic: "", language: "ru", media: [vo, photo("a"), photo("b")], input: {}, music: null, sfx: {}, cta: "", isFiller: isFillerWord });
		expect(plan.voice?.media).toBe("vo");
		expect(plan.pieces.length).toBe(brief.speech!.sentences.filter((s) => !s.retake).length);
		expect(plan.pieces.every((p) => p.role === "still")).toBe(true);
	});
	test("a watermark in a corner is named and keeps a clip out of the B-roll", () => {
		const v = judgeFrame({ ...base, faces: [], cornerText: 1 });
		expect(v.flags).toContain("watermark");
		const letterboxed = judgeFrame({ ...base, bars: [0.22, 0.22, 0, 0] });
		expect(letterboxed.flags).not.toContain("dark");
	});
});

// Round 4: what the e2e's own outputs showed wrong — Vision's horizon on faces and patterns, high-key read as blown,
// our titles read as watermarks, a 16:9 close-up cut to 9:16 cutting the face, three stills stretched past the pace,
// and an edit without music getting no sound check. The numbers are what native/framejudge.swift reads on the test photos.
describe("Claude's eye without false alarms", () => {
	const frame = (over: Partial<JudgedFrame>): JudgedFrame => ({ ...base, faces: [], salient: [0.3, 0.3, 0.4, 0.4], ...over });

	test("a tilt is a line across the frame at that angle, not Vision's guess on a face, a manicure or a stage", () => {
		expect(judgeFrame(frame({ horizon: 8.125, horizonLine: 0.716, horizonGain: 0.365 })).flags).toContain("tilted"); // sea
		expect(judgeFrame(frame({ horizon: 5.75, horizonLine: 0.993, horizonGain: 0.264 })).flags).toContain("tilted"); // roofline
		expect(judgeFrame(frame({ horizon: 7.375, horizonLine: 0.601, horizonGain: 0.088 })).flags).not.toContain("tilted"); // nails
		expect(judgeFrame(frame({ horizon: 4.125, horizonLine: 0.696, horizonGain: -0.007 })).flags).not.toContain("tilted"); // stage
		expect(judgeFrame(frame({ horizon: -9.875, horizonLine: 0.628, horizonGain: 0.007 })).flags).not.toContain("tilted"); // fractal
		expect(judgeFrame({ ...base, horizon: -4.25, horizonLine: 0.595, horizonGain: -0.047 }).flags).not.toContain("tilted"); // portrait
	});

	test("blown is the face or the subject, not a white backdrop, a sunny wall or stage lights", () => {
		expect(judgeFrame(frame({ luma: 0.732, clipHi: 0, salientLuma: 0.636, salientClip: 0 })).flags).not.toContain("overexposed");
		expect(judgeFrame(frame({ luma: 0.599, clipHi: 0.092, salientLuma: 0.572, salientClip: 0.107 })).flags).not.toContain("overexposed");
		expect(judgeFrame(frame({ luma: 0.393, clipHi: 0.023, salientLuma: 0.499, salientClip: 0.035 })).flags).not.toContain("overexposed");
		expect(judgeFrame({ ...base, luma: 0.726, clipHi: 0.032, faceLuma: 0.811, faceClip: 0.049 }).flags).toContain("overexposed");
		expect(judgeFrame(frame({ luma: 0.779, clipHi: 0.432, salientLuma: 0.887, salientClip: 0.501 })).flags).toContain("overexposed");
		expect(judgeFrame({ ...base, luma: 0.2, clipLo: 0.4, faceLuma: 0.31 }).flags).not.toContain("dark"); // low-key, the face lit
		expect(judgeFrame({ ...base, luma: 0.08, clipLo: 0.5, faceLuma: 0.09 }).flags).toContain("dark");
		const highKey = [0, 1, 2].map((t) => frame({ t, luma: 0.73, clipHi: 0, salientLuma: 0.64, salientClip: 0 }));
		expect(exposureOf(highKey).verdict).toBe("ok");
		expect(exposureOf(highKey.map((f) => ({ ...f, clipHi: 0.3 }))).verdict).toBe("bright");
	});

	test("a colour cast is read on skin (a blue sea is the picture's colour); the frame cutting the forehead is a close-up", () => {
		expect(judgeFrame(frame({ castR: -0.161, castB: 0.213 })).flags).not.toContain("cast");
		expect(judgeFrame({ ...base, castR: 0.125, castB: -0.139 }).flags).toContain("cast");
		expect(judgeFrame({ ...base, faces: [{ box: [0.2, 0, 0.6, 0.7], eyes: 0.9 }] }).flags).not.toContain("face-cut");
		expect(judgeFrame({ ...base, faces: [{ box: [0, 0.2, 0.5, 0.5], eyes: 0.9 }] }).flags).toContain("face-cut");
	});

	const wide = { width: 1920, height: 1080 };
	const tall = { width: 1080, height: 1920 };
	const wideFace: [number, number, number, number] = [0.345, 0.263, 0.301, 0.535];

	test("a 16:9 close-up in a 9:16 frame sits framed in the middle: the face half the width, never cut, not blown up", () => {
		const fit = framingOf(wide, tall, wideFace);
		expect(fit).toBeLessThan(1);
		const t = coverTransform(wide, tall, 1, [0.5, 0.53], fit);
		expect(t.y).toBe(0);
		const faceShare = (wideFace[2] * 1920 * (1080 / 1920) * t.scale) / 1080;
		expect(faceShare).toBeGreaterThan(0.45);
		expect(faceShare).toBeLessThan(0.55);
		expect(t.upscale).toBeLessThan(1.1);
		expect(facePunchLimit(wide, tall, wideFace, fit)).toBeGreaterThan(1.5);
		// a vertical close-up fills a vertical frame; a 16:9 close-up fills a 16:9 frame
		expect(framingOf(tall, tall, [0.134, 0.339, 0.725, 0.408])).toBe(1);
		expect(framingOf(wide, wide, wideFace)).toBe(1);
		// a wide shot of a small face is cropped full-bleed on the face, as before
		expect(framingOf(wide, tall, [0.45, 0.3, 0.1, 0.2])).toBe(1);
	});

	test("the build frames that close-up (and asks for the look's plate as background); the punch-ins still hide the jump cuts", async () => {
		const { brief } = talk();
		const horizontal = { ...brief, width: 1920, height: 1080, faceBox: wideFace };
		const media: MediaRef[] = [{ id: "talk-media-0001", name: "talk.mp4", type: "video", duration: brief.seconds, width: 1920, height: 1080, brief: horizontal }];
		const preset = presetOf("podcast");
		const platform = platformSpec("reels")!;
		const plan = autoPlan({ recipe: recipeOf("podcast-clips"), preset, platform, seconds: 12, topic: "", language: "ru", media, input: {}, music: null, sfx: {}, cta: "", isFiller: isFillerWord });
		const { buildDefaultScene } = await import("@/timeline/scenes");
		const { compilePlan } = await import("../compile");
		const before = buildDefaultScene({ name: "Main", isMain: true }).tracks;
		const built = compilePlan({ plan, preset, platform, canvas: tall, media, before, fps: 30 });
		expect(built.framed).toBe(true);
		const scales = built.tracks.main.elements.map((e) => Number(e.params["transform.scaleX"]));
		// framed (well under the 3.16 of full bleed) and every face inside the frame
		for (const s of scales) {
			expect(s).toBeLessThan(2.4);
			expect((wideFace[2] * 1920 * (1080 / 1920) * s) / 1080).toBeLessThan(0.94);
		}
		const jumps = scales.slice(1).filter((s, i) => Math.abs(s - scales[i]) / Math.max(s, scales[i]) >= 0.05).length;
		expect(jumps / (scales.length - 1)).toBeGreaterThanOrEqual(0.9);
		// a vertical talking head stays full-bleed
		const upright = compilePlan({ ...planFor(12), canvas: tall, before, fps: 30 });
		expect(upright.framed).toBe(false);
	});

	test("one grade: a bright B-roll after the speaker is brought halfway (it stays brighter, it doesn't flash)", async () => {
		const { brief } = talk();
		const bright = { ...brief, key: "vcity", name: "city.mp4", speech: undefined, shot: "no-face" as const, faces: 0, faceBox: undefined, tags: ["city", "свет", "b-roll"], seconds: 6, exposure: { luma: 0.8, clipHi: 0.01, clipLo: 0, verdict: "ok" as const } };
		const { plan, media, preset, platform } = planFor(12);
		const withBright = media.map((m) => (m.id === "city-media-0002" ? { ...m, brief: bright } : m));
		const { buildDefaultScene } = await import("@/timeline/scenes");
		const { compilePlan } = await import("../compile");
		const built = compilePlan({ plan, preset, platform, canvas: tall, media: withBright, before: buildDefaultScene({ name: "Main", isMain: true }).tracks, fps: 30 });
		const insert = built.tracks.overlay.flatMap((t) => t.elements as Array<{ mediaId?: string }>).find((e) => e.mediaId === "city-media-0002");
		expect(insert).toBeDefined();
		const exposure = Number((insert as { effects: Array<{ type: string; params: Record<string, unknown> }> }).effects.find((f) => f.type === "studio.color")?.params.exposure);
		expect(exposure).toBeCloseTo(-0.5, 2); // log2(0.4 / 0.8) = −1 stop, halved
		const speaker = built.tracks.main.elements[1] as unknown as { effects: Array<{ type: string; params: Record<string, unknown> }> };
		expect(speaker.effects.find((f) => f.type === "studio.color")?.params.temperature ?? 0).toBe(0);
	});

	test("three product shots for 23 s: two shots each (the whole, then a detail), each within the pace", () => {
		const shot = (id: string): MediaRef => ({ id, name: `${id}.jpg`, type: "image", width: 1920, height: 1282, brief: { ...talk().brief, key: id, name: `${id}.jpg`, kind: "image", seconds: 0, width: 1920, height: 1282, speech: undefined, shot: "no-face", faces: 0, faceBox: undefined, salientBox: [0.4, 0.3, 0.25, 0.4], tags: [id], frames: [{ t: 0, score: 70, flags: [], why: "" }] } });
		const preset = presetOf("luxury");
		const plan = autoPlan({ recipe: recipeOf("promo"), preset, platform: platformSpec("reels")!, seconds: 23, topic: "", language: "ru", media: [shot("watch"), shot("phone"), shot("bag")], input: {}, music: null, sfx: {}, cta: "", isFiller: isFillerWord });
		expect(plan.pieces.length).toBe(6);
		for (const id of ["watch", "phone", "bag"]) {
			const own = plan.pieces.filter((p) => p.media === id);
			expect(own.length).toBe(2);
			expect(own[0].punch).toBeLessThan(1.1);
			expect(own[1].punch).toBeGreaterThan(1.2);
			expect(own[1].focus?.[0]).toBeCloseTo(0.525, 2);
		}
		for (const p of plan.pieces) expect(p.to - p.from).toBeLessThanOrEqual(preset.pace.reel[1] * 1.5 + 0.01);
	});

	test("the review: our titles in a corner are no watermark, a level source is not tilted, the face-cut fix frames wider", () => {
		const { brief } = talk();
		const media: MediaRef[] = [{ id: "talk", name: "talk.mp4", type: "video", duration: brief.seconds, width: 1080, height: 1920, brief }];
		const shot = (start: number, end: number, scale: number) => ({ id: `m${start}`, type: "video", track: "m", trackType: "video", trackRole: "main" as const, name: "talk", start, end, mediaId: "talk", trimStart: Math.round(start * 120000), params: { "transform.scaleX": scale, "transform.scaleY": scale }, effects: [{ type: "studio.color", params: { look: "softContrast" } }] });
		const ours = judgeFrame({ ...base, t: 0.6, cornerText: 2, horizon: 6, horizonLine: 0.9, horizonGain: 0.3 });
		expect(ours.flags).toEqual(expect.arrayContaining(["watermark", "tilted"]));
		const cut = judgeFrame({ ...base, t: 3, faces: [{ box: [0, 0.2, 0.5, 0.5], eyes: 0.9 }] });
		const r = runReview({
			platform: platformSpec("reels")!,
			preset: presetOf("clean-premium"),
			recipe: recipeOf("reel-talking-head"),
			canvas: tall,
			fps: 30,
			elements: [shot(0, 2.5, 1), shot(2.5, 5, 1.3)],
			transitions: [],
			media,
			measured: null,
			frames: [
				{ t: 0.6, verdict: ours, faces: [{ box: [0.3, 0.3, 0.4, 0.25], eyes: 0.95 }], luma: 0.4, horizon: 6 },
				{ t: 3, verdict: cut, faces: [{ box: [0, 0.2, 0.5, 0.5], eyes: 0.9 }], luma: 0.4 },
			],
			seams: null,
			exportNormalizes: true,
			waived: [],
			provenance: [],
		});
		const first = r.checks.find((c) => c.id === "beauty")!;
		expect(first.detail).not.toContain("0.6 s");
		expect(r.cover?.t).toBe(0.6);
		expect(r.cover?.why).not.toContain("watermark");
		const fix = first.fixes.find((f) => f.say.includes("face"));
		expect(fix?.steps[0]).toMatchObject({ op: "set", params: { "transform.scaleX": 1 } });
	});

	test("the sound check's graph: every split output is used once, with and without music", () => {
		const part = (role: MixPart["role"], at: number): MixPart => ({ key: "k", from: at, to: at + 2, at, gainDb: 0, fadeIn: 0.03, fadeOut: 0.03, rate: 1, role, duck: role === "music" });
		for (const parts of [[part("speech", 0), part("speech", 2)], [part("speech", 0), part("music", 0)], [part("music", 0)], [part("speech", 0), part("other", 1)]]) {
			const g = mixGraph(parts.map((p, i) => ({ p, file: i % 2 ? "/b.wav" : "/a.wav" })), 4, [[0, 4]]);
			const graph = g.chains.join(";");
			const outputs = new Set(g.outputs);
			// each label a filter makes is read by exactly one other filter, or mapped as an output
			const labels = [...graph.matchAll(/\[([a-z_0-9]+)\]/g)].map((m) => m[1]).filter((x) => !/^\d+:a$/.test(x));
			const count = new Map<string, number>();
			for (const l of labels) count.set(l, (count.get(l) ?? 0) + 1);
			expect(count.size).toBeGreaterThan(2);
			for (const [l, n] of count) expect(`${l}×${n}`).toBe(`${l}×${outputs.has(l) ? 1 : 2}`);
			expect(g.both).toBe(parts.some((p) => p.role === "speech") && parts.some((p) => p.role === "music"));
		}
	});
});
