import { afterAll, beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// A plan and its build from REAL briefs (PRODUCE_DEV=1, the same env as analyze.dev.test.ts, PRODUCE_FILES = "file|file…",
// PRODUCE_BRIEF = the words): what the reel / YouTube cut would be, and the review of its structure.
let core: typeof import("@/core");
beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	(await import("@/effects")).registerDefaultEffects();
}, 60_000);
afterAll(() => core?.EditorCore.reset());

test.skipIf(!process.env.PRODUCE_DEV)(
	"plan from real briefs",
	async () => {
		const { requestAnalysis, analysisState } = await import("../server/analyze");
		const { readBrief: readStored } = await import("../server/store");
		const { readBrief } = await import("../brief-words");
		const { autoPlan } = await import("../plan");
		const { compilePlan } = await import("../compile");
		const { presetOf } = await import("../presets");
		const { recipeOf } = await import("../recipes");
		const { platformOf } = await import("@/platforms/table");
		const { isFillerWord } = await import("../material");
		const { normalizeTaste } = await import("../taste");
		const { runReview, describeReview } = await import("../review");
		const files = String(process.env.PRODUCE_FILES).split("|");
		const media = [];
		for (const [i, file] of files.entries()) {
			const key = `devf${Buffer.from(file).toString("hex").slice(-24)}`;
			requestAnalysis({ key, file, name: file.split("/").pop() ?? "x", front: true });
			for (let k = 0; k < 1200 && analysisState(key)?.status !== "done" && analysisState(key)?.status !== "failed"; k++) await new Promise((r) => setTimeout(r, 300));
			const brief = readStored(key);
			if (!brief) throw new Error(`no brief for ${file}: ${analysisState(key)?.error}`);
			media.push({ id: `media-${i}-${key}`, name: brief.name, type: brief.kind, duration: brief.seconds || undefined, width: brief.width, height: brief.height, brief });
		}
		const intent = readBrief(String(process.env.PRODUCE_BRIEF), normalizeTaste({}), { mediaSeconds: media.reduce((s, m) => s + (m.brief.speech ? m.brief.seconds : 0), 0) });
		const recipe = recipeOf(intent.recipe);
		const platform = platformOf(intent.platform);
		const preset = presetOf(intent.preset);
		const plan = autoPlan({ recipe, preset, platform, seconds: intent.seconds, topic: intent.topic, language: intent.language, media: media as never, input: { speaker: "Sam" }, music: { id: "m", url: "/api/library/file/m", name: "Bed", dur: 400, gain: -2, bpm: 100, downbeats: Array.from({ length: 160 }, (_, i) => i * 2.4) }, sfx: { hit: { id: "h", url: "/api/library/file/h", name: "Hit", dur: 1 }, whoosh: { id: "w", url: "/api/library/file/w", name: "Whoosh", dur: 1 }, riser: null }, cta: "Subscribe", isFiller: isFillerWord });
		console.log(`intent ${JSON.stringify(intent)}\nplan ${plan.seconds} s, ${plan.pieces.length} pieces, ${plan.inserts.length} inserts (${plan.inserts.reduce((s, x) => s + x.seconds, 0).toFixed(1)} s), texts ${plan.texts.map((t) => `${t.kind}@${t.at}:${t.text.slice(0, 30)}`).join(" | ")}, captions ${plan.captions?.words.length ?? 0} words, chapters ${plan.chapters.map((c) => `${c.at}:${c.title}`).join(" | ")}`);
		const { buildDefaultScene } = await import("@/timeline/scenes");
		const { EditorCore } = core;
		EditorCore.reset();
		const ed = EditorCore.getInstance();
		ed.save.stop();
		const scene = buildDefaultScene({ name: "Main", isMain: true });
		ed.project.setActiveProject({ project: { metadata: { id: "p", name: "p", createdAt: new Date(0), updatedAt: new Date(0) }, scenes: [scene], currentSceneId: scene.id, settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: platform.size }, version: 31 } as never });
		ed.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
		const t0 = performance.now();
		const built = compilePlan({ plan, preset, platform, canvas: { ...platform.size }, media: media as never, before: ed.scenes.getActiveScene().tracks, fps: 30 });
		console.log(`compile ${(performance.now() - t0).toFixed(1)} ms · ${built.summary.join(" · ")}`);
		const sec = (t: number) => t / 120000;
		const elements = [...built.tracks.overlay.map((t) => ["overlay", t] as const), ["main", built.tracks.main] as const, ...built.tracks.audio.map((t) => ["audio", t] as const)].flatMap(([role, t]) =>
			(t.elements as unknown as Array<Record<string, unknown> & { id: string; type: string; name: string; startTime: number; duration: number; params: Record<string, unknown> }>).map((e) => ({ id: e.id, type: e.type, track: t.id, trackType: t.type, trackRole: role, name: e.name, start: sec(e.startTime), end: sec(e.startTime + e.duration), mediaId: e.mediaId as string | undefined, trimStart: e.trimStart as number, params: e.params, effects: e.effects as never, definitionId: e.definitionId as string | undefined, sourceUrl: e.sourceUrl as string | undefined })),
		);
		const r = runReview({ platform, preset, recipe, canvas: platform.size, fps: 30, elements: elements as never, transitions: [], media: media as never, measured: { lufs: -18, truePeak: -3, speechOverMusic: 16, sections: [], holes: [] }, frames: [], seams: null, plannedSeconds: plan.seconds, exportNormalizes: true, waived: [], provenance: [] });
		console.log(describeReview(r));
		console.log(`captions: ${r.checks.find((c) => c.id === "captions")?.detail}`);
		const capEls = elements.filter((e) => e.params["caption.style"]);
		const kept = (plan.captions?.words ?? []).filter((w) => !capEls.some((c) => (w.start + w.end) / 2 >= c.start - 0.05 && (w.start + w.end) / 2 <= c.end + 0.05));
		console.log(`uncovered: ${kept.map((w) => `${w.text}@${w.start}`).join(" ")}`);
		expect(plan.pieces.length).toBeGreaterThan(0);
	},
	900_000,
);
