// The AI Composition agent. One run per request, with a live log the composition bar polls:
//   quick  → kit layers in the composition's style (one fast call);
//   full   → motion design like Claude with the Remotion skill: plan (thinking model) → find assets (local Lottie,
//            fonts, sounds, web images) → write its own TSX → compile + render still frames with the export engine →
//            art-director look at the frames → fix → present.
// Everything a run sees comes from its own request: no state is shared between runs, projects or compositions.
import { agentReady, NOT_SET_UP } from "@/studio/server/agent-keys";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CancelledError, explain, StudioError } from "@/studio/server/errors";
import { dataDir } from "@/studio/server/files";
import { loadSettings } from "@/studio/server/settings";
import { JSON_PREFIX, type MontageInput, type MontageItem, type PropValue } from "../types";
import { assetFile, type Candidate, fontCatalog, ImageFinds, pickSfx, searchFonts, searchGraphics, searchSfx, type StoredAsset, storeRef } from "./assets";
import { factProblems } from "./facts";
import { FIX_NOTE, JSON_REPAIR, PLAN_SYSTEM, REVIEW_SYSTEM, WRITE_SYSTEM } from "./knowledge";
import { skillsFor } from "./skills";
import type { Box } from "./layout";
import { pinOf, resolveLayout } from "./layout";
import { chat, type Message, type Part, parseJson, REASONER } from "./llm";
import {
	cleanLayers,
	compileComponent,
	context,
	DEFAULT_REQUEST,
	factSource,
	faceBox,
	faceNote,
	historyText,
	type Log,
	onlyWhatIsAsked,
	type PlannedLayer,
	type PlannedSfx,
	type PlanRequest,
	type PlanResult,
	planQuick,
	untouched,
} from "./plan";
import { renderStills, stripOf, viewFrame } from "./still";

// ───────────────────────── runs (polled by the composition bar) ─────────────────────────

export interface RunLine {
	at: number;
	text: string;
}

export interface RunState {
	id: string;
	status: "running" | "done" | "failed" | "cancelled";
	mode?: "quick" | "full";
	log: RunLine[];
	result?: PlanResult;
	error?: string;
	startedAt: number;
	endedAt?: number;
}

interface Entry {
	state: RunState;
	controller: AbortController;
}

const runs: Map<string, Entry> = ((globalThis as any).__montageRuns as Map<string, Entry>) ?? ((globalThis as any).__montageRuns = new Map());

/** Whole-run limits: quick answers in a couple of minutes, full motion design in ten. */
const LIMIT = { quick: 150, full: 900 };

function prune() {
	const now = Date.now();
	for (const [id, e] of runs) if (e.state.endedAt && now - e.state.endedAt > 30 * 60 * 1000) runs.delete(id);
	try {
		const dir = path.join(dataDir(), "montage-runs");
		const old = fs
			.readdirSync(dir)
			.map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs }))
			.sort((a, b) => b.t - a.t)
			.slice(8);
		for (const { n } of old) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
	} catch {}
}

export function getRun(id: string): RunState | null {
	return runs.get(id)?.state ?? null;
}

export function cancelRun(id: string): boolean {
	const e = runs.get(id);
	if (!e || e.state.status !== "running") return false;
	e.controller.abort();
	return true;
}

/** Starts a run and returns at once; the bar polls /api/montage/runs/<id>. */
export function startAgent(r: PlanRequest, origin: string): RunState {
	prune();
	validate(r);
	const state: RunState = { id: crypto.randomBytes(8).toString("hex"), status: "running", log: [], startedAt: Date.now() };
	const entry: Entry = { state, controller: new AbortController() };
	runs.set(state.id, entry);
	const log: Log = (text) => {
		state.log.push({ at: Date.now(), text: text.slice(0, 240) });
		if (state.log.length > 80) state.log.splice(0, state.log.length - 80);
	};
	const { mode, why } = classify(r);
	state.mode = mode;
	const timer = setTimeout(() => entry.controller.abort(new StudioError("timeout")), LIMIT[mode] * 1000);
	const signal = entry.controller.signal;
	(async () => {
		log(mode === "full" ? `Full motion design (${why})` : `Quick: motion kit (${why})`);
		const face = await faceBox(r, signal);
		log(face ? `Face found at y ${face.y.toFixed(2)}–${(face.y + face.h).toFixed(2)}` : r.face ? (faceNote.last ? `Couldn't check the face (${faceNote.last}) — keeping text in the safe zones` : "No face in the video") : "No video under the composition");
		const result = mode === "full" ? await runFull(r, face, { log, signal, origin, runId: state.id }) : await planQuick(r, face, log, signal);
		log(`Done: ${result.layers.length} layer${result.layers.length === 1 ? "" : "s"}${result.sfx.length ? `, ${result.sfx.length} sound${result.sfx.length === 1 ? "" : "s"}` : ""}`);
		return result;
	})()
		.then((result) => {
			state.result = result;
			state.status = "done";
		})
		.catch((error) => {
			if (signal.aborted && (signal.reason as Error)?.message === "timeout") {
				state.status = "failed";
				state.error = `Gaziyav AI took longer than ${Math.round(LIMIT[mode] / 60)} min and stopped. Try a simpler request.`;
			} else if (signal.aborted || error instanceof CancelledError || (error as Error)?.name === "AbortError") {
				state.status = "cancelled";
				state.error = "Cancelled";
			} else {
				state.status = "failed";
				state.error = error instanceof StudioError ? error.message : explain(error);
			}
			log(state.status === "cancelled" ? "Cancelled" : `Failed: ${state.error}`);
		})
		.finally(() => {
			clearTimeout(timer);
			state.endedAt = Date.now();
		});
	return state;
}

function validate(r: PlanRequest) {
	const ok =
		r &&
		typeof r.request === "string" &&
		Number.isFinite(r.width) &&
		Number.isFinite(r.height) &&
		Number.isFinite(r.fps) &&
		Number.isFinite(r.duration) &&
		Array.isArray(r.clips) &&
		Array.isArray(r.words) &&
		Array.isArray(r.layers);
	if (!ok) throw new StudioError("Gaziyav AI couldn't read the request. Reload the window (⌘⇧P) and try again.");
	if (r.request.length > 2000) throw new StudioError("The request is too long. Keep it under 2000 characters.");
	r.duration = Math.max(0.5, Math.min(600, r.duration));
	r.fps = Math.max(1, Math.min(120, r.fps));
	r.words = r.words.slice(0, 1500);
	r.history = Array.isArray(r.history) ? r.history.slice(-8) : [];
}

// ───────────────────────── quick or full ─────────────────────────

const STRONG_FULL =
	/(карт[аеуоыи](?![а-яё])|\bmap\b|mind ?map|схем|diagram|диаграм|инфограф|infograph|chart|график|сцен[аеуы](?![а-яё])|\bscene\b|интро|\bintro\b|заставк|outro|аутро|концовк|полноэкран|на весь (экран|кадр)|full[- ]?(frame|screen)|сложн|complex|моушн|motion design|explainer|объясн|визуализ|visuali[sz]|иконк|\bicons?\b|иллюстрац|illustrat|lottie|лотти|фото|photo|картинк|изображен|\bimages?\b|picture|маршрут|\broute\b|глобус|globe|таймлайн|сравнен|compar|список|\blist\b|по шагам|step by step|своими компонент|own component|tsx|remotion)/;

export function classify(r: PlanRequest): { mode: "quick" | "full"; why: string } {
	if (r.force === "quick") return { mode: "quick", why: "you chose Quick" };
	if (r.force === "full") return { mode: "full", why: "you chose Full" };
	if (r.layers.some((l) => l.kind === "Custom")) return { mode: "full", why: "refining its own components" };
	const q = r.request.toLowerCase();
	// The user wants it to CREATE by default: ready kit blocks only when asked to be quick or to use templates.
	if (/быстр|по-быстрому|quick|fast|шаблон|template|из готов|готов(ый|ые|ую)|просто (хук|заголов|титр|субтитр|cta|плашк)/.test(q)) {
		return { mode: "quick", why: "you asked for a quick one" };
	}
	if (STRONG_FULL.test(q) || /анимац|animat|motion/.test(q)) return { mode: "full", why: "the request needs its own animation" };
	return { mode: "full", why: "designed from scratch for this request" };
}

// ───────────────────────── full motion design ─────────────────────────

interface FullCtx {
	log: Log;
	signal: AbortSignal;
	origin: string;
	runId: string;
}

interface Plan {
	plan?: string;
	elements?: string[];
	question?: { text?: string; options?: string[] } | null;
	understanding?: string;
	layout?: string;
	from?: number;
	to?: number;
	beats?: { at?: number; what?: string }[];
	assets?: { type?: string; query?: string; required?: boolean }[];
	components?: string[];
	kit?: string[];
}

const ASSET_LABEL: Record<string, string> = { lottie: "Searching icons", image: "Searching images", font: "Picking a font", sfx: "Searching sounds" };

/** Answer budgets: the reasoner's thinking counts against them, so code answers get plenty. */
const BUDGET = { plan: { tokens: 16000, timeout: 240 }, write: { tokens: 64000, timeout: 480 } };

async function runFull(r: PlanRequest, face: Box | null, ctx: FullCtx): Promise<PlanResult> {
	const { log, signal } = ctx;
	const s = loadSettings();
	if (!agentReady()) throw new StudioError(NOT_SET_UP);
	let calls = 0;
	/** One reasoner call → JSON; an unreadable answer gets one "valid JSON only" repair call before giving up. */
	const thinkJson = async (messages: Message[], budget: { tokens: number; timeout: number }): Promise<{ text: string; json: any }> => {
		const text = await chat({ key: s.deepseekKey, model: REASONER, messages, json: true, maxTokens: budget.tokens, timeout: budget.timeout, signal });
		calls++;
		try {
			return { text, json: parseJson(text) };
		} catch {
			if (signal.aborted) throw new CancelledError();
			log("✗ The answer wasn't valid JSON — asking for a clean copy");
			const fixed = await chat({
				key: s.deepseekKey,
				model: s.deepseekModel === REASONER ? "deepseek-flash" : s.deepseekModel,
				messages: [
					{ role: "system", content: JSON_REPAIR },
					{ role: "user", content: text.slice(0, 200000) },
				],
				json: true,
				thinking: false,
				maxTokens: budget.tokens,
				timeout: budget.timeout,
				signal,
			});
			calls++;
			const json = parseJson(fixed);
			log("JSON repaired");
			return { text: fixed, json };
		}
	};
	const request = r.request.trim() || DEFAULT_REQUEST;
	const base = `${context(r, face, { code: true })}\n${historyText(r.history)}\nRequest: ${request}`;
	const fonts = fontCatalog();

	// 1. Plan (a refinement of this composition's own work goes straight to the code, unless it asks for new assets).
	const refining = r.mode !== "variation" && r.layers.some((l) => l.kind === "Custom") && !/icon|иконк|image|фото|картинк|изображен|font|шрифт|sound|звук|sfx|lottie|лотти|graphic|графику/i.test(request);
	let plan: Plan;
	let planLine = "";
	if (refining) {
		planLine = `keep everything, change only what the request names — "${request.slice(0, 120)}"`;
		log(`Plan: ${planLine}`);
		plan = { understanding: request, components: r.layers.filter((l) => l.kind === "Custom").map((l) => String(l.props.component ?? "")).filter(Boolean) };
	} else {
		log("Planning…");
		plan = (
			await thinkJson(
				[
					// The skills this request calls for (style, cartoon, pixel, map, logo…), loaded like an agent loads a skill.
					{ role: "system", content: `${PLAN_SYSTEM}\n\n${skillsFor(request)}\n\nLocal fonts:\n${fonts || "none"}` },
					{ role: "user", content: base },
				],
				BUDGET.plan,
			)
		).json as Plan;
		const q = plan.question;
		const options = Array.isArray(q?.options) ? q!.options.map((o) => String(o).slice(0, 60)).filter(Boolean).slice(0, 4) : [];
		if (q && typeof q.text === "string" && q.text.trim() && options.length >= 2) {
			log(`Question: ${q.text.trim().slice(0, 160)}`);
			return { comment: q.text.trim().slice(0, 200), mode: "full", layers: [], sfx: [], calls, keep: r.layers.map((l) => l.id), question: { text: q.text.trim().slice(0, 200), options } };
		}
		const layout = plan.layout === "scene" ? "full-frame scene" : "overlay";
		const span = Number.isFinite(plan.from) && Number.isFinite(plan.to) ? `${(Number(plan.to) - Number(plan.from)).toFixed(1)} s ` : "";
		planLine = typeof plan.plan === "string" && plan.plan.trim() ? plan.plan.trim().slice(0, 220) : `${span}${layout}${plan.understanding ? ` — ${String(plan.understanding).slice(0, 140)}` : ""}`;
		log(`Plan: ${planLine}`);
	}
	const elements = (Array.isArray(plan.elements) ? plan.elements : []).map((e) => String(e).slice(0, 80)).filter(Boolean).slice(0, 10);
	const beats = (Array.isArray(plan.beats) ? plan.beats : [])
		.map((b) => ({ at: Number(b?.at), what: String(b?.what ?? "").slice(0, 100) }))
		.filter((b) => Number.isFinite(b.at) && b.at >= 0 && b.at <= r.duration);

	// 2. Assets (pictures the user added for this request come first).
	const images = new ImageFinds();
	const found: Candidate[] = [...images.offer(r.provided ?? []), ...mediaCandidates(r)];
	for (const c of found) log(c.ref.startsWith("media:") ? `Your media: ${c.title} (${c.detail})` : `Using your picture: ${c.title}`);
	for (const a of (Array.isArray(plan.assets) ? plan.assets : []).slice(0, 5)) {
		const type = String(a?.type ?? "");
		const query = String(a?.query ?? "").slice(0, 80).trim();
		if (!query || !ASSET_LABEL[type]) continue;
		if (type === "image" && found.some((c) => c.ref.startsWith("provided:") || (c.ref.startsWith("media:") && c.type === "image"))) continue;
		if (signal.aborted) throw new CancelledError();
		log(`${ASSET_LABEL[type]}: ${query}`);
		let list: Candidate[] = [];
		try {
			if (type === "lottie") list = searchGraphics(query);
			else if (type === "font") list = searchFonts(query);
			else if (type === "sfx") list = searchSfx(query);
			else if (type === "image") list = await images.search(query, 3, signal, log);
		} catch (error) {
			log(`  ${type === "image" ? "✗ Image search failed" : "Search failed"}: ${(error as Error).message.slice(0, 120)}`);
		}
		if (type !== "image") log(list.length ? `  found ${list.length}: ${list.map((c) => c.title).slice(0, 3).join(", ")}` : "  nothing suitable");
		found.push(...list.filter((c) => !found.some((f) => f.ref === c.ref)));
		// A picture the idea can't work without and nobody has: ask for it instead of inventing one.
		if (type === "image" && a?.required && !list.length) {
			log(`✗ No usable photo found for "${query}" — add one and Gaziyav AI will use it`);
			return {
				comment: `I couldn't find a usable photo for "${query}". Add one and I'll use it.`,
				mode: "full",
				layers: [],
				sfx: [],
				calls,
				keep: r.layers.map((l) => l.id),
				plan: planLine,
				question: { text: `I couldn't find a usable photo for "${query}". Add one?`, options: [], action: "add-image", query },
			};
		}
	}

	// 3. Write.
	const comps = (Array.isArray(plan.components) ? plan.components : []).filter((n) => /^[A-Z][A-Za-z0-9]{1,40}$/.test(String(n)));
	log(comps.length ? `Writing ${comps.map((n) => `${n}.tsx`).join(", ")}` : "Writing the layers");
	const assetList = found.length ? found.map((c) => `- ${c.ref} — ${c.type}: ${c.title} (${c.detail})`).join("\n") : "- none (design without assets)";
	const writeUser = `${base}

${refining ? "This is a refinement: start from the current layers and their component code above, change only what the request names, keep ids and every value the request does not name." : `Your plan: ${JSON.stringify(plan).slice(0, 5000)}`}
${elements.length ? `\nElements that must be on screen (from the request): ${elements.join("; ")}` : ""}
Found assets (use a ref in "assets"/"sfx" to use one; fonts may also be any "font:<family>" from the local list):
${assetList}

Local fonts:
${fonts || "none"}`;
	const messages: Message[] = [
		{ role: "system", content: `${WRITE_SYSTEM}\n\n${skillsFor(`${request} ${plan.understanding ?? ""} ${(plan as { plan?: string }).plan ?? ""}`)}` },
		{ role: "user", content: writeUser },
	];
	let answer = await thinkJson(messages, BUDGET.write);

	// 4. Build, check, fix (at most two fixes; one art-director look).
	const runDir = path.join(dataDir(), "montage-runs", ctx.runId);
	fs.mkdirSync(runDir, { recursive: true });
	let reviewed = false;
	let built: Built | null = null;
	for (let attempt = 0; attempt < 3; attempt++) {
		if (signal.aborted) throw new CancelledError();
		// A fix that comes back broken never costs the user the version that already works.
		const previous = built;
		try {
			built = await build(r, face, answer.json, found, images, ctx, path.join(runDir, `try${attempt}`), beats);
		} catch (error) {
			if (signal.aborted || !previous) throw error;
			log(`✗ The fix didn't work (${error instanceof Error ? error.message : "unreadable answer"}) — keeping the previous version`);
			built = previous;
			break;
		}
		let problems = built.problems;
		if (!problems.length && !reviewed && built.views.length) {
			reviewed = true;
			log(elements.length ? `Looking at the frames (checklist: ${elements.join(", ").slice(0, 120)})…` : "Looking at the frames…");
			try {
				problems = await review(s.deepseekKey, s.deepseekModel, request, built, elements, signal);
				calls++;
				log(problems.length ? `Art director: ${problems.length} note${problems.length === 1 ? "" : "s"} — ${problems[0]}` : "Art director: looks good, every element is there");
			} catch (error) {
				if (signal.aborted) throw error;
				log("Art director check skipped (no answer)");
				problems = [];
			}
		}
		if (!problems.length || attempt === 2) break;
		log(`Fixing: ${problems[0].slice(0, 160)}${problems.length > 1 ? ` (+${problems.length - 1})` : ""}`);
		messages.push({ role: "assistant", content: answer.text }, { role: "user", content: `Problems found when rendering your frames:\n- ${problems.join("\n- ")}\n${FIX_NOTE}` });
		try {
			answer = await thinkJson(messages, BUDGET.write);
		} catch (error) {
			if (signal.aborted) throw error;
			log(`✗ The fix didn't come back (${error instanceof Error ? error.message : "no answer"}) — keeping the current version`);
			break;
		}
	}
	if (!built) throw new StudioError("Gaziyav AI couldn't make any usable layers. Rephrase the request and try again.");
	// Whatever still fails after the fixes never reaches the editor.
	const layers = built.layers.filter((l) => !built!.broken.has(l));
	const keep = untouched(r, layers);
	if (!layers.length && !keep.length) throw new StudioError(`Gaziyav AI couldn't make the animation render: ${built.problems[0] ?? "unknown problem"}. Rephrase the request and try again.`);
	// A layer that still shows a picture nobody found is not shipped as an empty placeholder: ask for the picture.
	const unresolved = built.problems.find((p) => /uses p\.assets\..* but no such asset was found/.test(p));
	if (unresolved && !found.some((c) => c.type === "image")) {
		log("✗ No picture to show — add one and Gaziyav AI will use it");
		return { comment: "I need a picture for this. Add one and I'll use it.", mode: "full", layers: [], sfx: [], calls, keep: r.layers.map((l) => l.id), plan: planLine, question: { text: "I couldn't find a picture to show. Add one?", options: [], action: "add-image" } };
	}
	const result: PlanResult = { comment: built.comment, mode: "full", layers, sfx: built.sfx, calls, keep, plan: planLine, original: built.original };
	if (built.original.length) log(`Your ${built.original.length === 1 ? "original is" : "originals are"} ${built.original.every((o) => o.action === "remove") ? "replaced" : "hidden"} under the animation`);
	onlyWhatIsAsked(r.request, result);
	if (keep.length) log(`Kept ${keep.length} layer${keep.length === 1 ? "" : "s"} the request didn't name`);
	if (built.broken.size) result.comment += ` (left out ${built.broken.size} layer${built.broken.size === 1 ? "" : "s"} that did not render)`;
	return result;
}

interface Built {
	comment: string;
	layers: PlannedLayer[];
	sfx: PlannedSfx[];
	problems: string[];
	/** Layers that failed to render (dropped if the fixes don't help). */
	broken: Set<PlannedLayer>;
	views: { at: number; url: string; beat?: string }[];
	original: { id: string; action: "hide" | "remove" }[];
}

async function build(
	r: PlanRequest,
	face: Box | null,
	raw: any,
	found: Candidate[],
	images: ImageFinds,
	ctx: FullCtx,
	dir: string,
	beats: { at: number; what: string }[] = [],
): Promise<Built> {
	const { log, signal } = ctx;
	if (!raw || typeof raw !== "object") throw new StudioError("Gaziyav AI returned an unreadable answer.");
	const problems: string[] = [];

	// Components (a refinement may leave a component it did not change out of "components": its current code stays).
	const compiled = new Map<string, { js: string; code: string }>();
	const sources = { ...existingComponents(r), ...((raw?.components ?? {}) as Record<string, unknown>) };
	for (const [name, code] of Object.entries(sources)) {
		if (typeof code !== "string" || !/^[A-Z][A-Za-z0-9]*$/.test(name)) continue;
		log(`Compiling ${name}.tsx`);
		const out = compileComponent(code);
		if ("error" in out) problems.push(`${name}.tsx: ${out.error}`);
		else compiled.set(name, { js: out.js, code });
	}

	// Assets: only refs found for this request (fonts: any local family).
	const stored = new Map<string, StoredAsset>();
	for (const [key, ref] of Object.entries((raw?.assets ?? {}) as Record<string, unknown>)) {
		if (typeof ref !== "string" || !/^[A-Za-z][\w-]{0,30}$/.test(key)) continue;
		const allowed = found.some((c) => c.ref === ref) || ref.startsWith("font:");
		if (!allowed || ref.startsWith("sfx:")) continue;
		if (signal.aborted) throw new CancelledError();
		const asset = ref.startsWith("media:") ? mediaAsset(r, ref) : await storeRef(ref, images);
		if (asset) {
			stored.set(key, asset);
			log(`Using ${asset.type === "lottie" ? "graphic" : asset.type}: ${asset.title}`);
		} else problems.push(`asset "${key}" (${ref}) could not be loaded — design without it`);
	}
	// A follow-up keeps the assets this composition's components already use (found by an earlier run of it).
	const previous = new Map<string, StoredAsset>();
	for (const l of r.layers) {
		if (l.kind !== "Custom" || typeof l.props.assets !== "string") continue;
		try {
			for (const [k, a] of Object.entries(JSON.parse(l.props.assets) as Record<string, StoredAsset>)) if (a?.name && !stored.has(k)) previous.set(k, a);
		} catch {}
	}
	const assetsFor = (component: string) => {
		const code = compiled.get(component)?.code ?? "";
		if (!code.includes("assets")) return undefined;
		const pool = new Map([...previous, ...stored]);
		const used = [...pool.keys()].filter((k) => new RegExp(`\\b${k}\\b`).test(code));
		if (!used.length) return undefined;
		return JSON.stringify(Object.fromEntries(used.map((k) => [k, pool.get(k)])));
	};

	const cleaned = cleanLayers(r, raw, { components: compiled, assetsFor });
	problems.push(...cleaned.problems.filter((p) => !p.includes("was dropped") || !cleaned.layers.length));
	const layers = cleaned.layers;
	// Everything the user may change is a declared, editable prop (auto-derived when the answer forgot the schema).
	for (const l of layers) {
		if (l.kind !== "Custom") continue;
		const name = String(l.props.component);
		const fields = schemaFor(raw?.schema?.[name], l, compiled.get(name)?.code ?? "", r.layers.find((x) => x.id === l.id)?.props.schema);
		l.props.schema = JSON.stringify(fields);
		const hard = hardCodedText(compiled.get(name)?.code ?? "");
		if (hard.length) problems.push(`${name}.tsx shows text written into the code (${hard.slice(0, 3).map((t) => `"${t}"`).join(", ")}) — move every on-screen text into a prop declared in the schema and read it as p.<key>`);
	}
	// Never a silent placeholder: a component that shows an asset nobody found is a problem (asked for, not faked).
	for (const l of layers) {
		if (l.kind !== "Custom") continue;
		const name = String(l.props.component);
		const have = new Set(Object.keys(typeof l.props.assets === "string" ? (JSON.parse(l.props.assets) as object) : {}));
		const missing = usedAssetKeys(compiled.get(name)?.code ?? "").filter((k) => !have.has(k));
		if (missing.length) problems.push(`${name}.tsx uses p.assets.${missing.join(", p.assets.")} but no such asset was found — use only the found assets (or none)`);
	}
	const unused = [...compiled.keys()].filter((n) => !layers.some((l) => l.props.component === n));
	if (unused.length && !layers.length) problems.push(`components ${unused.join(", ")} are not used by any layer`);

	// Facts (kit text and every string a component shows).
	const facts = factSource(r);
	for (const l of layers) {
		const strings = visibleStrings(l);
		const pseudo = strings.map((text) => ({ kind: "Custom", from: l.from, to: l.to, props: { text } as Record<string, PropValue> }));
		const bad = factProblems(l.kind === "Custom" ? pseudo : [l], facts);
		for (const b of bad) problems.push(`${l.kind === "Custom" ? String(l.props.component) : l.kind}: ${b.problem.replace(/^\w+: /, "")} — use only the speaker's words`);
	}
	const kitNotes = resolveLayout(layers, face, r.width / Math.max(1, r.height), pinOf(r.request));
	if (kitNotes.length) log(`Layout: ${kitNotes.slice(0, 2).join(", ")}`);

	// Sounds.
	const sfx: PlannedSfx[] = [];
	for (const x of Array.isArray(raw?.sfx) ? raw.sfx : []) {
		const ref = String(x?.ref ?? "");
		if (!found.some((c) => c.ref === ref)) continue;
		const s = pickSfx(ref);
		if (s) sfx.push({ at: Math.max(0, Math.min(r.duration, Number(x?.at) || 0)), id: s.id, name: s.name, dur: s.dur });
		if (sfx.length >= 8) break;
	}

	// Still frames with the export engine.
	const broken = new Set<PlannedLayer>();
	const views: { at: number; url: string; beat?: string }[] = [];
	const custom = layers.filter((l) => l.kind === "Custom");
	if (layers.length && !problems.some((p) => p.includes(".tsx:"))) {
		fs.mkdirSync(dir, { recursive: true });
		const times = checkTimes(custom.length ? custom : layers, r.duration, beats);
		const lastFrame = Math.max(0, Math.ceil(r.duration * r.fps) - 1);
		const toFrame = (t: number) => Math.max(0, Math.min(Math.round(t * r.fps), lastFrame));
		const centres = times.map(toFrame);
		// Each checked moment with its neighbours 0.3 s before and after: the review sees how it moves.
		const groups = centres.map((c) => [...new Set([toFrame(c / r.fps - 0.3), c, toFrame(c / r.fps + 0.3)])]);
		const frames = [...new Set(groups.flat())].sort((a, b) => a - b);
		log(`Checking frame${centres.length > 1 ? "s" : ""} ${times.map((t) => `${t.toFixed(1)}s`).join(", ")} (with the motion around them)`);
		const input: MontageInput = {
			items: layers.map((l, i) => item(l, i)),
			words: [],
			origin: ctx.origin,
			width: r.width,
			height: r.height,
			fps: r.fps,
			durationInFrames: Math.max(1, Math.ceil(r.duration * r.fps)),
		};
		const report = await renderStills({ input, frames, outDir: dir, signal });
		for (const text of report.logs) problems.push(`while rendering: ${text}`);
		const viewFiles = new Map<number, string>();
		for (const f of report.frames) {
			const at = f.frame / r.fps;
			if (!centres.includes(f.frame)) {
				// A neighbour frame: only its picture, for the motion strip.
				if (f.file && !f.error) {
					const out = path.join(dir, `view${f.frame}.jpg`);
					if (await viewFrame({ still: f.file, video: r.face ?? null, at, width: r.width, height: r.height, outFile: out, signal }).catch(() => null)) viewFiles.set(f.frame, out);
				}
				continue;
			}
			const live = layers.filter((l) => at >= l.from && at < l.to);
			if (f.error) {
				problems.push(`frame ${at.toFixed(1)} s failed to render: ${f.error}`);
				for (const l of live) if (l.kind === "Custom") broken.add(l);
				continue;
			}
			if (f.ms && f.ms > 15000) problems.push(`frame ${at.toFixed(1)} s took ${(f.ms / 1000).toFixed(0)} s to render — make the component lighter (fewer elements, no huge blurs)`);
			const scene = live.find((l) => l.props.layout === "scene");
			if (scene && f.coverage !== undefined && f.coverage < 0.97 && at > scene.from + 0.7 && at < scene.to - 0.7) {
				problems.push(`the full-frame scene does not cover the frame at ${at.toFixed(1)} s — paint the whole frame or keep the automatic backdrop`);
			}
			if (!scene && live.some((l) => l.kind === "Custom") && f.coverage !== undefined && f.coverage < 0.002) {
				problems.push(`frame ${at.toFixed(1)} s is empty — nothing of ${live.map((l) => l.props.component).join(", ")} is visible`);
			}
			if (report.logs.length) for (const l of live) if (l.kind === "Custom" && report.logs.some((x) => x.includes(String(l.props.component)))) broken.add(l);
			if (f.file) {
				const out = path.join(dir, `view${f.frame}.jpg`);
				if (await viewFrame({ still: f.file, video: r.face ?? null, at, width: r.width, height: r.height, outFile: out, signal }).catch(() => null)) viewFiles.set(f.frame, out);
			}
		}
		for (const [i, c] of centres.entries()) {
			if (!viewFiles.has(c)) continue;
			const files = groups[i].map((g) => viewFiles.get(g)).filter((x): x is string => !!x);
			const url = await stripOf(files, path.join(dir, `strip${c}.jpg`), signal).catch(() => null);
			const at = c / r.fps;
			const beat = beats.filter((b) => b.at <= at + 0.05).pop();
			if (url) views.push({ at, url, beat: beat?.what });
		}
		log(problems.length ? `Check: ${problems.length} problem${problems.length === 1 ? "" : "s"}` : "Check: frames render cleanly");
	} else if (layers.length) {
		for (const l of custom) if (!compiled.has(String(l.props.component))) broken.add(l);
	}
	if (!layers.length && !problems.length) problems.push("no layers in the answer — return at least one layer");
	// The user's own media the new layers animate: hidden by default (one undo step with the layers).
	const original: { id: string; action: "hide" | "remove" }[] = [];
	const animated = new Set(layers.flatMap((l) => (typeof l.props.assets === "string" ? Object.values(JSON.parse(l.props.assets) as Record<string, StoredAsset>).map((a) => a.name) : [])));
	const asked = (raw?.original ?? {}) as Record<string, unknown>;
	for (const m of r.media ?? []) {
		if (!animated.has(m.info.name)) continue;
		const a = String(asked[m.id] ?? (/остав|keep/i.test(r.request) ? "keep" : "hide"));
		if (a === "hide" || a === "remove") original.push({ id: m.id, action: a });
	}
	return { comment: String(raw?.comment ?? "Done").slice(0, 220), layers, sfx, problems: [...new Set(problems)].slice(0, 8), broken, views, original };
}

/** The user's own media as asset candidates (refs media:N). */
function mediaCandidates(r: PlanRequest): Candidate[] {
	return (r.media ?? []).map((m, i) => ({
		ref: `media:${i}`,
		type: m.info.kind === "video" ? ("image" as const) : ("image" as const),
		title: m.name,
		detail: `${m.info.kind} ${m.info.w}×${m.info.h}${m.info.alpha ? ", transparent" : ""}`,
	}));
}

function mediaAsset(r: PlanRequest, ref: string): StoredAsset | null {
	const m = r.media?.[Number(ref.slice(6))];
	if (!m || !assetFile(m.info.name)) return null;
	return { type: m.info.kind === "video" ? "video" : "image", name: m.info.name, title: m.name, w: m.info.w, h: m.info.h, duration: m.info.duration };
}

/** Asset keys a component's code reads (p.assets.key / assets.key / assets["key"]). */
export function usedAssetKeys(code: string): string[] {
	const keys = new Set<string>();
	for (const m of code.matchAll(/assets\??\.\s*([A-Za-z_]\w*)|assets\[\s*['"]([A-Za-z_][\w-]*)['"]\s*\]/g)) keys.add(m[1] ?? m[2]);
	return [...keys];
}

/** Code of this composition's own components, by name (what a follow-up refines). */
export function existingComponents(r: PlanRequest): Record<string, string> {
	const out: Record<string, string> = {};
	for (const l of r.layers) {
		const name = l.props.component;
		if (l.kind === "Custom" && typeof name === "string" && typeof l.props.code === "string") out[name] = l.props.code;
	}
	return out;
}

/** 2–4 moments worth looking at: just after each planned beat (where the named events happen), else early/middle/late. */
function checkTimes(layers: PlannedLayer[], duration: number, beats: { at: number }[] = []): number[] {
	const first = layers.reduce((a, b) => (a.from <= b.from ? a : b));
	const last = layers.reduce((a, b) => (a.to >= b.to ? a : b));
	const inside = (x: number) => Math.max(first.from + 0.1, Math.min(last.to - 0.15, x));
	const fromBeats = beats.map((b) => inside(b.at + 0.3));
	const defaults = [first.from + Math.min(0.9, (first.to - first.from) * 0.35), (first.from + last.to) / 2, last.to - Math.min(0.6, (last.to - last.from) * 0.2)];
	const out: number[] = [];
	for (const x of [...fromBeats, ...defaults].map((x) => Math.max(0, Math.min(duration - 0.05, x)))) {
		if (out.length >= 4) break;
		if (!out.some((y) => Math.abs(y - x) < 0.45)) out.push(Math.round(x * 10) / 10);
	}
	return out.sort((a, b) => a - b);
}

export interface SchemaField {
	key: string;
	label: string;
	type: "text" | "color" | "number" | "time" | "image";
	min?: number;
	max?: number;
	step?: number;
}

const SKIP_FIELD = new Set(["component", "layout", "style", "js", "code", "assets", "schema", "words", "bg"]);
const label = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** The editable fields of a component: the declared schema, completed with every prop the layer sets. */
export function schemaFor(declared: unknown, l: PlannedLayer, code: string, previous?: unknown): SchemaField[] {
	const out: SchemaField[] = [];
	const add = (f: SchemaField) => {
		if (!out.some((x) => x.key === f.key)) out.push(f);
	};
	let prior: unknown = previous;
	if (typeof prior === "string") {
		try {
			prior = JSON.parse(prior);
		} catch {
			prior = null;
		}
	}
	for (const f of [...(Array.isArray(declared) ? declared : []), ...(Array.isArray(prior) ? prior : [])]) {
		const key = String(f?.key ?? "");
		if (!/^[A-Za-z_][\w]{0,40}$/.test(key) || SKIP_FIELD.has(key)) continue;
		const type = ["text", "color", "number", "time", "image"].includes(f?.type) ? f.type : "text";
		const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
		add({ key, label: String(f?.label ?? label(key)).slice(0, 40), type, min: num(f?.min), max: num(f?.max), step: num(f?.step) });
	}
	for (const [key, v] of Object.entries(l.props)) {
		if (SKIP_FIELD.has(key) || key === "accent" || !/^[A-Za-z_][\w]{0,40}$/.test(key)) continue;
		if (typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v)) add({ key, label: label(key), type: "color" });
		else if (typeof v === "number") add({ key, label: label(key), type: /at$|time|start|delay|^t\d|hit|impact/i.test(key) ? "time" : "number", step: /at$|time|start|delay|hit|impact/i.test(key) ? 0.05 : undefined });
		else if (typeof v === "string" && !v.startsWith("json:")) add({ key, label: label(key), type: "text" });
	}
	if (/\bp\.accent\b|accent/.test(code)) add({ key: "accent", label: "Accent", type: "color" });
	return out.slice(0, 24);
}

/** On-screen words written into the code itself (JSX text, Cyrillic string literals). */
export function hardCodedText(code: string): string[] {
	const out: string[] = [];
	for (const m of code.matchAll(/<[A-Za-z][\w.]*(?:\s[^<>]*)?>([^<>{}]*\p{L}{2,}[^<>{}]*)</gu)) if (!/[;=()]/.test(m[1]) && m[1].trim()) out.push(m[1].trim());
	for (const m of code.matchAll(/(['"`])([^'"`\n]*[А-Яа-яЁё][^'"`\n]*)\1/g)) out.push(m[2].trim());
	return [...new Set(out)].slice(0, 6);
}

function item(l: PlannedLayer, i: number): MontageItem {
	return { id: `check-${i}`, kind: l.kind, from: l.from, dur: Math.max(0.1, l.to - l.from), props: l.props };
}

const SKIP_PROPS = new Set(["js", "code", "assets", "style", "layout", "component", "bg", "accent", "words", "schema", "x", "y"]);
/** Props that style or time a layer: never on-screen words (colours, fonts, easings, positions, sizes, ids, urls). */
const STYLE_KEY = /colou?r|font|eas(e|ing)|shadow|blend|filter|gradient|^bg|background|border|stroke|fill|align|anchor|position|layout|style|weight|direction|mode|variant|shape|curve|^id$|Id$|url|src|asset|image|photo|picture|icon$|emoji$/i;
/** A string that is CSS or a keyword, not words for the viewer. */
const CSS_VALUE = /^#|^(rgba?|hsla?|oklch|linear-gradient|radial-gradient|conic-gradient|url|var|calc|cubic-bezier)\(|^-?[\d.]+(px|%|deg|ms|s|em|rem|vh|vw|fr)?(\s+-?[\d.]+(px|%|deg|ms|s|em|rem|vh|vw)?)*$|\b\d+(\.\d+)?(px|deg|em|rem|vh|vw)\b/;
const CSS_WORD = /^(none|auto|normal|bold|bolder|lighter|italic|left|right|top|bottom|center|centre|middle|start|end|stretch|cover|contain|fill|solid|dashed|dotted|hidden|visible|absolute|relative|flex|row|column|wrap|nowrap|uppercase|lowercase|capitalize|inherit|transparent|linear|ease|in|out|inout|overlay|scene|screen|multiply|blur|glass|dark|light|spring|smooth|soft|hard|clamp|true|false)$/i;

/**
 * Every string a layer can put on screen: its text props (lists included; never colours, fonts, timings, sizes, the
 * schema or other styling) and the text written in its code. Numbers are only read from these strings.
 */
export function visibleStrings(l: PlannedLayer): string[] {
	const out: string[] = [];
	let declared: Record<string, string> = {};
	if (typeof l.props.schema === "string") {
		try {
			declared = Object.fromEntries((JSON.parse(l.props.schema) as SchemaField[]).map((f) => [f.key, f.type]));
		} catch {}
	}
	const words = (v: string) => /\p{L}{2,}|\d/u.test(v) && !CSS_VALUE.test(v.trim()) && !CSS_WORD.test(v.trim());
	const walk = (v: unknown, key = "") => {
		if (key && STYLE_KEY.test(key)) return;
		if (typeof v === "string") {
			if (words(v)) out.push(v);
		} else if (Array.isArray(v)) for (const x of v) walk(x);
		else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
	};
	for (const [k, v] of Object.entries(l.props)) {
		if (SKIP_PROPS.has(k) || STYLE_KEY.test(k)) continue;
		if (declared[k] && declared[k] !== "text") continue;
		if (typeof v === "string" && v.startsWith(JSON_PREFIX)) {
			try {
				walk(JSON.parse(v.slice(JSON_PREFIX.length)));
			} catch {}
		} else walk(v);
	}
	// Words written into the code itself: JSX text right after an opening tag, and Cyrillic string literals.
	const code = typeof l.props.code === "string" ? l.props.code : "";
	for (const m of code.matchAll(/<[A-Za-z][\w.]*(?:\s[^<>]*)?>([^<>{}]*\p{L}{2,}[^<>{}]*)</gu)) if (!/[;=()]/.test(m[1])) out.push(m[1]);
	for (const m of code.matchAll(/(['"`])([^'"`\n]*[А-Яа-яЁё][^'"`\n]*)\1/g)) out.push(m[2]);
	return [...new Set(out.map((s) => s.trim()).filter(Boolean))].slice(0, 60);
}

async function review(key: string, model: string, request: string, built: Built, elements: string[], signal: AbortSignal): Promise<string[]> {
	const parts: Part[] = [
		{
			type: "text",
			text: `Request: ${request}\nLayers: ${built.layers.map((l) => `${l.kind === "Custom" ? l.props.component : l.kind} (${l.props.layout}) ${l.from.toFixed(1)}–${l.to.toFixed(1)} s`).join("; ")}\n${elements.length ? `Checklist — each must be clearly visible in at least one frame: ${elements.join("; ")}\n` : ""}Frames follow, in order.`,
		},
	];
	for (const v of built.views.slice(0, 4)) parts.push({ type: "text", text: `Around ${v.at.toFixed(1)} s — three moments left to right (−0.3 s, ${v.at.toFixed(1)} s, +0.3 s)${v.beat ? `; should show: ${v.beat}` : ""}:` }, { type: "image_url", image_url: { url: v.url } });
	const answer = await chat({
		key,
		model: model === REASONER ? "deepseek-flash" : model,
		messages: [
			{ role: "system", content: REVIEW_SYSTEM },
			{ role: "user", content: parts },
		],
		json: true,
		maxTokens: 8000,
		timeout: 150,
		signal,
	});
	const j = parseJson(answer);
	if (j?.ok === true && !(Array.isArray(j?.problems) && j.problems.some((p: unknown) => /^missing/i.test(String(p))))) return [];
	return (Array.isArray(j?.problems) ? j.problems : []).map((p: unknown) => String(p).slice(0, 240)).filter(Boolean).slice(0, 5);
}

