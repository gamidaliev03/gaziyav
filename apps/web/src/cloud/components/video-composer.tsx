"use client";

// AI video (Media → Generate → AI video): every mode of fal's video generators on the user's own key — text, a start
// frame, first + last frame, reference pictures, motion control, a clip changed by a description, a talking photo.
// One compact form: the mode, only the inputs that mode needs (from Media, the selected timeline clip or a file), the
// model with its price, the settings it takes, the price of this run live, one Generate button.
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@/components/ui/icon";
import { Settings01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { openFalSettings, useKeys } from "@/fal/client";
import { usd } from "@/fal/models";
import { lengthFromInput, priceParts, takesPrompt, type VideoMode, type VideoModel, type VideoOptions, videoDefaults, videoDefaultsOf, videoModel, videoModelsFor, videoModes, videoProblem } from "@/fal/video";
import { manyKeys } from "@/fal/video";
import { useT } from "@/i18n";
import type { TimelineElement } from "@/timeline";
import { cn } from "@/utils/ui";
import { TICKS_PER_SECOND } from "@/wasm";
import { type PointInput, pointUpload, usePoint } from "../client";
import { ActiveJobLine } from "./active-job";

type SourceType = "image" | "video" | "audio";

/** An input of a generation: a Media file, the selected timeline clip (its piece, taken when picked) or a file from the Mac. */
type Source =
	| { from: "media"; id: string }
	| { from: "clip"; elementId: string; trackId?: string; mediaId: string; name: string; type: SourceType; trim?: { from: number; length: number } }
	| { from: "file"; file: File; seconds?: number };

const PLACEHOLDERS: Record<VideoMode, string> = {
	text: "What happens in the shot: subject, action, camera, light, style…",
	image: "How the picture moves: action, camera, mood…",
	frames: "What happens between the two frames…",
	reference: "The new scene with your subjects or style…",
	motion: "Optional: the scene, the look, the light…",
	edit: "What to change: «anime style», «a sunset sky», «winter»…",
	avatar: "Optional: the mood, gestures, camera…",
	extend: "What happens next: the action, the camera, the mood…",
};

/** The selected clip of the timeline that has a file (video, picture or sound), with the piece the timeline plays. */
function selectedClip(editor: EditorCore): { element: TimelineElement & { mediaId: string }; trackId: string; type: SourceType; from: number; length: number } | null {
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return null;
	const picked = new Set(editor.selection.getSelectedElements().map((s) => s.elementId));
	if (!picked.size) return null;
	for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio]) {
		for (const element of track.elements as TimelineElement[]) {
			const mediaId = (element as { mediaId?: unknown }).mediaId;
			if (!picked.has(element.id) || typeof mediaId !== "string") continue;
			if (element.type !== "video" && element.type !== "image" && element.type !== "audio") continue;
			return { element: element as TimelineElement & { mediaId: string }, trackId: track.id, type: element.type, from: element.trimStart / TICKS_PER_SECOND, length: element.duration / TICKS_PER_SECOND };
		}
	}
	return null;
}

/** Whether a source of `type` can be taken from a file of `kind` (a sound also comes from a clip's own sound). */
const fits = (type: SourceType, kind: string) => kind === type || (type === "audio" && kind === "video");

/** A source's name and seconds now (the price before anything is uploaded). */
function describe(editor: EditorCore, s: Source | null, type: SourceType): { name: string; seconds?: number } | null {
	if (!s) return null;
	if (s.from === "file") return { name: s.file.name, seconds: s.seconds };
	if (s.from === "media") {
		const a = editor.media.getAssets().find((x) => x.id === s.id);
		return a ? { name: a.name, seconds: a.duration || undefined } : null;
	}
	if (!fits(type, s.type) || !editor.media.getAssets().some((a) => a.id === s.mediaId)) return null;
	return { name: s.name, seconds: s.trim?.length };
}

/** A file's length in seconds, read by the browser (a clip or a sound picked from the Mac). */
function fileSeconds(file: File): Promise<number | undefined> {
	return new Promise((resolve) => {
		const el = document.createElement(file.type.startsWith("audio/") ? "audio" : "video");
		const url = URL.createObjectURL(file);
		const done = (v?: number) => {
			URL.revokeObjectURL(url);
			resolve(v);
		};
		el.preload = "metadata";
		el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : undefined);
		el.onerror = () => done(undefined);
		el.src = url;
		window.setTimeout(() => done(undefined), 8000);
	});
}

const ACCEPT: Record<SourceType, string> = { image: "image/png,image/jpeg,image/webp", video: "video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm", audio: "audio/*,video/mp4,video/quicktime,.mp3,.wav,.m4a,.aac" };

/** Picks an input: the selected clip, a file in Media, or a file from the Mac. */
function SourcePick({ type, value, onChange, placeholder, field, optional = false }: { type: SourceType; value: Source | null; onChange: (s: Source | null) => void; placeholder: string; field: string; optional?: boolean }) {
	const t = useT();
	const assets = useEditor((e) => e.media.getAssets().filter((a) => fits(type, a.type) && !a.ephemeral), ["media"]);
	const clipKey = useEditor((e) => {
		const c = selectedClip(e);
		return c && fits(type, c.type) ? `${c.element.id}|${c.element.name}|${c.type}` : "";
	});
	const fileInput = useRef<HTMLInputElement>(null);
	const [clipId, clipName, clipType] = clipKey.split("|");
	const current = value?.from === "media" ? `media:${value.id}` : value?.from === "clip" ? `clip:${value.elementId}` : value?.from === "file" ? "file" : "none";
	const soundOf = (kind: string, name: string) => (type === "audio" && kind === "video" ? t("Sound of {name}", { name }) : name);
	return (
		<>
			<Select
				value={current}
				onValueChange={(v) => {
					if (v === "pick-file") return fileInput.current?.click();
					if (v === "none") return onChange(null);
					if (v.startsWith("clip:")) {
						// The piece the timeline plays now (selecting something else later doesn't change it).
						const c = selectedClip(EditorCore.getInstance());
						if (c && c.element.id === v.slice(5)) onChange({ from: "clip", elementId: c.element.id, trackId: c.trackId, mediaId: c.element.mediaId, name: c.element.name, type: c.type, ...(c.type === "image" ? {} : { trim: { from: c.from, length: c.length } }) });
						return;
					}
					if (v.startsWith("media:")) return onChange({ from: "media", id: v.slice(6) });
				}}
			>
				<SelectTrigger className="h-8 text-xs" data-video-field={field}>
					<SelectValue placeholder={placeholder} />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="none" className="text-muted-foreground text-xs">
						{optional ? t("{what}: none", { what: placeholder }) : placeholder}
					</SelectItem>
					{clipId && (
						<SelectItem value={`clip:${clipId}`} className="text-xs" data-video-option="clip">
							{t("Selected clip: {name}", { name: soundOf(clipType, clipName) })}
						</SelectItem>
					)}
					{value?.from === "clip" && value.elementId !== clipId && (
						<SelectItem value={`clip:${value.elementId}`} className="text-xs">
							{t("Selected clip: {name}", { name: soundOf(value.type, value.name) })}
						</SelectItem>
					)}
					{assets.map((a) => (
						<SelectItem key={a.id} value={`media:${a.id}`} className="text-xs" data-video-option={`media:${a.name}`}>
							{soundOf(a.type, a.name)}
						</SelectItem>
					))}
					{value?.from === "file" && (
						<SelectItem value="file" className="text-xs">
							{value.file.name}
						</SelectItem>
					)}
					<SelectItem value="pick-file" className="text-xs" data-video-option="file">
						{t("From a file…")}
					</SelectItem>
				</SelectContent>
			</Select>
			<input
				ref={fileInput}
				type="file"
				accept={ACCEPT[type]}
				className="hidden"
				data-video-file={field}
				onChange={async (e) => {
					const file = e.target.files?.[0];
					e.target.value = "";
					if (!file) return;
					onChange({ from: "file", file, seconds: type === "image" ? undefined : await fileSeconds(file) });
				}}
			/>
		</>
	);
}

/** Small select for a setting (shape, length, resolution). */
function Choice({ value, options, onChange, label, field, title }: { value: string; options: string[]; onChange: (v: string) => void; label?: (v: string) => string; field: string; title: string }) {
	return (
		<Select value={value} onValueChange={onChange}>
			<SelectTrigger className="h-7 min-w-[4.5rem] flex-auto px-2 text-xs" data-video-field={field} title={title}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{options.map((o) => (
					<SelectItem key={o} value={o} className="text-xs" data-video-option={o}>
						{label ? label(o) : o}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** A per-second price with its own precision: $0.0216 · $0.07 · $0.242 (two decimals would round $0.0216 to $0.02). */
// The rate exactly as the API bills it ($0.2419/s, $0.0097/s); three digits rounded $0.2419 to $0.242.
const perSecond = (v: number) => usd(v);

const sourceKey = (s: Source | null) => (!s ? "" : s.from === "media" ? `m:${s.id}` : s.from === "clip" ? `c:${s.mediaId}:${s.trim ? `${s.trim.from.toFixed(2)}+${s.trim.length.toFixed(2)}` : ""}` : `f:${s.file.name}:${s.file.size}:${s.file.lastModified}`);

/**
 * `results`: the result cards, drawn at the end of the form's own scroller. One scroller for the whole panel: with the
 * cards under the pinned Generate bar the panel scrolled as well, and once it had scrolled down to a card the form's
 * fields sat above the panel's edge, where a wheel over them moved nothing (check-flow Reference at 1440×900, 07.11).
 */
export function VideoComposer({ onStart, results }: { onStart: ReturnType<typeof usePoint.getState>["start"]; results?: React.ReactNode }) {
	const t = useT();
	const editor = useEditor();
	const prefs = usePoint((s) => s.video);
	const setPrefs = usePoint((s) => s.setVideo);
	// A request started on the home page (the AI video tile) opens here, already typed.
	const [draft] = useState(() => {
		const d = usePoint.getState().draft;
		return d?.kind === "video" ? d : null;
	});
	useEffect(() => {
		if (draft) usePoint.getState().setDraft(null);
	}, [draft]);

	// The models of every API with a key in one list; a pick whose API has no key falls back to the default.
	const keys = useKeys();
	const both = manyKeys(keys);
	// The tabs of the APIs with a key (Extend is kie.ai's); a mode saved for a key that is gone opens as Text.
	const modes = videoModes(keys);
	const [savedMode, setModeState] = useState<VideoMode>(prefs.mode ?? "text");
	const mode: VideoMode = modes.some((m) => m.id === savedMode) ? savedMode : "text";
	const list = useMemo(() => videoModelsFor(mode, keys), [mode, keys]);
	// `kie:<mode>` is where a pick was kept while the API was a switch in Settings.
	const model: VideoModel = list.find((m) => m.id === prefs.models?.[mode]) ?? list.find((m) => m.id === prefs.models?.[`kie:${mode}`]) ?? (videoModel(videoDefaultsOf(keys)[mode]) as VideoModel);
	// A mode change shows its form from the top (the panel may have been scrolled down to a result card: the new form's
	// first fields sat above the panel's edge, and a wheel over them moved nothing — check-flow, 07.11).
	const form = useRef<HTMLDivElement>(null);
	const setMode = (m: VideoMode) => {
		setModeState(m);
		setPrefs({ mode: m });
		window.requestAnimationFrame(() => {
			form.current?.scrollTo({ top: 0 });
			form.current?.scrollIntoView({ block: "start" });
		});
	};
	const setModel = (id: string) => setPrefs({ models: { [mode]: id } });

	const [prompt, setPrompt] = useState(draft?.prompt ?? "");
	const canvas = useEditor((e) => e.project.getActiveOrNull()?.settings.canvasSize ?? null, ["project"]);
	const portrait = !canvas || canvas.height >= canvas.width;
	// Settings: what the user changed; the rest is the model's default (a new model keeps what it also offers).
	const [set, setSet] = useState<VideoOptions>({});
	const [seed, setSeed] = useState("");
	const [negative, setNegative] = useState("");
	const [more, setMore] = useState(false);
	// Inputs, kept across modes (the same photo serves Image, Motion and Avatar).
	const [start, setStart] = useState<Source | null>(null);
	const [end, setEnd] = useState<Source | null>(null);
	const [refs, setRefs] = useState<Source[]>([]);
	const [clip, setClip] = useState<Source | null>(null);
	const [sound, setSound] = useState<Source | null>(null);
	const [busy, setBusy] = useState(false);
	/** Set at once on press (state is async: a fast double click would start two paid jobs). */
	const running = useRef(false);
	/** When the last job was started: the second click of a double click (even after an instant answer) is ignored. */
	const lastStart = useRef(0);
	/** Files already sent to fal: pressing Generate again doesn't send them again. */
	const uploaded = useRef(new Map<string, { id: string; seconds?: number }>());

	const base = videoDefaults(model, portrait);
	// What is shown is what is sent: a model that reads no description (VEED Fabric) has no field for one.
	const withPrompt = takesPrompt(model);
	const pick = <T,>(value: T | undefined, list?: T[]) => (value !== undefined && (!list || list.includes(value)) ? value : undefined);
	const options: VideoOptions = {
		prompt,
		duration: pick(set.duration, model.durations) ?? base.duration,
		aspect: pick(set.aspect, model.aspects) ?? base.aspect,
		resolution: pick(set.resolution, model.resolutions) ?? base.resolution,
		audio: model.sound ? (set.audio ?? base.audio) : undefined,
		orientation: model.orientation ? (set.orientation ?? "video") : undefined,
		keepSound: model.keepSound ? (set.keepSound ?? true) : undefined,
		seed: model.seed && /^\d+$/.test(seed.trim()) ? Number(seed.trim()) : undefined,
		negative: model.negative ? negative : undefined,
	};
	const change = (patch: VideoOptions) => setSet((cur) => ({ ...cur, ...patch }));

	// Re-render when Media or the selection changes (names, lengths of the inputs).
	useEditor((e) => `${e.media.getAssets().length}|${e.selection.getSelectedElements().map((s) => s.elementId).join(",")}`);
	const input = mode === "avatar" ? describe(editor, sound, "audio") : mode === "motion" || mode === "edit" ? describe(editor, clip, "video") : null;
	if (input?.seconds !== undefined) options.inputSeconds = input.seconds;
	if (mode === "reference") options.images = refs.length;
	const have = { image: !!describe(editor, start, "image"), end: !!describe(editor, end, "image"), images: refs.length, video: !!describe(editor, clip, "video"), audio: !!describe(editor, sound, "audio") };
	const uses = { start: mode === "image" || mode === "frames" || mode === "motion" || mode === "avatar" || (mode === "edit" && !!model.picture) };
	const problem = videoProblem(model, options, have);
	const cost = priceParts(model, options);

	/** fal's ids of the inputs (uploaded once per file and piece). */
	const send = async (s: Source | null, type: SourceType): Promise<{ id: string; seconds?: number } | undefined> => {
		if (!s) return undefined;
		const key = `${type}|${sourceKey(s)}`;
		let file: Blob;
		let trim: { from: number; length: number } | undefined;
		if (s.from === "file") file = s.file;
		else {
			const mediaId = s.from === "media" ? s.id : s.mediaId;
			const asset = EditorCore.getInstance().media.getAssets().find((a) => a.id === mediaId);
			if (!asset?.file) throw new Error(t("A file was removed from Media. Pick it again."));
			file = asset.file;
			// The timeline's piece of a clip (not the whole file).
			if (s.from === "clip") trim = s.trim;
		}
		const hit = uploaded.current.get(key);
		if (hit) return hit;
		const sent = await pointUpload(file, type, trim);
		uploaded.current.set(key, sent);
		return sent;
	};

	const generate = async () => {
		if (running.current || Date.now() - lastStart.current < 1000 || problem) return;
		running.current = true;
		lastStart.current = Date.now();
		setBusy(true);
		try {
			const ids = (s?: { id: string }) => (s ? [s.id] : undefined);
			const startUp = uses.start ? await send(start, "image") : undefined;
			const endUp = mode === "frames" ? await send(end, "image") : undefined;
			const refUps = mode === "reference" ? await Promise.all(refs.map((r) => send(r, "image"))) : [];
			const clipUp = mode === "motion" || mode === "edit" || mode === "extend" ? await send(clip, "video") : undefined;
			const soundUp = mode === "avatar" ? await send(sound, "audio") : undefined;
			const request: PointInput = {
				kind: "video",
				mode,
				model: model.id,
				prompt: withPrompt ? prompt.trim() : "",
				...(options.duration && !lengthFromInput(mode) ? { duration_seconds: options.duration } : {}),
				...(options.aspect ? { aspect_ratio: options.aspect } : {}),
				...(options.resolution ? { quality: options.resolution } : {}),
				...(options.audio !== undefined ? { generate_audio: options.audio } : {}),
				...(options.seed !== undefined ? { seed: options.seed } : {}),
				...(options.negative?.trim() ? { negative_prompt: options.negative.trim() } : {}),
				...(options.orientation ? { character_orientation: options.orientation } : {}),
				...(options.keepSound !== undefined ? { keep_sound: options.keepSound } : {}),
				...(startUp ? { image_asset_ids: ids(startUp) } : {}),
				...(endUp ? { end_image_asset_ids: ids(endUp) } : {}),
				...(refUps.length ? { reference_asset_ids: refUps.map((r) => (r as { id: string }).id) } : {}),
				...(clipUp ? { video_asset_ids: ids(clipUp), ...(clipUp.seconds ? { reference_video_duration_seconds: clipUp.seconds } : {}) } : {}),
				...(soundUp ? { audio_asset_ids: ids(soundUp), ...(soundUp.seconds ? { reference_audio_duration_seconds: soundUp.seconds } : {}) } : {}),
			};
			// Everything stays as it is: the same settings can be generated again or changed a little. A clip made from a still of
			// the timeline remembers it: «↓» on the result puts the clip in the still's place.
			const still = uses.start && start?.from === "clip" && start.type === "image" && start.trackId ? { trackId: start.trackId, elementId: start.elementId } : undefined;
			await onStart(request, still ? { replaces: still } : undefined);
		} catch (e) {
			const message = (e as Error).message;
			if (/key/i.test(message)) toast.error(message, { action: { label: t("Settings"), onClick: openFalSettings } });
			else toast.error(message);
		} finally {
			running.current = false;
			setBusy(false);
		}
	};

	// Billed per clip (some of kie.ai's): the price of the clip, not a rate.
	const rateText = (m: VideoModel) => (m.priceOf ? t("{price} per clip", { price: usd(priceParts(m, options).total) }) : t("{price}/s", { price: perSecond(priceParts(m, options).rate) }));
	// Cheapest first by the rate shown (a per-clip model: the clip's price over its seconds); no price: last.
	const perSecondOf = (m: VideoModel) => {
		const p = priceParts(m, options);
		const v = m.priceOf ? p.total / Math.max(1, p.seconds) : p.rate;
		return v > 0 && Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
	};
	const rows = [...list].sort((a, b) => perSecondOf(a) - perSecondOf(b));
	const modeNote = modes.find((m) => m.id === mode)?.note ?? "";
	const refHint = mode === "reference" && model.refName ? t("Name them in the text as {names}.", { names: [1, 2].map((n) => model.refName?.replace("{n}", String(n))).join(", ") }) : "";
	const fromInput = lengthFromInput(mode);

	return (
		// @container: in a narrow panel (a 1024 px window leaves ~150 px) the modes wrap as chips with their whole names
		// (four equal columns cut them to «Im…» «Re…» «Re…»), the settings wrap two to a row. The panel is as tall as the
		// space it has: the form scrolls inside it and the problem + Generate sit under the form, always in view and never
		// over a control (a sticky footer covered the fields the browser had just scrolled to).
		<div className="@container/vc flex h-full min-h-0 shrink-0 flex-col" data-video-composer data-video-mode-now={mode} data-video-model-now={model.id}>
			<div ref={form} className="scrollbar-hidden flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2" data-video-form>
			<div className="hidden @max-[17rem]/vc:flex">
				<Select value={mode} onValueChange={(v) => setMode(v as VideoMode)}>
					<SelectTrigger className="h-8 w-full text-xs" aria-label={t("Video mode")} data-video-mode-trigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{modes.map((m) => (
							<SelectItem key={m.id} value={m.id} className="text-xs" data-video-mode-option={m.id}>
								{t(m.label)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div role="tablist" aria-label={t("Video mode")} className="bg-muted grid grid-cols-4 gap-0.5 rounded-md p-0.5 @max-[17rem]/vc:hidden">
				{modes.map((m) => (
					<button
						key={m.id}
						type="button"
						role="tab"
						aria-selected={mode === m.id}
						title={t(m.note)}
						onClick={() => setMode(m.id)}
						data-video-mode={m.id}
						className={cn(
							"h-6 min-w-0 cursor-pointer truncate rounded-[5px] px-1 text-[11px] font-medium transition-colors",
							mode === m.id ? "bg-background text-foreground shadow-sm" : "text-foreground/65 hover:text-foreground",
						)}
					>
						{t(m.label)}
					</button>
				))}
			</div>
			<p className="text-muted-foreground -mt-0.5 text-[11px] leading-snug">{t(modeNote)}</p>

			{/* Inputs: only what this mode needs */}
			{(mode === "image" || mode === "frames") && <SourcePick field="start" type="image" value={start} onChange={setStart} placeholder={t(mode === "frames" ? "First frame" : "Start frame")} />}
			{mode === "frames" && <SourcePick field="end" type="image" value={end} onChange={setEnd} placeholder={t("Last frame")} />}
			{mode === "reference" && (
				<div className="flex flex-col gap-1.5">
					{/* One more picker while the model takes more; all chosen ones stay visible (a model that takes fewer says so). */}
					{[...refs, ...(refs.length < (model.maxImages ?? 4) ? [null] : [])].map((r, i) => (
						<SourcePick
							key={r ? `${i}:${sourceKey(r)}` : "add"}
							field={`ref-${i}`}
							type="image"
							value={r}
							optional={i > 0}
							placeholder={t(i === 0 ? "Reference picture" : "Another reference picture")}
							onChange={(v) => setRefs((cur) => (v ? [...cur.slice(0, i), v, ...cur.slice(i + 1)] : cur.filter((_, j) => j !== i)))}
						/>
					))}
				</div>
			)}
			{mode === "motion" && (
				<>
					<SourcePick field="start" type="image" value={start} onChange={setStart} placeholder={t("Photo of the character")} />
					<SourcePick field="video" type="video" value={clip} onChange={setClip} placeholder={t("Clip with the motion")} />
				</>
			)}
			{mode === "edit" && (
				<>
					<SourcePick field="video" type="video" value={clip} onChange={setClip} placeholder={t("Clip to change")} />
					{model.picture && <SourcePick field="start" type="image" value={start} onChange={setStart} optional placeholder={t("Style picture")} />}
				</>
			)}
			{mode === "extend" && <SourcePick field="video" type="video" value={clip} onChange={setClip} placeholder={t("Clip to continue")} />}
			{mode === "avatar" && (
				<>
					<SourcePick field="start" type="image" value={start} onChange={setStart} placeholder={t("Photo of the person")} />
					<SourcePick field="sound" type="audio" value={sound} onChange={setSound} placeholder={t("Voice or song")} />
				</>
			)}

			<div className="flex items-center gap-1.5">
			<Select value={model.id} onValueChange={setModel}>
				<SelectTrigger className="h-8 min-w-0 flex-1 text-xs" data-video-field="model" data-point-field="model">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{rows.map((m) => (
						<SelectItem key={m.id} value={m.id} className="text-xs" data-video-model={m.id}>
							{m.title} <span className="text-muted-foreground ml-1">{`${m.maker} · ${rateText(m)}`}</span>
							{both && <span className="text-muted-foreground/70 ml-1" data-model-api={m.api ?? "fal"}>{m.api ?? "fal"}</span>}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
				{/* the models and the keys, on the model's own row (see point-view: the header band that held «Models» stood empty) */}
				<button
					type="button"
					onClick={openFalSettings}
					title={t("Models and API keys")}
					aria-label={t("Models and API keys")}
					data-ai-open-settings
					className="text-muted-foreground hover:bg-accent hover:text-foreground grid size-8 shrink-0 place-items-center rounded-md border transition-colors"
				>
					<HugeiconsIcon icon={Settings01Icon} className="size-3.5" />
				</button>
			</div>
			<p className="text-muted-foreground -mt-1 truncate text-[11px]" title={t(model.note)}>
				{t(model.note)}
			</p>

			{withPrompt && (
				<div className="relative">
					<Textarea
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						placeholder={t(PLACEHOLDERS[mode])}
						className={cn("resize-none pb-5 text-sm", mode === "motion" || mode === "avatar" ? "min-h-14" : "min-h-20")}
						maxLength={model.maxPrompt ?? 2000}
						data-point-field="prompt"
						data-video-field="prompt"
					/>
					{prompt.length > (model.maxPrompt ?? 2000) * 0.8 && <span className="text-muted-foreground pointer-events-none absolute right-2 bottom-1 text-[10px]">{`${prompt.length} / ${model.maxPrompt ?? 2000}`}</span>}
				</div>
			)}
			{withPrompt && refHint && <p className="text-muted-foreground -mt-1 text-[11px]">{refHint}</p>}

			{/* The settings this model takes */}
			{(model.aspects?.length || (!fromInput && (model.durations?.length ?? 0) > 1) || (model.resolutions?.length ?? 0) > 1) && (
				<div className="flex flex-wrap gap-1.5">
					{!!model.aspects?.length && <Choice field="aspect" title={t("Frame shape")} value={options.aspect ?? ""} options={model.aspects} label={(v) => (v === "auto" || v === "adaptive" ? t("As the picture") : v)} onChange={(v) => change({ aspect: v })} />}
					{!fromInput && (model.durations?.length ?? 0) > 1 && <Choice field="duration" title={t("Clip length")} value={String(options.duration)} options={(model.durations ?? []).map(String)} label={(v) => t("{s} s", { s: v })} onChange={(v) => change({ duration: Number(v) })} />}
					{(model.resolutions?.length ?? 0) > 1 && <Choice field="resolution" title={t("Resolution")} value={options.resolution ?? ""} options={model.resolutions ?? []} onChange={(v) => change({ resolution: v })} />}
				</div>
			)}
			{model.orientation && (
				<Choice
					field="orientation"
					title={t("Which way the character faces")}
					value={options.orientation ?? "video"}
					options={["video", "image"]}
					label={(v) => t(v === "image" ? "Faces as in the photo · up to 10 s" : "Faces as in the clip · up to 30 s")}
					onChange={(v) => change({ orientation: v === "image" ? "image" : "video" })}
				/>
			)}
			{(model.sound || model.keepSound) && (
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
					{model.sound && (
						<span className="flex items-center gap-2">
							<Switch id="video-gen-audio" checked={!!options.audio} onCheckedChange={(v) => change({ audio: v })} data-video-field="audio" />
							<label htmlFor="video-gen-audio" className="cursor-pointer">
								{t("Sound")}
							</label>
						</span>
					)}
					{model.keepSound && (
						<span className="flex items-center gap-2">
							<Switch id="video-gen-keep" checked={options.keepSound ?? true} onCheckedChange={(v) => change({ keepSound: v })} data-video-field="keep-sound" />
							<label htmlFor="video-gen-keep" className="cursor-pointer">
								{t("Keep the clip's sound")}
							</label>
						</span>
					)}
				</div>
			)}
			{(model.seed || model.negative) && (
				<>
					<button type="button" className="text-muted-foreground hover:text-foreground -my-1 self-start rounded px-1 py-1 text-[11px]" onClick={() => setMore((v) => !v)} data-video-more>
						{t(more ? "Fewer settings" : "More settings")}
					</button>
					{more && (
						<div className="flex flex-col gap-1.5">
							{model.negative && <Input value={negative} onChange={(e) => setNegative(e.target.value)} placeholder={t("Avoid: blur, extra fingers, text…")} className="h-8 text-xs" data-video-field="negative" />}
							{model.seed && <Input value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder={t("Seed: random")} className="h-8 text-xs" data-video-field="seed" />}
						</div>
					)}
				</>
			)}

			<div className="text-muted-foreground flex items-baseline justify-between gap-2 text-[11px] tabular-nums" data-video-price={cost.total.toFixed(4)}>
				<span className="truncate">
					{model.priceOf
						? t("Priced per clip")
						: fromInput
						? t(input?.seconds !== undefined ? (mode === "avatar" ? "{rate}/s × {s} s of the sound" : "{rate}/s × {s} s of the clip") : "{rate}/s, as long as the input", { rate: perSecond(cost.rate), s: cost.seconds })
						: t("{rate}/s × {s} s", { rate: perSecond(cost.rate), s: cost.seconds })}
					{cost.extra > 0 ? ` + ${usd(cost.extra)}` : ""}
				</span>
				<span className="text-foreground font-medium">{`≈ ${usd(cost.total)}`}</span>
			</div>
			{/* The results, in the same scroller as the form (see `results`); they bring their own side padding. */}
			{results && <div className="-mx-3 mt-1">{results}</div>}
			</div>
			{/* The problem and Generate stay under the form: the button is always in reach. */}
			<div className="flex shrink-0 flex-col gap-2 border-t px-2 pt-2 pb-2.5" data-video-footer>
			{problem && ((withPrompt && prompt.trim()) || mode !== "text") && (
				<p className="text-[11px] text-amber-500" data-video-problem>
					{t(problem.text, problem.vars)}
				</p>
			)}
			<Button className="h-auto min-h-9 whitespace-normal py-1.5 leading-tight" disabled={busy || !!problem} onClick={() => void generate()} data-point-generate>
				{busy ? <Spinner className="mr-2 size-3.5" /> : null}
				{t("Generate · ≈ {price}", { price: usd(cost.total) })}
			</Button>
			<ActiveJobLine kind="video" />
			</div>
		</div>
	);
}
