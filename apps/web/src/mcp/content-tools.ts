// Gaziyav's built-in libraries for Claude, searched by name or theme in one tool: transitions, effects, filters
// (colour looks), text designs, motion templates, stickers, music and sounds — and the two ways to use them that
// Gaziyav AI has no tool for: a filter on a clip, a motion template on the timeline.
import { NO_STICKERS, STICKERS } from "./surface";
import { EditorCore } from "@/core";
import { effectsRegistry } from "@/effects";
import { LOOKS } from "@/effects/luts/looks";
import { COLOR_EFFECT_TYPE } from "@/effects/definitions/studio/color";
import { MOGRAPH_BY_KIND, MOGRAPH_KINDS } from "@/montage/mograph";
import { mographElement } from "@/montage/mograph-insert";
import { autoPlacement } from "@/commands/timeline/element/insert-element";
import { InsertElementCommand } from "@/commands";
import { TEMPLATES } from "@/templates/catalog";
import { TEXT_PRESETS } from "@/text/presets";
import type { TimelineElement, TimelineTrack } from "@/timeline";
import { ALL_TRANSITIONS } from "@/transitions/definitions";
import { TICKS_PER_SECOND } from "@/wasm";

type Args = Record<string, unknown>;
export type AgentRun = (name: string, args: Args) => Promise<{ ok: boolean; content: string }>;

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const S = (description: string) => ({ type: "string", description });
const KINDS = ["transition", "effect", "filter", "text", "motion", "sticker", "music", "sound"] as const;

export const CONTENT_TOOL_SPECS = [
	{
		name: "find_content",
		description:
			"Search Gaziyav's built-in libraries by name or theme (English words; empty query = the first ones): transition, effect, filter (colour looks), text (styled text and caption designs), motion (animated templates: intros, lower thirds, CTAs, counters, kinetic type, social proof, sale tags), sticker (animated stickers and callouts), music, sound (effects: whoosh, pop, riser…). Each hit says how to use it.",
		parameters: obj({ kind: S(KINDS.join(" | ")), query: S("Name or theme, e.g. 'zoom', 'glitch', 'warm film', 'lower third', 'subscribe', 'upbeat pop', 'whoosh'") }, ["kind"]),
	},
	{
		name: "apply_filter",
		description: "Put a colour filter (a look from find_content kind:filter) on a video or picture clip. Change its strength after with set_effect.",
		parameters: obj({ id: S("Clip id"), look: S("Look id") }, ["id", "look"]),
	},
	{
		name: "add_motion",
		description: "Put a motion template (from find_content kind:motion) on the timeline at `start`, with its texts filled in (`fields`: key → text, keys from find_content).",
		parameters: obj({ kind: S("Motion template id"), template: S("Or a Templates pack id (find_content kind:template)"), start: { type: "number", description: "Seconds" }, fields: { type: "object", description: "Field key → value" } }),
	},
];

export const CONTENT_TOOL_NAMES = new Set(CONTENT_TOOL_SPECS.map((t) => t.name));

const editor = () => EditorCore.getInstance();

/** Hits that contain any of the words (best first); the start of the list when none matches. */
function search<T>(items: T[], text: (item: T) => string, query: string, limit = 24): { hits: T[]; exact: boolean } {
	const words = query.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 1);
	if (!words.length) return { hits: items.slice(0, limit), exact: true };
	const scored = items
		.map((item) => {
			const hay = text(item).toLowerCase();
			return { item, score: words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0) };
		})
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score);
	return scored.length ? { hits: scored.slice(0, limit).map((x) => x.item), exact: true } : { hits: items.slice(0, limit), exact: false };
}

/** A JSON list of hits as «id (name, category, s)» items. */
function compactList(json: string): string {
	try {
		const list = JSON.parse(json) as Array<Record<string, unknown>>;
		if (!Array.isArray(list)) return json;
		return list.map((x) => `${x.id} (${[x.name, x.category, x.seconds !== undefined ? `${x.seconds} s` : ""].filter(Boolean).join(", ")})`).join(" · ");
	} catch {
		return json;
	}
}

const note = (exact: boolean, query: string) => (exact ? "" : `Nothing matched “${query}”; here are the first ones. `);

/** Nothing matched: a few of the kind instead of thirty unrelated ones, its groups to ask by, and where else the words do match. */
const FEW = 8;
function miss<T>(hits: T[], exact: boolean, query: string, groups: string[], skip: "text" | "motion" | ""): { hits: T[]; note: string } {
	if (exact || !query.trim()) return { hits, note: "" };
	const other: string[] = [];
	if (skip !== "text") {
		const t = search(TEXT_PRESETS, (p) => `${p.id} ${p.name} ${p.group}`, query, 4);
		if (t.exact) other.push(`kind "text" has ${t.hits.map((p) => `text:${p.id} (${p.group}: ${p.name})`).join(" · ")}`);
	}
	if (skip !== "motion") {
		const m = search(MOGRAPH_KINDS.filter((k) => !k.hidden), (k) => `${k.kind} ${k.label} ${k.category}`, query, 4);
		if (m.exact) other.push(`kind "motion" has ${m.hits.map((k) => `motion:${k.kind} (${k.label})`).join(" · ")}`);
	}
	const by = [...new Set(groups.filter(Boolean))].slice(0, 14);
	return { hits: hits.slice(0, FEW), note: `Nothing here matches “${query}”${other.length ? ` — but ${other.join("; ")}` : ""}.${by.length ? ` Its groups: ${by.join(", ")}.` : ""} The first ${Math.min(FEW, hits.length)}: ` };
}

export async function runContentTool(name: string, args: Args, agent: AgentRun): Promise<string> {
	if (name === "apply_filter") {
		const look = String(args.look ?? "");
		if (!LOOKS.some((l) => l.id === look)) throw new Error(`No look "${look}". Use find_content with kind:"filter".`);
		// A clip that already has a Color pass gets the new look on it, not a second pass on top.
		const set = await agent("set_effect", { id: args.id, effect: COLOR_EFFECT_TYPE, params: { look } });
		const r = set.ok ? set : await agent("add_effect", { id: args.id, type: COLOR_EFFECT_TYPE, params: { look } });
		if (!r.ok) throw new Error(r.content.replace(/^Error:\s*/, ""));
		return `${LOOKS.find((l) => l.id === look)?.name} on ${String(args.id).slice(0, 8)}. ${r.content}`;
	}
	if (name === "add_motion" && args.template) {
		// A multi-layer pack (Templates tab): every layer at its own moment of the video, one ⌘Z.
		const pack = TEMPLATES.find((t) => t.id === String(args.template));
		if (!pack) throw new Error(`No template "${String(args.template)}". Use find_content with kind:"template".`);
		const ed = editor();
		const count = () => ed.scenes.getActiveScene().tracks.overlay.reduce((n, t) => n + t.elements.length, 0);
		const before = count();
		const { applyTemplate } = await import("@/templates/components/templates-view");
		await applyTemplate(pack);
		return `${pack.name}: ${count() - before} layer(s) placed over the video (texts change with motion_layer {id, props} or edit set).`;
	}
	if (name === "add_motion") {
		const kind = MOGRAPH_BY_KIND.get(String(args.kind ?? ""));
		if (!kind) throw new Error(`No motion template "${String(args.kind)}". Use find_content with kind:"motion".`);
		const ed = editor();
		const all = () => {
			const t = ed.scenes.getActiveScene().tracks;
			return ([...t.overlay, t.main, ...t.audio] as TimelineTrack[]).flatMap((track) => (track.elements as TimelineElement[]).map((element) => ({ track, element })));
		};
		const before = new Set(all().map((x) => x.element.id));
		const fields = (args.fields && typeof args.fields === "object" ? args.fields : {}) as Record<string, unknown>;
		const known = new Set(kind.fields.map((f) => f.key));
		// The texts go in with the clip: one ⌘Z for the whole step (an insert and then an update made two).
		const element = mographElement(kind, args.start === undefined ? ed.playback.getCurrentTime() / TICKS_PER_SECOND : Math.max(0, Number(args.start) || 0));
		for (const [k, v] of Object.entries(fields)) if (known.has(k)) (element.params as Record<string, unknown>)[k] = typeof v === "number" || typeof v === "boolean" ? v : String(v);
		ed.command.execute({ command: new InsertElementCommand({ element, placement: autoPlacement() }) });
		const added = all().find((x) => !before.has(x.element.id));
		if (!added) throw new Error("The template couldn't be placed (no project open?).");
		const unknown = Object.keys(fields).filter((k) => !known.has(k));
		return `${kind.label} at ${(added.element.startTime / TICKS_PER_SECOND).toFixed(1)} s, id ${added.element.id.slice(0, 8)}${unknown.length ? ` (no field ${unknown.join(", ")}; fields: ${[...known].join(", ")})` : ""}.`;
	}
	if (name !== "find_content") throw new Error(`Unknown tool ${name}.`);
	const kind = String(args.kind ?? "");
	const query = String(args.query ?? "");
	switch (kind) {
		case "transition": {
			const { hits, exact } = search(ALL_TRANSITIONS, (t) => `${t.type} ${t.name} ${t.category}`, query);
			return `${note(exact, query)}place {item, at: a cut}: ${hits.map((t) => `transition:${t.type} (${t.name}, ${t.category})`).join(" · ")}`;
		}
		case "effect": {
			const { hits, exact } = search(effectsRegistry.getAll(), (d) => `${d.type} ${d.name} ${d.category ?? ""}`, query);
			return `${note(exact, query)}place {item, on: clip id, fields?: params}: ${hits.map((d) => `effect:${d.type} (${d.name}${d.params.length ? `; ${d.params.map((p) => p.key).slice(0, 6).join(", ")}` : ""})`).join(" · ")}`;
		}
		case "filter": {
			const { hits, exact } = search(LOOKS, (l) => `${l.id} ${l.name}`, query, 40);
			return `${note(exact, query)}place {item, on: clip id or "all"} (one look on every clip reads as a style): ${hits.map((l) => `filter:${l.id} (${l.name})`).join(" · ")}`;
		}
		case "text": {
			const found = search(TEXT_PRESETS, (p) => `${p.id} ${p.name} ${p.group}`, query, 40);
			const { hits, note: said } = miss(found.hits, found.exact, query, TEXT_PRESETS.map((p) => p.group), "text");
			return `${said}place {item, text, at, duration?}: ${hits.map((p) => `text:${p.id} (${p.group}: ${p.name})`).join(" · ")}`;
		}
		case "motion": {
			const all = MOGRAPH_KINDS.filter((k) => !k.hidden);
			const found = search(all, (k) => `${k.kind} ${k.label} ${k.category}`, query, 30);
			const { hits, note: said } = miss(found.hits, found.exact, query, all.map((k) => k.category), "motion");
			return `${said}place {item, at, fields:{key: text}}: ${hits.map((k) => `motion:${k.kind} (${k.label}, ${k.category}, ${k.dur} s; fields ${k.fields.filter((f) => f.type === "text").map((f) => f.key).join(", ") || "none"})`).join(" · ")}`;
		}
		case "sticker": {
			// (the owner's own edition has no sticker packs: src/edition/cuts.ts)
			if (!STICKERS) return NO_STICKERS;
			const r = await agent("find_graphic", { query });
			let list = r.content;
			try {
				const j = JSON.parse(r.content) as { graphics?: Array<Record<string, unknown>> };
				if (j.graphics) list = compactList(JSON.stringify(j.graphics));
			} catch {}
			return `place {item, at}: ${list.replace(/(^|· )([\w.-]+) \(/g, "$1sticker:$2 (")}`;
		}
		case "music":
		case "sound": {
			const lib = kind === "music" ? "music" : "sfx";
			let r = await agent("find_sound", { query, kind: lib });
			let prefix = "";
			if (r.ok && r.content.trim() === "[]" && query) {
				prefix = note(false, query);
				r = await agent("find_sound", { query: "", kind: lib });
			}
			return `${prefix}place {item, at}${kind === "music" ? " (music fits the video and ducks under voices)" : ""}: ${compactList(r.content).replace(/(^|· )([^\s(]+) \(/g, `$1${kind}:$2 (`)}`;
		}
		default:
			throw new Error(`kind must be one of ${KINDS.join(", ")}.`);
	}
}
