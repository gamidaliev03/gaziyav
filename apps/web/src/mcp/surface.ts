// The tools Claude sees (MCP tools/list): a few strong ones instead of sixty small ones. `edit` runs a list of editing
// steps in one call (each step is one of the editor's own operations, one ⌘Z each), `find_content` searches every
// library and source, `generate` makes every paid or on-device AI thing, `price_plan` prices a plan against the budget.
// Every older tool name still works when called (it is routed to the same code), it is only not listed.
// Pure data + small helpers: the bridge (bridge.tsx) runs them.

import { EDITION } from "@/edition/cuts";

/** The owner's own edition has no sticker packs (src/edition/cuts.ts): no `sticker` kind, no add_graphic step, no
 * «sticker:…» item in the words Claude reads. */
export const STICKERS = EDITION.stickers;
const noStickers = (text: string) => (STICKERS ? text : text.replace(/, "sticker:…"/g, "").replace(/ "sticker:…",/g, "").replace(/, sticker(?=,)/g, ""));
export const NO_STICKERS = "Stickers are not part of Gaziyav (removed 11.11 by the owner): use motion (find_content kind motion: callouts, badges, arrows, CTAs), a text design, or a picture instead.";

const S = (description: string) => ({ type: "string", description });
const N = (description: string) => ({ type: "number", description });
const B = (description: string) => ({ type: "boolean", description });
const E = (values: readonly string[], description: string) => ({ type: "string", enum: [...values], description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

/** The steps `edit` takes: the op name is the editor operation (the older tool of the same name). */
export const EDIT_OPS = [
	"place", "camera", "add_media", "add_text", "add_text_style", "add_sound", "add_graphic", "add_motion", "captions",
	"split", "trim", "move", "delete", "duplicate", "reorder", "cut_out", "remove_pauses",
	"set", "keyframes", "speed", "freeze_frame", "reverse",
	"add_transition", "add_effect", "set_effect", "apply_filter", "auto_color",
	"beat_markers", "split_scenes", "make_vertical", "track", "follow", "ai_effect", "action", "playhead", "split_parts",
] as const;
export type EditOp = (typeof EDIT_OPS)[number];

/** An op's own tool: `set` is set_element, the rest keep their names. */
export const opTool = (op: string) => (op === "set" ? "set_element" : op);

const EDIT_DOC = `Change the open project: a list of steps run in order (each one ⌘Z; stops at the first error and says which steps were done). Times are timeline seconds; "$1" in a step = the id step 1 made, "$prev" = the step before's, and a step with as:"s18" is "$s18" later. The main track has no gaps: a clip placed or moved there stands after the one before; a free place is a track above (track:"new").
Steps ({op, …}):
- place {item, at?, on?, text?, duration?, fields?} anything from find_content (item "music:…", "text:…", "motion:…", "transition:…", "filter:…", "effect:…", "sticker:…", "template:…", "local:/path", "image:…", "stock:…") or media {media, at, duration?, sourceFrom?, track?:"main"}; a plain title: {text, at}
- captions {style?, language?} word-timed captions from the speech (on this Mac)
- split {time, ids?} · trim {id, start?, end?, closeGap?, exact?} · move {id, start?, track? "new"|id} · delete {ids, closeGap?} · duplicate {ids} · reorder {id, index}
- cut_out {ranges:[{from,to}]} every track, gaps closed · remove_pauses {id} silences and fillers (captions and titles follow; music is not cut)
- set {id|ids, params} keys from get_project {id}: volume dB, pan, fadeIn, fadeOut, duckUnderVoice, fx.denoise|fx.voice|fx.compressor… true, fx.voice.bands "voice"|"podcast"; transform.positionX/Y (px from the centre, +Y down), transform.scaleX/Y (1 = fitted to the frame), transform.rotate, opacity, blendMode; content, color, fontSize (frame-height units: 3 small, 5 title, 8 big, 12 max), fontFamily; anim.in/out fade|pop|rise|drop|slam (text), anim.inDuration; mask "ellipse"|"rectangle"|"heart"|"split"|"none", mask.feather
- keyframes {id, key, points:[{time,value}], interpolation?} · camera {id, move push_in|pull_out|pan_left|pan_right|tilt_up|tilt_down|ken_burns|shake|punch_in, amount?, from?, to?}
- speed {id, rate?, keepPitch?, opticalFlow?} · freeze_frame {id, at?} · reverse {id}
- set_effect {id, effect, params?, remove?} · auto_color {id} · beat_markers {id} · split_scenes {id} · make_vertical {ids?, aspect?} · track {id, kind? face|object, effect? blur|pixelate} · follow {id, clip}
- ai_effect {id, kind} free, on this Mac: remove_background, blur_background, enhance, denoise, upscale_2x, retouch, deflicker, enhance_voice, separate_voice, voice_changer {params:{voice}}
- split_parts {id, solo?} a song's four parts (vocals, drums, bass, other) as muted tracks under it, in sync; solo "drums"|…|"mix"
- action {name, ids?} create-compound, dismiss-compound, group-selected, mirror-selected, reset-transform, toggle-source-audio, split-left, split-right, extract-in-out, lift-in-out`;

const FIND_KINDS = ["transition", "effect", "filter", "text", "caption", "motion", "template", "sticker", "music", "sound", "voice", "local", "youtube", "image", "stock", "facts"] as const;
/** The kinds find_content offers in this edition. */
const FIND_KINDS_SHOWN = STICKERS ? FIND_KINDS : FIND_KINDS.filter((k) => k !== "sticker");
/** The steps the edit tool offers in this edition (add_graphic is the sticker packs' step). */
const EDIT_OPS_SHOWN = STICKERS ? EDIT_OPS : EDIT_OPS.filter((op) => op !== "add_graphic");

const GENERATE_KINDS = ["image", "video", "voice", "lipsync", "revoice", "dub", "face_swap", "design"] as const;

export const SURFACE = [
	{
		name: "project",
		description: "Projects: list | create {name, aspect 9:16|16:9|1:1|4:5} (opens it) | open {id} | rename {name} | settings {aspect?, fps?, resolution?} | save | close | notes {notes} (this project's brief a later chat reads first: intent, platform, preset, decisions, what is left). Start every job here, then get_project.",
		parameters: obj({ action: E(["list", "create", "open", "rename", "settings", "save", "close", "notes"], "What to do"), id: S("Project id (open)"), name: S("Name (create, rename)"), aspect: S("9:16 | 16:9 | 1:1 | 4:5"), fps: N("24 | 25 | 30 | 50 | 60 (settings)"), resolution: N("Short side px: 720 | 1080 | 1440 | 2160 (settings)"), notes: S("The project brief, ≤ 1500 characters (notes)") }, ["action"]),
		annotations: { title: "Projects" },
	},
	{
		name: "get_project",
		description: "Read the open project: the brief and cast, what the user selected and the playhead, then the tracks with clip ids and times, the media (newest first). Once per chat; after that since:<rev> gives only what changed (clips and new Media, and who changed it: you or the user). Every answer ends with [rev N]. id: one clip in one line (detail:true: every key `edit set` takes); track: all clips of one track; media:\"new\": the Media added lately, newest first (\"all\": every item); detail:true alone: the full JSON.",
		parameters: obj({ since: N("A revision: only the changes after it"), id: S("Element id or reference: one line (detail:true: its settings)"), track: S("Track id: all its clips"), media: E(["new", "all"], "The Media list: new = added lately, newest first"), detail: B("Full JSON / an element's settings") }),
		annotations: { title: "Read the project", readOnlyHint: true },
	},
	{
		name: "look",
		description: "See what the user sees. frames: the preview at up to 8 times (at); playback: frames over from..to in one picture (pacing, motion); timeline; media: the Media pictures, newest first (ids: just those; count/offset: a page of the newest); media + one id + at = that file's own frames at its seconds. Small pictures (size:large to read small text). Look before saying it is done.",
		parameters: obj({ what: E(["frames", "playback", "timeline", "media"], "Default frames"), at: { type: "array", items: { type: "number" }, description: "Seconds" }, from: N("Seconds (playback)"), to: N("Seconds (playback)"), count: N("Strip frames 4–16; media: how many (default 24)"), ids: { type: "array", items: { type: "string" }, description: "Media ids (media): only these" }, offset: N("media: skip this many of the newest"), size: E(["small", "large"], "Default small") }),
		annotations: { title: "Look", readOnlyHint: true },
	},
	{
		name: "analyze",
		description: "Read the sound and speech before cutting (text, not pictures): words = what is said as numbered phrases with times (retakes, false starts); audio = the audio map (pauses, loudness, music, ranked cut points; picture:true adds one small waveform picture); cut_points = the best frame-exact cut near `at` or after word #n; beats = the music's beats as timeline markers; music = the song's score by parts (stems separated on this Mac): tempo and bars, sections, which parts (vocals, drums, bass, other) sound in every run of bars, sung phrases with their words, where the voice is silent and the drums stop, strongest hits; from/to ≤ 40 s = every bar, hit and word (ask it before cutting to a song; the first time may answer «still running»: send the same call again). id: a clip or a Media id; from/to: only that range. The whole material at once: analyze_material.",
		parameters: obj({ what: E(["words", "audio", "cut_points", "beats", "music"], "What to read"), id: S("Clip id or Media id (default: the whole timeline)"), from: N("Seconds"), to: N("Seconds"), at: N("cut_points: near this time"), after: N("cut_points: after word #n"), picture: B("audio: one small picture too") }, ["what"]),
		annotations: { title: "Analyze", readOnlyHint: true },
	},
	{
		name: "find_content",
		description: noStickers(`Find anything to use, by kind and words. Library: transition, effect, filter (colour looks), text (title designs), caption (caption styles), motion (animated templates: lower thirds, CTAs, counters…), template (multi-layer packs), sticker, music, sound (whoosh, pop, riser…), voice (ready voices). Sources: local (the user's files on this Mac), stock (free stock video for B-roll), youtube, image (free web pictures), facts (Wikipedia, for true facts on screen). Each hit is an item id for place.`),
		parameters: obj({ kind: E(FIND_KINDS_SHOWN, "What to look for"), query: S("English words, e.g. 'whip', 'warm film', 'lower third', 'upbeat pop', 'whoosh'; empty = the first ones") }, ["kind"]),
		annotations: { title: "Find content", readOnlyHint: true },
		examples: [{ kind: "music", query: "upbeat pop" }, { kind: "stock", query: "city night" }, { kind: "local", query: "interview" }],
	},
	{
		name: "import_media",
		description: "Bring files into Media (nothing goes on the timeline): paths of the user's files (find_content local), a YouTube link (from/to = only that piece), a web picture (image query, pick = result index). Returns the media ids for edit add_media.",
		parameters: obj({ paths: { type: "array", items: { type: "string" }, description: "Absolute paths" }, youtube: S("YouTube link"), from: N("Seconds into the YouTube video"), to: N("Seconds"), image: S("Web picture to find and import"), pick: N("Which result, default 0") }),
		annotations: { title: "Import media", openWorldHint: true },
	},
	{
		name: "place",
		description: noStickers('Put things on the timeline: one item or several (items). item = an id from find_content ("music:…", "sound:…", "text:<style>" + text, "motion:<kind>" + fields, "template:…", "transition:…" at a cut, "filter:…"/"effect:…" on a clip or "all", "sticker:…", "local:/path", "image:<query>#n", "stock:…" — imported first when needed) or media (a Media id) or a plain text title. Same as edit op place.'),
		parameters: obj({ item: S("From find_content"), media: S("Media id"), text: S("Words (titles)"), at: { type: "number", description: "Timeline seconds (default: the playhead)" }, duration: N("Seconds"), on: S("Clip id, a word ('selected', 'clip 2') or 'all' (filters, effects)"), fields: { type: "object", description: "Template fields / effect params" }, track: S("'main' for the main video track"), sourceFrom: N("Seconds into the file (media)"), items: { type: "array", items: { type: "object" }, description: "Several: [{item, at, …}, …]" } }),
		annotations: { title: "Place" },
		examples: [{ item: "text:hook-bold", text: "3 MISTAKES", at: 0, duration: 2.5 }, { items: [{ item: "transition:whip", at: 4.2 }, { item: "sound:whoosh-1", at: 4.1 }] }],
	},
	{
		name: "edit",
		description: `${noStickers(EDIT_DOC)}
Targets: an id, or words: "selected" (what the user selected), "playhead" for a time, "music", "voice", "captions" (all of them), "title" / "title at 0:05", "text at 5", "clip 2" / "second clip" / "last clip", "clip at 0:12". Numbers may be relative: "+=3", "-=3", "*=1.2", "+=20%" (set). Colour of a clip: add_effect {id, type:"studio.color", params:{exposure, contrast, saturation, temperature…}} (get_project {id} after shows its keys).`,
		parameters: obj(
			{
				ops: {
					type: "array",
					minItems: 1,
					maxItems: 80,
					items: { type: "object", properties: { op: E(EDIT_OPS_SHOWN, "The step") }, required: ["op"] },
					description: "Steps, each {op, …its args}",
				},
			},
			["ops"],
		),
		annotations: { title: "Edit", destructiveHint: false },
		examples: [{ ops: [{ op: "set", id: "title at 0:01", params: { fontSize: "*=1.3" } }, { op: "set", id: "music", params: { volume: "-=3" } }, { op: "delete", ids: ["clip 2"], closeGap: true }] }, { ops: [{ op: "split", time: 3.2 }, { op: "camera", id: "clip 1", move: "push_in", amount: 0.08 }] }],
	},
	{
		name: "motion_layer",
		description:
			"Remotion motion graphics as an editable layer: a ready template (kind from find_content motion, fields = its texts), a kit layer (kind HookTitle | LowerThird | Counter | CTA | Plate | Card | Badge | PriceCard | ProgressBar | Finish + props), or your own component (code: TSX exporting `component`, props: data for it). id + new code/props updates a layer. It checks the code and the rendered frames and returns them; read the error, fix, send again. editing_guide topic:motion has the rules and patterns.",
		parameters: obj({ kind: S("Template or kit kind"), prompt: S("Or describe a plate and Gaziyav AI designs it (uses its AI)"), code: S("TSX of your component (own layer)"), component: S("The component's name, PascalCase"), props: { type: "object", description: "Fields / props (numbers, strings, booleans, arrays, objects)" }, start: N("Seconds, default the playhead"), duration: N("Seconds"), track: S("'new' (default: a track on top) or a track id"), id: S("Existing layer to update"), name: S("Layer name") }),
		annotations: { title: "Motion layer" },
	},
	{
		name: "generate",
		description:
			"Make with AI. Everything here is paid on the user's fal.ai / kie.ai / ArgoLink key (a voice too: cents, by characters) — it runs while the provider's balance covers it (or within a budget the user named for this video) and says what it charged; a repeat of the same paid call within 30 min returns that result, nothing charged (again:true = a new take). quote:true = the price only. kind: image {prompt, refs?|cast? (edits/follows those pictures)} · video {prompt, mode? text|image (from = first frame)|frames (from + end)|reference (refs/cast, several)|motion (from photo + clip)|edit (clip)|avatar (from photo + sound: a timeline audio clip id = only its trimmed piece is sent and billed, or a Media sound + soundFrom/soundTo)|extend (clip, the scene goes on), duration?, aspect?, quality?, seed?, negative?, audio?} — a video's answer ends with next: from:'<media id>@last' to start the next shot from (from:'<clip id>@last' = a timeline clip's last frame) · model:'cheapest' picks the cheapest model that takes the inputs and says which · voice {text, speaker? or cast, start?} · lipsync {id, sound:'timeline'} (the song or voice under the clip drives the lips) | {id, sound:'<audio media or timeline clip id>', soundFrom?, soundTo?} | {id, text, speaker?}; model = a lipsync model id or 'cheapest' (default: the one in Settings); one clip a call, the result keeps the clip's place and length · revoice {id, text} · dub {id, language, lipsync?} · face_swap {id, face|photo+consent} · design {prompt}. price_plan {kind:'video'} lists which model takes which inputs. Results go to Media and (place:false = only Media) the timeline at start. items:[{…one shot's arguments}, … up to 8] starts every shot at once (the other arguments are shared): one answer within 45 s with what finished and what still runs (the same call again collects the rest, nothing runs twice).",
		parameters: obj({ kind: E(GENERATE_KINDS, "What to make"), prompt: S("What to make (image, video, design)"), text: S("Words (voice, lipsync, revoice)"), id: S("Clip id (lipsync, revoice, dub, face_swap)"), model: S("Model id from price_plan, or 'cheapest' (the cheapest model that takes these inputs)"), mode: S("video: text | image | frames | reference | motion | edit | avatar | extend"), duration: N("Seconds (video)"), aspect: S("9:16 | 16:9 | 1:1…"), quality: S("480p | 720p | 1080p (video)"), from: S("Media picture id(s): the start frame / the photo; '<clip id>@last' = that clip's last frame"), end: S("Media picture id: the last frame (frames)"), refs: { type: "array", items: { type: "string" }, description: "Media picture ids: references" }, cast: { type: "array", items: { type: "string" }, description: "Cast names (project cast): their pictures / voice" }, clip: S("Media or timeline clip id (motion, edit, extend)"), sound: S("avatar / lipsync: 'timeline' (the sound under the clip), a timeline audio clip id (its trimmed piece) or a Media sound id"), soundFrom: N("Seconds into a Media sound (its piece only)"), soundTo: N("Seconds into a Media sound"), again: B("A new take of a call already made (otherwise a repeat within 30 min returns that result, free)"), seed: N("Seed (the same look again)"), negative: S("What to avoid"), audio: B("Video with its own sound"), language: S("dub: en, es, de, fr, ru…"), lipsync: B("dub: also move the lips"), speaker: S("voice: a ready voice (find_content voice)"), style: S("voice: excited, calm, whisper…"), face: S("face_swap: hero | diva | rebel | noir | elf | viking | idol | sage | android"), photo: S("face_swap: Media photo id of a real person"), consent: B("face_swap: that person agreed (ask the user)"), start: N("Timeline seconds"), place: B("Put it on the timeline (default true)"), quote: B("Only the price, nothing is spent"), items: { type: "array", maxItems: 8, items: { type: "object" }, description: "Several shots at once: [{prompt, from?, start?, …}, …] (each one a generate of its own)" } }, ["kind"]),
		annotations: { title: "Generate", openWorldHint: true },
	},
	{
		name: "price_plan",
		description:
			"Money first. No items: this video's spend, budget and the balances. items: the planned generations → the exact price of each and the total, each provider's balance, this video's budget, spent and left, and whether it fits. model:'cheapest' picks the cheapest model that can do it. budget: the user's budget for this video (save it when the user names one). kind (+ mode): the models of that kind with prices.",
		parameters: obj({
			items: {
				type: "array",
				items: obj({ kind: E(["image", "video", "voice", "lipsync", "face_swap"], "What"), model: S("Model id or 'cheapest'"), mode: S("video: text | image (from a picture) | frames | reference | motion | avatar"), duration: N("Seconds (video, lipsync, face_swap)"), quality: S("video: 480p | 720p | 1080p"), aspect: S("9:16 | 16:9 | 1:1"), count: N("How many, default 1"), chars: N("voice: characters of text"), audio: B("video: with sound"), refs: N("Reference pictures with it (cast photos, a style)") }, ["kind"]),
				description: "Planned generations",
			},
			budget: N("This video's budget in US dollars (the user's words)"),
			kind: E(["image", "video", "voice", "lipsync", "face_swap"], "No items: list the models of this kind"),
			mode: S("With kind video: only the models that take this mode (text | image | frames | reference | motion | avatar | extend)"),
		}),
		annotations: { title: "Price a plan", readOnlyHint: true },
		examples: [{ budget: 5, items: [{ kind: "image", model: "cheapest", count: 6 }, { kind: "video", mode: "image", duration: 5, quality: "720p", count: 2 }] }],
	},
	{
		name: "export",
		description: "Render the open project to a file and say where it is. platform sets size, quality and loudness; or set quality, resolution (short side px), fps, format. from/to = only that range; cover = seconds on the timeline (or a Media picture id): that frame goes before the video as the file's first 0.1 s (the picture platforms show).",
		parameters: obj({ platform: S("tiktok | reels | shorts | youtube | feed | vk | telegram"), quality: S("low | medium | high | very_high"), resolution: N("720 | 1080 | 1440 | 2160"), fps: N("24 | 25 | 30 | 50 | 60"), format: S("mp4 | mov | webm"), from: N("Seconds"), to: N("Seconds"), loudness: B("Bring the sound to −14 LUFS (on with a platform)"), cover: S("Seconds of the timeline or a Media picture id"), name: S("File name without extension"), folder: S("Absolute folder (default ~/Movies/Gaziyav)") }),
		annotations: { title: "Export", openWorldHint: false },
	},
	{
		name: "post",
		description:
			"Publish the open project through Share → Post to the user's connected accounts (YouTube Shorts, Instagram Reels, TikTok). Without confirm it checks everything and says exactly what would go out (nothing is posted): show that to the user once; after their yes send it again with confirm:true: it renders, posts and returns each link. check:true = the state of recent posts.",
		parameters: obj({ platforms: { type: "array", items: E(["youtube", "instagram", "tiktok"], "Platform"), description: "Default: every connected account" }, title: S("Title (YouTube)"), description: S("Description / caption"), hashtags: S("Hashtags, e.g. '#travel #sunset'"), privacy: E(["public", "unlisted", "private"], "Default public"), at: S("Schedule: ISO time (default now)"), cover: S("Seconds of the timeline or a Media picture id: the first frames"), vertical: B("Post a 9:16 copy of a non-vertical project"), confirm: B("The user said yes: post now"), check: B("Only report recent posts") }),
		annotations: { title: "Post", openWorldHint: true, destructiveHint: true },
	},
	{
		name: "memory",
		description: "What Gaziyav remembers about this user across projects (you got it on connect): read | cast {name, images:[Media picture ids], description?, voice?} keeps a character for every project (generate {cast:[name]} uses its pictures) | voice {name, speaker} names a ready voice. remove:true forgets one. The brand kit, platform, preset and budget are the taste profile: taste_profile {set}.",
		parameters: obj({ action: E(["read", "cast", "voice"], "What to do"), name: S("Character / voice name"), images: { type: "array", items: { type: "string" }, description: "Media picture ids (cast)" }, description: S("Who the character is, how they look (cast)"), voice: S("cast: a ready voice id"), speaker: S("voice: a ready voice id"), remove: B("Forget it") }),
		annotations: { title: "Memory" },
	},
	{
		name: "scenes",
		description: `The film's scenes (a scene = its mark to the next), by number or title; each change is one ⌘Z. list · find {apply?} (cuts, pauses snapped to the picture change, topics; free; no titles) · rename {titles:[all, in order]} or {scene, title} · move {scene, before|after|to}: its clips, captions, titles and sounds go with it, music beds stay, length kept · merge {scene} (with the next) · split {at, title?} · delete {scene} (with its part of the film) · duplicate · color · copy {scene, name?} (a compound clip in Media) · youtube (chapter lines: ask after the last change)`,
		parameters: obj({
			action: E(["list", "find", "move", "rename", "merge", "split", "delete", "duplicate", "color", "copy", "youtube"], "Default list"),
			scene: S("Number or title"),
			before: S("move"),
			after: S("move"),
			to: N("move: place, 1 = first"),
			title: S("rename / split"),
			titles: { type: "array", items: { type: "string" }, description: "rename: all, in order" },
			at: S("split: seconds or playhead"),
			color: S("#RRGGBB"),
			name: S("copy"),
			apply: B("find: false = only propose"),
		}),
		annotations: { title: "Scenes" },
	},
	{
		name: "undo",
		description: "Take back your last tool call(s) (a whole edit call at once), or redo them. Refuses when the user changed the project since, so their work is never undone.",
		parameters: obj({ steps: N("Calls to take back, default 1"), redo: B("Redo instead") }),
		annotations: { title: "Undo" },
	},
] as const;

/** Tools listed under other names before: still callable, routed to the same code. */
export const LEGACY_PROJECT: Record<string, string> = {
	list_projects: "list",
	create_project: "create",
	open_project: "open",
	rename_project: "rename",
	save_project: "save",
	close_project: "close",
};

/** Agent tools that are reached through the listed tools now (not listed themselves). */
export const UNLISTED = new Set([
	...Object.keys(LEGACY_PROJECT),
	"export_project", "export_media", "get_element", "list_effects", "list_transitions", "find_sound", "find_graphic", "local_files", "import_file",
	"youtube", "web_image", "web_search", "ai_models", "ai_generate", "generate_voice", "lipsync", "revoice", "dub", "face_swap", "ai_template",
	"project_settings", "transcript", "listen", "cut_point", "hear_music", "camera", "playhead", ...EDIT_OPS.map(opTool),
]);

/** What each analyze {what} runs (the hearing and material tools keep their own names too). */
export const ANALYZE: Record<string, string> = { words: "transcript", audio: "listen", cut_points: "cut_point", beats: "beat_markers", music: "hear_music" };

export const GENERATE_TOOL: Record<(typeof GENERATE_KINDS)[number], string> = {
	image: "ai_generate",
	video: "ai_generate",
	voice: "generate_voice",
	lipsync: "lipsync",
	revoice: "revoice",
	dub: "dub",
	face_swap: "face_swap",
	design: "ai_template",
};

/** What each find_content kind runs when it isn't a library of content-tools.ts. */
export const FIND_SOURCES: Partial<Record<(typeof FIND_KINDS)[number], string>> = {
	local: "local_files",
	youtube: "youtube",
	image: "web_image",
	facts: "web_search",
};

/** Calls that change nothing: no undo bookkeeping, no «the user changed it» note. */
export const READ_ONLY = new Set(["analyze", "memory_read", "get_project", "get_element", "look", "transcript", "find_content", "price_plan", "editing_guide", "list_projects", "local_files", "web_search", "ai_models", "list_effects", "list_transitions", "find_sound", "find_graphic", "listen", "analyze_material", "review", "cut_point"]);

/**
 * Calls that change nothing (no undo bookkeeping), so they may run beside others. review {fix:true} changes the
 * project: counted as read-only it left no step for `undo`, which then refused Claude's own fix as «the user changed
 * the project» (exam 11.11, three briefs).
 */
export function readOnlyCall(tool: string, args: Record<string, unknown>): boolean {
	return (READ_ONLY.has(tool) && !(tool === "analyze" && args.what === "beats") && !(tool === "review" && args.fix === true)) || (tool === "project" && args.action === "list") || (tool === "post" && args.confirm !== true) || (tool === "generate" && args.quote === true) || (tool === "memory" && (args.action ?? "read") === "read") || (tool === "scenes" && ["list", "youtube"].includes(String(args.action ?? "list"))) || (tool === "scenes" && args.action === "find" && args.apply === false);
}

// Long steps (an AI generation, a render, a download, the first look at new material) run in the background: the
// window takes Claude's next call at once, so reading the project or pricing the next shot never waits minutes behind
// them (10.11: one lipsync held every call for minutes and Claude's client gave each up after 60 s). Plain reads of
// data run at once too. Changes to the project and anything that uses the player (frames, review) run one at a time.
const BACKGROUND = new Set(["generate", "export", "post", "import_media", "analyze_material"]);
const DATA_READS = new Set(["get_project", "get_element", "price_plan", "find_content", "memory", "project", "transcript", "taste_profile"]);
export const laneOf = (tool: string, args: Record<string, unknown>): "background" | "foreground" => (BACKGROUND.has(tool) || (DATA_READS.has(tool) && readOnlyCall(tool, args)) ? "background" : "foreground");
/** Calls that go to another page or project: nothing else is taken while one runs. */
export const navigates = (tool: string, args: Record<string, unknown>) => (tool === "project" && ["open", "create", "close"].includes(String(args.action))) || ["open_project", "create_project", "close_project"].includes(tool);

/** The arguments a listed tool takes (an unknown one is refused with this list instead of being dropped). */
export function knownArgs(tool: string): string[] | null {
	const t = SURFACE.find((x) => x.name === tool);
	return t ? Object.keys((t.parameters as { properties: Record<string, unknown> }).properties) : null;
}
