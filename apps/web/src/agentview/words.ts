// «Claude at work»: one of Claude's tool calls as a sentence a person reads — what it is doing now (the header pill:
// present tense, lower case) and what it did (the card's row: past tense, with the numbers the call or its answer has).
// Never a tool name, an id or «[rev 41]» on screen (docs/design/for-agent.md §2). A phrase is the English text (the key
// of its Russian line in i18n/ru-agentview.ts) plus its values, so a row kept across a reload reads in the language
// of the moment. `{n|clip|clips}` picks the form for the number (Russian lines carry three: 1 · 2–4 · 5+).
// Pure: the unit tests walk every tool the connector answers (surface.ts and the older names).
import { opTool, readOnlyCall } from "@/mcp/surface";

type Args = Record<string, unknown>;

export interface Phrase {
	k: string;
	v?: Record<string, string | number>;
	/** More parts of the same sentence, joined with « · » («Cut out pieces: 3 · Title «Hello»»). */
	then?: Phrase[];
}

const P = (k: string, v?: Record<string, string | number>): Phrase => (v ? { k, v } : { k });

/** The form of a word for a number: English one | many, Russian 1 | 2–4 | 5+ (11–14 are «many»). */
export function pluralForm(n: number, forms: string[], lang: "en" | "ru"): string {
	const a = Math.abs(Math.round(n));
	if (lang !== "ru" || forms.length < 3) return a === 1 ? forms[0] : (forms[1] ?? forms[0]);
	const d = a % 10;
	const h = a % 100;
	if (d === 1 && h !== 11) return forms[0];
	if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return forms[1];
	return forms[2];
}

/** The phrase as text: `dict` is the Russian table (absent or without the line: the English key itself). */
export function sayPhrase(p: Phrase, lang: "en" | "ru", dict?: Record<string, string>): string {
	const text = lang === "ru" ? (dict?.[p.k] ?? p.k) : p.k;
	const v = p.v ?? {};
	const own = text
		.replace(/\{(\w+)\|([^}]*)\}/g, (_all, key: string, forms: string) => pluralForm(Number(v[key]) || 0, forms.split("|"), lang))
		.replace(/\{(\w+)\}/g, (all, key: string) => (key in v ? String(v[key]) : all));
	return p.then?.length ? [own, ...p.then.map((x) => sayPhrase(x, lang, dict))].join(" · ") : own;
}

// ───────────────────────── which calls only look ─────────────────────────

/** Calls the hub counts as changing that only read or listen (they never wait for «Continue» and make no step row). */
function onlyLooks(tool: string, args: Args): boolean {
	if (tool === "sounds_like" || tool === "hear_music" || tool === "editing_guide" || tool === "status") return true;
	if (tool === "taste_profile") return args.set === undefined && args.reset === undefined;
	if (tool === "playhead") return true;
	return false;
}

/** A call that changes nothing the person would have to take back: looking, listening, searching, pricing. */
export const isRead = (tool: string, args: Args = {}): boolean => readOnlyCall(tool, args) || onlyLooks(tool, args);

/** What a read was about (a run of reads is one quiet row in the card, named by its kind when they are all of one). */
export type ReadKind = "project" | "frames" | "footage" | "library" | "price" | "check";

// ───────────────────────── small helpers ─────────────────────────

const list = (v: unknown): Args[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Args[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");
/** A name the person gave or would recognise, short enough for a row; ids and paths are cut to their last part. */
export function shortName(v: unknown, max = 28): string {
	let s = str(v).replace(/\s+/g, " ").trim();
	if (!s) return "";
	if (s.includes("/")) s = s.split("/").filter(Boolean).pop() ?? s;
	if (s.length <= max) return s;
	// cut at a word when that keeps most of it, and never end on a comma
	let cut = s.slice(0, max - 1);
	const space = cut.lastIndexOf(" ");
	if (s[max - 1] !== " " && space > max * 0.6) cut = cut.slice(0, space);
	return `${cut.replace(/[\s,.;:!?—–-]+$/, "")}…`;
}
const clock = (seconds: number) => {
	const s = Math.max(0, Math.round(seconds));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const POSTS: Record<string, string> = { youtube: "YouTube Shorts", instagram: "Reels", tiktok: "TikTok" };
const PLATFORMS: Record<string, string> = { tiktok: "TikTok", reels: "Reels", shorts: "Shorts", youtube: "YouTube", feed: "Instagram", vk: "VK", telegram: "Telegram", instagram: "Reels" };

/** What kind of thing a `place` item is, from its id («music:lofi-01», «text:hook-bold», a Media id…). */
type Placed = "clip" | "music" | "sound" | "title" | "graphics" | "transition" | "look" | "effect" | "sticker";
function placedKind(item: Args): Placed {
	const id = str(item.item);
	const kind = id.includes(":") ? id.slice(0, id.indexOf(":")) : "";
	if (kind === "music") return "music";
	if (kind === "sound") return "sound";
	if (kind === "text" || (!id && !item.media && str(item.text))) return "title";
	if (kind === "motion" || kind === "template") return "graphics";
	if (kind === "transition") return "transition";
	if (kind === "filter") return "look";
	if (kind === "effect") return "effect";
	if (kind === "sticker") return "sticker";
	return "clip";
}

const PLACE_NOW: Record<Placed, Phrase> = {
	clip: P("placing clips"),
	music: P("adding music"),
	sound: P("adding a sound"),
	title: P("adding a title"),
	graphics: P("adding graphics"),
	transition: P("adding a transition"),
	look: P("applying a colour look"),
	effect: P("adding an effect"),
	sticker: P("adding a sticker"),
};

// ───────────────────────── the steps of `edit` ─────────────────────────

type Group = "cut_words" | "pauses" | "cut" | "captions" | "title" | "music" | "clips" | "adjust" | "camera" | "speed" | "transition" | "effect" | "colour" | "beats" | "scenes" | "parts" | "vertical" | "track" | "picture" | "voice" | "background" | "graphics" | "tidy" | "none";

/** One editing step (an op of `edit`, or the same operation called by its own older name) → its group. */
function groupOf(op: string, a: Args): Group {
	switch (op) {
		case "cut_out":
			return "cut_words";
		case "remove_pauses":
			return "pauses";
		case "split":
		case "trim":
		case "delete":
		case "move":
		case "reorder":
		case "duplicate":
			return "cut";
		case "captions":
			return "captions";
		case "add_text":
		case "add_text_style":
			return "title";
		case "add_sound":
			return "music";
		case "add_media":
			return "clips";
		case "place": {
			const k = placedKind(a);
			return k === "clip" ? "clips" : k === "music" || k === "sound" ? "music" : k === "title" ? "title" : k === "transition" ? "transition" : k === "look" ? "colour" : k === "effect" ? "effect" : "graphics";
		}
		case "add_graphic":
		case "add_motion":
			return "graphics";
		case "set":
		case "set_element":
		case "keyframes":
			return "adjust";
		case "camera":
			return "camera";
		case "speed":
		case "freeze_frame":
		case "reverse":
			return "speed";
		case "add_transition":
			return "transition";
		case "add_effect":
		case "set_effect":
			return "effect";
		case "apply_filter":
		case "auto_color":
			return "colour";
		case "beat_markers":
			return "beats";
		case "split_scenes":
			return "scenes";
		case "split_parts":
			return "parts";
		case "make_vertical":
			return "vertical";
		case "track":
		case "follow":
			return "track";
		case "ai_effect": {
			const kind = str(a.kind);
			if (/background/.test(kind)) return "background";
			if (/voice|denoise/.test(kind)) return "voice";
			return "picture";
		}
		case "action":
			return "tidy";
		default:
			return "none";
	}
}

const GROUP_NOW: Record<Group, Phrase> = {
	cut_words: P("cutting by the words"),
	pauses: P("removing pauses"),
	cut: P("cutting and moving"),
	captions: P("making captions"),
	title: P("adding a title"),
	music: P("adding music"),
	clips: P("placing clips"),
	adjust: P("adjusting clips"),
	camera: P("moving the camera"),
	speed: P("changing the speed"),
	transition: P("adding transitions"),
	effect: P("adding effects"),
	colour: P("grading the colour"),
	beats: P("marking the beats"),
	scenes: P("splitting into scenes"),
	parts: P("splitting the song into its parts"),
	vertical: P("reframing to vertical"),
	track: P("tracking an object"),
	picture: P("improving the picture"),
	voice: P("cleaning the voice"),
	background: P("removing the background"),
	graphics: P("adding graphics"),
	tidy: P("tidying the timeline"),
	none: P("editing"),
};

/** How many things a step touches (clips for delete/set, ranges for cut_out), at least one. */
function amount(op: string, a: Args): number {
	if (op === "cut_out") return Math.max(1, list(a.ranges).length);
	if (Array.isArray(a.ids)) return Math.max(1, a.ids.length);
	return 1;
}

function editGroups(ops: Args[]): Map<Group, { n: number; ops: Args[] }> {
	const out = new Map<Group, { n: number; ops: Args[] }>();
	for (const o of ops) {
		const op = str(o.op);
		const g = groupOf(op, o);
		if (g === "none" && op === "playhead") continue;
		const was = out.get(g) ?? { n: 0, ops: [] };
		was.n += amount(op, o);
		was.ops.push(o);
		out.set(g, was);
	}
	return out;
}

/** «Placed a clip» for one, «Placed 3 clips» for more: said the way a person would. */
const one = (n: number, single: Phrase, many: Phrase): Phrase => (n === 1 ? single : many);

/** The music and the sounds among placed things: «Added music», «Added 2 sounds», «Added music and 2 sounds». */
function soundsDone(items: Args[]): Phrase {
	const music = items.filter((o) => /^music:/.test(str(o.item)) || /music|song|track/i.test(str(o.sound))).length;
	const sounds = items.length - music;
	if (music && sounds) return P("Added music and {n} {n|sound|sounds}", { n: sounds });
	if (music) return P("Added music");
	return one(sounds, P("Added a sound"), P("Added {n} {n|sound|sounds}", { n: sounds }));
}

/** The past-tense part of one group of steps, with its number. */
function groupDone(g: Group, n: number, ops: Args[]): Phrase {
	const k = ops.length;
	switch (g) {
		case "cut_words": {
			const cut = ops.flatMap((o) => list(o.ranges)).reduce((sum, r) => sum + Math.max(0, (Number(r.to) || 0) - (Number(r.from) || 0)), 0);
			if (cut >= 0.5) return one(n, P("Cut out a piece (−{time})", { time: clock(cut) }), P("Cut out {n} {n|piece|pieces} (−{time})", { n, time: clock(cut) }));
			return one(n, P("Cut out a piece"), P("Cut out {n} {n|piece|pieces}", { n }));
		}
		case "pauses":
			return P("Removed the pauses");
		case "cut": {
			const kinds = new Set(ops.map((o) => str(o.op)));
			if (kinds.size === 1) {
				const only = [...kinds][0];
				if (only === "split") return one(n, P("Made a cut"), P("Made {n} {n|cut|cuts}", { n }));
				if (only === "trim") return one(n, P("Trimmed a clip"), P("Trimmed {n} {n|clip|clips}", { n }));
				if (only === "delete") return one(n, P("Removed a clip"), P("Removed {n} {n|clip|clips}", { n }));
				if (only === "duplicate") return one(n, P("Duplicated a clip"), P("Duplicated {n} {n|clip|clips}", { n }));
				return one(n, P("Moved a clip"), P("Moved {n} {n|clip|clips}", { n }));
			}
			return P("Cut and moved {n} {n|clip|clips}", { n });
		}
		case "captions":
			return P("Made the captions");
		case "title": {
			const text = shortName(ops.map((o) => o.text ?? o.content).find((x) => str(x)), 32);
			if (text && k === 1) return P("Title «{name}»", { name: text });
			return text ? P("Title «{name}» and {n} more", { name: text, n: k - 1 }) : one(k, P("Added a title"), P("Added {n} {n|title|titles}", { n: k }));
		}
		case "music":
			return soundsDone(ops);
		case "clips":
			return one(k, P("Placed a clip"), P("Placed {n} {n|clip|clips}", { n: k }));
		case "adjust":
			return one(n, P("Adjusted a clip"), P("Adjusted {n} {n|clip|clips}", { n }));
		case "camera":
			return one(k, P("Added a camera move"), P("Added {n} camera {n|move|moves}", { n: k }));
		case "speed":
			return one(k, P("Changed the speed of a clip"), P("Changed the speed of {n} {n|clip|clips}", { n: k }));
		case "transition":
			return one(k, P("Added a transition"), P("Added {n} {n|transition|transitions}", { n: k }));
		case "effect":
			return one(k, P("Added an effect"), P("Added {n} {n|effect|effects}", { n: k }));
		case "colour":
			return P("Graded the colour");
		case "beats":
			return P("Marked the beats");
		case "scenes":
			return P("Split into scenes");
		case "parts":
			return P("Split the song into its parts");
		case "vertical":
			return P("Reframed to vertical");
		case "track":
			return P("Tracked an object");
		case "picture":
			return P("Improved the picture");
		case "voice":
			return P("Cleaned the voice");
		case "background":
			return P("Removed the background");
		case "graphics":
			return one(k, P("Added graphics"), P("Added {n} graphic {n|layer|layers}", { n: k }));
		case "tidy":
			return P("Tidied the timeline");
		default:
			return P("Edited in {n} {n|step|steps}", { n: k });
	}
}

// ───────────────────────── a call, now ─────────────────────────

export interface CallWords {
	/** What it is doing: present tense, lower case, no full stop. */
	now: Phrase;
	/** It only looks (no step row, never waits for «Continue»). */
	read: boolean;
	/** For a read: what it was about. */
	about?: ReadKind;
	/** A read whose answer is worth its own row (a review's score). */
	own?: boolean;
	/** Paid on the user's key (its price shows in the row once the answer names it). */
	paid?: boolean;
	/** No line of its own here: shown as «working», its row is the first sentence of its answer. */
	unknown?: boolean;
}

/** The scenes tool's actions (the scenes department's `scenes`); list and youtube only read. */
const SCENES_NOW: Record<string, Phrase> = {
	find: P("finding the scenes"),
	move: P("moving a scene"),
	rename: P("renaming a scene"),
	merge: P("joining two scenes"),
	split: P("splitting a scene"),
	delete: P("removing a scene"),
	duplicate: P("duplicating a scene"),
	color: P("colouring a scene"),
	copy: P("copying a scene to a new timeline"),
};
const SCENES_DONE: Record<string, Phrase> = {
	find: P("Found the scenes"),
	move: P("Moved a scene"),
	rename: P("Renamed a scene"),
	merge: P("Joined two scenes"),
	split: P("Split a scene"),
	delete: P("Removed a scene"),
	duplicate: P("Duplicated a scene"),
	color: P("Coloured a scene"),
	copy: P("Copied a scene to a new timeline"),
};

const GENERATE_NOW: Record<string, Phrase> = {
	image: P("generating a picture"),
	video: P("generating a video"),
	voice: P("voicing the text"),
	lipsync: P("syncing the lips"),
	revoice: P("re-voicing the clip"),
	dub: P("dubbing into another language"),
	face_swap: P("swapping the face"),
	design: P("designing graphics"),
};

/** The call in plain words while it runs. */
export function wordsFor(tool: string, rawArgs: Args | null | undefined): CallWords {
	const a = rawArgs ?? {};
	const read = isRead(tool, a);
	const looks = (now: Phrase, about: ReadKind): CallWords => ({ now, read: true, about });
	const does = (now: Phrase, more: Partial<CallWords> = {}): CallWords => ({ now, read: false, ...more });
	switch (tool) {
		// ── the project and what Gaziyav remembers ──
		case "get_project":
		case "get_element":
			return looks(P("reading the project"), "project");
		case "list_projects":
			return looks(P("reading the list of projects"), "project");
		case "project": {
			const action = str(a.action);
			if (action === "list" || !action) return looks(P("reading the list of projects"), "project");
			if (action === "create") return does(P("creating a project"));
			if (action === "open") return does(P("opening a project"));
			if (action === "rename") return does(P("renaming the project"));
			if (action === "settings") return does(P("changing the project's format"));
			if (action === "save") return does(P("saving the project"));
			if (action === "close") return does(P("closing the project"));
			if (action === "notes") return does(P("writing down the brief"));
			return does(P("working on the project"));
		}
		case "create_project":
			return does(P("creating a project"));
		case "open_project":
			return does(P("opening a project"));
		case "rename_project":
			return does(P("renaming the project"));
		case "save_project":
			return does(P("saving the project"));
		case "close_project":
			return does(P("closing the project"));
		case "project_settings":
			return does(P("changing the project's format"));
		case "memory":
			if (read) return looks(P("recalling your style and cast"), "project");
			return does(a.action === "voice" ? P("remembering a voice") : P("remembering a character"));
		case "memory_read":
			return looks(P("recalling your style and cast"), "project");
		case "taste_profile":
			return read ? looks(P("recalling your style and cast"), "project") : does(P("updating your style"));
		case "editing_guide":
			return looks(P("reading the editing guide"), "project");
		case "status":
			return looks(P("checking what is running"), "project");
		// ── looking and listening ──
		case "look": {
			const what = str(a.what);
			if (what === "playback") return looks(P("watching the cut play"), "frames");
			if (what === "timeline") return looks(P("looking at the timeline"), "frames");
			if (what === "media") return looks(P("looking through Media"), "frames");
			return looks(P("looking at frames"), "frames");
		}
		case "analyze": {
			const what = str(a.what);
			if (what === "beats") return does(P("marking the beats"));
			if (what === "words") return looks(P("reading the speech"), "footage");
			if (what === "music") return looks(P("listening to the music"), "footage");
			if (what === "cut_points") return looks(P("looking for the best cuts"), "footage");
			return looks(P("listening to the sound"), "footage");
		}
		case "transcript":
			return looks(P("reading the speech"), "footage");
		case "listen":
			return looks(P("listening to the sound"), "footage");
		case "hear_music":
			return looks(P("listening to the music"), "footage");
		case "cut_point":
			return looks(P("looking for the best cuts"), "footage");
		case "sounds_like":
			return looks(P("listening for a sound"), "footage");
		case "analyze_material":
			return looks(P("hearing and watching the footage"), "footage");
		case "check_cuts":
			return { now: P("checking the cuts"), read: true, about: "check", own: true };
		case "review":
			return { now: P("reviewing the edit"), read: true, about: "check", own: true };
		// ── finding ──
		case "find_content": {
			const kind = str(a.kind);
			if (kind === "local") return looks(P("looking through your files"), "library");
			if (kind === "youtube") return looks(P("searching YouTube"), "library");
			if (kind === "image") return looks(P("searching for pictures"), "library");
			if (kind === "stock") return looks(P("searching stock footage"), "library");
			if (kind === "facts") return looks(P("searching the web"), "library");
			if (kind === "music") return looks(P("choosing music"), "library");
			if (kind === "sound") return looks(P("choosing a sound"), "library");
			return looks(P("searching the library"), "library");
		}
		case "local_files":
			return looks(P("looking through your files"), "library");
		case "web_search":
			return looks(P("searching the web"), "library");
		case "find_sound":
			return looks(P("choosing a sound"), "library");
		case "find_graphic":
		case "list_effects":
		case "list_transitions":
			return looks(P("searching the library"), "library");
		case "price_plan":
		case "ai_models":
			return looks(P("pricing the plan"), "price");
		// ── bringing material ──
		case "import_media": {
			if (Array.isArray(a.paths) && a.paths.length) return does(P("adding {n} {n|file|files}", { n: a.paths.length }));
			if (a.youtube) return does(P("downloading from YouTube"));
			if (a.image) return does(P("adding a picture from the web"));
			return does(P("adding files"));
		}
		case "import_file":
			return does(P("adding {n} {n|file|files}", { n: 1 }));
		case "youtube":
			return does(P("downloading from YouTube"));
		case "web_image":
			return does(P("adding a picture from the web"));
		// ── the cut ──
		case "place": {
			const items = list(a.items).length ? list(a.items) : [a];
			const kinds = new Set(items.map(placedKind));
			if (kinds.size === 1) {
				const k = [...kinds][0];
				if (k === "clip" && items.length > 1) return does(P("placing {n} {n|clip|clips}", { n: items.length }));
				return does(PLACE_NOW[k]);
			}
			if ([...kinds].every((x) => x === "music" || x === "sound")) return does(P("adding music and sounds"));
			return does(P("placing {n} {n|thing|things} on the timeline", { n: items.length }));
		}
		case "edit": {
			const groups = editGroups(list(a.ops));
			if (groups.size === 1) {
				const [g, x] = [...groups][0];
				if (g === "clips" && x.ops.length > 1) return does(P("placing {n} {n|clip|clips}", { n: x.ops.length }));
				return does(GROUP_NOW[g]);
			}
			const n = list(a.ops).length;
			return does(n ? P("editing, {n} {n|step|steps}", { n }) : P("editing"));
		}
		case "apply_plan":
			return does(P("editing by the plan"));
		case "fit_music":
			return does(P("fitting the music"));
		case "fix_sound":
			return does(P("cleaning the sound"));
		case "motion_layer":
		case "ai_template":
			return does(tool === "ai_template" ? P("designing graphics") : P("making graphics"));
		case "undo":
			return does(a.redo ? P("bringing its step back") : P("taking its step back"));
		case "scenes": {
			const action = str(a.action) || "list";
			if (read) return looks(P("reading the scenes"), "project");
			return does(SCENES_NOW[action] ?? P("working on the scenes"));
		}
		// ── AI on the user's key ──
		case "generate": {
			if (a.quote === true) return looks(P("pricing the plan"), "price");
			if (Array.isArray(a.items) && a.items.length) return does(P("generating {n} {n|shot|shots}", { n: a.items.length }), { paid: true });
			const kind = str(a.kind);
			return does(GENERATE_NOW[kind] ?? P("generating"), { paid: kind !== "voice" });
		}
		case "ai_generate":
			return does(a.kind === "image" ? P("generating a picture") : P("generating a video"), { paid: true });
		case "generate_voice":
			return does(P("voicing the text"));
		case "lipsync":
			return does(P("syncing the lips"), { paid: true });
		case "revoice":
			return does(P("re-voicing the clip"), { paid: true });
		case "dub":
			return does(P("dubbing into another language"), { paid: true });
		case "face_swap":
			return does(P("swapping the face"), { paid: true });
		// ── out ──
		case "export":
		case "export_project":
		case "export_media": {
			const platform = PLATFORMS[str(a.platform).toLowerCase()];
			return does(platform ? P("exporting for {platform}", { platform }) : P("exporting"));
		}
		case "post":
			return read ? { now: P("checking the post"), read: true, about: "check" } : does(P("posting"));
		default: {
			// an editing step called by its own (older) name
			const g = groupOf(tool === "set_element" ? "set" : tool, a);
			if (g !== "none") return read ? looks(GROUP_NOW[g], "project") : does(GROUP_NOW[g]);
			if (tool === "playhead") return looks(P("moving the playhead"), "project");
			return { now: P("working"), read, unknown: true, ...(read ? { about: "project" as const } : {}) };
		}
	}
}

// ───────────────────────── a call, done ─────────────────────────

/** A tool's answer without what the connector wrote around it: the «user changed by hand» lines, notes, «[rev 41]». */
export function ownAnswer(content: string): string {
	const lines = String(content ?? "").replace(/\s*\[rev \d+\]\s*$/, "").split("\n");
	let i = 0;
	for (;;) {
		const line = lines[i] ?? "";
		if (/^The user (changed by hand|went back|brought )/.test(line) || /^Note: /.test(line)) {
			i++;
			while (i < lines.length && /^(user(\+you)?: |… \d+ more)/.test(lines[i])) i++;
			continue;
		}
		break;
	}
	return lines.slice(i).join("\n").trim();
}

/** The first sentence of a tool's own answer, fit for the card: no ids, no «[rev 41]», no JSON, at most `max` characters. */
export function firstSentence(content: string, max = 72): string {
	let s = ownAnswer(content).replace(/^Error:\s*/i, "").trim();
	if (/^[[{]/.test(s)) return "";
	s = s.split(/\n/)[0] ?? "";
	// «1 split ✓ …»: the numbering of edit's lines is not for people
	s = s.replace(/^\d+\s+[a-z_]+\s+[✓✗]\s*/, "");
	const end = /[.!?](\s|$)/.exec(s);
	if (end && end.index > 12) s = s.slice(0, end.index + 1);
	s = s
		.replace(/\((?:clip|media|track|id)\s+[0-9a-f]{6,}\)/gi, "")
		.replace(/\b(?:clip|media|track|id)\s+[0-9a-f]{6,}\b/gi, "")
		.replace(/\b[0-9a-f]{8}\b/g, "")
		.replace(/\{[^{}]*\}/g, "")
		.replace(/\s{2,}/g, " ")
		.replace(/\s+([.,:;!?])/g, "$1")
		.trim();
	if (s.length > max) s = `${s.slice(0, max - 1).trimEnd()}…`;
	return s;
}

/** Why a step failed, in one line a person can act on (a known reason in words, else the tool's own first sentence). */
export function reasonOf(content: string): Phrase {
	const text = ownAnswer(content);
	if (/more than this video's budget has left/i.test(text)) return P("It would go over this video's budget");
	if (/there is no ([\w.]+) key/i.test(text)) return P("No {api} key: add it in Settings → AI", { api: /there is no ([\w.]+) key/i.exec(text)?.[1] ?? "AI" });
	if (/EMPTY \(refused|Exhausted balance|has \$[\d.]+ left, this costs/i.test(text)) return P("Not enough money on the AI account");
	if (/The open project is now/i.test(text)) return P("Another project is open now");
	if (/No project is open|Open the project first/i.test(text)) return P("No project is open");
	if (/stopped answering while doing this|was reloaded or closed/i.test(text)) return P("The window was reloaded while it ran");
	if (/Unknown argument/i.test(text)) return P("Claude asked for something this step does not take");
	if (/No element|No clip|No media|No track/i.test(text)) return P("It pointed at a clip that is not there any more");
	if (/timed out|did not answer|didn't answer|no answer/i.test(text)) return P("The service did not answer in time");
	if (/safety|content policy|moderation/i.test(text)) return P("The AI service refused this request");
	if (/network|fetch failed|ECONN|offline/i.test(text)) return P("No connection to the service");
	const own = firstSentence(text, 72);
	return own ? P("{text}", { text: own }) : P("It did not work");
}

/** What a paid step charged, from its own answer («charged $0.04 on fal.ai», or «≈ $0.04 charged» when stopped). */
export function chargedIn(content: string): number {
	const text = String(content ?? "");
	let sum = 0;
	for (const m of text.matchAll(/(?<!nothing new )\bcharged \$(\d+(?:\.\d+)?) on\b/g)) sum += Number(m[1]) || 0;
	if (!sum) for (const m of text.matchAll(/≈ \$(\d+(?:\.\d+)?) charged/g)) sum += Number(m[1]) || 0;
	return Math.round(sum * 1e6) / 1e6;
}

export interface DoneWords {
	/** What it did: past tense, sentence case, with its number. */
	done: Phrase;
	/** What it charged (paid steps only). */
	usd?: number;
}

const GENERATED: Record<string, [named: string, plain: string]> = {
	image: ["Picture «{name}»", "A picture"],
	video: ["Video «{name}»", "A video"],
	voice: ["Voice-over «{name}»", "A voice-over"],
	lipsync: ["Lipsync «{name}»", "Lipsync"],
	revoice: ["New voice «{name}»", "A new voice for the clip"],
	dub: ["Dubbing", "Dubbing"],
	face_swap: ["Face swap", "Face swap"],
	design: ["Graphics «{name}»", "Graphics"],
};

function generated(kind: string, a: Args): Phrase {
	const pair = GENERATED[kind];
	if (!pair) return P("Generated");
	const name = shortName(a.prompt ?? a.text, 28);
	return name && pair[0].includes("{name}") ? P(pair[0], { name }) : P(pair[1]);
}

/** A file name in an answer («Exported /Users/x/Movies/Gaziyav/Podcast 12.mp4 · 1080×1920 · …»): the name, spaces and all. */
function fileIn(content: string): string {
	const EXT = "(?:mp4|mov|webm|mkv|gif|mp3|wav|m4a|png|jpg|jpeg)";
	const whole = new RegExp(`(/[^\\n"«»]*?\\.${EXT})(?=$|[\\s·,;)"])`, "i").exec(content)?.[1];
	if (whole) return whole.split("/").pop() ?? "";
	return new RegExp(`([^\\s/"«»]+\\.${EXT})\\b`, "i").exec(content)?.[1] ?? "";
}

/** The call in plain words once it is done, with what its arguments and its answer say. */
export function doneFor(tool: string, rawArgs: Args | null | undefined, answer: { ok: boolean; content: string }): DoneWords {
	const a = rawArgs ?? {};
	const content = String(answer?.content ?? "");
	const usd = chargedIn(content);
	const out = (done: Phrase): DoneWords => (usd > 0 ? { done, usd } : { done });
	// (a call that only looked has no row of its own: it is one of a run of reads)
	const w = wordsFor(tool, a);
	if (w.read && !w.own) return out(readsRow([w.about ?? "project"]));
	switch (tool) {
		case "project":
		case "create_project":
		case "open_project":
		case "rename_project":
		case "save_project":
		case "close_project":
		case "project_settings": {
			const action = tool === "project" ? str(a.action) : tool === "project_settings" ? "settings" : tool.replace(/_project$/, "");
			const name = shortName(a.name, 32);
			if (action === "create") return out(name ? P("Created the project «{name}»", { name }) : P("Created a project"));
			if (action === "open") return out(P("Opened the project"));
			if (action === "rename") return out(name ? P("Renamed the project to «{name}»", { name }) : P("Renamed the project"));
			if (action === "settings") return out(P("Changed the project's format"));
			if (action === "save") return out(P("Saved the project"));
			if (action === "close") return out(P("Closed the project"));
			if (action === "notes") return out(P("Wrote down the brief"));
			return out(P("Worked on the project"));
		}
		case "memory": {
			const name = shortName(a.name, 28);
			if (a.action === "voice") return out(name ? P("Remembered the voice «{name}»", { name }) : P("Remembered a voice"));
			return out(name ? P("Remembered the character «{name}»", { name }) : P("Remembered a character"));
		}
		case "taste_profile":
			return out(P("Updated your style"));
		case "analyze":
		case "beat_markers":
			return out(P("Marked the beats"));
		case "check_cuts": {
			const n = /(\d+)\s+(?:cut|issue|problem)s?\b/i.exec(content)?.[1];
			return out(n ? P("Checked the cuts: {n} to fix", { n: Number(n) }) : P("Checked the cuts"));
		}
		case "review": {
			const score = /\b(\d{1,3})\s*(?:\/|of|out of)\s*100\b/i.exec(content)?.[1];
			return out(score ? P("Review: {score} of 100", { score: Number(score) }) : P("Reviewed the edit"));
		}
		case "post": {
			const where = (Array.isArray(a.platforms) ? a.platforms : []).map((x) => POSTS[String(x)] ?? "").filter(Boolean).join(", ");
			return out(where ? P("Posted to {where}", { where }) : P("Posted"));
		}
		case "import_media": {
			if (Array.isArray(a.paths) && a.paths.length) return out(one(a.paths.length, P("Added a file"), P("Added {n} {n|file|files}", { n: a.paths.length })));
			if (a.youtube) return out(P("Downloaded from YouTube"));
			if (a.image) return out(P("Added a picture from the web"));
			return out(P("Added files"));
		}
		case "import_file":
			return out(P("Added a file"));
		case "youtube":
			return out(P("Downloaded from YouTube"));
		case "web_image":
			return out(P("Added a picture from the web"));
		case "place": {
			const items = list(a.items).length ? list(a.items) : [a];
			const kinds = new Set(items.map(placedKind));
			if ([...kinds].every((x) => x === "music" || x === "sound")) return out(soundsDone(items));
			if (kinds.size !== 1) return out(P("Placed {n} {n|thing|things} on the timeline", { n: items.length }));
			const k = [...kinds][0];
			const n = items.length;
			if (k === "clip") return out(one(n, P("Placed a clip"), P("Placed {n} {n|clip|clips}", { n })));
			if (k === "title") {
				const name = shortName(items[0].text, 32);
				return out(name && n === 1 ? P("Title «{name}»", { name }) : one(n, P("Added a title"), P("Added {n} {n|title|titles}", { n })));
			}
			if (k === "music" || k === "sound") return out(soundsDone(items));
			if (k === "graphics") return out(one(n, P("Added graphics"), P("Added {n} graphic {n|layer|layers}", { n })));
			if (k === "transition") return out(one(n, P("Added a transition"), P("Added {n} {n|transition|transitions}", { n })));
			if (k === "look") return out(P("Applied a colour look"));
			if (k === "effect") return out(one(n, P("Added an effect"), P("Added {n} {n|effect|effects}", { n })));
			return out(one(n, P("Added a sticker"), P("Added {n} {n|sticker|stickers}", { n })));
		}
		case "edit": {
			const groups = [...editGroups(list(a.ops))];
			if (!groups.length) return out(P("Edited"));
			const [first, ...more] = groups.slice(0, 2).map(([g, x]) => groupDone(g, x.n, x.ops));
			const rest = groups.slice(2).reduce((sum, [, x]) => sum + x.ops.length, 0);
			const then = [...more, ...(rest ? [P("and {n} more", { n: rest })] : [])];
			return out(then.length ? { ...first, then } : first);
		}
		case "apply_plan":
			return out(P("Edited by the plan"));
		case "fit_music":
			return out(P("Fitted the music"));
		case "fix_sound":
			return out(P("Cleaned the sound"));
		case "motion_layer": {
			const props = (a.props && typeof a.props === "object" ? a.props : a.fields && typeof a.fields === "object" ? a.fields : {}) as Args;
			const name = shortName(props.title ?? props.text ?? props.headline ?? a.prompt, 32);
			return out(name ? P("Graphics «{name}»", { name }) : P("Made graphics"));
		}
		case "ai_template":
			return out(generated("design", a));
		case "scenes":
			return out(SCENES_DONE[str(a.action)] ?? P("Changed the scenes"));
		case "undo": {
			const n = Number(/(\d+) calls/.exec(content)?.[1] ?? 1);
			if (a.redo) return out(one(n, P("Brought its step back"), P("Brought back {n} of its {n|step|steps}", { n })));
			return out(one(n, P("Took its step back"), P("Took back {n} of its {n|step|steps}", { n })));
		}
		case "generate": {
			if (Array.isArray(a.items) && a.items.length) return out(one(a.items.length, P("Generated a shot"), P("Generated {n} {n|shot|shots}", { n: a.items.length })));
			return out(generated(str(a.kind), a));
		}
		case "ai_generate":
			return out(generated(a.kind === "image" ? "image" : "video", a));
		case "generate_voice":
			return out(generated("voice", a));
		case "lipsync":
		case "revoice":
		case "dub":
		case "face_swap":
			return out(generated(tool, a));
		case "export":
		case "export_project":
		case "export_media": {
			const name = shortName(fileIn(content) || a.name, 34);
			return out(name ? P("Export «{name}»", { name }) : P("Exported"));
		}
		default: {
			const op = tool === "set_element" ? "set" : tool;
			const g = groupOf(op, a);
			if (g !== "none") return out(groupDone(g, amount(op, a), [{ ...a, op }]));
			const own = firstSentence(content, 72);
			return out(own ? P("{text}", { text: own }) : P("Done"));
		}
	}
}

/** A run of reads as one quiet row: named by its kind when they are all of one, else «Looked at the project». */
export function readsRow(kinds: ReadKind[]): Phrase {
	const one = new Set(kinds).size === 1 ? kinds[0] : null;
	if (one === "frames") return P("Looked at frames");
	if (one === "footage") return P("Heard and watched the footage");
	if (one === "library") return P("Searched the library");
	if (one === "price") return P("Priced the plan");
	if (one === "check") return P("Checked the edit");
	if (one === "project") return P("Read the project");
	return P("Looked at the project");
}

/** An op's own tool name (surface.ts), for the tests that walk every step of `edit`. */
export { opTool };
