import { describe, expect, test } from "bun:test";
import { FAL_MODELS } from "../models";
import { cleanVideoOptions, endpointOf, inMode, lengthFromInput, takesPrompt, VIDEO_DEFAULTS, VIDEO_MODELS, VIDEO_MODES, type VideoModel, type VideoOptions, type VideoUrls, videoDefaults, videoInput, videoModel, videoModelTitle, videoModelsFor, videoPrice, videoProblem, videoSeconds } from "../video";

const m = (id: string) => videoModel(id) as VideoModel;
const U = "https://v3.fal.media/files/x";
const urls = { image: `${U}/a.png`, end: `${U}/b.png`, images: [`${U}/r1.png`, `${U}/r2.png`], video: `${U}/c.mp4`, audio: `${U}/d.mp3` };

describe("the catalog", () => {
	test("every mode has models and a default that belongs to it", () => {
		for (const mode of VIDEO_MODES) {
			expect(videoModelsFor(mode.id, { fal: true, kie: false }).length).toBeGreaterThan(1);
			expect(videoModel(VIDEO_DEFAULTS[mode.id])?.mode).toBe(mode.id);
		}
	});
	test("ids are unique and every price is a positive per-second rate", () => {
		expect(new Set(VIDEO_MODELS.map((x) => x.id)).size).toBe(VIDEO_MODELS.length);
		for (const x of VIDEO_MODELS) {
			for (const v of Object.values(x.rate)) expect(v).toBeGreaterThan(0);
			if (x.resolutions) for (const r of x.resolutions) expect(x.rate[r] ?? x.rate[""]).toBeGreaterThan(0);
			expect(videoPrice(x, videoDefaults(x))).toBeGreaterThan(0);
		}
	});
	test("the default of each mode is the cheapest of its mode or close to it", () => {
		for (const mode of VIDEO_MODES) {
			const def = videoPrice(m(VIDEO_DEFAULTS[mode.id]), videoDefaults(m(VIDEO_DEFAULTS[mode.id])));
			const cheapest = Math.min(...videoModelsFor(mode.id, { fal: true, kie: false }).map((x) => videoPrice(x, videoDefaults(x))));
			expect(def).toBeLessThanOrEqual(cheapest * 2.2);
		}
	});
	test("Settings lists the text models with their picture endpoints (for live prices)", () => {
		const video = FAL_MODELS.filter((x) => x.task === "video");
		expect(video.map((x) => x.id)).toEqual(videoModelsFor("text", { fal: true, kie: false }).map((x) => x.id));
		expect(video.find((x) => x.id.includes("seedance/v1/pro/fast"))?.i2v).toBe("fal-ai/bytedance/seedance/v1/pro/fast/image-to-video");
		expect(video.every((x) => !x.id.includes("#") && (!x.i2v || !x.i2v.includes("#")))).toBe(true);
	});
	test("a text model given a picture runs its picture endpoint; «#frames» entries call the real endpoint", () => {
		expect(inMode(m(VIDEO_DEFAULTS.text), "image")?.id).toBe(VIDEO_DEFAULTS.image);
		expect(endpointOf(m(VIDEO_DEFAULTS.frames))).toBe("fal-ai/bytedance/seedance/v1.5/pro/image-to-video");
		expect(inMode(m("decart/lucy-restyle"), "image")).toBeUndefined();
	});
});

describe("prices (fal's list prices per second)", () => {
	test("Seedance 1.0 Pro Fast: 720p 5 s ≈ $0.11, 1080p ≈ $0.24", () => {
		const s = m(VIDEO_DEFAULTS.text);
		expect(videoPrice(s, { duration: 5 })).toBeCloseTo(0.108, 3);
		expect(videoPrice(s, { duration: 5, resolution: "1080p" })).toBeCloseTo(0.243, 3);
	});
	test("sound costs more where fal bills it: Veo 3.1 Fast, Kling 3.0, Seedance 1.5", () => {
		expect(videoPrice(m("fal-ai/veo3.1/fast"), { duration: 8 })).toBeCloseTo(0.8, 5);
		expect(videoPrice(m("fal-ai/veo3.1/fast"), { duration: 8, audio: true })).toBeCloseTo(1.2, 5);
		expect(videoPrice(m("fal-ai/veo3.1/fast"), { duration: 4, resolution: "4k", audio: true })).toBeCloseTo(1.4, 5);
		expect(videoPrice(m("fal-ai/kling-video/v3/standard/text-to-video"), { duration: 5, audio: true })).toBeCloseTo(0.63, 5);
		expect(videoPrice(m("fal-ai/bytedance/seedance/v1.5/pro/text-to-video"), { duration: 5, audio: true })).toBeCloseTo(0.259, 3);
	});
	test("sound is free where it is: Seedance 2.0, Vidu Q4", () => {
		const s2 = m("bytedance/seedance-2.0/fast/text-to-video");
		expect(videoPrice(s2, { duration: 5, audio: true })).toBe(videoPrice(s2, { duration: 5, audio: false }));
		// (its first resolution is 540p now, the cheap one the Reference mode starts on: $0.0315/s; 720p stays $0.0665/s)
		expect(videoPrice(m("fal-ai/vidu/q4/reference-to-video"), { duration: 5, images: 2 })).toBeCloseTo(0.1575, 4);
		expect(videoPrice(m("fal-ai/vidu/q4/reference-to-video"), { duration: 5, images: 2, resolution: "720p" })).toBeCloseTo(0.3325, 4);
	});
	test("MiniMax H3: by resolution, reference pictures past five cost $0.08 each", () => {
		const h3 = m("minimax/h3/reference-to-video");
		expect(videoPrice(h3, { duration: 5, images: 3 })).toBeCloseTo(0.3, 5);
		expect(videoPrice(h3, { duration: 5, images: 7 })).toBeCloseTo(0.46, 5);
		expect(videoPrice(m("minimax/h3/text-to-video"), { duration: 10, resolution: "4K" })).toBeCloseTo(1.6, 5);
	});
	test("motion, edits and avatars are billed by the input's length, up to what the model takes", () => {
		const mc = m(VIDEO_DEFAULTS.motion);
		expect(videoPrice(mc, { inputSeconds: 5 })).toBeCloseTo(0.35, 5);
		expect(videoPrice(mc, { inputSeconds: 5.04 })).toBeCloseTo(0.35, 5);
		expect(videoSeconds(mc, { inputSeconds: 25, orientation: "image" })).toBe(10);
		expect(videoSeconds(mc, { inputSeconds: 25, orientation: "video" })).toBe(25);
		expect(videoPrice(m("decart/lucy-restyle"), { inputSeconds: 12.3 })).toBeCloseTo(0.13, 5);
		expect(videoPrice(m(VIDEO_DEFAULTS.avatar), { inputSeconds: 10 })).toBeCloseTo(0.562, 5);
		expect(videoPrice(m("veed/fabric-1.0"), { inputSeconds: 10, resolution: "720p" })).toBeCloseTo(1.5, 5);
	});
	test("a length or resolution the model doesn't offer falls back to its default", () => {
		const k = m("fal-ai/kling-video/v2.6/pro/image-to-video");
		expect(videoSeconds(k, cleanVideoOptions(k, { duration: 7 }))).toBe(5);
		expect(videoPrice(k, { duration: 7, resolution: "4K" })).toBeCloseTo(0.35, 5);
	});
});

describe("fal inputs, field by field", () => {
	test("Seedance 1.0 Pro Fast text and picture", () => {
		expect(videoInput(m(VIDEO_DEFAULTS.text), { prompt: " Waves ", duration: 5, aspect: "9:16", resolution: "720p", seed: 7 }, {})).toEqual({ prompt: "Waves", duration: "5", resolution: "720p", aspect_ratio: "9:16", seed: 7 });
		expect(videoInput(m(VIDEO_DEFAULTS.image), { prompt: "Go", ...videoDefaults(m(VIDEO_DEFAULTS.image)) }, urls)).toEqual({ prompt: "Go", duration: "5", resolution: "720p", aspect_ratio: "auto", image_url: urls.image });
	});
	test("Veo 3.1 Fast: «4s», generate_audio, first_frame_url / last_frame_url between frames", () => {
		expect(videoInput(m("fal-ai/veo3.1/fast"), { prompt: "x", duration: 6, aspect: "16:9", audio: true, negative: " blur " }, {})).toEqual({ prompt: "x", duration: "6s", resolution: "720p", generate_audio: true, aspect_ratio: "16:9", negative_prompt: "blur" });
		const flf = videoInput(m("fal-ai/veo3.1/fast/first-last-frame-to-video"), { prompt: "x" }, urls);
		expect(flf.first_frame_url).toBe(urls.image);
		expect(flf.last_frame_url).toBe(urls.end);
		expect("image_url" in flf).toBe(false);
	});
	test("Kling: start_image_url / end_image_url, string durations, no seed", () => {
		const k = videoInput(m("fal-ai/kling-video/v3/standard/image-to-video#frames"), { prompt: "x", duration: 8, seed: 3, aspect: "9:16" }, urls);
		expect(k).toEqual({ prompt: "x", duration: "8", generate_audio: false, start_image_url: urls.image, end_image_url: urls.end });
		const t = videoInput(m("fal-ai/kling-video/v3/standard/text-to-video"), { prompt: "x", aspect: "4:3" }, {});
		expect(t.aspect_ratio).toBe("9:16");
	});
	test("MiniMax H3: integer duration, 768P sent (fal's own default is 2K)", () => {
		expect(videoInput(m("minimax/h3/text-to-video"), { prompt: "x", duration: 6 }, {})).toEqual({ prompt: "x", duration: 6, resolution: "768P", aspect_ratio: "9:16" });
		expect(videoInput(m("minimax/h3/image-to-video#frames"), { prompt: "x" }, urls)).toEqual({ prompt: "x", duration: 5, resolution: "768P", image_url: urls.image, end_image_url: urls.end });
		expect(videoInput(m("minimax/h3/reference-to-video"), { prompt: "x" }, urls).reference_image_urls).toEqual(urls.images);
	});
	test("reference models name their picture lists as fal does", () => {
		expect(videoInput(m("fal-ai/vidu/q4/reference-to-video"), { prompt: "x" }, urls)).toMatchObject({ reference_image_urls: urls.images, audio: true, duration: 5 });
		expect(videoInput(m("fal-ai/kling-video/o3/standard/reference-to-video"), { prompt: "x" }, urls)).toMatchObject({ image_urls: urls.images, generate_audio: false, duration: "5" });
		expect(videoInput(m("bytedance/seedance-2.0/mini/reference-to-video"), { prompt: "x" }, urls)).toMatchObject({ image_urls: urls.images, generate_audio: true, duration: "5" });
	});
	test("motion control: image_url, video_url, character_orientation, keep_original_sound", () => {
		expect(videoInput(m(VIDEO_DEFAULTS.motion), { prompt: "", orientation: "image", keepSound: false }, urls)).toEqual({ image_url: urls.image, video_url: urls.video, character_orientation: "image", keep_original_sound: false });
		expect(videoInput(m("fal-ai/kling-video/v3/pro/motion-control"), { prompt: "dance" }, urls)).toEqual({ image_url: urls.image, video_url: urls.video, character_orientation: "video", keep_original_sound: true, prompt: "dance" });
	});
	test("edits: Lucy, Wan 2.7 (audio_setting, reference_image_url), Kling O3 (keep_audio, image_urls)", () => {
		expect(videoInput(m("decart/lucy-restyle"), { prompt: "anime" }, { video: urls.video })).toEqual({ prompt: "anime", video_url: urls.video });
		expect(videoInput(m("fal-ai/wan/v2.7/edit-video"), { prompt: "snow", keepSound: false }, { video: urls.video, image: urls.image })).toEqual({ prompt: "snow", video_url: urls.video, resolution: "720p", audio_setting: "auto", reference_image_url: urls.image });
		expect(videoInput(m("fal-ai/kling-video/o3/standard/video-to-video/edit"), { prompt: "night" }, { video: urls.video, image: urls.image })).toEqual({ prompt: "night", video_url: urls.video, keep_audio: true, image_urls: [urls.image] });
	});
	test("avatars: image_url + audio_url (a prompt only when typed; resolution where the model has one)", () => {
		expect(videoInput(m(VIDEO_DEFAULTS.avatar), { prompt: " " }, urls)).toEqual({ image_url: urls.image, audio_url: urls.audio });
		expect(videoInput(m("fal-ai/bytedance/omnihuman/v1.5"), { prompt: "sings" }, urls)).toEqual({ image_url: urls.image, audio_url: urls.audio, prompt: "sings", resolution: "720p" });
		expect(videoInput(m("veed/fabric-1.0"), { prompt: "x" }, urls)).toEqual({ image_url: urls.image, audio_url: urls.audio, resolution: "480p" });
	});
});

describe("what the page shows is what fal gets", () => {
	const last = <T,>(list?: T[]) => list?.[list.length - 1];
	/** The inputs the page offers in each mode (video-composer.tsx). */
	const offered = (x: VideoModel): VideoUrls => {
		switch (x.mode) {
			case "text":
				return {};
			case "image":
				return { image: urls.image };
			case "frames":
				return { image: urls.image, end: urls.end };
			case "reference":
				return { images: urls.images };
			case "motion":
				return { image: urls.image, video: urls.video };
			case "edit":
				return { video: urls.video, ...(x.picture ? { image: urls.image } : {}) };
			case "avatar":
				return { image: urls.image, audio: urls.audio };
			case "extend":
				return { video: urls.video };
		}
	};
	test("every model: each setting it shows is sent, none it hides is (VEED Fabric showed a prompt it never sent)", () => {
		for (const x of VIDEO_MODELS) {
			// Not the defaults: the last of each list, sound on, a seed, a negative, the photo's orientation, sound off.
			const o: VideoOptions = { prompt: "A cat dances", duration: last(x.durations), aspect: last(x.aspects), resolution: last(x.resolutions), audio: true, seed: 7, negative: "blur", orientation: "image", keepSound: false, inputSeconds: 5, images: 2 };
			const input = videoInput(x, o, urls) as Record<string, unknown>;
			const why = x.id;
			expect([why, Object.values(input).includes("A cat dances")]).toEqual([why, takesPrompt(x)]);
			expect([why, input.seed === 7]).toEqual([why, !!x.seed]);
			expect([why, input.negative_prompt === "blur"]).toEqual([why, !!x.negative]);
			expect([why, input.aspect_ratio]).toEqual([why, x.aspects?.length ? o.aspect : undefined]);
			if (x.resolutions?.length) expect([why, input.resolution]).toEqual([why, o.resolution]);
			expect([why, input.generate_audio === true || input.audio === true]).toEqual([why, !!x.sound]);
			if (x.durations?.length && !lengthFromInput(x.mode)) expect([why, String(input.duration).replace(/s$/, "")]).toEqual([why, String(o.duration)]);
			expect([why, input.character_orientation === "image"]).toEqual([why, !!x.orientation]);
			if (x.keepSound) expect([why, input.keep_original_sound === false || input.keep_audio === false || input.audio_setting === "auto"]).toEqual([why, true]);
			// Every input the mode asks for goes, and none of another mode's.
			const sent = JSON.stringify(input);
			const want = offered(x);
			for (const url of [urls.image, urls.end, ...urls.images, urls.video, urls.audio]) {
				const asked = Object.values(want).flat().includes(url);
				expect([why, url, sent.includes(url)]).toEqual([why, url, asked]);
			}
		}
	});
	test("a model without a description takes no prompt: none is sent and none is checked", () => {
		const fabric = m("veed/fabric-1.0");
		expect(takesPrompt(fabric)).toBe(false);
		expect(cleanVideoOptions(fabric, { prompt: "smile" }).prompt).toBeUndefined();
		expect(videoProblem(fabric, { prompt: "x".repeat(5000) }, { image: true, audio: true })).toBeNull();
		expect(VIDEO_MODELS.filter((x) => !takesPrompt(x)).map((x) => x.id)).toEqual(["veed/fabric-1.0"]);
	});
	test("a job names its model by the catalog's title, from its id or its fal endpoint", () => {
		// The run card showed «fal-ai/bytedance/seedance/v1/pro/fast/text-to-video».
		expect(videoModelTitle("fal-ai/bytedance/seedance/v1/pro/fast/text-to-video")).toBe("Seedance 1.0 Pro Fast");
		expect(videoModelTitle("fal-ai/kling-video/v2.6/pro/image-to-video#frames")).toBe("Kling 2.6 Pro");
		expect(videoModelTitle("fal-ai/kling-video/v2.6/pro/image-to-video")).toBe("Kling 2.6 Pro");
		expect(videoModelTitle("veed/fabric-1.0")).toBe("VEED Fabric 1.0");
		expect(videoModelTitle("nope/model")).toBeUndefined();
		expect(videoModelTitle(undefined)).toBeUndefined();
	});
});

describe("what a mode needs", () => {
	test("each mode asks for its own inputs", () => {
		expect(videoProblem(m(VIDEO_DEFAULTS.text), { prompt: "" }, {})?.text).toBe("Describe what happens in the shot.");
		expect(videoProblem(m(VIDEO_DEFAULTS.image), { prompt: "x" }, {})?.text).toBe("Pick the start frame.");
		expect(videoProblem(m(VIDEO_DEFAULTS.frames), { prompt: "x" }, { image: true })?.text).toBe("Pick the first and the last frame.");
		expect(videoProblem(m(VIDEO_DEFAULTS.reference), { prompt: "x" }, {})?.text).toBe("Pick at least one reference picture.");
		expect(videoProblem(m("fal-ai/kling-video/o3/standard/reference-to-video"), { prompt: "x" }, { images: 5 })?.vars?.n).toBe(4);
		expect(videoProblem(m(VIDEO_DEFAULTS.motion), {}, { image: true })?.text).toBe("Pick the clip with the motion.");
		expect(videoProblem(m(VIDEO_DEFAULTS.motion), {}, { image: true, video: true })).toBeNull();
		expect(videoProblem(m(VIDEO_DEFAULTS.edit), { prompt: "" }, { video: true })?.text).toBe("Describe what to change.");
		expect(videoProblem(m(VIDEO_DEFAULTS.avatar), {}, { image: true })?.text).toBe("Pick the sound.");
		expect(videoProblem(m(VIDEO_DEFAULTS.avatar), {}, { image: true, audio: true })).toBeNull();
	});
	test("too long or too short inputs are named before anything is paid", () => {
		expect(videoProblem(m(VIDEO_DEFAULTS.motion), { orientation: "image", inputSeconds: 12 }, { image: true, video: true })?.vars?.max).toBe(10);
		expect(videoProblem(m("fal-ai/wan/v2.7/edit-video"), { prompt: "x", inputSeconds: 1 }, { video: true })?.vars?.min).toBe(2);
		expect(videoProblem(m("bytedance/omnihuman/v2"), { inputSeconds: 2 }, { image: true, audio: true })?.vars?.min).toBe(4);
		expect(videoProblem(m("wan/v2.6/text-to-video"), { prompt: "x".repeat(1501) }, {})?.vars?.max).toBe(1500);
	});
});
