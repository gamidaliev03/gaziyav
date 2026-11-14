import { describe, expect, test } from "bun:test";
import { falModel, price } from "@/fal/models";
import { planLipsync, sampleWindow, type Span, wholePlan } from "../lip-plan";

const LATENT = falModel("fal-ai/latentsync")!;
const SYNC2 = falModel("fal-ai/sync-lipsync/v2")!;
const KLING = falModel("fal-ai/kling-video/lipsync/audio-to-video")!;
const VEED = falModel("veed/lipsync")!;
const FPS = 25;

/** `n` stretches of `talk` s every `every` s from `from`. */
const every = (n: number, talk: number, period: number, from = 0): Span[] => Array.from({ length: n }, (_, i) => ({ start: from + i * period, end: from + i * period + talk }));

// a 25-minute talk: phrases of 4–9 s, pauses of 0.3–2.5 s, a long listen of 20 s every ~3 min (deterministic)
function talk25(): Span[] {
	const out: Span[] = [];
	let t = 1;
	let k = 0;
	while (t < 1500) {
		const len = 4 + ((k * 7) % 6);
		out.push({ start: t, end: Math.min(1500, t + len) });
		t += len + (k % 20 === 19 ? 20 : 0.3 + ((k * 3) % 23) / 10);
		k++;
	}
	return out;
}

const CASES: Array<{ name: string; duration: number; speech: Span[]; cuts?: number[]; model: typeof LATENT }> = [
	{ name: "all speech 12 s", duration: 12, speech: [{ start: 0.1, end: 11.9 }], model: LATENT },
	{ name: "3:00, 64 % silence (audit S3)", duration: 180, speech: every(11, 6.1, 17), model: LATENT },
	{ name: "3:00, 64 % silence, Sync v2", duration: 180, speech: every(11, 6.1, 17), model: SYNC2 },
	{ name: "ten 6 s spans in 200 s", duration: 200, speech: every(10, 6, 20, 2), model: LATENT },
	{ name: "ten 6 s spans, Sync v2", duration: 200, speech: every(10, 6, 20, 2), model: SYNC2 },
	{ name: "25-min talk", duration: 1500, speech: talk25(), model: LATENT },
	{ name: "25-min talk, Sync v2", duration: 1500, speech: talk25(), model: SYNC2 },
	{ name: "spans across cuts", duration: 30, speech: [{ start: 2, end: 10 }, { start: 14, end: 25 }], cuts: [6, 20], model: LATENT },
	{ name: "spans across cuts, Kling (2–10 s, 5 s steps)", duration: 30, speech: [{ start: 2, end: 10 }, { start: 14, end: 25 }], cuts: [6, 20], model: KLING },
	{ name: "3:00, VEED per second", duration: 180, speech: every(11, 6.1, 17), model: VEED },
];

describe("the lipsync plan", () => {
	const rows: string[] = ["| case | model | mode | requests | sent s | ¢ | before (1 job) s / ¢ |", "|---|---|---|---|---|---|---|"];
	for (const c of CASES) {
		test(c.name, () => {
			const plan = planLipsync({ duration: c.duration, fps: FPS, speech: c.speech, cuts: c.cuts, model: c.model });
			// the estimate is the sum of what each request is billed (models.ts price of its seconds)
			const billed = plan.requests.reduce((s, r) => s + price(c.model, r.seconds), 0);
			expect(Math.abs(billed - plan.usd)).toBeLessThan(1e-6);
			// never dearer than the one job of before, unless that job breaks the length cap (a continuous long talk)
			if (plan.wholeSeconds <= (c.model.unit === "clip" ? 120 : 40)) expect(plan.usd).toBeLessThanOrEqual(plan.wholeUsd + 1e-9);
			// every voiced frame is inside a unit, units don't overlap, none straddles a cut
			const cutF = (c.cuts ?? []).map((x) => Math.round(x * FPS));
			for (const s of c.speech) {
				for (let f = Math.ceil(s.start * FPS); f < Math.floor(s.end * FPS); f++) expect(plan.units.some((u) => f >= u.a && f < u.b)).toBe(true);
			}
			for (let i = 1; i < plan.units.length; i++) expect(plan.units[i].a).toBeGreaterThanOrEqual(plan.units[i - 1].b);
			for (const u of plan.units) for (const k of cutF) expect(k <= u.a || k >= u.b).toBe(true);
			// a request never runs past the model's limit nor the 40 s quality cap
			for (const r of plan.requests) {
				expect(r.frames / FPS).toBeLessThanOrEqual((c.model.unit === "clip" ? 120 : 40) + 1e-9);
				if (c.model.maxSeconds) expect(r.seconds).toBeLessThanOrEqual(c.model.maxSeconds);
				// a contiguous (joined / single) request never crosses a cut either
				if (plan.mode !== "packed") for (const k of cutF) expect(k <= r.segments[0].from || k >= r.segments.at(-1)!.to).toBe(true);
			}
			rows.push(`| ${c.name} | ${c.model.title} | ${plan.mode} | ${plan.requests.length} | ${plan.secondsSent.toFixed(1)} | ${(plan.usd * 100).toFixed(1)} | ${plan.wholeSeconds.toFixed(1)} / ${(plan.wholeUsd * 100).toFixed(1)} |`);
		});
	}
	test("the table", () => {
		console.log(rows.join("\n"));
		expect(rows.length).toBe(CASES.length + 2);
	});

	test("audit scenario 3 on LatentSync: 3 requests instead of one 180 s job, cheaper, a third of the seconds", () => {
		const plan = planLipsync({ duration: 180, fps: FPS, speech: every(11, 6.1, 17), model: LATENT });
		expect(plan.wholeUsd).toBeCloseTo(0.905, 3);
		expect(plan.mode).toBe("packed");
		expect(plan.requests.length).toBe(3);
		expect(plan.usd).toBeCloseTo(0.6, 6);
		expect(plan.secondsSent).toBeLessThan(90);
	});

	test("a per-second model sends exactly the spans (+ handles + tail), nothing packed", () => {
		const plan = planLipsync({ duration: 180, fps: FPS, speech: every(11, 6.1, 17), model: SYNC2 });
		expect(plan.mode).toBe("spans");
		expect(plan.requests.length).toBe(11);
		const unitSeconds = plan.units.reduce((s, u) => s + (u.b - u.a) / FPS, 0);
		expect(plan.secondsSent).toBeCloseTo(unitSeconds + 11 * 0.8, 6);
		expect(plan.usd).toBeLessThan(plan.wholeUsd / 2);
	});

	test("a made sample is carved out and not paid again", () => {
		const made = [{ a: 2 * FPS, b: 5 * FPS }];
		const plan = planLipsync({ duration: 12, fps: FPS, speech: [{ start: 1, end: 11 }], model: SYNC2, made });
		const m = plan.units.find((u) => u.made)!;
		expect([m.a, m.b]).toEqual([50, 125]);
		for (const r of plan.requests) for (const s of r.segments) expect(s.to <= 50 || s.from >= 125).toBe(true);
	});

	test("no speech: nothing to send; the whole plan is the request of before", () => {
		expect(planLipsync({ duration: 10, fps: FPS, speech: [], model: LATENT }).requests.length).toBe(0);
		const w = wholePlan({ duration: 180, fps: FPS, model: LATENT });
		expect(w.usd).toBeCloseTo(0.905, 3);
	});

	test("the sample window: the loudest 3 s inside one shot and inside speech", () => {
		const levels = new Float32Array(1200).fill(-90);
		for (let i = 300; i < 500; i++) levels[i] = -30;
		for (let i = 700; i < 1000; i++) levels[i] = -12; // the hardest stretch: 7–10 s
		const w = sampleWindow({ duration: 12, fps: FPS, speech: [{ start: 3, end: 5 }, { start: 7, end: 10 }], levels, levelStep: 0.01 })!;
		expect(w.b - w.a).toBe(75);
		expect(w.a).toBeGreaterThanOrEqual(6 * FPS);
		expect(w.b).toBeLessThanOrEqual(11 * FPS);
		// never across a cut
		const c = sampleWindow({ duration: 12, fps: FPS, speech: [{ start: 7, end: 10 }], cuts: [8.5], levels, levelStep: 0.01 })!;
		expect(c.b <= 213 || c.a >= 213).toBe(true);
	});
});
