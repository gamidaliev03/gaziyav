// One Claude tool call in the window: the listed tools (surface.ts) and every older name, routed to the same editor
// code as the buttons and Gaziyav AI. Answers are short text (ids and times first, the next step when it helps), end
// with the project's revision, and say what the user changed by hand since Claude's last call; pictures small unless
// asked. Targets can be plain words ("selected", "music", "the title at 0:05"). Claude's undo takes back its own calls
// and never the user's work; what the user keeps or undoes feeds the taste in Claude's memory.
import { EditorCore } from "@/core";
import { CAPTION_STYLES } from "@/subtitles/styles";
import { isCaptionElement } from "@/subtitles/apply-style";
import { VOICES } from "@/generate/voices";
import { TEMPLATES } from "@/templates/catalog";
import type { TimelineElement, TimelineTrack } from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";
import { callLabel, clip, compactElement, compactProject, FONT_UNIT, hhmm, idOf, isHelperMedia, mediaLine, mediaList, oneLine, type ProjectJson, withRefs } from "./compact";
import { CONTENT_TOOL_NAMES, runContentTool } from "./content-tools";
import { asClaude, claudeCall, claudeCallsEnded } from "./context";
import { EDIT_TOOL_NAMES, runEditTool } from "./edit-tools";
import { budgetLine, pricePlan, readBudget } from "./money";
import { motionLayer } from "./motion-layer";
import { castOf, memoryTool, noteTaste, readMemory, readNotes, writeNotes } from "./notes";
import { PROJECT_TOOL_NAMES, runProjectTool } from "./project-tools";
import { postTool } from "./share-tools";
import { ANALYZE, EDIT_OPS, FIND_SOURCES, GENERATE_TOOL, knownArgs, LEGACY_PROJECT, NO_STICKERS, opTool, readOnlyCall, STICKERS } from "./surface";

export { readOnlyCall };

type Args = Record<string, unknown>;
type AgentTools = typeof import("@/agent/tools");

export interface McpAnswer {
	ok: boolean;
	content: string;
	images?: string[];
	navigate?: string;
}

export interface McpCtx {
	page: "editor" | "projects";
	agent: AgentTools;
	signal: AbortSignal;
	/** The project Claude worked in last, when the hub knows it. */
	expect?: { id: string; name: string };
}

const ed = () => EditorCore.getInstance();
const fail = (content: string): McpAnswer => ({ ok: false, content: content.startsWith("Error") ? content : `Error: ${content}` });
const errText = (error: unknown) => (error as Error)?.message || String(error);
const sec = (ticks: number) => Math.round((ticks / TICKS_PER_SECOND) * 100) / 100;
const openProject = () => ed().project.getActiveOrNull()?.metadata.id ?? "";
const params = (e: TimelineElement) => ((e as { params?: Record<string, unknown> }).params ?? {}) as Record<string, unknown>;

function allElements(): Array<{ track: TimelineTrack; element: TimelineElement; role: "overlay" | "main" | "audio" }> {
	const t = ed().scenes.getActiveScene().tracks;
	return [
		...t.overlay.flatMap((track) => (track.elements as TimelineElement[]).map((element) => ({ track: track as TimelineTrack, element, role: "overlay" as const }))),
		...(t.main.elements as TimelineElement[]).map((element) => ({ track: t.main as TimelineTrack, element, role: "main" as const })),
		...t.audio.flatMap((track) => (track.elements as TimelineElement[]).map((element) => ({ track: track as TimelineTrack, element, role: "audio" as const }))),
	];
}

// ───────────────────────── revisions: who changed what ─────────────────────────

/** Every step of the history (do, undo, redo) is a revision; each one is the user's or Claude's. */
let rev = 0;
/** When this window started counting (revisions start at 0 again after a restart or a reload). */
const countingSince = Date.now();
/** What Claude's generations made in this session (media id → the prompt's first words, the price), for the media lines. */
const made = new Map<string, { prompt: string; usd?: number }>();
const authors = new Map<number, "user" | "claude">();
/** The project at moments around Claude's calls (element → a line), to say what changed between them. */
const snaps: Array<{ rev: number; project: string; map: Map<string, string>; media: Map<string, string> }> = [];
let lastClaudeRev = 0;

function snapLine(e: TimelineElement, track?: TimelineTrack): string {
	const p = params(e);
	const bits = [e.id.slice(0, 8), e.type, e.type === "text" ? JSON.stringify(String(p.content ?? "").slice(0, 40)) : String(e.name ?? "").slice(0, 30), `${sec(e.startTime)}–${sec(e.startTime + e.duration)}`];
	const media = (e as { mediaId?: string }).mediaId;
	if (media) bits.push(`media ${media.slice(0, 8)}`);
	const trim = (e as { trimStart?: number }).trimStart;
	if (media && typeof trim === "number" && trim > 0) bits.push(`src ${sec(trim)}`);
	if (track) bits.push(`track ${track.id.slice(0, 8)}`);
	const x = Number(p["transform.positionX"] ?? 0);
	const y = Number(p["transform.positionY"] ?? 0);
	if (x || y) bits.push(`pos ${Math.round(x)},${Math.round(y)}`);
	const sx = Number(p["transform.scaleX"] ?? 1);
	if (Number.isFinite(sx) && Math.abs(sx - 1) > 0.001) bits.push(`scale ${Math.round(sx * 100) / 100}`);
	if (p.fontSize !== undefined && e.type === "text") bits.push(`size ${p.fontSize}`);
	if (typeof p.color === "string" && e.type === "text") bits.push(p.color);
	if (p.volume !== undefined && Number(p.volume) !== 0) bits.push(`${p.volume} dB`);
	if (p.opacity !== undefined && Number(p.opacity) !== 1) bits.push(`opacity ${p.opacity}`);
	if ((e as { hidden?: boolean }).hidden) bits.push("hidden");
	if (p.muted) bits.push("muted");
	const fx = (e as { effects?: Array<{ type: string; params?: unknown }> }).effects ?? [];
	if (fx.length) bits.push(`fx ${fx.map((f) => f.type.replace(/^studio\./, "")).join("+")}#${JSON.stringify(fx.map((f) => f.params ?? {})).length}`);
	return bits.join(" ");
}

function snapshot() {
	const project = openProject();
	if (!project) return;
	const last = snaps[snaps.length - 1];
	if (last && last.rev === rev && last.project === project) return;
	const map = new Map<string, string>();
	for (const { element, track } of allElements()) {
		map.set(element.id.slice(0, 8), snapLine(element, track));
		if (isCaptionElement(element)) captionSeen.add(element.id.slice(0, 8));
	}
	if (captionSeen.size > 20_000) captionSeen.clear();
	snaps.push({ rev, project, map, media: mediaSnap() });
	if (snaps.length > 40) snaps.shift();
}

/** The Media items (not the app's helper pictures) as lines: a new one is its own «+ media …» line in since. */
function mediaSnap(): Map<string, string> {
	const out = new Map<string, string>();
	const used = new Set(allElements().map((x) => (x.element as { mediaId?: string }).mediaId).filter(Boolean));
	for (const a of ed().media.getAssets()) {
		if (a.ephemeral || (a as { motionProxy?: unknown }).motionProxy) continue;
		const id = a.id.slice(0, 8);
		if (isHelperMedia({ id, name: a.name })) continue;
		const ai = made.get(id);
		out.set(id, mediaLine({ id, name: a.name, type: a.type, duration: a.duration ? Math.round(a.duration * 100) / 100 : undefined, onTimeline: used.has(a.id), made: a.origin === "result", prompt: ai?.prompt, usd: ai?.usd }));
	}
	return out;
}

/** What changed after `since`, each change marked with who made it (the later wins for the same element). */
function changesSince(since: number): { lines: string[]; byUser: number; byClaude: number } | null {
	snapshot();
	const project = openProject();
	const list = snaps.filter((s) => s.project === project);
	const start = [...list].reverse().find((s) => s.rev <= since);
	if (!start) return null;
	const change = new Map<string, { who: string; line: string }>();
	let prev = start;
	let byUser = 0;
	let byClaude = 0;
	for (const s of list.filter((x) => x.rev > start.rev)) {
		const whos = new Set<string>();
		for (let r = prev.rev + 1; r <= s.rev; r++) whos.add(authors.get(r) ?? "user");
		const who = whos.size > 1 ? "user+you" : whos.has("claude") ? "you" : "user";
		if (who.includes("user")) byUser++;
		if (who.includes("you")) byClaude++;
		for (const [id, line] of s.map) {
			const was = prev.map.get(id);
			// (what it was: only the parts that differ — the old line minus its id, kind and name was cut wrong for names with spaces)
			if (was !== line) change.set(id, { who, line: was ? `~ ${line} (was ${wasBits(was, line)})` : `+ ${line}` });
		}
		for (const [id, line] of prev.map) if (!s.map.has(id)) change.set(id, { who, line: `− ${line}` });
		// (a generation Claude ordered lands by itself, with no call running: it is still Claude's, not «user: + media»)
		for (const [id, line] of s.media) if (!prev.media.has(id)) change.set(`m${id}`, { who: made.has(id) ? "you" : who, line: `+ media ${line}` });
		for (const [id, line] of prev.media) if (!s.media.has(id)) change.set(`m${id}`, { who, line: `− media ${line}` });
		prev = s;
	}
	// Captions come in dozens: one line per kind of change («you: + 28 captions 0.1–37.3 s»), not one per caption
	// (a change list of 56 caption lines cost 4 KB and pushed the real changes out of the first 60).
	const groups = new Map<string, { n: number; from: number; to: number }>();
	const lines: string[] = [];
	for (const [id, c] of change) {
		const span = /(-?\d+(?:\.\d+)?)–(-?\d+(?:\.\d+)?)/.exec(c.line);
		if (captionSeen.has(id) && span) {
			const key = `${c.who}: ${c.line[0]}`;
			const g = groups.get(key) ?? { n: 0, from: Number.POSITIVE_INFINITY, to: 0 };
			groups.set(key, { n: g.n + 1, from: Math.min(g.from, Number(span[1])), to: Math.max(g.to, Number(span[2])) });
			continue;
		}
		lines.push(`${c.who}: ${c.line}`);
	}
	for (const [key, g] of groups) lines.push(`${key} ${g.n} caption${g.n === 1 ? "" : "s"} ${g.from}–${g.to} s${key.endsWith("~") ? " (moved or changed; get_project {track} lists them)" : ""}`);
	// (the header's «by …» follows the lines when there are any: a landed generation is «you» whoever's turn it was)
	if (change.size) {
		byUser = [...change.values()].filter((c) => c.who.includes("user")).length;
		byClaude = [...change.values()].filter((c) => c.who.includes("you")).length;
	}
	return { lines, byUser, byClaude };
}

/** Elements seen as captions at any snapshot (a removed caption is no longer on the timeline to ask). */
const captionSeen = new Set<string>();

/** What an element's line was, as the parts that changed (times, place, size, level…), not the whole old line. */
function wasBits(was: string, now: string): string {
	const at = (line: string) => /(-?\d+(?:\.\d+)?–-?\d+(?:\.\d+)?)/.exec(line)?.[1] ?? "";
	const rest = (line: string) => line.slice(line.indexOf(at(line)) + at(line).length).trim().split(" ");
	const text = (line: string) => /^\S+ text ("(?:[^"\\]|\\.)*")/.exec(line)?.[1] ?? "";
	const bits: string[] = [];
	if (text(was) && text(was) !== text(now)) bits.push(text(was));
	if (at(was) !== at(now)) bits.push(at(was));
	const nowRest = new Set(rest(now));
	const old = rest(was).filter((b) => b && !nowRest.has(b));
	if (old.length) bits.push(old.join(" "));
	return bits.join(" ") || "the same in other details";
}

// ───────────────────────── Claude's steps, the user's, the taste ─────────────────────────

interface Step {
	tool: string;
	/** The call in a few words («edit (7 steps)»), for what undo says it took back. */
	label?: string;
	/** The revision right after the step: who changed the project since is read from the revisions after it. */
	rev?: number;
	before: number;
	after: number;
	project: string;
	mixed?: boolean;
	/** Another of Claude's calls ran at the same time (a generation going on in the background): its steps are in between. */
	overlapped?: boolean;
	choices: Array<{ cat: string; value: string }>;
	undoneSeen?: boolean;
}
const steps: Step[] = [];
const redos: Step[] = [];
let userChanged = false;
let watching: (() => void) | null = null;
/** The user's last click or key in the window: a step made while they worked too is theirs as much as Claude's. */
let lastInput = 0;
/** When Claude's newest call began. */
let lastCallStart = 0;

/** The user's own steps are noticed (Claude re-reads and never undoes them); their ⌘Z of Claude's step is taste. */
export function watchHistory() {
	if (watching) return;
	watching = ed().command.subscribeHistory(() => {
		rev++;
		// The user's when they clicked or typed just now (a long call of Claude's may be running in the background
		// meanwhile) — «just now» counted from the call's start: a drag finished 0.8 s before Claude's call began was
		// already in the history, and the call's own change, made 0.9 s after that drag, was written down as the
		// user's (get_project {since} said «user:» for Claude's step, and undo refused it).
		const byUser = !claudeCall() || (Date.now() - lastInput < 1000 && lastInput > lastCallStart - 600);
		authors.set(rev, byUser ? "user" : "claude");
		authors.delete(rev - 2000);
		if (!byUser) return;
		userChanged = true;
		const last = steps[steps.length - 1];
		if (last && !last.undoneSeen && last.project === openProject() && ed().command.depth() < last.after) {
			last.undoneSeen = true;
			noteTaste("undone", last.choices);
		}
	});
	const mark = () => {
		lastInput = Date.now();
	};
	for (const type of ["pointerdown", "pointerup", "keydown", "keyup"]) window.addEventListener(type, mark, { capture: true, passive: true });
}

/** What a call chose that says something about taste (a caption style, a look, a transition, music…). */
function choicesOf(tool: string, args: Args): Array<{ cat: string; value: string }> {
	const ops = tool === "edit" && Array.isArray(args.ops) ? (args.ops as Args[]) : [{ ...args, op: tool }];
	const out: Array<{ cat: string; value: string }> = [];
	for (const o of ops) {
		const op = String(o.op ?? "");
		if (op === "captions" && o.style) out.push({ cat: "captions", value: String(o.style) });
		if (op === "apply_filter" && o.look) out.push({ cat: "look", value: String(o.look) });
		if (op === "add_transition" && o.type) out.push({ cat: "transition", value: String(o.type) });
		if (op === "add_text_style" && o.style) out.push({ cat: "title", value: String(o.style) });
		if (op === "add_sound" && o.sound) out.push({ cat: "sound", value: String(o.sound) });
		if ((op === "add_motion" || op === "motion_layer") && (o.kind || o.template)) out.push({ cat: "motion", value: String(o.kind ?? o.template) });
	}
	return out;
}

async function undoClaude(args: Args): Promise<McpAnswer> {
	const n = Math.min(20, Math.max(1, Math.round(Number(args.steps) || 1)));
	// Steps made in another project are not this one's history.
	for (const list of [steps, redos]) for (let i = list.length - 1; i >= 0; i--) if (list[i].project !== openProject()) list.splice(i, 1);
	const cmd = ed().command;
	const names: string[] = [];
	// What was taken back, by name, newest first («Undid 2: edit (7 steps), apply_plan»): Claude sees what is gone.
	const told = (verb: string) => (names.length ? `${verb} ${names.length === 1 ? names[0] : `${names.length}: ${names.join(", ")}`}. ` : "");
	/** An undone apply_plan takes its plan with it (review judged a later hand-built cut against the undone plan). */
	const plan = async (step: Step, back: boolean) => {
		if (step.tool !== "apply_plan") return;
		await import("@/agent/produce-tools").then((m) => (back ? m.recallPlan(step.project) : m.forgetPlan(step.project))).catch(() => {});
	};
	for (let i = 0; i < n; i++) {
		if (args.redo) {
			const last = redos[redos.length - 1];
			if (!last) break;
			if (cmd.depth() !== last.before) return { ok: names.length > 0, content: `${told("Redid")}Not redone: the project changed since (the user's steps stay). Make the change again with edit instead.` };
			for (let k = 0; k < last.after - last.before; k++) cmd.redo();
			steps.push(redos.pop()!);
			await plan(last, true);
			names.push(last.label ?? last.tool);
		} else {
			const last = steps[steps.length - 1];
			if (!last) break;
			if (last.overlapped && cmd.depth() === last.after && !last.mixed)
				return { ok: names.length > 0, content: `${told("Undid")}Not undone: another of your calls (a step running in the background) changed the project while ${last.label ?? last.tool} ran, so undo would take more than this step. Change it back with edit instead.` };
			if (cmd.depth() !== last.after || last.mixed) {
				// Who changed it since: the user (their work is never taken back), or a call of Claude's own that left no step.
				let user = !!last.mixed;
				for (let r = (last.rev ?? rev) + 1; r <= rev; r++) if (authors.get(r) !== "claude") user = true;
				return {
					ok: names.length > 0,
					content: user
						? `${told("Undid")}Not undone (${last.label ?? last.tool}): the user changed the project ${last.mixed ? "while your step ran" : "after your step"}, and undo would take their work back. Change it back with edit instead.`
						: `${told("Undid")}Not undone (${last.label ?? last.tool}): a later call of yours changed the project without leaving a step to take back, so undo can't separate the two. Change it back with edit instead (get_project {since} shows what differs).`,
				};
			}
			for (let k = 0; k < last.after - last.before; k++) cmd.undo();
			redos.push(steps.pop()!);
			await plan(last, false);
			names.push(last.label ?? last.tool);
		}
	}
	if (!names.length) return { ok: false, content: args.redo ? "Nothing of yours to redo." : "Nothing of yours to undo in this session (the user's own steps are theirs: ⌘Z in the app)." };
	return { ok: true, content: `${told(args.redo ? "Redid" : "Undid").trim()}${steps.length ? ` Your next undo: ${steps[steps.length - 1].label ?? steps[steps.length - 1].tool}.` : ""}` };
}

/**
 * remove_pauses in words: what was removed and what went with the cut (the plain one-line form printed
 * «jobs [] · timelineChanged true · result …» and dropped the note: two examinees read the whole project again to
 * learn that captions and titles had moved and the music had not).
 */
function pausesLine(content: string): string {
	try {
		const j = JSON.parse(content) as { result?: unknown; note?: unknown; jobs?: unknown };
		if (typeof j.result === "string") {
			const jobs = Array.isArray(j.jobs) && j.jobs.length ? ` (${j.jobs.map(String).join("; ")})` : "";
			return `${j.result}${jobs}${typeof j.note === "string" ? ` ${j.note}` : ""}`.replace(/\s+/g, " ").trim().slice(0, 900);
		}
	} catch {}
	return oneLine(content, 220);
}

// ───────────────────────── plain-word targets ─────────────────────────

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, первый: 1, второй: 2, третий: 3, четвертый: 4, четвёртый: 4, пятый: 5, шестой: 6 };

/** "0:05", "at 5", "5s", "1:02.5" → seconds. */
function timeIn(text: string): number | null {
	const m = /(\d+):(\d{1,2}(?:\.\d+)?)|(?:\bat|\bна|\bв)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:s|с|сек)\b/i.exec(text);
	if (!m) return null;
	if (m[1] !== undefined) return Number(m[1]) * 60 + Number(m[2]);
	return Number(m[3] ?? m[4]);
}

const covers = (e: TimelineElement, t: number) => e.startTime / TICKS_PER_SECOND <= t + 0.05 && (e.startTime + e.duration) / TICKS_PER_SECOND >= t - 0.05;
function nearest<T extends { element: TimelineElement }>(list: T[], t: number): T {
	return list.find((x) => covers(x.element, t)) ?? [...list].sort((a, b) => Math.abs(a.element.startTime / TICKS_PER_SECOND - t) - Math.abs(b.element.startTime / TICKS_PER_SECOND - t))[0];
}

/** A clip of a separated song (separate_voice): its voice stem or its music stem (the media's neural label says which). */
function stem(e: TimelineElement): "voice" | "music" | null {
	const id = (e as { mediaId?: string }).mediaId;
	const n = id ? (ed().media.getAssets().find((a) => a.id === id) as { neural?: { effect?: string; label?: string } } | undefined)?.neural : undefined;
	if (n?.effect !== "ai.separate") return null;
	return n.label === "Music" ? "music" : "voice";
}

/** Words for elements → their ids (several for "captions", "selected"…); null when it isn't a reference. */
export function resolveTarget(word: string): string[] | null {
	const w = word.toLowerCase().trim();
	if (!w || /^[0-9a-f-]{6,}$/.test(w)) return null;
	const all = allElements();
	const t = timeIn(w);
	if (/^(this|this one|it|этот|эту|это)$/.test(w) || /selected|выбранн|выделенн/.test(w)) {
		const sel = ed().selection.getSelectedElements().map((r) => r.elementId);
		if (!sel.length) throw new Error(`"${word}": nothing is selected in the editor. Use an id from get_project.`);
		return sel.map((id) => id.slice(0, 8));
	}
	if (/caption|субтитр/.test(w)) {
		const caps = all.filter((x) => isCaptionElement(x.element));
		if (!caps.length) throw new Error(`"${word}": there are no captions (edit op captions makes them).`);
		return caps.map((x) => x.element.id.slice(0, 8));
	}
	if (/music|музык/.test(w)) {
		const audio = all.filter((x) => x.role === "audio").sort((a, b) => b.element.duration - a.element.duration);
		const music = audio.filter((x) => stem(x.element) === "music" || params(x.element).duckUnderVoice === true || /music|track|song|музык/i.test(x.element.name));
		const hit = music[0] ?? audio[0];
		if (!hit) throw new Error(`"${word}": there is no music (edit op add_sound puts some).`);
		return [hit.element.id.slice(0, 8)];
	}
	if (/voice|vocal|голос|вокал/.test(w)) {
		// A song's voice stem or a clip named so first; never a music stem or a clip whose name says it is music.
		const audio = all.filter((x) => x.role === "audio" && stem(x.element) !== "music" && !/music|musik|музык|instrumental|инструментал|минус/i.test(x.element.name));
		const named = audio.filter((x) => stem(x.element) === "voice" || /voice|vocal|голос|вокал/i.test(x.element.name));
		const voice = named.length ? named : audio.filter((x) => params(x.element).duckUnderVoice !== true);
		if (!voice.length) throw new Error(`"${word}": no voice clip on an audio track (the voice may be in the video itself; a clip named music is never taken for it).`);
		return [voice[0].element.id.slice(0, 8)];
	}
	if (/title|text|heading|hook|титр|заголов|текст|надпис/.test(w)) {
		const texts = all.filter((x) => x.element.type === "text" && !isCaptionElement(x.element)).sort((a, b) => a.element.startTime - b.element.startTime);
		const list = texts.length ? texts : all.filter((x) => x.element.type === "graphic" && x.role === "overlay");
		if (!list.length) throw new Error(`"${word}": there is no title.`);
		const n = Object.entries(ORDINALS).find(([k]) => w.includes(k))?.[1];
		const hit = t !== null ? nearest(list, t) : n ? list[n - 1] : list[0];
		if (!hit) throw new Error(`"${word}": there are only ${list.length} titles.`);
		return [hit.element.id.slice(0, 8)];
	}
	if (/clip|shot|кадр|клип|фрагмент|сцен/.test(w)) {
		const main = all.filter((x) => x.role === "main").sort((a, b) => a.element.startTime - b.element.startTime);
		if (!main.length) throw new Error(`"${word}": the main track is empty.`);
		if (/last|последн/.test(w)) return [main[main.length - 1].element.id.slice(0, 8)];
		if (t !== null) return [nearest(main, t).element.id.slice(0, 8)];
		const num = /(?:clip|shot|кадр|клип)\s*#?(\d+)|(\d+)(?:st|nd|rd|th|-?й)/.exec(w);
		const n = Number(num?.[1] ?? num?.[2]) || Object.entries(ORDINALS).find(([k]) => w.includes(k))?.[1] || 1;
		const hit = main[n - 1];
		if (!hit) throw new Error(`"${word}": the main track has ${main.length} clips.`);
		return [hit.element.id.slice(0, 8)];
	}
	return null;
}

/** An op's targets in words → ids, "playhead" → seconds. */
function resolveArgs(args: Args): Args {
	const out: Args = { ...args };
	for (const key of ["id", "clip"]) {
		if (typeof out[key] !== "string") continue;
		const hit = resolveTarget(String(out[key]));
		if (!hit) continue;
		if (hit.length > 1 && key === "id") {
			out.ids = hit;
			delete out.id;
		} else out[key] = hit[0];
	}
	if (out.ids !== undefined) {
		const list = Array.isArray(out.ids) ? out.ids.map(String) : String(out.ids).split(/,\s*/);
		out.ids = list.flatMap((x) => resolveTarget(x) ?? [x]);
	}
	const playhead = sec(ed().playback.getCurrentTime());
	for (const key of ["time", "at", "start"]) if (typeof out[key] === "string" && /^(playhead|here|now|здесь|тут)$/i.test(String(out[key]).trim())) out[key] = playhead;
	if (Array.isArray(out.at)) out.at = out.at.map((v) => (typeof v === "string" && /^(playhead|here)$/i.test(v) ? playhead : v));
	return out;
}

/** Ops that take `ids` themselves; the rest run once per target when a word names several. */
// (look takes Media ids itself: one look per id would join their text and lose the pictures)
const TAKES_IDS = new Set(["set_element", "delete", "duplicate", "split", "make_vertical", "playhead", "action", "look"]);

// ───────────────────────── the router ─────────────────────────

const needsEditor = (page: McpCtx["page"]) => page !== "editor" || !ed().project.getActiveOrNull();

/** Any tool by its name (listed or older), as one answer. */
async function runAny(name: string, args: Args, ctx: McpCtx): Promise<McpAnswer> {
	if (PROJECT_TOOL_NAMES.has(name)) {
		const r = await runProjectTool(name, args, ctx.page);
		return { ok: true, content: r.content, navigate: r.navigate };
	}
	if (needsEditor(ctx.page)) return fail("No project is open. project {action:'list'} then {action:'open', id}, or {action:'create', name, aspect}.");
	const a = resolveArgs(args);
	if (Array.isArray(a.ids) && a.id === undefined && !TAKES_IDS.has(name) && a.ids.length) {
		const lines: string[] = [];
		for (const id of a.ids as string[]) {
			const r = await runAny(name, { ...a, ids: undefined, id }, ctx);
			if (!r.ok) return r;
			lines.push(oneLine(r.content, 120));
		}
		return { ok: true, content: lines.join(" · ") };
	}
	const agentRun = (n: string, x: Args) => ctx.agent.runTool(n, JSON.stringify(x), ctx.signal);
	if (name === "place") return place(a, ctx);
	if (CONTENT_TOOL_NAMES.has(name)) return { ok: true, content: await runContentTool(name, a, agentRun) };
	if (EDIT_TOOL_NAMES.has(name)) return { ok: true, content: runEditTool(name, a) };
	return agentRun(name, a);
}

/** A Media id from an answer of import_file / youtube / web_image ({"media":"a1b2c3d4", …}). */
const mediaOf = (answer: string) => /"media"\s*:\s*"([^"]+)"/.exec(answer)?.[1] ?? /\bmedia ([0-9a-f]{6,8})\b/.exec(answer)?.[1] ?? null;

/** A free stock video (Pexels / Pixabay with the user's free key, Wikimedia Commons without) into Media. */
async function importStock(item: string): Promise<string> {
	const res = await fetch(`/api/mcp/stock/file?item=${encodeURIComponent(item)}`, { headers: { "X-Studio": "1" } });
	if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "The stock clip didn't download. Try another one.");
	const blob = await res.blob();
	const { processMediaAssets } = await import("@/media/processing");
	const commons = item.startsWith("File:");
	const name = commons ? item.replace(/^File:/, "") : `${item.replace(":", " ")}.${blob.type.includes("webm") ? "webm" : "mp4"}`;
	const [processed] = await processMediaAssets({ files: [new File([blob], name, { type: blob.type || "video/mp4" })] });
	if (!processed) throw new Error("The editor couldn't read this stock clip. Try another one.");
	const license = res.headers.get("x-license") ?? "free licence";
	const asset = await ed().media.addMediaAsset({ projectId: openProject(), asset: { ...processed, origin: "source", attribution: { title: name, author: commons ? "Wikimedia Commons" : (license.split(" · ")[1] ?? item.split(":")[0]), license: license.split(" · ")[0], sourceUrl: commons ? `https://commons.wikimedia.org/wiki/${encodeURIComponent(item)}` : (license.split(" · ")[2] ?? "") } } });
	if (!asset) throw new Error("Not enough disk space.");
	return asset.id.slice(0, 8);
}

/** place: an item from find_content (or a Media file, or plain words) on the timeline, importing first when needed. */
async function place(args: Args, ctx: McpCtx): Promise<McpAnswer> {
	if (Array.isArray(args.items)) {
		const lines: string[] = [];
		for (const [i, one] of (args.items as Args[]).slice(0, 40).entries()) {
			const r = await place(resolveArgs(one ?? {}), ctx);
			if (!r.ok) return { ok: false, content: `${lines.join("\n")}${lines.length ? "\n" : ""}${i + 1} ✗ ${r.content.replace(/^Error:\s*/, "")}${i ? ` (items 1–${i} were placed)` : ""}` };
			lines.push(`${i + 1} ✓ ${oneLine(r.content, 160)}`);
		}
		return { ok: true, content: lines.join("\n") };
	}
	const at = args.at ?? args.start;
	const raw = String(args.item ?? "");
	const colon = raw.indexOf(":");
	const kind = colon > 0 ? raw.slice(0, colon) : args.media ? "media" : "";
	const id = colon > 0 ? raw.slice(colon + 1) : raw;
	const fields = (args.fields && typeof args.fields === "object" ? args.fields : {}) as Args;
	const addMedia = (media: string) => runAny("add_media", { media, start: at, duration: args.duration, sourceFrom: args.sourceFrom, track: args.track }, ctx);
	switch (kind) {
		case "media":
			return addMedia(String(args.media ?? id));
		case "local": {
			const r = await runAny("import_file", { path: id }, ctx);
			const m = r.ok ? mediaOf(r.content) : null;
			return m ? addMedia(m) : r;
		}
		case "youtube": {
			const r = await runAny("youtube", { query: id, from: args.from, to: args.to }, ctx);
			const m = r.ok ? mediaOf(r.content) : null;
			return m ? addMedia(m) : r.ok ? fail("Downloaded, but it isn't in Media yet: get_project, then place {media}.") : r;
		}
		case "image": {
			const [query, pick] = id.split("#");
			const r = await runAny("web_image", { query, pick: Number(pick) || 0 }, ctx);
			const m = r.ok ? mediaOf(r.content) : null;
			return m ? addMedia(m) : r;
		}
		case "stock":
			return addMedia(await importStock(id));
		case "transition":
			return runAny("add_transition", { type: id, at }, ctx);
		case "effect":
		case "filter": {
			const on = String(args.on ?? "");
			const targets = on === "all" ? allElements().filter((x) => x.role === "main" && (x.element.type === "video" || x.element.type === "image")).map((x) => x.element.id.slice(0, 8)) : (resolveTarget(on) ?? (on ? [on] : []));
			if (!targets.length) return fail(`${kind}: say on which clip (on: id, "selected", "clip 2" or "all").`);
			const lines: string[] = [];
			for (const [i, target] of targets.entries()) {
				// An effect the clip already has is changed, not stacked (a second «brighter» adjusts the same pass).
				const set = kind === "effect" ? await runAny("set_effect", { id: target, effect: id, params: fields }, ctx) : null;
				const r = kind === "filter" ? await runAny("apply_filter", { id: target, look: id }, ctx) : set?.ok ? set : await runAny("add_effect", { id: target, type: id, params: fields }, ctx);
				if (!r.ok) return i ? { ...r, content: `${r.content} (${id} is on the first ${i} clip(s))` } : r;
				lines.push(oneLine(r.content, 100));
			}
			// Many clips: one line (10.11: 66 clips answered twice over in 3 866 characters).
			if (targets.length > 3) return { ok: true, content: `${id} on ${targets.length} clips (${targets[0]} … ${targets[targets.length - 1]}): ${lines[0]}` };
			return { ok: true, content: `${id} on ${targets.length} clip(s): ${lines.join(" · ")}` };
		}
		case "text":
			return runAny("add_text_style", { style: id, text: args.text, start: at, duration: args.duration }, ctx);
		case "motion":
			return runAny("add_motion", { kind: id, start: at, fields }, ctx);
		case "template":
			return runAny("add_motion", { template: id }, ctx);
		case "sticker":
			// (the owner's own edition has no sticker packs: src/edition/cuts.ts)
			if (!STICKERS) return fail(NO_STICKERS);
			return runAny("add_graphic", { graphic: id, start: at }, ctx);
		case "music":
		case "sound": {
			const r = await runAny("add_sound", { sound: id, start: at }, ctx);
			// duration: only that much of it (an 18.8-s train sound asked for 2.7 s ran its whole length and made the film longer).
			const want = Number(args.duration);
			const made = r.ok ? idOf(r.content) : null;
			const from = Number(/"start"\s*:\s*(-?\d+(?:\.\d+)?)/.exec(r.content)?.[1] ?? NaN);
			const till = Number(/"end"\s*:\s*(-?\d+(?:\.\d+)?)/.exec(r.content)?.[1] ?? NaN);
			if (made && want > 0 && Number.isFinite(from) && Number.isFinite(till) && till - from > want + 0.05) {
				const cut = await runAny("trim", { id: made, end: from + want, exact: true }, ctx);
				if (cut.ok) return { ...r, content: r.content.replace(/"end"\s*:\s*-?\d+(?:\.\d+)?/, `"end":${Math.round((from + want) * 100) / 100}`) };
			}
			return r;
		}
		case "":
			if (typeof args.text === "string" && args.text.trim()) return runAny("add_text", { text: args.text, start: at, duration: args.duration, ...fields }, ctx);
			return fail("Give item (an id from find_content), media (a Media id) or text.");
		default:
			return fail(`Unknown item kind "${kind}": music, sound, text, motion, template, transition, filter, effect, ${STICKERS ? "sticker, " : ""}local, image, stock, youtube, media.`);
	}
}

let stockKeySaid = false;

async function findContent(args: Args, ctx: McpCtx): Promise<McpAnswer> {
	const kind = String(args.kind ?? "");
	const query = String(args.query ?? "").trim();
	const words = query.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 1);
	const match = (hay: string) => !words.length || words.some((w) => hay.toLowerCase().includes(w));
	if (kind === "caption") {
		const hits = CAPTION_STYLES.filter((s) => match(`${s.id} ${s.name}`));
		// (no word, or none that matches: the first 16 and the count — all 96 on one line cost 2 KB a look)
		const list = words.length && hits.length ? hits : CAPTION_STYLES.slice(0, 16);
		const head = words.length && !hits.length ? `No caption style matches “${query}”. ` : "";
		const more = list.length < CAPTION_STYLES.length && !(words.length && hits.length) ? ` · … ${CAPTION_STYLES.length - list.length} more: give a word (bold, karaoke, neon, minimal, pop…)` : "";
		return { ok: true, content: `${head}edit op captions {style}: ${list.map((s) => `${s.id} (${s.name})`).join(" · ")}${more}` };
	}
	if (kind === "voice") {
		const saved = (await readMemory().catch(() => ({ voices: [] as Array<{ name: string; speaker: string }> }))).voices;
		return { ok: true, content: `generate {kind:"voice", text, speaker}: ${VOICES.map((v) => `${v.id} (${v.tone})`).join(" · ")}${saved.length ? ` · saved: ${saved.map((v) => `${v.name}=${v.speaker}`).join(", ")}` : ""}` };
	}
	if (kind === "template") {
		const hits = TEMPLATES.filter((t) => match(`${t.id} ${t.name} ${t.category} ${t.themes.join(" ")}`)).slice(0, 24);
		return { ok: true, content: `place {item}: every layer of the pack at its moment, one ⌘Z. ${(hits.length ? hits : TEMPLATES.slice(0, 24)).map((t) => `template:${t.id} (${t.name}, ${t.category})`).join(" · ")}` };
	}
	if (kind === "stock") {
		if (!query) return fail("Say what footage to look for, e.g. 'city night', 'ocean waves'.");
		const c = ed().project.getActiveOrNull()?.settings.canvasSize;
		const res = await fetch(`/api/mcp/stock?q=${encodeURIComponent(query)}&vertical=${c && c.width > c.height ? 0 : 1}`, { headers: { "X-Studio": "1" }, signal: ctx.signal });
		const data = (await res.json().catch(() => ({}))) as { items?: Array<{ item: string; title: string; source: string; seconds?: number; width?: number; height?: number; mb?: number }>; notes?: string[]; error?: string };
		let notes = data.notes?.length ? ` (${data.notes.join(" ")})` : "";
		if (!stockKeySaid) {
			stockKeySaid = true;
			const keys = (await fetch("/api/mcp/stock/keys", { headers: { "X-Studio": "1" } }).then((r) => r.json()).catch(() => null)) as Record<string, unknown> | null;
			if (keys && !Object.values(keys).some((v) => (v as { key?: boolean } | null)?.key === true)) notes += " (No Pexels/Pixabay key: Wikimedia only — free but few clips; web pictures, YouTube pieces or AI find more.)";
		}
		if (!data.items?.length) return fail(`${data.error || "No free stock video for that: try other words, or find_content image / youtube."}${notes}`);
		return { ok: true, content: `Free stock video (place {item, at, duration?} imports it)${notes}: ${data.items.map((x) => `${x.item} (${x.source}${x.seconds ? `, ${Math.round(x.seconds)} s` : ""}${x.width ? `, ${x.width}×${x.height}` : ""}${x.mb ? `, ${x.mb} MB` : ""})`).join(" · ")}` };
	}
	const source = FIND_SOURCES[kind as keyof typeof FIND_SOURCES];
	if (source) {
		if (kind === "image") {
			if (!query) return fail("Say what picture to look for.");
			const res = await fetch(`/api/images/search?q=${encodeURIComponent(query)}&page=1`, { signal: ctx.signal });
			const data = (await res.json()) as { items?: Array<{ title: string; author: string; license: string }>; error?: string };
			if (!data.items?.length) return fail(data.error || "No pictures found: try other words.");
			return { ok: true, content: `Free pictures (place {item, at} imports it): ${data.items.slice(0, 10).map((x, i) => `image:${query}#${i} «${x.title.slice(0, 50)}» ${x.license}`).join(" · ")}` };
		}
		const r = await runAny(source, kind === "local" ? { query, kind: args.type } : { query }, ctx);
		if (kind === "local" && r.ok) {
			// The user's files as item ids (place imports and places one; import_media only imports).
			try {
				const files = (JSON.parse(r.content) as { files?: Array<{ path: string; kind: string; mb: number; modified: string }> }).files ?? [];
				return { ok: true, content: `The user's files (place {item, at} or import_media {paths}): ${files.map((f) => `local:${f.path} (${f.kind}, ${f.mb} MB, ${String(f.modified).slice(0, 10)})`).join(" · ")}` };
			} catch {}
		}
		const note = kind === "local" ? ' place {item:"local:<path>", at} imports and places one; import_media {paths} only imports.' : kind === "youtube" ? ' place {item:"youtube:<url>", from?, to?, at} downloads a piece and places it.' : "";
		return { ...r, content: `${clip(r.content, 4000)}${r.ok ? note : ""}` };
	}
	return runAny("find_content", { kind, query }, ctx);
}

async function importMedia(args: Args, ctx: McpCtx): Promise<McpAnswer> {
	const lines: string[] = [];
	let ok = true;
	const paths = Array.isArray(args.paths) ? args.paths.map(String) : typeof args.path === "string" ? [args.path] : [];
	for (const path of paths.slice(0, 40)) {
		const r = await runAny("import_file", { path }, ctx);
		ok &&= r.ok;
		lines.push(`${path.split("/").pop()}: ${oneLine(r.content, 160)}`);
		if (!r.ok) break;
	}
	if (ok && args.youtube) {
		const r = await runAny("youtube", { query: String(args.youtube), from: args.from, to: args.to }, ctx);
		ok &&= r.ok;
		lines.push(`YouTube: ${oneLine(r.content, 200)}`);
	}
	if (ok && args.image) {
		const r = await runAny("web_image", { query: String(args.image), pick: args.pick }, ctx);
		ok &&= r.ok;
		lines.push(`Picture: ${oneLine(r.content, 200)}`);
	}
	if (!lines.length) return fail("Give paths (find_content local), a youtube link or an image query.");
	return { ok, content: `${lines.join("\n")}${ok ? '\nIn Media. Place with edit {op:"add_media", media, start}.' : ""}` };
}

async function editOps(args: Args, ctx: McpCtx): Promise<McpAnswer> {
	const ops = (Array.isArray(args.ops) ? args.ops : []) as Args[];
	if (!ops.length) return fail('Give ops: [{op:"split", time:3}, …].');
	const results: string[] = [];
	const lines: string[] = [];
	const images: string[] = [];
	const names = new Map<string, number>();
	const notes: string[] = [];
	const lengthBefore = sec(ed().timeline.getTotalDuration());
	/** What an edit did to the film's length, said once at the end (a ripple, a speed change, a sound that ran long). */
	const length = () => {
		const now = sec(ed().timeline.getTotalDuration());
		return Math.abs(now - lengthBefore) > 0.02 ? `\nThe timeline is ${now} s now (was ${lengthBefore} s).` : "";
	};
	for (const [i, raw] of ops.slice(0, 80).entries()) {
		const { op, as, ...rest } = raw ?? {};
		const name = String(op ?? "");
		const size = Number((rest.params as Args | undefined)?.fontSize ?? rest.fontSize);
		if (Number.isFinite(size) && size > 15) notes.push(`step ${i + 1}: fontSize ${size} is huge — the unit is ${FONT_UNIT}`);
		if (!(EDIT_OPS as readonly string[]).includes(name)) {
			lines.push(`${i + 1} ${name || "?"} ✗ unknown op. Ops: ${EDIT_OPS.filter((o) => STICKERS || o !== "add_graphic").join(", ")}`);
			return { ok: false, content: `${lines.join("\n")}\n${i ? `Steps 1–${i} were done.` : "Nothing was done."}` };
		}
		if (name === "add_graphic" && !STICKERS) {
			lines.push(`${i + 1} add_graphic ✗ ${NO_STICKERS}`);
			return { ok: false, content: `${lines.join("\n")}\n${i ? `Steps 1–${i} were done.` : "Nothing was done."}` };
		}
		let r: McpAnswer;
		let target: unknown;
		try {
			const a = withRefs(rest, results, names);
			target = a.id;
			r = await runAny(opTool(name), a, ctx);
		} catch (error) {
			r = fail(errText(error));
		}
		// (a step that makes nothing new — set, move, trim — refers to the clip it changed: "$prev" after a set is that clip)
		results.push(idOf(r.content) || typeof target !== "string" ? r.content : JSON.stringify({ id: target }));
		if (r.images?.length) images.push(...r.images);
		if (!r.ok) {
			lines.push(`${i + 1} ${name} ✗ ${r.content.replace(/^Error:\s*/, "")}`);
			return { ok: false, content: `${lines.join("\n")}\n${i ? `Steps 1–${i} were done (undo takes back all of them); fix step ${i + 1} and send the rest.` : "Nothing was done."}${length()}`, images };
		}
		if (typeof as === "string" && as) names.set(as.replace(/^\$/, ""), i + 1);
		lines.push(`${i + 1} ${name} ✓ ${name === "remove_pauses" ? pausesLine(r.content) : oneLine(r.content, 220)}`);
		// A clip that did not land where it was asked is said (the main track has no gaps: a clip placed at 23 s after
		// a gap snapped to 7.7 s, and the answer was a plain ✓).
		const asked = Number(rest.at ?? rest.start);
		if (Number.isFinite(asked) && typeof (rest.at ?? rest.start) === "number" && ["place", "add_media", "move"].includes(name)) {
			const got = Number(/"start"\s*:\s*(-?\d+(?:\.\d+)?)/.exec(r.content)?.[1] ?? /\b(?:to|at) (-?\d+(?:\.\d+)?) s\b/.exec(r.content)?.[1] ?? NaN);
			if (Number.isFinite(got) && Math.abs(got - asked) > 0.05) notes.push(`step ${i + 1}: it is at ${got} s, not ${asked} s — the main track has no gaps (clips stand one after another); for a free place use a track above (track:"new")`);
		}
	}
	const warn = `${notes.length ? `\n⚠ ${notes.join("; ")}` : ""}${length()}`;
	if (ops.length <= 4) return { ok: true, content: `${lines.join("\n")}${warn}`, images };
	// Many steps: one line (10.11: a 40-step edit answered in 4 873 characters), the new ids, the steps with a remark.
	const count = new Map<string, number>();
	for (const o of ops) count.set(String(o?.op), (count.get(String(o?.op)) ?? 0) + 1);
	const fresh = results.map((r, i) => (["split", "add_media", "add_text", "add_text_style", "add_sound", "add_graphic", "add_motion", "place", "duplicate", "freeze_frame", "captions"].includes(String(ops[i]?.op)) ? (/\bid ([0-9a-f]{6,8})\b|"(?:id|added)"\s*:\s*"([0-9a-f]{6,8})/.exec(r) ?? [])[1] ?? (/"(?:id|added)"\s*:\s*"([0-9a-f]{6,8})/.exec(r) ?? [])[1] : null)).map((id, i) => (id ? `${id} (step ${i + 1}${ops[i]?.as ? ` "$${ops[i]?.as}"` : ""})` : "")).filter(Boolean);
	const remarks = lines.filter((l) => /snapped|moved|clamped|nothing|not |instead|ignored|already|⚠|outside/i.test(l)).map((l) => l.slice(0, 160));
	return { ok: true, content: `${ops.length} steps done (${[...count].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(", ")}).${fresh.length ? ` New ids: ${fresh.join(", ")}.` : ""}${remarks.length ? `\n${remarks.join("\n")}` : ""}${warn}`, images };
}

async function generate(args: Args, ctx: McpCtx): Promise<McpAnswer> {
	const kind = String(args.kind ?? "") as keyof typeof GENERATE_TOOL;
	const tool = GENERATE_TOOL[kind];
	if (!tool) return fail(`kind: ${Object.keys(GENERATE_TOOL).join(", ")}.`);
	const { kind: _k, ...rest } = args;
	const a: Args = tool === "ai_generate" ? { ...rest, kind } : rest;
	if (kind === "voice") {
		// A character's voice, or a saved voice by its name.
		if (args.cast && !a.speaker) a.speaker = (await castOf(Array.isArray(args.cast) ? args.cast.slice(0, 1) : args.cast))[0]?.voice;
		const saved = typeof a.speaker === "string" ? (await readMemory().catch(() => ({ voices: [] as Array<{ name: string; speaker: string }> }))).voices.find((v) => v.name.toLowerCase() === String(a.speaker).toLowerCase()) : undefined;
		if (saved) a.speaker = saved.speaker;
	}
	const r = await runAny(tool, a, ctx);
	try {
		const j = JSON.parse(r.content) as { media?: string; costUsd?: number };
		const words = String(args.prompt ?? args.text ?? "").trim().split(/\s+/).filter(Boolean);
		if (r.ok && j.media) made.set(j.media.slice(0, 8), { prompt: `${words.slice(0, 6).join(" ")}${words.length > 6 ? "…" : ""}`, ...(typeof j.costUsd === "number" ? { usd: j.costUsd } : {}) });
	} catch {}
	return r;
}

/** Pictures for Claude: small unless it asked for large (a frame ~300 px wide is enough to judge a cut). */
async function shrink(src: string, maxSide: number): Promise<string> {
	try {
		const blob = await (await fetch(src)).blob();
		const bmp = await createImageBitmap(blob);
		const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
		if (k > 0.97) {
			bmp.close();
			return src;
		}
		const canvas = new OffscreenCanvas(Math.max(2, Math.round(bmp.width * k)), Math.max(2, Math.round(bmp.height * k)));
		canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
		bmp.close();
		const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 });
		const buf = new Uint8Array(await out.arrayBuffer());
		let bin = "";
		for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
		return `data:image/jpeg;base64,${btoa(bin)}`;
	} catch {
		return src;
	}
}

const userLine = () => {
	const sel = ed().selection.getSelectedElements();
	const named = sel
		.map((r) => allElements().find((x) => x.element.id === r.elementId)?.element)
		.filter((e): e is TimelineElement => !!e)
		.map((e) => `${e.id.slice(0, 8)} ${e.type === "text" ? JSON.stringify(String(params(e).content ?? "").slice(0, 30)) : e.name}`);
	return `User: ${named.length ? `selected ${named.join(", ")}` : "nothing selected"} · playhead ${sec(ed().playback.getCurrentTime())} s`;
};

/** The digest's head: the brief, the memory in one line, the budget, what the user selected and the playhead. */
async function digestHead(): Promise<string> {
	const [notes, memory, budget] = await Promise.all([readNotes(), readMemory().catch(() => null), readBudget().catch(() => null)]);
	return [
		notes.notes ? `Brief: ${notes.notes.length > 200 ? `${notes.notes.slice(0, 200).replace(/\s+\S*$/, "")}… (project {action:"notes"} has it whole)` : notes.notes}` : "Brief: none yet (project {action:'notes'} keeps one for later chats).",
		memory && (memory.cast.length || memory.brands.length) ? `Memory: ${[memory.cast.length ? `cast ${memory.cast.map((c) => c.name).join(", ")}` : "", memory.brands.length ? `brand ${memory.brands.map((b) => b.name).join(", ")}` : ""].filter(Boolean).join(" · ")} (memory {action:'read'})` : "",
		budget ? `Budget: ${budgetLine(budget)}.` : "",
		userLine(),
	]
		.filter(Boolean)
		.join("\n");
}

/** The project list in short lines, newest first (10.11: 4.6 K of JSON, sent as a ping). */
function projectList(r: McpAnswer): McpAnswer {
	try {
		const j = JSON.parse(r.content) as { open: { id: string; name: string } | null; projects: Array<{ id: string; name: string; updated: string }> };
		const list = [...j.projects].sort((a, b) => b.updated.localeCompare(a.updated));
		const shown = list.slice(0, 15).map((p) => `${p.id} «${p.name.slice(0, 40)}» ${p.updated}`);
		return { ...r, content: `Open: ${j.open ? `«${j.open.name}» (${j.open.id})` : "none"}. Projects (${list.length}, newest first): ${shown.join(" · ")}${list.length > 15 ? ` · … ${list.length - 15} older` : ""}` };
	} catch {
		return r;
	}
}

async function route(tool: string, args: Args, ctx: McpCtx): Promise<McpAnswer> {
	switch (tool) {
		case "project": {
			const action = String(args.action ?? "");
			const legacy = Object.entries(LEGACY_PROJECT).find(([, a]) => a === action)?.[0];
			if (legacy === "list_projects") return projectList(await runAny(legacy, args, ctx));
			if (legacy) return runAny(legacy, args, ctx);
			if (action === "settings") return runAny("project_settings", args, ctx);
			if (action === "notes") {
				if (needsEditor(ctx.page)) return fail("Open the project first.");
				const n = await writeNotes(String(args.notes ?? ""));
				return { ok: true, content: `Brief kept (${n.notes.length} characters); the next chat reads it first.` };
			}
			return fail("action: list | create | open | rename | settings | save | close | notes.");
		}
		case "get_project": {
			if (args.id) {
				const hit = typeof args.id === "string" && !needsEditor(ctx.page) ? resolveTarget(String(args.id)) : null;
				const r = await runAny("get_element", { id: hit?.[0] ?? args.id }, ctx);
				return r.ok ? { ...r, content: compactElement(r.content, args.detail === true) } : r;
			}
			if (args.since !== undefined && Number.isFinite(Number(args.since)) && !needsEditor(ctx.page)) {
				// A revision this window never counted to: Gaziyav (or its window) started again and counts from 0.
				if (Number(args.since) > rev) return { ok: true, content: `Gaziyav restarted at ${hhmm(countingSince)}: revisions start again at 0 (you asked since ${args.since}). What was running then is listed above if anything was cut. Call get_project once (without since), then since again.\n${userLine()}` };
				const d = changesSince(Number(args.since));
				if (d) {
					const who = [d.byUser ? "the user" : "", d.byClaude ? "you" : ""].filter(Boolean).join(" and ");
					return { ok: true, content: d.lines.length ? `Changes since rev ${args.since} (by ${who}):\n${d.lines.slice(0, 60).join("\n")}${d.lines.length > 60 ? `\n… ${d.lines.length - 60} more: get_project for the whole` : ""}\n${userLine()}` : `No changes since rev ${args.since}. ${userLine()}` };
				}
			}
			if (needsEditor(ctx.page)) return fail("No project is open. project {action:'list'} then {action:'open', id}, or {action:'create', name, aspect}.");
			// The project as data (no cut at 12 000 characters, every media item), then the short view.
			const data = ctx.agent.projectData(100_000) as unknown as ProjectJson;
			for (const m of data.media) {
				const ai = made.get(m.id);
				if (ai) Object.assign(m, { prompt: ai.prompt, usd: ai.usd });
			}
			const notes = await readNotes().catch(() => ({ notes: "", castMedia: {} as Record<string, string[]> }));
			const hide = new Set(Object.values(notes.castMedia ?? {}).flat().map((id) => String(id).slice(0, 8)));
			if (args.media === "new" || args.media === "all") return { ok: true, content: mediaList(data, { hide, max: args.media === "new" ? 30 : 400 }) };
			if (args.detail && !args.track) {
				const full = JSON.stringify(data);
				if (full.length <= 12000) return { ok: true, content: full };
				return { ok: true, content: `(The full JSON is ${full.length} characters: here is the short view; get_project {track} or {id, detail:true} gives the details of a part.)\n${compactProject(data, { hide })}` };
			}
			const body = compactProject(data, { track: args.track ? String(args.track) : undefined, hide });
			return { ok: true, content: args.track ? body : `${await digestHead()}\n${body}` };
		}
		case "look": {
			// A Media file's own frames: media + one id + at (file seconds) or count (that many, evenly across it).
			const one = args.what === "media" && (Array.isArray(args.at) || (args.count !== undefined && Array.isArray(args.ids) && args.ids.length === 1 && args.offset === undefined && Number(args.count) <= 8)) ? (Array.isArray(args.ids) ? args.ids.map(String) : typeof args.id === "string" ? [args.id] : []) : [];
			if (one.length === 1 && !needsEditor(ctx.page)) {
				const asset = ed().media.getAssets().find((a) => a.id === one[0] || a.id.startsWith(one[0]));
				if (!asset) return fail(`No media "${one[0]}". get_project {media:"new"} lists the ids.`);
				if (asset.type !== "video" || !asset.file) return fail(`«${asset.name}» is ${asset.type === "video" ? "not on this Mac any more" : `a ${asset.type}`}: its own frames are for a video file (look {what:"media", ids} shows its picture).`);
				const length = asset.duration ?? 0;
				const n = Math.min(8, Math.max(2, Math.round(Number(args.count) || 6)));
				const at = (Array.isArray(args.at) ? (args.at as unknown[]).map(Number).filter((x) => Number.isFinite(x) && x >= 0 && (!length || x <= length)) : Array.from({ length: n }, (_, i) => Math.round(((length * (i + 0.5)) / n) * 100) / 100)).slice(0, 8);
				if (!at.length) return fail(`at: seconds of the file itself, 0–${Math.round(length * 10) / 10}.`);
				const { uploadOnce } = await import("@/studio/client/api");
				const up = await uploadOnce(`media:${asset.id}`, asset.file);
				const res = await fetch(`/api/mcp/filecheck?file=${encodeURIComponent(up.fileId)}&at=${at.join(",")}`, { headers: { "X-Studio": "1" }, signal: ctx.signal });
				const seen = (res.ok ? await res.json() : null) as { frames?: Array<{ at: number; src: string }> } | null;
				if (!seen?.frames?.length) return fail(`«${asset.name}» couldn't be read as a video.`);
				return { ok: true, content: `«${asset.name}» itself (${Math.round(length * 10) / 10} s; file seconds, not the timeline) at ${seen.frames.map((f) => `${f.at} s`).join(", ")}, in that order.`, images: seen.frames.map((f) => f.src) };
			}
			// Up to 8 frames a call (the player gives 4 at a time): six times asked used to come back as four, silently.
			const times = (args.what ?? "frames") === "frames" && Array.isArray(args.at) ? (args.at as unknown[]) : [];
			let r: McpAnswer;
			if (times.length > 4) {
				const first = await runAny("look", { ...args, at: times.slice(0, 4) }, ctx);
				const second = first.ok ? await runAny("look", { ...args, at: times.slice(4, 8) }, ctx) : first;
				if (!first.ok || !second.ok) return first.ok ? second : first;
				r = { ok: true, content: `The preview (exactly what the user sees) at ${times.slice(0, 8).map((t) => `${typeof t === "number" ? Math.round(t * 100) / 100 : t} s`).join(", ")}, in that order.${times.length > 8 ? ` 8 frames a call: the last ${times.length - 8} time(s) are not shown — ask them in another call.` : ""}`, images: [...(first.images ?? []), ...(second.images ?? [])] };
			} else r = await runAny("look", args, ctx);
			if (args.size === "large" || !r.images?.length) return r;
			const side = (args.what ?? "frames") === "frames" ? 512 : 1024;
			return { ...r, images: await Promise.all(r.images.map((src) => shrink(src, side))) };
		}
		case "find_content":
			return findContent(args, ctx);
		case "analyze": {
			const what = String(args.what ?? "words");
			const tool = ANALYZE[what];
			if (!tool) return fail(`what: ${Object.keys(ANALYZE).join(", ")}.`);
			const known = ctx.agent.TOOL_SPECS.some((t) => t.function.name === tool);
			if (!known) return fail(`analyze ${what} isn't in this Gaziyav yet: use analyze words.`);
			const { what: _w, ...rest } = args;
			const r = await runAny(tool, rest, ctx);
			// A long talk comes in parts: cut at a whole line, with the time it reached and the call for the next part
			// (a 20-minute transcript was cut mid-line at 12 000 characters with a hint about get_project).
			if (what === "words" && r.ok && r.content.length > 11_000) {
				const cut = r.content.lastIndexOf("\n", 10_500);
				const kept = r.content.slice(0, cut > 2000 ? cut : 10_500);
				const reached = [...kept.matchAll(/^\[(\d+(?:\.\d+)?)–(\d+(?:\.\d+)?)\]/gm)].pop();
				const last = [...r.content.matchAll(/^\[(\d+(?:\.\d+)?)–(\d+(?:\.\d+)?)\]/gm)].pop();
				if (reached && last) return { ...r, content: `${kept}\n… this part ends at ${reached[2]} s of ${last[2]} s: analyze {what:"words"${args.id ? `, id:${JSON.stringify(args.id)}` : ""}, from:${Math.floor(Number(reached[2]))}, to:${Math.ceil(Number(last[2]))}} gives the rest (ask long talks in parts of about 8 minutes).` };
			}
			return r;
		}
		case "import_media":
			return importMedia(args, ctx);
		case "edit":
			return editOps(args, ctx);
		case "motion_layer": {
			if (needsEditor(ctx.page)) return fail("No project is open.");
			// A described plate made by Gaziyav AI ("Create with AI", paid by the AI's own tokens), not code.
			if (typeof args.prompt === "string" && !args.code && !args.kind && !args.id) return runAny("ai_template", { prompt: args.prompt, start: args.start }, ctx);
			const seen = await motionLayer(resolveArgs(args));
			return { ok: true, content: seen.text, images: await Promise.all(seen.images.map((src) => shrink(src, 512))) };
		}
		case "generate":
			return generate(args, ctx);
		case "price_plan":
			if (needsEditor(ctx.page)) return fail("Open the project first: the budget is per video.");
			return { ok: true, content: await pricePlan(args) };
		case "memory":
			return { ok: true, content: await memoryTool(args) };
		case "export": {
			// The quality gate (production/gate.ts): a review's open hard failures keep Claude's export closed.
			const blocked = args.media ? null : await import("@/production/gate").then((m) => m.exportGate()).catch(() => null);
			if (blocked) return fail(blocked);
			const r = await runAny("export_project", args, ctx);
			if (r.ok) keepTaste();
			// The file as it was written: its own length, loudness, black or silent stretches, and three of its frames
			// (five of six examinees wanted to run ffprobe on the export: this is that, inside Gaziyav).
			const written = r.ok && !args.media ? /^Exported (.+?\.(?:mp4|mov|webm)) · ([\d.]+) s/.exec(r.content) : null;
			if (written) {
				const ask = () => fetch(`/api/mcp/filecheck?path=${encodeURIComponent(written[1])}&seconds=${written[2]}`, { headers: { "X-Studio": "1" }, signal: ctx.signal }).then((x) => (x.ok ? (x.json() as Promise<{ line?: string; frames?: string[] }>) : null)).catch(() => null);
				// (a folder of the user's own choice is known to the app a moment after the file lands)
				const seen = (await ask()) ?? (await new Promise<void>((done) => setTimeout(done, 700)).then(ask));
				if (seen?.line) return { ...r, content: `${r.content}\n${seen.line}`, ...(seen.frames?.length ? { images: seen.frames } : {}) };
			}
			return r;
		}
		case "post": {
			if (needsEditor(ctx.page)) return fail("Open the project to post first.");
			const blocked = args.check ? null : await import("@/production/gate").then((m) => m.exportGate()).catch(() => null);
			if (blocked) return fail(blocked);
			const text = await postTool(args);
			if (args.confirm === true) keepTaste();
			return { ok: true, content: text };
		}
		case "scenes":
			if (needsEditor(ctx.page)) return fail("No project is open.");
			return import("@/chapters/agent").then((m) => m.scenesTool(args));
		case "undo":
			return undoClaude(args);
		default:
			return runAny(tool, args, ctx);
	}
}

/** An export or a post: what Claude chose in this project and the user didn't undo is what they keep. */
function keepTaste() {
	const project = openProject();
	const depth = ed().command.depth();
	noteTaste("kept", steps.filter((s) => s.project === project && depth >= s.after && !s.undoneSeen).flatMap((s) => s.choices));
}

/** Arguments a listed tool doesn't take: refused with the ones it does (10.11: analyze beats {from,to} ignored them). */
function unknownArgs(tool: string, args: Args, ctx: McpCtx): string | null {
	if (!["generate", "analyze", "get_project"].includes(tool)) return null;
	const known = new Set(knownArgs(tool) ?? []);
	// (and whatever the tool underneath takes: a new argument of Gaziyav AI's tool is never refused here)
	const under = tool === "generate" ? GENERATE_TOOL[String(args.kind) as keyof typeof GENERATE_TOOL] : tool === "analyze" ? ANALYZE[String(args.what)] : null;
	const spec = under ? ctx.agent.TOOL_SPECS.find((t) => t.function.name === under) : null;
	for (const k of Object.keys(((spec?.function.parameters as { properties?: Args } | undefined)?.properties ?? {}) as Args)) known.add(k);
	const bad = Object.keys(args).filter((k) => !known.has(k));
	return bad.length ? `Unknown argument${bad.length > 1 ? "s" : ""} ${bad.join(", ")} for ${tool}: nothing was done. It takes: ${[...known].join(", ")}.` : null;
}

/** The call as Claude made it → the answer (and the bookkeeping for its undo, the revision, the user's changes). */

export async function runMcp(tool: string, args: Args, ctx: McpCtx): Promise<McpAnswer> {
	const readOnly = readOnlyCall(tool, args ?? {});
	const inEditor = () => ctx.page === "editor" && !!ed().project.getActiveOrNull();
	const unknown = unknownArgs(tool, args ?? {}, ctx);
	if (unknown) return fail(unknown);
	let note = "";
	// The user opened another project while Claude worked: Claude's edits would land in the wrong video.
	const open = ed().project.getActiveOrNull();
	// (the project tool and its older names; not get_project, which only reads)
	const switching = tool === "project" || /^(open|create|close|rename|save)_project$|^list_projects$/.test(tool);
	if (ctx.expect && open && inEditor() && open.metadata.id !== ctx.expect.id && !switching) {
		const here = `«${open.metadata.name}» (${open.metadata.id.slice(0, 8)})`;
		const was = ctx.expect.name ? `«${ctx.expect.name}» (${ctx.expect.id.slice(0, 8)})` : `project ${ctx.expect.id.slice(0, 8)}`;
		if (!readOnly) return fail(`The open project is now ${here}, not ${was} you worked on: nothing was changed. project {action:"open", id:"${ctx.expect.id}"} goes back; to work in this one, project {action:"open", id:"${open.metadata.id}"} first.`);
		note = `Note: the open project is now ${here}, not ${was} you worked on (project {action:"open", id:"${ctx.expect.id}"} goes back).\n`;
	}
	// What the user did by hand since Claude's last call, in a few lines: Claude builds on it without re-reading.
	if (inEditor() && userChanged && tool !== "get_project" && tool !== "undo") {
		const users = changesSince(lastClaudeRev)?.lines.filter((l) => l.startsWith("user")) ?? [];
		if (users.length) note += `The user changed by hand since your last call:\n${users.slice(0, 8).join("\n")}${users.length > 8 ? `\n… ${users.length - 8} more (get_project {since:${lastClaudeRev}})` : ""}\n`;
	}
	if (tool === "get_project" || note) userChanged = false;
	if (inEditor()) snapshot();
	const cmd = ed().command;
	const before = cmd.depth();
	const revAtStart = rev;
	lastCallStart = Date.now();
	const endedAtStart = claudeCallsEnded();
	let answer: McpAnswer;
	try {
		answer = await asClaude(tool, () => route(tool, args ?? {}, ctx));
	} catch (error) {
		if ((error as Error)?.name === "AbortError") throw error;
		answer = fail(errText(error));
	}
	const after = cmd.depth();
	// The user's own steps landed inside this call's range (not just a click while a long call ran in the background).
	let mixed = false;
	for (let r = revAtStart + 1; r <= rev; r++) if (authors.get(r) === "user") mixed = true;
	// another call of Claude's ended (and so placed what it made) while this one ran: its steps are in this range
	const overlapped = claudeCallsEnded() - endedAtStart > 1;
	if (mixed && after !== before) userChanged = true;
	if (!readOnly && tool !== "undo" && after > before) {
		steps.push({ tool, label: callLabel(tool, args ?? {}), rev, before, after, project: openProject(), choices: choicesOf(tool, args ?? {}), ...(mixed ? { mixed } : {}), ...(overlapped ? { overlapped } : {}) });
		if (steps.length > 200) steps.shift();
		redos.length = 0;
	}
	let tail = "";
	if (inEditor()) {
		snapshot();
		lastClaudeRev = rev;
		tail = ` [rev ${rev}]`;
	}
	// (how to get the rest is said in the tool's own terms: a transcript was cut with «use get_project {track}»)
	const more = tool === "get_project" ? 'get_project {track} lists one track, {media:"new"} the newest Media' : tool === "find_content" ? "narrow the query" : tool === "analyze" ? "ask a part of it: from, to" : "ask for less at a time";
	return { ...answer, content: clip(`${note}${answer.content}${tail}`, 12000, more) };
}
