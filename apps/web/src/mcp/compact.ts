// What Claude reads back, made short: the project as a few lines (ids and times first) instead of a JSON dump, long
// tracks of captions folded into one line, long answers cut with a hint how to ask for the rest; a call and its result
// in one line (for results Claude didn't hear). Pure: tested in bun, used by the window and the app's hub.

export interface ProjectJson {
	project: { name: string; width: number; height: number; fps: number; duration: number; playhead: number; composition?: string };
	selected?: string[];
	tracks: Array<{ id: string; role: string; type: string; muted?: boolean; hidden?: boolean; elements: Array<Record<string, unknown>>; more?: number }>;
	elementCount?: number;
	media: Array<{ id: string; name: string; type: string; duration?: number; size?: string; onTimeline?: boolean; made?: boolean; prompt?: string; usd?: number }>;
}

type Args = Record<string, unknown>;

const s1 = (v: unknown) => {
	const n = Number(v);
	return Number.isFinite(n) ? (Math.round(n * 100) / 100).toString() : "?";
};

function aspectOf(w: number, h: number): string {
	const r = w / h;
	const known: Array<[string, number]> = [["9:16", 9 / 16], ["16:9", 16 / 9], ["1:1", 1], ["4:5", 4 / 5]];
	return known.find(([, k]) => Math.abs(r - k) < 0.02)?.[0] ?? `${w}:${h}`;
}

/** Dollars as a person reads them: $0.003, $0.17, $1.80. */
export const usd = (v: number) => `$${v > 0 && v < 0.1 ? Number(v.toFixed(3)).toString() : v.toFixed(2)}`;

/** The size unit of titles (agent/tools.ts clamps 1.5–12): a percent of the frame's height. */
export const FONT_UNIT = "frame-height units: 3 small, 5 title, 8 big, 12 max";

/** One element in a few words: id kind "name/text" start–end and what is special about it. */
export function elementLine(e: Record<string, unknown>): string {
	const parts = [`${e.id}`, String(e.type)];
	if (e.type === "text") parts.push(JSON.stringify(String(e.text ?? "").slice(0, 48)));
	else if (e.graphic) parts.push(String(e.graphic));
	else if (e.name) parts.push(String(e.name).slice(0, 40));
	parts.push(`${s1(e.start)}–${s1(e.end)}`);
	if (e.media) parts.push(`media ${e.media}`);
	if (e.sourceFrom !== undefined && Number(e.sourceFrom) > 0) parts.push(`src+${s1(e.sourceFrom)}`);
	if (e.speed !== undefined) parts.push(`×${e.speed}`);
	if (e.volumeDb !== undefined) parts.push(`${e.volumeDb} dB`);
	if (e.muted) parts.push("muted");
	if (e.hidden) parts.push("hidden");
	if (e.reversed) parts.push("reversed");
	if (Array.isArray(e.effects) && e.effects.length) parts.push(`fx:${(e.effects as Array<string | { type?: string }>).map((f) => (typeof f === "string" ? f : String(f?.type ?? "?").replace(/^studio\./, ""))).join("+")}`);
	if (e.transitionIn) parts.push(`⇤${e.transitionIn}`);
	if (Array.isArray(e.trackers) && e.trackers.length) parts.push(`tracked`);
	return parts.join(" ");
}

/** A track with many elements of one kind (captions, beat cuts) shows its first and last few and how many. */
const FOLD_AT = 14;

export function trackLines(t: ProjectJson["tracks"][number], full = false, foldAt = FOLD_AT): string {
	const head = `${t.id} ${t.role}${t.muted ? " (muted)" : ""}${t.hidden ? " (hidden)" : ""}`;
	if (!t.elements.length) return `${head}: empty`;
	const total = t.elements.length + (t.more ?? 0);
	if (!full && total > foldAt) {
		const first = t.elements.slice(0, foldAt > 4 ? 3 : 1).map(elementLine);
		const last = elementLine(t.elements[t.elements.length - 1]);
		const texts = t.elements.filter((e) => e.type === "text").length;
		const kind = texts === t.elements.length ? `${total} text clips (captions?)` : `${total} clips`;
		return `${head}: ${kind} ${s1(t.elements[0].start)}–${s1(t.elements[t.elements.length - 1].end)} s · ${first.join(" · ")} · … · ${last}  [get_project {track:"${t.id}"} lists all]`;
	}
	return `${head}: ${t.elements.map(elementLine).join(" · ")}${t.more ? ` · +${t.more} more` : ""}`;
}

/** Media made by the app for itself (a video's «· last frame», a cast picture's copy): not listed, only counted. */
export const isHelperMedia = (m: { id: string; name: string }, hide?: Set<string>) => /\s·\s(last frame|frame [\d.]+ s)\.[a-z0-9]+$/i.test(m.name) || !!hide?.has(m.id);

/** A Media item in a few words: id kind "name" length size, ✓ on the timeline, what made it. */
export function mediaLine(m: ProjectJson["media"][number]): string {
	const ai = m.made ? (m.prompt ? ` (AI: «${m.prompt}»${m.usd ? `, ${usd(m.usd)}` : ""})` : " (AI)") : "";
	return `${m.id} ${m.type} "${String(m.name).slice(0, 36)}"${m.duration ? ` ${s1(m.duration)}s` : ""}${m.size ? ` ${m.size}` : ""}${m.onTimeline ? " ✓" : ""}${ai}`;
}

/** The project's Media, newest first, without the app's helper pictures. */
export function mediaList(p: ProjectJson, opts: { hide?: Set<string>; max?: number } = {}): string {
	const all = [...(p.media ?? [])].reverse();
	const shown = all.filter((m) => !isHelperMedia(m, opts.hide));
	const helpers = all.length - shown.length;
	if (!all.length) return "Media: empty (import_media brings files in).";
	const used = shown.filter((m) => m.onTimeline).length;
	const max = opts.max ?? 60;
	const more = shown.length > max ? ` · … ${shown.length - max} older (get_project {media:"all"})` : "";
	return `Media (${shown.length}, ${used} on the timeline, newest first${helpers ? `; ${helpers} helper picture(s) not listed` : ""}): ${shown.slice(0, max).map(mediaLine).join(" · ")}${more}`;
}

/** The whole project in lines: the header, each track top to bottom, the media; folded harder until it fits `max`. */
export function compactProject(p: ProjectJson, opts: { track?: string; hide?: Set<string>; max?: number } = {}): string {
	const { project } = p;
	if (opts.track) {
		const t = p.tracks.find((x) => x.id === opts.track || x.id.startsWith(opts.track as string));
		if (!t) return `No track "${opts.track}". Tracks: ${p.tracks.map((x) => `${x.id} (${x.role})`).join(", ")}.`;
		return trackLines(t, true);
	}
	const head = `"${project.name}" ${project.width}×${project.height} (${aspectOf(project.width, project.height)}) ${s1(project.fps)} fps · ${s1(project.duration)} s · playhead ${s1(project.playhead)}${project.composition ? ` · inside composition "${project.composition}"` : ""}${p.selected?.length ? ` · selected ${p.selected.join(",")}` : ""}`;
	const tracks = p.tracks.filter((t) => t.elements.length || t.role === "main video");
	// The main track is the cut itself: its clips are listed whole up to 48 (a 16-shot music clip was folded to «…» and
	// read again track by track eight times); captions and other dense tracks fold as before.
	const render = (foldAt: number, mediaMax: number, mainAt = foldAt) =>
		[head, "Tracks, top → bottom (id kind name start–end s):", ...tracks.map((t) => `- ${trackLines(t, false, t.role === "main video" ? mainAt : foldAt)}`), mediaList(p, { hide: opts.hide, max: mediaMax })].join("\n");
	const max = opts.max ?? 11_000;
	for (const [foldAt, mediaMax, mainAt] of [[FOLD_AT, 60, 48], [FOLD_AT, 60, FOLD_AT], [6, 30, 6], [2, 15, 2]] as const) {
		const text = render(foldAt, mediaMax, mainAt);
		if (text.length <= max) return text;
	}
	// A huge project: one line per track, the newest media.
	return [head, "Tracks (folded: get_project {track} lists one):", ...tracks.map((t) => `- ${t.id} ${t.role}: ${t.elements.length + (t.more ?? 0)} clips${t.elements.length ? ` ${s1(t.elements[0].start)}–${s1(t.elements[t.elements.length - 1].end)} s` : ""}`), mediaList(p, { hide: opts.hide, max: 10 })].join("\n").slice(0, max);
}

/** A long answer cut to `max` characters, saying how to get the rest. */
export function clip(text: string, max = 6000, more = "ask for less at a time"): string {
	return text.length <= max ? text : `${text.slice(0, max)}… (${text.length - max} more characters: ${more})`;
}

/** The first element/media id an answer names (a step's new id, for "$1" in the next steps). */
export function idOf(answer: string): string | null {
	try {
		const j = JSON.parse(answer) as Record<string, unknown>;
		for (const key of ["id", "added", "media", "tracker"]) if (typeof j[key] === "string" && j[key]) return String(j[key]);
		for (const key of ["copies", "newRightParts", "ids"]) if (Array.isArray(j[key]) && typeof (j[key] as unknown[])[0] === "string") return String((j[key] as string[])[0]);
		if (j.placed && typeof (j.placed as Record<string, unknown>).id === "string") return String((j.placed as Record<string, unknown>).id);
	} catch {}
	return /\bid ([0-9a-f]{6,8})\b/.exec(answer)?.[1] ?? null;
}

/** Arguments with "$1", "$prev" or a named "$s18" (a step with as:"s18") replaced by the id that step made. */
export function withRefs<T>(value: T, results: string[], names: Map<string, number> = new Map()): T {
	if (typeof value === "string") {
		const m = /^\$([A-Za-z_][\w-]*|\d+)$/.exec(value);
		if (m) {
			const ref = m[1];
			const step = /^\d+$/.test(ref) ? Number(ref) : ref === "prev" ? results.length : names.get(ref);
			// (a "$word" no step is named is plain text, a title's «$PRICE»)
			if (step === undefined) return value;
			const answer = results[step - 1];
			const id = answer ? idOf(answer) : null;
			if (!id) throw new Error(`"${value}": step ${step || "before"} has no id to refer to.`);
			return id as T;
		}
		return value;
	}
	if (Array.isArray(value)) return value.map((v) => withRefs(v, results, names)) as T;
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withRefs(v, results, names)])) as T;
	return value;
}

/** A JSON answer as one short line ({"id":"a1b2","start":3} → id a1b2 start 3). */
export function oneLine(answer: string, max = 300): string {
	let text = answer;
	try {
		const j = JSON.parse(answer) as unknown;
		if (j && typeof j === "object" && !Array.isArray(j)) {
			text = Object.entries(j as Record<string, unknown>)
				.filter(([k, v]) => v !== undefined && v !== null && v !== "" && k !== "note")
				.map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
				.join(" · ");
		}
	} catch {}
	text = text.replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * One element (get_element's JSON): one line (kind, media, start–end, src, muted, volume, fx); with detail its settings
 * as key=value lines, what `edit set` takes, with ranges.
 */
export function compactElement(json: string, detail = true): string {
	let e: Record<string, unknown>;
	try {
		e = JSON.parse(json) as Record<string, unknown>;
	} catch {
		return json;
	}
	const head = elementLine(e) + (e.track ? ` on track ${e.track}` : "");
	if (!detail) return `${head} (detail:true lists every setting edit set takes)`;
	const params = (Array.isArray(e.params) ? e.params : []) as Array<{ key: string; type: string; value: unknown; min?: number; max?: number; options?: string[] }>;
	const fmt = (p: (typeof params)[number]) => {
		const v = typeof p.value === "string" ? JSON.stringify(p.value.length > 60 ? `${p.value.slice(0, 60)}…` : p.value) : String(p.value);
		const range = p.options?.length ? ` [${p.options.slice(0, 8).join("|")}${p.options.length > 8 ? "|…" : ""}]` : p.min !== undefined || p.max !== undefined ? ` [${p.min ?? ""}..${p.max ?? ""}]` : "";
		return `${p.key}=${v}${range}${p.key === "fontSize" ? ` (${FONT_UNIT})` : ""}`;
	};
	const lines = [head, `settings (edit set {id, params:{key:value}}): ${params.map(fmt).join(" · ")}`];
	const effects = (Array.isArray(e.effects) ? e.effects : []) as Array<{ id: string; type: string; enabled: boolean; params: Record<string, unknown> }>;
	if (effects.length) lines.push(`effects: ${effects.map((f) => `${f.id} ${f.type}${f.enabled ? "" : " (off)"} ${JSON.stringify(f.params).slice(0, 160)}`).join(" · ")}`);
	const rt = e.retime as { rate?: number } | undefined;
	if (rt && rt.rate !== undefined && rt.rate !== 1) lines.push(`speed ×${rt.rate}`);
	return lines.join("\n");
}

// ───────────────────────── a call and its result in one line ─────────────────────────

/** JSON with its keys sorted: the same arguments in another order are the same call. */
export function stable(v: unknown): string {
	if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
	if (v && typeof v === "object") return `{${Object.keys(v as Args).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Args)[k])}`).join(",")}}`;
	return JSON.stringify(v ?? null);
}

/** A local clock time, «12:22». */
export const hhmm = (t: number) => {
	const d = new Date(t);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const words = (v: unknown, n = 4) => {
	const w = String(v ?? "").trim().split(/\s+/).filter(Boolean);
	return w.length ? ` «${w.slice(0, n).join(" ")}${w.length > n ? "…" : ""}»` : "";
};

export function callLabel(tool: string, args: Args): string {
	const a = args ?? {};
	const when = a.start ?? a.at;
	const at = typeof when === "number" ? ` @${Math.round(when * 100) / 100}` : typeof when === "string" && when ? ` @${when}` : "";
	switch (tool) {
		case "generate": {
			if (Array.isArray(a.items)) return `generate ×${a.items.length}`;
			const kind = a.kind === "video" && a.mode && a.mode !== "text" ? String(a.mode) : String(a.kind ?? "?");
			return `generate ${kind}${at}${words(a.prompt ?? a.text)}`;
		}
		case "edit":
			return `edit (${Array.isArray(a.ops) ? a.ops.length : 0} step${Array.isArray(a.ops) && a.ops.length === 1 ? "" : "s"})`;
		case "export":
			return `export${a.platform ? ` ${a.platform}` : ""}${a.name ? ` «${a.name}»` : ""}`;
		case "project":
			return `project ${a.action ?? ""}${a.name ? ` «${a.name}»` : a.id ? ` ${a.id}` : ""}`.trim();
		case "place":
			return Array.isArray(a.items) ? `place ×${a.items.length}` : `place ${String(a.item ?? a.media ?? a.text ?? "").slice(0, 40)}${at}`;
		case "import_media":
			return `import_media${Array.isArray(a.paths) ? ` ${a.paths.length} file(s)` : a.youtube ? " YouTube" : a.image ? words(a.image) : ""}`;
		default: {
			const sub = a.what ?? a.kind ?? a.action;
			return `${tool}${sub ? ` ${sub}` : ""}${a.id ? ` ${a.id}` : ""}${at}`;
		}
	}
}

/** A finished call in one line: «✓ generate avatar @145.1 → media 6e703a placed ($0.17 fal.ai)», «✗ … failed 12:22: …». */
export function briefOf(tool: string, args: Args, result: { ok: boolean; content: string }, finishedAt: number): string {
	const label = callLabel(tool, args);
	const text = String(result.content ?? "").replace(/\s*\[rev \d+\]\s*$/, "").trim();
	// (a stopped call says what it was itself: «Not run: generate … was stopped …; nothing was charged.»)
	if (!result.ok && /^(Not run|Stopped)\b/.test(text)) return `✗ ${oneLine(text, 240)}`;
	if (!result.ok) return `✗ ${label} failed ${hhmm(finishedAt)}: ${oneLine(text.replace(/^Error:\s*/, ""), 200)}`;
	let outcome = "";
	try {
		const j = JSON.parse(text) as Args;
		if (typeof j.media === "string") {
			const p = j.placed as { clip?: string; start?: number } | string | undefined;
			const where =
				p && typeof p === "object" && p.start !== undefined ? `placed @${s1(p.start)}${p.clip ? ` (clip ${p.clip})` : ""}` : typeof p === "string" && /^not placed/.test(p) ? `in Media (${p.slice(0, 80)})` : j.placedAt !== undefined && j.placedAt !== null ? `placed @${s1(j.placedAt)}` : "in Media";
			const api = /\bon ([\w.]+)\s*$/.exec(String(j.model ?? ""))?.[1];
			const cost = typeof j.costUsd === "number" && j.costUsd > 0 ? ` (${usd(j.costUsd)}${api ? ` ${api}` : ""})` : "";
			outcome = `media ${j.media} ${where}${cost}${typeof j.lastFrame === "string" ? ` · last frame ${j.lastFrame}` : ""}`;
		}
	} catch {}
	return `✓ ${label} → ${outcome || oneLine(text, 200)}`;
}
