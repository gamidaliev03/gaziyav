// The machine check for every price in the three catalogs. prices-read.json holds what each provider's OWN page printed on
// 06.11.2026 (docs/PRICES.md is the readable table); nothing here copies a number out of the code under test, so a catalog
// edit that drifts from the page, a price formula that rounds or counts wrong, or a list that is not cheapest first fails.
//   cd apps/web && bun test src/fal/__tests__/prices.test.ts
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import { ARGO_RATES, ARGO_VIDEO_MODELS } from "../../argo/catalog";
import { estimate, type GenerateInput, models as cloudModels } from "../../cloud/server";
import { CREDIT_USD, KIE_IMAGES, KIE_VIDEO_MODELS } from "../../kie/catalog";
import { ARGO_MODELS, FAL_MODELS, type FalModel, falModel, KIE_MODELS, modelsFor, price, refsFee, usd, type FalTask } from "../models";
import { type Keys, priceParts, videoDefaults, VIDEO_MODELS, videoModel, videoPrice, videoRate, type VideoMode, type VideoModel, type VideoOptions } from "../video";

// ───────────────────────── the record ─────────────────────────

type Table = Record<string, number>;
interface VideoRecord {
	unit: "usd/s" | "credits/s" | "credits/clip" | "credits/5s";
	rate?: Table;
	sound?: Table;
	clip?: Record<string, number | Table>;
	extraImages?: { free: number; usd: number };
	status: string;
}
const R = JSON.parse(fs.readFileSync(new URL("./prices-read.json", import.meta.url), "utf8")) as {
	read: string;
	creditUsd: { value: number };
	argo: Record<string, VideoRecord>;
	kie: Record<string, VideoRecord>;
	fal: Record<string, VideoRecord>;
	kieOther: Record<string, { credits: number; unit: string; status: string }>;
	kieImages: Record<string, { credits: number; refFree?: number; refCredits?: number; status: string }>;
	falOther: Record<string, { unit: string; usd: number; included?: number; extra?: number; status: string }>;
};
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const CU = R.creditUsd.value;
/** Dollars of a recorded number: credits at kie's list rate, dollars as they are. */
const dollars = (rec: { unit: string }, n: number) => round6(rec.unit.startsWith("credits") ? n * CU : n);

const apiOfVideo = (m: VideoModel) => m.api ?? "fal";
const ALL_VIDEO: VideoModel[] = [...VIDEO_MODELS, ...KIE_VIDEO_MODELS, ...ARGO_VIDEO_MODELS];
const recordOf = (m: VideoModel): VideoRecord | undefined => (R[apiOfVideo(m)] as Record<string, VideoRecord>)[`${apiOfVideo(m)}/${m.family}`];

// ───────────────────────── independent formulas ─────────────────────────

/** The recorded price of a video run. `seconds` is what is billed (the length asked for, or the clip's whole seconds). */
function videoFormula(rec: VideoRecord, o: { res: string; seconds: number; sound: boolean; images?: number }): number {
	if (rec.unit === "credits/clip") {
		const entry = (rec.clip as Record<string, number | Table>)[o.res];
		// Veo: one price per video; Hailuo: by the clip's seconds, 1080P is a 6 s clip.
		return dollars(rec, typeof entry === "number" ? entry : (entry as Table)[String(o.res === "1080P" ? 6 : o.seconds)]);
	}
	if (rec.unit === "credits/5s") return dollars(rec, ((rec.clip as Table)[o.res] * o.seconds) / 5);
	const table = o.sound && rec.sound ? rec.sound : (rec.rate as Table);
	const extra = rec.extraImages ? Math.max(0, (o.images ?? 0) - rec.extraImages.free) * rec.extraImages.usd : 0;
	return round6(dollars(rec, table[o.res]) * o.seconds + extra);
}

const MODES_FROM_INPUT: VideoMode[] = ["motion", "edit", "avatar"];
/** Whole seconds of a clip or a sound as the app bills it: a few hundredths over don't make another second; at least 1. */
const wholeSeconds = (s: number, max?: number) => Math.min(Math.max(1, Math.ceil(s - 0.1)), max ?? Number.POSITIVE_INFINITY);
const longest = (m: VideoModel, orientation: string | undefined, res: string) => (m.input?.maxAt ? (m.input.maxAt[m.orientation ? (orientation ?? "video") : res] ?? m.input.max) : m.input?.max);

// ───────────────────────── 1. every model has a record, every record a model ─────────────────────────

describe("the dated record covers the catalogs", () => {
	test("every video model (fal, kie, ArgoLink) has a record for its family, read on the record's date", () => {
		const missing = ALL_VIDEO.filter((m) => !recordOf(m)).map((m) => `${apiOfVideo(m)}/${m.family}`);
		expect([...new Set(missing)]).toEqual([]);
		expect(R.read).toBe("2026-11-06");
	});
	test("no record is left over from a model that is gone", () => {
		const used = new Set(ALL_VIDEO.map((m) => `${apiOfVideo(m)}/${m.family}`));
		for (const api of ["fal", "kie", "argo"] as const) for (const key of Object.keys(R[api])) expect([key, used.has(key)]).toEqual([key, true]);
	});
	test("every non-video model (voice, lipsync, face swap, clone, agent; kie's pictures) has one", () => {
		for (const m of FAL_MODELS.filter((x) => x.task !== "video")) expect([m.id, R.falOther[m.id] !== undefined]).toEqual([m.id, true]);
		for (const m of KIE_MODELS.filter((x) => x.task !== "video" && x.task !== "image")) expect([m.id, R.kieOther[m.id] !== undefined]).toEqual([m.id, true]);
		for (const m of KIE_IMAGES) expect([m.id, R.kieImages[m.id] !== undefined]).toEqual([m.id, true]);
	});
	test("kie's credit is the recorded $0.005 and ArgoLink's spend table is the page's", () => {
		expect(CREDIT_USD).toBe(CU);
		for (const [name, table] of Object.entries(ARGO_RATES)) {
			const rec = R.argo[`argo/${name === "seedance-2.0-mini" ? "a-seedance-2-mini" : name === "seedance-2.0-fast" ? "a-seedance-2-fast" : "a-seedance-2"}`];
			expect(table).toEqual(rec.rate as Table);
		}
	});
});

// ───────────────────────── 2. the rates ─────────────────────────

describe("per-second and per-clip rates are the recorded ones, for every resolution and with and without sound", () => {
	test("each catalog rate, resolution by resolution", () => {
		const wrong: string[] = [];
		for (const m of ALL_VIDEO) {
			const rec = recordOf(m) as VideoRecord;
			if (rec.unit === "credits/clip" || rec.unit === "credits/5s") continue;
			for (const res of m.resolutions ?? [""]) {
				const want = videoFormula(rec, { res, seconds: 1, sound: false });
				const got = videoRate(m, { resolution: res || undefined, audio: false });
				if (Math.abs(got - want) > 1e-9) wrong.push(`${m.id} ${res}: ${got} vs page ${want}`);
				if (rec.sound) {
					const wantSound = videoFormula(rec, { res, seconds: 1, sound: true });
					const gotSound = videoRate(m, { resolution: res || undefined, audio: true });
					if (Math.abs(gotSound - wantSound) > 1e-9) wrong.push(`${m.id} ${res} with sound: ${gotSound} vs page ${wantSound}`);
				} else if (m.sound && Math.abs(videoRate(m, { resolution: res || undefined, audio: true }) - want) > 1e-9) wrong.push(`${m.id} ${res}: sound is in the price on the page, not here`);
				// A catalog table never holds a resolution the page doesn't print.
				if (res && !(res in (rec.rate ?? rec.clip ?? {}))) wrong.push(`${m.id}: ${res} is not on the page`);
			}
			for (const res of Object.keys(m.rate)) if (res && !(res in (rec.rate as Table))) wrong.push(`${m.id}: rate table has ${res}, the page doesn't`);
		}
		expect(wrong).toEqual([]);
	});
	test("per-clip models (Veo, Wan 2.6, Hailuo on kie): the clip's price, by length, as the page prints it", () => {
		const wrong: string[] = [];
		for (const m of ALL_VIDEO.filter((x) => x.priceOf)) {
			const rec = recordOf(m) as VideoRecord;
			for (const res of m.resolutions ?? []) {
				for (const d of m.durations ?? []) {
					const want = videoFormula(rec, { res, seconds: d, sound: false });
					const got = videoPrice(m, { resolution: res, duration: d });
					if (Math.abs(got - want) > 1e-9) wrong.push(`${m.id} ${res} ${d} s: ${got} vs page ${want}`);
					// The rate shown is the clip's price over the clip's seconds (Hailuo 1080P: a 6 s clip whatever is picked).
					const secs = m.clipSeconds ? m.clipSeconds({ resolution: res, duration: d }) : d;
					if (Math.abs(videoRate(m, { resolution: res, duration: d }) - want / secs) > 1e-9) wrong.push(`${m.id} ${res} ${d} s: rate ${videoRate(m, { resolution: res, duration: d })} vs ${want / secs}`);
				}
			}
		}
		expect(wrong).toEqual([]);
	});
	test("kie's pictures, voices and lipsync, fal's voices, lipsync, clones, pictures and swap", () => {
		for (const m of KIE_IMAGES) expect([m.id, m.usd]).toEqual([m.id, round6(R.kieImages[m.id].credits * CU)]);
		expect(KIE_IMAGES.find((m) => m.id === "seedream/5-pro-text-to-image")?.refFee).toEqual({ free: 1, usd: round6(0.5 * CU) });
		for (const m of KIE_MODELS.filter((x) => x.task !== "video" && x.task !== "image")) {
			const rec = R.kieOther[m.id];
			expect([m.id, m.usd]).toEqual([m.id, round6(rec.credits * CU)]);
		}
		for (const m of FAL_MODELS.filter((x) => x.task !== "video" && x.task !== "llm")) {
			const rec = R.falOther[m.id];
			expect([m.id, Math.abs(m.usd - (rec.unit === "usd/min" ? rec.usd / 60 : rec.usd)) < 1e-9]).toEqual([m.id, true]);
			if (rec.unit === "clip") expect([m.included, m.extra]).toEqual([rec.included, rec.extra]);
		}
		for (const m of FAL_MODELS.filter((x) => x.task === "llm")) expect([m.id, m.usd]).toEqual([m.id, R.falOther[m.id].usd]);
	});
});

// ───────────────────────── 3. the Generate price equals the formula ─────────────────────────

const U = "x";
/** The request the Generate button's price comes from (server estimate), for one setting of a model. */
function request(m: VideoModel, o: { res?: string; seconds?: number; sound?: boolean; input?: number; orientation?: string; images?: number }): GenerateInput {
	const g: GenerateInput = { kind: "video", prompt: "A fox runs over snow", model: m.id, mode: m.mode };
	if (o.res) g.quality = o.res;
	if (o.sound !== undefined && m.sound) g.generate_audio = o.sound;
	if (!MODES_FROM_INPUT.includes(m.mode) && o.seconds !== undefined) g.duration_seconds = o.seconds;
	if (m.mode === "image" || m.mode === "frames" || m.mode === "motion" || m.mode === "avatar") g.image_asset_ids = [U];
	if (m.mode === "frames") g.end_image_asset_ids = [U];
	if (m.mode === "reference") g.reference_count = o.images ?? 1;
	if (m.mode === "motion" || m.mode === "edit" || m.mode === "extend") g.reference_video_duration_seconds = o.input ?? 5;
	if (m.mode === "avatar") g.reference_audio_duration_seconds = o.input ?? 5;
	if (o.orientation) g.character_orientation = o.orientation as "image" | "video";
	return g;
}

describe("the price on Generate is the formula, for every length, resolution and sound", () => {
	test("duration modes: every model, resolution, length and sound switch; the form's total, videoPrice and the server's estimate all equal rate × seconds (or the clip's price)", async () => {
		const wrong: string[] = [];
		let checked = 0;
		for (const m of ALL_VIDEO.filter((x) => !MODES_FROM_INPUT.includes(x.mode))) {
			const rec = recordOf(m) as VideoRecord;
			const imageCounts = m.mode === "reference" ? Array.from({ length: m.maxImages ?? 1 }, (_, i) => i + 1) : [undefined];
			for (const res of m.resolutions ?? [""]) {
				for (const d of m.durations ?? [5]) {
					for (const sound of m.sound || m.soundRate ? [false, true] : [undefined]) {
						// Seedance-style models take their sound for free (no sound table): the same number.
						const wantSound = !!sound && !!rec.sound;
						for (const images of m.extraImages ? imageCounts : [imageCounts[0]]) {
							const want = videoFormula(rec, { res, seconds: d, sound: wantSound, images });
							const o: VideoOptions = { duration: d, resolution: res || undefined, audio: sound, images };
							const total = priceParts(m, o).total;
							const direct = videoPrice(m, o);
							const served = (await estimate(request(m, { res: res || undefined, seconds: d, sound, images }))).cost;
							checked++;
							if (Math.abs(direct - want) > 1e-9 || Math.abs(total - want) > 1e-9 || Math.abs(served - want) > 1e-9) wrong.push(`${m.id} ${res} ${d} s sound=${sound} images=${images}: videoPrice ${direct}, form ${total}, server ${served}, page says ${want}`);
						}
					}
				}
			}
		}
		expect(wrong.slice(0, 20)).toEqual([]);
		expect(checked).toBeGreaterThan(2500);
	});
	test("lengths that come from the clip or the sound (motion, restyle, avatar): whole seconds, at least 1, up to what the model takes", async () => {
		const wrong: string[] = [];
		let checked = 0;
		for (const m of ALL_VIDEO.filter((x) => MODES_FROM_INPUT.includes(x.mode))) {
			const rec = recordOf(m) as VideoRecord;
			for (const res of m.resolutions ?? [""]) {
				for (const orientation of m.orientation ? ["image", "video"] : [undefined]) {
					const top = longest(m, orientation, res);
					const samples = [0.4, 1, 2.4, 3, 3.04, 3.2, 4.95, 5, 5.05, 7.5, 9.95, 10, 14.3, 30, 61, 120, 300].filter((s) => !top || s <= top + 0.1);
					for (const s of samples) {
						const want = videoFormula(rec, { res, seconds: wholeSeconds(s, top), sound: false });
						const o: VideoOptions = { resolution: res || undefined, orientation: orientation as "image" | "video" | undefined, inputSeconds: s };
						const direct = videoPrice(m, o);
						const total = priceParts(m, o).total;
						checked++;
						if (Math.abs(direct - want) > 1e-9 || Math.abs(total - want) > 1e-9) wrong.push(`${m.id} ${res} ${orientation} ${s} s: videoPrice ${direct}, form ${total}, page says ${want}`);
						const min = m.input?.min ?? 0;
						if (s >= min - 0.05) {
							const served = (await estimate(request(m, { res: res || undefined, input: s, orientation }))).cost;
							if (Math.abs(served - want) > 1e-9) wrong.push(`${m.id} ${res} ${orientation} ${s} s: server ${served}, page says ${want}`);
						}
					}
				}
			}
		}
		expect(wrong.slice(0, 20)).toEqual([]);
		expect(checked).toBeGreaterThan(150);
	});
	test("pictures: the price on the button is the page's, plus what the reference pictures add (Seedream 5.0 Pro on kie: the first is free, each next 0.5 credit)", async () => {
		const wrong: string[] = [];
		for (const m of [...FAL_MODELS, ...KIE_MODELS].filter((x) => x.task === "image")) {
			const rec = m.api === "kie" ? R.kieImages[m.id] : undefined;
			const base = rec ? round6(rec.credits * CU) : R.falOther[m.id].usd;
			const maxRefs = m.id === "fal-ai/flux/schnell" ? 0 : (KIE_IMAGES.find((k) => k.id === m.id)?.maxRefs ?? (m.id === "fal-ai/nano-banana" ? 3 : 6));
			for (let n = 0; n <= Math.min(maxRefs, 12); n++) {
				const fee = rec?.refCredits && n > (rec.refFree ?? 0) ? round6((n - (rec.refFree ?? 0)) * rec.refCredits * CU) : 0;
				const got = (await estimate({ kind: "image", prompt: "a fox", model: m.id, ...(n ? { reference_count: n } : {}) })).cost;
				if (Math.abs(got - (base + fee)) > 1e-9) wrong.push(`${m.id} with ${n} pictures: ${got} vs page ${base + fee}`);
			}
		}
		expect(wrong).toEqual([]);
		expect(refsFee(falModel("seedream/5-pro-text-to-image") as FalModel, 4)).toBeCloseTo(0.0075, 9);
	});
	test("voice, lipsync, clones and swap: price() equals the recorded unit price for every amount", () => {
		const wrong: string[] = [];
		const unit = (m: FalModel) => (m.api === "kie" ? { ...R.kieOther[m.id], usd: round6(R.kieOther[m.id].credits * CU) } : R.falOther[m.id]);
		for (const m of [...FAL_MODELS, ...KIE_MODELS].filter((x) => ["lipsync", "tts", "clone", "faceswap"].includes(x.task))) {
			const rec = unit(m) as { unit: string; usd: number; included?: number; extra?: number };
			const amounts = m.task === "tts" ? [1, 60, 999, 1000, 1001, 2500, 5000, 12000] : [1, 2, 3, 4.2, 5, 5.01, 9.99, 10, 30, 40, 40.4, 41, 60, 90, 240];
			for (const a of amounts) {
				let want: number;
				if (rec.unit === "clip") want = rec.usd + Math.max(0, Math.ceil(a) - (rec.included ?? 0)) * (rec.extra ?? 0);
				else if (rec.unit === "usd/min") want = (rec.usd / 60) * Math.max(1, a);
				else if (rec.unit === "credits/s") want = rec.usd * Math.max(1, a);
				else if (rec.unit === "5s") want = m.task === "faceswap" ? rec.usd * (a > 5 ? 2 : 1) : rec.usd * Math.max(1, Math.ceil(a / 5));
				else if (rec.unit === "1k-chars" || rec.unit === "credits/1k chars") want = (rec.usd * Math.max(1, a)) / 1000;
				else if (rec.unit === "minute") want = rec.usd * Math.max(1, Math.ceil(a / 60));
				else if (rec.unit === "voice") want = rec.usd;
				else throw new Error(`no formula for ${rec.unit}`);
				if (Math.abs(price(m, a) - want) > 1e-9) wrong.push(`${m.id} ${a}: ${price(m, a)} vs ${want}`);
			}
		}
		expect(wrong).toEqual([]);
	});
});

// ───────────────────────── 4. cheapest first, in one unit ─────────────────────────

/** US dollars for ONE unit of a task, from the record alone: a second of video at the model's start settings, a picture, 1,000 characters, a 10 s piece (lipsync), 5 s (swap), 30 s of sample (clone). */
function unitPrice(m: FalModel): number {
	switch (m.task) {
		case "video": {
			const v = videoModel(m.id) as VideoModel;
			const d = videoDefaults(v);
			const res = d.resolution ?? "";
			const seconds = d.duration ?? 5;
			return round6(videoFormula(recordOf(v) as VideoRecord, { res, seconds, sound: !!d.audio, images: 0 }) / (recordOf(v)?.unit === "credits/clip" && v.clipSeconds ? v.clipSeconds({ ...d }) : seconds));
		}
		case "image":
			return m.api === "kie" ? round6(R.kieImages[m.id].credits * CU) : R.falOther[m.id].usd;
		case "tts": {
			const rec = m.api === "kie" ? { unit: "1k-chars", usd: round6(R.kieOther[m.id].credits * CU) } : R.falOther[m.id];
			return rec.usd;
		}
		case "lipsync": {
			if (m.api === "kie") return round6(R.kieOther[m.id].credits * CU) * 10;
			const rec = R.falOther[m.id];
			return rec.unit === "clip" ? rec.usd + Math.max(0, 10 - (rec.included ?? 0)) * (rec.extra ?? 0) : rec.unit === "usd/min" ? (rec.usd / 60) * 10 : rec.usd * Math.ceil(10 / 5);
		}
		case "faceswap":
			return R.falOther[m.id].usd;
		case "clone":
			return m.id.includes("qwen") ? R.falOther[m.id].usd : R.falOther[m.id].usd;
		case "llm":
			return R.falOther[m.id].usd;
	}
}

const COMBOS: (Keys | undefined)[] = [
	undefined,
	{ fal: true, kie: false, argo: false },
	{ fal: false, kie: true, argo: false },
	{ fal: false, kie: false, argo: true },
	{ fal: true, kie: true, argo: false },
	{ fal: true, kie: false, argo: true },
	{ fal: false, kie: true, argo: true },
	{ fal: true, kie: true, argo: true },
];
const TASKS: FalTask[] = ["lipsync", "tts", "image", "video", "faceswap", "clone", "llm"];

describe("every list is cheapest first across the APIs that have a key, in one unit", () => {
	for (const keys of COMBOS) {
		const label = keys ? (["fal", "kie", "argo"] as const).filter((a) => keys[a]).join("+") : "no key";
		test(`Settings lists (${label}): ${TASKS.join(", ")}`, () => {
			for (const task of TASKS) {
				const pool = [...FAL_MODELS, ...KIE_MODELS, ...ARGO_MODELS].filter((m) => m.task === task);
				const on = keys ? (["fal", "kie", "argo"] as const).filter((a) => keys[a]) : (["fal", "kie", "argo"] as const);
				const expected = pool.filter((m) => on.includes(m.api ?? "fal"));
				const list = modelsFor(task, keys);
				// An API without models of a task adds none; with none at all, every model is on offer.
				expect(new Set(list.map((m) => m.id))).toEqual(new Set((expected.length ? expected : pool).map((m) => m.id)));
				const units = list.map(unitPrice);
				for (let i = 1; i < units.length; i++) expect([task, list[i - 1].id, list[i].id, units[i - 1] <= units[i] + 1e-9]).toEqual([task, list[i - 1].id, list[i].id, true]);
			}
		});
	}
	test("the generator's / agent's lists (cloud models()): per second of video at the model's start settings, in every mode, each row's price is that unit", () => {
		const wrong: string[] = [];
		for (const mode of ["text", "image", "frames", "reference", "motion", "edit", "extend", "avatar"] as VideoMode[]) {
			const rows = cloudModels("video", mode).models;
			expect(rows.length).toBeGreaterThan(0);
			const units = rows.map((row) => {
				const v = videoModel(row.id) as VideoModel;
				const d = videoDefaults(v);
				const seconds = MODES_FROM_INPUT.includes(v.mode) ? 1 : (d.duration ?? 5);
				const rec = recordOf(v) as VideoRecord;
				const clipSeconds = rec.unit === "credits/clip" && v.clipSeconds ? v.clipSeconds({ ...d }) : seconds;
				return round6(videoFormula(rec, { res: d.resolution ?? "", seconds, sound: !!d.audio }) / clipSeconds);
			});
			rows.forEach((row, i) => {
				if (Math.abs(row.usd - units[i]) > 1e-6) wrong.push(`${mode} ${row.id}: usd ${row.usd} vs ${units[i]} per second`);
				if (i && units[i - 1] > units[i] + 1e-9) wrong.push(`${mode}: ${rows[i - 1].id} (${units[i - 1]}/s) before ${row.id} (${units[i]}/s)`);
			});
		}
		expect(wrong).toEqual([]);
	});
	test("the same model on three APIs, in one unit: Seedance 2.0 Mini 720p per second", () => {
		const per = (api: "fal" | "kie" | "argo") => modelsFor("video", { fal: api === "fal", kie: api === "kie", argo: api === "argo" }).filter((m) => m.id.includes("seedance-2.0-mini") || m.id.includes("seedance-2-mini") || m.id.includes("seedance-2.0/mini"));
		// fal has the Mini in reference mode only, so it is not in the text list: the cheapest of the other two is kie's.
		expect(per("kie")[0].usd).toBeCloseTo(0.041, 9);
		expect(per("argo")[0].usd).toBeCloseTo(0.0643, 9);
		expect(modelsFor("video", { fal: false, kie: true, argo: true }).findIndex((m) => m.id.startsWith("bytedance/seedance-2-mini"))).toBeLessThan(modelsFor("video", { fal: false, kie: true, argo: true }).findIndex((m) => m.id.startsWith("argolink/seedance-2.0-mini")));
	});
});

// ───────────────────────── 5. what is shown is what is charged ─────────────────────────

describe("the dollars on screen are the dollars charged", () => {
	test("whole cents with two decimals; anything finer exactly, never rounded to the cent", () => {
		expect([0.2, 1.5, 0.38, 0.1, 12].map(usd)).toEqual(["$0.20", "$1.50", "$0.38", "$0.10", "$12.00"]);
		expect([0.3775, 0.2419, 0.0097, 0.003, 0.0008, 0.245, 0.1125, 0.0398, 1.0475].map(usd)).toEqual(["$0.3775", "$0.2419", "$0.0097", "$0.003", "$0.0008", "$0.245", "$0.1125", "$0.0398", "$1.0475"]);
		expect([0, Number.NaN].map(usd)).toEqual(["$0", "$—"]);
	});
	test("every price the formulas give round-trips through the display without losing a digit", () => {
		const lost: string[] = [];
		for (const m of ALL_VIDEO.filter((x) => !MODES_FROM_INPUT.includes(x.mode))) {
			for (const res of m.resolutions ?? [""]) for (const d of m.durations ?? [5]) {
				const p = videoPrice(m, { resolution: res || undefined, duration: d, audio: true });
				if (Math.abs(Number(usd(p).slice(1)) - p) > 1e-9) lost.push(`${m.id} ${res} ${d}: ${p} shows ${usd(p)}`);
			}
		}
		expect(lost.slice(0, 10)).toEqual([]);
	});
});
