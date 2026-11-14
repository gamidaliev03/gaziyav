// Not a test: what one update of each trim costs on a film of two hours' size, in the pure model (no DOM, no React).
//   bun src/timeline/trim/__tests__/cost.bench.ts
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks, TimelineElement } from "@/timeline/types";

async function main(): Promise<void> {
await installOpenCutWasm();
const core = await import("../core");
const linkage = await import("@/timeline/linkage");
const twoUp = await import("../two-up");

const F = 4800;
const fps = { numerator: 25, denominator: 1 };
const MAIN = 1440; // 2 h of 5 s clips
const clip = (id: string, start: number, length: number, trim: number, extra: Record<string, unknown> = {}): TimelineElement =>
	({ id, name: id, type: "video", mediaId: `m${Number(id.slice(1)) % 3}`, sourceDuration: 60000 * F, startTime: start * F, duration: length * F, trimStart: trim * F, trimEnd: (60000 - trim - length) * F, params: {}, ...extra }) as unknown as TimelineElement;
const main = Array.from({ length: MAIN }, (_, i) => clip(`c${i}`, i * 125, 125, 500 + i * 7));
const text = (id: string, start: number, name: string, params: Record<string, unknown> = {}) => ({ id, name, type: "text", startTime: start * F, duration: 60 * F, trimStart: 0, trimEnd: 0, params }) as unknown as TimelineElement;
const captions = Array.from({ length: 600 }, (_, i) => text(`cap${i}`, i * 300 + 10, `Caption ${i + 1}`, { "caption.style": "plain" }));
const titles = Array.from({ length: 150 }, (_, i) => text(`t${i}`, i * 1200 + 20, `Title ${i + 1}`));
const broll = Array.from({ length: 150 }, (_, i) => clip(`b${i}`, i * 1200 + 250, 50, 100));
const music = { ...clip("a0", 0, MAIN * 125, 0), type: "audio", sourceType: "upload" } as unknown as TimelineElement;
const sfx = Array.from({ length: 100 }, (_, i) => ({ ...clip(`s${i}`, i * 1800 + 125, 25, i * 30), type: "audio", sourceType: "library", sourceUrl: "x" }) as unknown as TimelineElement);
const tracks = {
	overlay: [
		{ id: "titles", name: "Titles", type: "text", elements: titles, hidden: false },
		{ id: "caps", name: "Captions", type: "text", elements: captions, hidden: false },
		{ id: "v2", name: "Video 2", type: "video", elements: broll, muted: true, hidden: false },
	],
	main: { id: "main", name: "Main", type: "video", elements: main, muted: false, hidden: false },
	audio: [
		{ id: "music", name: "Music", type: "audio", elements: [music], muted: false },
		{ id: "sfx", name: "Sound effects", type: "audio", elements: sfx, muted: false },
	],
} as unknown as SceneTracks;
const items = tracks.overlay.reduce((n, t) => n + t.elements.length, 0) + tracks.audio.reduce((n, t) => n + t.elements.length, 0);
console.log(`film: ${MAIN} main clips, ${items} items over and under them (load ${items * MAIN})`);

const time = (label: string, fn: (i: number) => void, rounds = 200) => {
	for (let i = 0; i < 20; i++) fn(i);
	const samples: number[] = [];
	for (let i = 0; i < rounds; i++) {
		const t0 = performance.now();
		fn(i);
		samples.push(performance.now() - t0);
	}
	samples.sort((a, b) => a - b);
	const q = (x: number) => samples[Math.min(samples.length - 1, Math.floor(x * samples.length))].toFixed(3);
	console.log(`${label.padEnd(64)} p50 ${q(0.5)} ms  p95 ${q(0.95)} ms  max ${q(1)} ms`);
};
const mid = Math.floor(MAIN / 2);
const kinds = new Set(["text", "sticker", "effect", "audio", "overlay"] as const);
for (const [label, target] of [
	["roll in the middle of the film", { kind: "roll", trackId: "main", leftId: `c${mid}`, rightId: `c${mid + 1}` }],
	["slip", { kind: "slip", trackId: "main", elementId: `c${mid}` }],
	["slide", { kind: "slide", trackId: "main", elementId: `c${mid}` }],
	["ripple from the middle (720 clips move)", { kind: "ripple", trackId: "main", elementId: `c${mid}`, side: "right" }],
	["ripple from the first clip (1 439 clips move)", { kind: "ripple", trackId: "main", elementId: "c0", side: "right" }],
] as const) {
	const t0 = performance.now();
	const plan = core.planTrim({ tracks, target, fps });
	if (!plan) throw new Error(label);
	console.log(`${`${label}: plan (once, at the press)`.padEnd(64)} ${(performance.now() - t0).toFixed(3)} ms`);
	time(`${label}: one update`, (i) => void plan.apply(((i % 40) - 20) * F));
	const twoUpTarget = target.kind === "ripple" ? ({ kind: "edge", trackId: target.trackId, elementId: target.elementId, side: target.side, closes: true } as const) : target;
	const shown = plan.apply(7 * F).tracks;
	time(`${label}: the two frames named`, () => void twoUp.twoUpOf({ tracks: shown, target: twoUpTarget, frame: F }));
	time(`${label}: Linkage's pass (the editor's rule, at rest / on commit)`, (i) => void linkage.applyLinkage({ before: tracks, after: plan.apply(((i % 40) - 20 || 1) * F).tracks, kinds }), 40);
}
}

void main();
