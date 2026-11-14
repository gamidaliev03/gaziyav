import { describe, expect, test } from "bun:test";
import { readBrief } from "../brief-words";
import { CAMERA_MOVES, type CastMember, productionScript, shotList, shotPrompt } from "../shots";
import { normalizeTaste } from "../taste";

// Generated genres made like a crew: the cast's references in every shot that shows them, the next shot of a scene from
// the previous shot's last frame, the 180° rule in a dialogue, prompts from one template, drafts first, priced first.
describe("a 3-shot scene with one character", () => {
	const cast: CastMember[] = [{ id: "A", name: "Mira", look: "young woman, short dark hair", outfit: "red coat", sheet: "photo123" }];
	const shots = shotList({ lines: [{ who: "A", text: "Hi." }, { who: "A", text: "Look at this light." }], cast, seconds: 12 });
	const steps = productionScript({ shots, scenes: [{ n: 1, place: "a kitchen", light: "soft window light from the left", palette: "warm amber" }], cast, style: "cinematic", mood: "calm", family: "kling", aspect: "9:16" });

	test("establishing → medium → close, same scene", () => {
		expect(shots.map((s) => s.size)).toEqual(["establishing", "medium", "close"]);
		expect(new Set(shots.map((s) => s.scene)).size).toBe(1);
	});
	test("price first, the reference in the first shot, then each next shot starts from the previous last frame", () => {
		expect(steps[0].tool).toBe("price_plan");
		const pictures = steps.filter((s) => s.tool === "generate" && s.args.kind === "image");
		expect(pictures[0].args.refs).toEqual(["photo123"]);
		expect(pictures[1].args.refs).toEqual(["CLIP_1@last", "photo123"]);
		expect(pictures[2].args.refs).toEqual(["CLIP_2@last", "photo123"]);
		// cheapest first, priced the way generate picks: the pictures by their number of references, the drafts by length
		const items = steps[0].args.items as Array<Record<string, unknown>>;
		expect(items.filter((x) => x.kind === "image").map((x) => [x.refs ?? 0, x.count])).toEqual([
			[1, 1],
			[2, 2],
		]);
		expect(items.filter((x) => x.kind !== "voice").every((x) => x.model === "cheapest")).toBe(true);
		expect(steps.filter((s) => s.tool === "generate" && s.args.kind !== "voice" && s.args.quality !== "1080p").every((s) => s.args.model === "cheapest")).toBe(true);
		// every shot's prompt carries the same character, light and palette
		for (const p of pictures) {
			expect(String(p.args.prompt)).toContain("Mira (young woman, short dark hair, red coat");
			expect(String(p.args.prompt)).toContain("soft window light from the left, palette warm amber");
		}
	});
	test("cheap first: a picture, then animated at 480p in 2 drafts; the line voiced and lip-synced", () => {
		const videos = steps.filter((s) => s.tool === "generate" && s.args.kind === "video" && s.args.quality === "480p");
		expect(videos.length).toBe(3);
		expect(videos.every((v, i) => v.args.mode === "image" && v.args.from === `PIC_${i + 1}`)).toBe(true);
		expect(steps.filter((s) => s.args.kind === "lipsync").length).toBe(2);
		expect(String(videos[0].args.prompt)).toContain(String(CAMERA_MOVES["push-in"].words.kling));
	});
});

describe("a dialogue keeps the 180° rule", () => {
	test("A left looking right, B right looking left, over-shoulders alternate", () => {
		const cast: CastMember[] = [
			{ id: "A", name: "Ann", look: "a", outfit: "blue" },
			{ id: "B", name: "Bob", look: "b", outfit: "grey" },
		];
		const shots = shotList({ lines: [{ who: "A", text: "1" }, { who: "B", text: "2" }, { who: "A", text: "3" }], cast, seconds: 20 });
		expect(cast[0].side).toBe("left");
		expect(cast[1].side).toBe("right");
		expect(shots.slice(1).map((s) => s.who[0])).toEqual(["A", "B", "A"]);
		const p = shotPrompt(shots[1], { n: 1, place: "a cafe", light: "dusk", palette: "teal" }, cast, "cinematic", "tense");
		expect(p).toContain("on the left of the frame looking right");
	});
});

describe("every genre starts from one line", () => {
	const taste = normalizeTaste({});
	const cases: Array<[string, string]> = [
		["клип на эту песню, герой — с этого фото", "music-video"],
		["оживи это фото, пусть скажет: привет", "monologue-lipsync"],
		["диалог двух героев про камеру", "dialogue"],
		["мультик про кота", "cartoon"],
		["объясняющее видео на 3 минуты с инфографикой", "explainer"],
		["документалка про историю кино с кусками с ютуба", "documentary"],
		["слайдшоу из этих фото под музыку", "photo-story"],
		["трейлер для фильма", "trailer"],
		["туториал с записи экрана", "screen-tutorial"],
		["нарезка из подкаста", "podcast-clips"],
		["промо для товара", "promo"],
		["рилс из этого", "reel-talking-head"],
	];
	for (const [words, recipe] of cases) test(words, () => expect(readBrief(words, taste).recipe).toBe(recipe as never));
});
