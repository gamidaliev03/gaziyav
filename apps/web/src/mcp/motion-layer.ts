// motion_layer: Claude authors Remotion motion graphics itself (no AI spend) as ordinary AI layers of the timeline —
// a ready template (Templates → Motion graphics), a kit layer (HookTitle, Counter, LowerThird…) or its own component
// (TSX in the same sandbox as Gaziyav AI's components: montage/server/plan.ts + mcp/server/compose.ts). Placed or
// changed as one ⌘Z step; then rendered at a few frames in the preview: a layer that doesn't load or crashes is taken
// back and the error says what to fix; one that renders comes back with its frames.
import { autoPlacement } from "@/commands/timeline/element/insert-element";
import { InsertElementCommand } from "@/commands";
import { EditorCore } from "@/core";
import { lookAt } from "@/agent/vision";
import { AI_PREFIX, KIND_BY_ID } from "@/montage/catalog";
import { MOGRAPH_BY_KIND, mographDefaults } from "@/montage/mograph";
import { layoutDefaults } from "@/montage/run-agent";
import { JSON_PREFIX, type PropValue } from "@/montage/types";
import type { CreateGraphicElement, TimelineElement, TimelineTrack } from "@/timeline";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";
import { layerErrorsSince } from "./context";

type Args = Record<string, unknown>;
export interface Seen {
	text: string;
	images: string[];
}

const ed = () => EditorCore.getInstance();
const ticks = (s: number) => mediaTime({ ticks: Math.round(Math.max(0, s) * TICKS_PER_SECOND) });
const sec = (t: number) => Math.round((t / TICKS_PER_SECOND) * 100) / 100;
/** The kit layers Claude may place by kind (the rest of the catalogue is Gaziyav AI's own). */
const KIT = ["HookTitle", "LowerThird", "Counter", "CTA", "Plate", "Card", "Badge", "PriceCard", "ProgressBar", "Finish", "Sticker"];

function all(): Array<{ track: TimelineTrack; element: TimelineElement }> {
	const t = ed().scenes.getActiveScene().tracks;
	return ([...t.overlay, t.main, ...t.audio] as TimelineTrack[]).flatMap((track) => (track.elements as TimelineElement[]).map((element) => ({ track, element })));
}

/** Props as the editor keeps them: flat values, lists and objects as `json:` strings. */
function flat(props: unknown): Record<string, PropValue> {
	const out: Record<string, PropValue> = {};
	if (!props || typeof props !== "object") return out;
	for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
		if (!/^[A-Za-z_][\w.]{0,40}$/.test(k) || k === "js" || k === "code") continue;
		if (typeof v === "string" || typeof v === "boolean") out[k] = v;
		else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
		else if (v && typeof v === "object") {
			const s = JSON.stringify(v);
			if (s.length > 20000) throw new Error(`props.${k} is too big (keep data under 20 kB).`);
			out[k] = `${JSON_PREFIX}${s}`;
		}
	}
	return out;
}

async function compile(code: string, component: string): Promise<string> {
	const res = await fetch("/api/mcp/compose", { method: "POST", headers: { "X-Studio": "1", "Content-Type": "application/json" }, body: JSON.stringify({ code, component }) });
	const j = (await res.json().catch(() => ({}))) as { js?: string; error?: string };
	if (!j.js) throw new Error(`The component doesn't compile: ${j.error || `HTTP ${res.status}`}`);
	// Loaded here once, the way the preview loads it: an error at load time is known before anything is placed.
	const { loadComponent } = await import("@/montage/remotion/custom");
	const since = Date.now();
	if (!loadComponent(j.js, component)) {
		const why = layerErrorsSince(since, component)[0] ?? "it exports no component, or it throws when it loads";
		throw new Error(`The component doesn't load: ${why}. Fix it and send the whole code again.`);
	}
	return j.js;
}

/** The props a layer's component gets in the composition (montage/remotion/composition.tsx): its own (json: decoded) + the kit's. */
function layerProps(params: Record<string, PropValue>, dur: number, start: number): Record<string, unknown> {
	const own: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(params)) {
		if (k === "js" || k === "code") continue;
		if (typeof v === "string" && v.startsWith(JSON_PREFIX)) {
			try {
				own[k] = JSON.parse(v.slice(JSON_PREFIX.length));
				continue;
			} catch {}
		}
		own[k] = v;
	}
	return { ...own, id: "probe", dur, accent: typeof params.accent === "string" ? params.accent : "", t0: start, words: [], media: {}, assets: {}, origin: "" };
}

/**
 * The component rendered off screen at its first, middle and last frame inside Remotion's own error boundary, before
 * anything is placed: a component that throws while it renders is refused with the frame and the message.
 */
async function probe(js: string, name: string, params: Record<string, PropValue>, seconds: number, start: number): Promise<string | null> {
	const project = ed().project.getActive();
	const fps = Math.max(1, Math.round(project.settings.fps.numerator / project.settings.fps.denominator));
	const dur = Math.max(1, Math.round(seconds * fps));
	const [{ Thumbnail }, { createRoot }, React, { loadComponent }] = await Promise.all([import("@remotion/player"), import("react-dom/client"), import("react"), import("@/montage/remotion/custom")]);
	const Comp = loadComponent(js, name);
	if (!Comp) return "does not load (it exports no component, or throws when it loads)";
	const host = document.createElement("div");
	host.style.cssText = "position:fixed;left:-10000px;top:0;width:48px;height:48px;overflow:hidden;opacity:0;pointer-events:none";
	document.body.appendChild(host);
	const root = createRoot(host);
	const props = layerProps(params, dur, start);
	try {
		for (const frame of [0, Math.floor(dur / 2), dur - 1]) {
			let failed: Error | null = null;
			root.render(
				React.createElement(Thumbnail, {
					component: Comp,
					inputProps: props,
					compositionWidth: project.settings.canvasSize.width,
					compositionHeight: project.settings.canvasSize.height,
					durationInFrames: dur,
					fps,
					frameToDisplay: frame,
					style: { width: 48, height: 48 },
					errorFallback: ({ error }: { error: Error }) => {
						failed = error;
						return null;
					},
				}),
			);
			await new Promise((r) => setTimeout(r, 120));
			if (failed) return `crashes when it renders at frame ${frame} of ${dur}: ${(failed as Error).message}`;
		}
		return null;
	} finally {
		root.unmount();
		host.remove();
	}
}

/** Plays the layer at a few moments in the preview; the errors it logged, and the frames. */
async function renderCheck(element: TimelineElement, name: string): Promise<{ errors: string[]; images: string[]; times: number[] }> {
	const a = element.startTime / TICKS_PER_SECOND;
	const len = element.duration / TICKS_PER_SECOND;
	const times = len > 1.2 ? [a + Math.min(0.4, len * 0.2), a + len * 0.55, a + len - 0.15] : [a + len / 2];
	const since = Date.now();
	const shots = await lookAt(times, 640);
	return { errors: layerErrorsSince(since, name), images: shots.map((s) => s.src).filter((x): x is string => !!x), times: shots.map((s) => s.at) };
}

export async function motionLayer(args: Args): Promise<Seen> {
	const editor = ed();
	if (!editor.project.getActiveOrNull()) throw new Error("No project is open.");
	const props = flat(args.props);
	const code = typeof args.code === "string" ? args.code : "";
	const component = String(args.component ?? (/export\s+(?:const|function)\s+([A-Z]\w*)/.exec(code)?.[1] ?? ""));

	// ── change a layer that is there ──
	if (args.id) {
		const key = String(args.id);
		const found = all().find((x) => x.element.id === key || x.element.id.startsWith(key));
		if (!found || found.element.type !== "graphic" || !found.element.definitionId.startsWith(AI_PREFIX)) throw new Error(`No motion layer "${key}". get_project lists the layers (type graphic).`);
		const params = { ...(found.element as { params: Record<string, PropValue> }).params, ...props };
		if (code) {
			if (found.element.definitionId !== `${AI_PREFIX}Custom`) throw new Error("This layer is a template or a kit layer: change its props, or place your code as a new layer.");
			params.js = await compile(code, component);
			params.code = code;
			params.component = component;
		}
		if (found.element.definitionId === `${AI_PREFIX}Custom` && typeof params.js === "string") {
			const len = args.duration !== undefined ? Number(args.duration) : found.element.duration / TICKS_PER_SECOND;
			const crash = await probe(params.js, String(params.component), params, len, found.element.startTime / TICKS_PER_SECOND);
			if (crash) throw new Error(`Not changed: the component ${crash}. Fix it and send the whole code again (motion_layer {id, code}).`);
		}
		const patch: Partial<TimelineElement> = { params } as Partial<TimelineElement>;
		if (args.start !== undefined) Object.assign(patch, { startTime: ticks(Number(args.start)) });
		if (args.duration !== undefined) Object.assign(patch, { duration: ticks(Math.max(0.3, Number(args.duration))) });
		if (typeof args.name === "string" && args.name.trim()) Object.assign(patch, { name: args.name.trim().slice(0, 60) });
		const old = { ...found.element } as Partial<TimelineElement>;
		editor.timeline.updateElements({ updates: [{ trackId: found.track.id, elementId: found.element.id, patch }] });
		const depth = editor.command.depth();
		const now = all().find((x) => x.element.id === found.element.id)?.element ?? found.element;
		const check = await renderCheck(now, String(params.component || found.element.name));
		if (check.errors.length) {
			// (the user's own step meanwhile is never undone: the old settings are put back instead)
			if (editor.command.depth() === depth) editor.command.undo();
			else editor.timeline.updateElements({ updates: [{ trackId: found.track.id, elementId: found.element.id, patch: old }] });
			throw new Error(`The change was taken back: the layer ${check.errors[0]}. Fix it and call motion_layer {id:"${found.element.id.slice(0, 8)}", code} again.`);
		}
		return { text: `Updated ${found.element.id.slice(0, 8)} (${sec(now.startTime)}–${sec(now.startTime + now.duration)} s); it renders: frames at ${check.times.map((t) => t.toFixed(1)).join(", ")} s below.`, images: check.images };
	}

	// ── a new layer ──
	const start = args.start === undefined ? editor.playback.getCurrentTime() / TICKS_PER_SECOND : Number(args.start);
	// Own code makes an own layer whatever kind was guessed beside it (a cat job sent kind:"Title" with its code: «Unknown kind»).
	const asked = String(args.kind ?? "");
	const kind = code && !KIT.includes(asked) && !MOGRAPH_BY_KIND.has(asked) ? "Custom" : asked || (code ? "Custom" : "");
	let element: CreateGraphicElement;
	if (kind === "Custom") {
		if (!code) throw new Error("An own layer needs code: TSX that exports the component (editing_guide topic:motion has the rules).");
		const js = await compile(code, component);
		const seconds = Math.max(0.3, Number(args.duration) || 4);
		const crash = await probe(js, component, { ...props, component, js }, seconds, start);
		if (crash) throw new Error(`Not placed: the component ${crash}. Fix it and send the whole code again.`);
		element = {
			type: "graphic",
			name: String(args.name || component).slice(0, 60),
			definitionId: `${AI_PREFIX}Custom`,
			startTime: ticks(start),
			duration: ticks(Math.max(0.3, Number(args.duration) || 4)),
			trimStart: ticks(0),
			trimEnd: ticks(0),
			params: { ...layoutDefaults(KIND_BY_ID.get("Custom")?.fields ?? []), layout: "overlay", ...props, component, code, js },
		};
	} else if (MOGRAPH_BY_KIND.has(kind)) {
		const m = MOGRAPH_BY_KIND.get(kind)!;
		const known = new Set(m.fields.map((f) => f.key));
		const unknown = Object.keys(props).filter((k) => !known.has(k));
		if (unknown.length) throw new Error(`${m.label} has no field ${unknown.join(", ")}. Its fields: ${[...known].join(", ")}.`);
		element = { type: "graphic", name: String(args.name || m.label), definitionId: `${AI_PREFIX}${m.kind}`, startTime: ticks(start), duration: ticks(Number(args.duration) || m.dur), trimStart: ticks(0), trimEnd: ticks(0), params: { ...mographDefaults(m), ...props } };
	} else if (KIT.includes(kind)) {
		const k = KIND_BY_ID.get(kind)!;
		element = { type: "graphic", name: String(args.name || k.label), definitionId: `${AI_PREFIX}${kind}`, startTime: ticks(start), duration: ticks(Math.max(0.3, Number(args.duration) || 3)), trimStart: ticks(0), trimEnd: ticks(0), params: { ...layoutDefaults(k.fields), ...props } };
	} else {
		const near = KIT.find((k) => k.toLowerCase().includes(kind.toLowerCase()) || kind.toLowerCase().includes(k.toLowerCase()));
		throw new Error(`Unknown kind "${kind}"${near ? ` (did you mean ${near}?)` : ""}. kind is a kit layer — ${KIT.join(" | ")} — or a template's kind from find_content {kind:"motion"}; for your own layer send code (+ component) and no kind.`);
	}
	const before = new Set(all().map((x) => x.element.id));
	const track = typeof args.track === "string" && args.track !== "new" ? all().find((x) => x.track.id.startsWith(String(args.track)))?.track : undefined;
	if (args.track && args.track !== "new" && !track) throw new Error(`No track "${String(args.track)}". get_project lists the tracks.`);
	// A new layer goes on a new track on top (After Effects): nothing covers it, it is drawn live and its errors seen.
	editor.command.execute({ command: new InsertElementCommand({ element, placement: track ? { mode: "explicit", trackId: track.id } : autoPlacement({ newTrackIndex: 0 }) }) });
	const depth = editor.command.depth();
	const added = all().find((x) => !before.has(x.element.id));
	if (!added) throw new Error("The layer couldn't be placed there (a busy track?). Try track:'new'.");
	const name = String(element.params.component || element.name);
	const check = await renderCheck(added.element, kind === "Custom" ? name : "");
	if (check.errors.length) {
		if (editor.command.depth() === depth) editor.command.undo();
		else editor.timeline.deleteElements({ elements: [{ trackId: added.track.id, elementId: added.element.id }] });
		throw new Error(`Not placed: the layer ${check.errors[0]}. Fix the code and call motion_layer again.`);
	}
	return {
		text: `Placed ${element.name} id ${added.element.id.slice(0, 8)} on track ${added.track.id.slice(0, 8)} at ${sec(added.element.startTime)}–${sec(added.element.startTime + added.element.duration)} s; it renders (frames at ${check.times.map((t) => t.toFixed(1)).join(", ")} s below). Change it with motion_layer {id, props|code}; move/trim with edit.`,
		images: check.images,
	};
}
