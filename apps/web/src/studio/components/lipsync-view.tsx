"use client";

// The Lipsync section: for a selected video clip the FIRST section of the inspector (lipa, 14.11). The podcast's golden
// path is the clip → the words → ⌘↵ (or the one button): the words are voiced in the clip's own voice and the clip
// speaks them, one run with its stages, one price in cents on the button (the button is the consent; a dialog only above
// the limit of Settings → AI). Everything here belongs to the clip: its draft, its run, its result card — several clips
// run at once. The run / stop / retry bar is pinned to the inspector's own bottom edge, never scrolled away.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DEMO } from "@/demo/flag";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@/components/ui/icon";
import { PauseIcon, PlayIcon, Settings01Icon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEditor } from "@/editor/use-editor";
import { cn } from "@/utils/ui";
import { mediaTimeFromSeconds } from "@/wasm";
import { aiScript, applyLipVersion, chosenModel, lipsyncPlan, lipsyncSample, originalOf, preflight, refreshServer, sampleKey, speakAndLipsync, speechIsCurrent, voiceOnly, voiceover } from "@/studio/client/actions";
import { type Preflight, studioApi } from "@/studio/client/api";
import { type ClipRef, currentClip, type LipPlace, projectFps, videoClipCount } from "@/studio/client/editor-bridge";
import type { FitChoice } from "@/studio/client/fit";
import { cents } from "@/studio/client/money";
import { draftKey, isRunning, placeOf, type Run, useStudioStore, versionKey } from "@/studio/client/studio-store";
import { useTimelineStore } from "@/timeline/timeline-store";
import { setVoiceFromFile } from "@/studio/client/voice-file";
import { audioUnder, setVoiceFromAsset, setVoiceFromTimeline } from "@/studio/client/voice-timeline";
import { estimateSpeechSeconds, formatNumber, LIPSYNC_TAIL_SECONDS } from "@/studio/shared/models";
import { ModelLadder } from "./model-ladder";
import { SamplePlayer } from "./sample-player";
import { TakeButton } from "./take-button";
import { ResultCard } from "./result-card";
import { RunProgress, RunStatus, sayStudio } from "./run-status";
import { ScriptButton } from "./script-button";
import { trendVoice } from "@/trending/voices";
import { myCards, type VoiceCard } from "@/generate/components/voice-picker";
import { VOICES } from "@/generate/voices";
import { t as tr, useLang, useT } from "@/i18n";
import { falChoice, isCloneVoice, openFalSettings, useFal, useFalTts, useKeys } from "@/fal/client";
import { VoiceModelSelect } from "@/fal/components/voice-model-select";
import { apiOf, falModel, modelsFor, price } from "@/fal/models";
import { onOffer } from "@/fal/video";

/** 0:01.2 */
const tc = (s: number) => {
	const t = Math.max(0, s);
	return `${Math.floor(t / 60)}:${formatNumber(t % 60, 1).padStart(4, "0")}`;
};
/** «6.0 s» (RU: «6,0 с»). */
const sec = (s: number) => tr("{s} s", { s: formatNumber(s, 1) });

/** Speech previews autoplay once per voice-over, even if the panel is re-opened. */
const autoplayed = new Set<string>();

type SoundSource = "text" | "timeline" | "file";

/** `embedded`: inside the inspector's «Lipsync» group, whose header already names it — no header of its own. */
export function LipsyncView({ embedded = false }: { embedded?: boolean }) {
	const t = useT();
	const editor = useEditor();
	const projectId = useEditor((e) => e.project.getActiveOrNull()?.metadata.id ?? "");
	// Primitive snapshots of the timeline, so the window follows the selection without re-rendering on every frame.
	const pins = useStudioStore((s) => s.pins);
	const clipKey = useEditor((e) => {
		const c = currentClip(e);
		return c ? [c.elementId, c.asset.id, c.start, c.length, c.at, c.asset.name, c.element.retime?.rate ?? 1] : [];
	});
	const hasSelection = useEditor((e) => e.selection.getSelectedElements().length > 0);
	const videoCount = useEditor((e) => videoClipCount(e));
	const audioBelow = useEditor((e) => {
		const c = currentClip(e);
		return c ? audioUnder(e, c.at, c.at + c.length).length : 0;
	});
	const audioFiles = useEditor((e) =>
		e.media
			.getAssets()
			.filter((a) => a.type === "audio" && !a.ephemeral)
			.slice(-12)
			.reverse()
			.map((a) => `${a.id}\t${a.name}`),
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the pin changes the picked clip
	const clip = useMemo(() => (clipKey.length ? currentClip(editor) : null), [clipKey.join("|"), pins, editor]);
	// Everything below is this clip's: its draft, its run, its card (another clip never shows them).
	const key = clip ? draftKey(projectId, clip.elementId) : projectId;
	const clipId = clip?.elementId ?? null;

	const server = useStudioStore((s) => s.server);
	const drafts = useStudioStore((s) => s.drafts);
	const clipRuns = useStudioStore((s) => s.clipRuns);
	const versionsAll = useStudioStore((s) => s.versions);
	const consents = useStudioStore((s) => s.consents);
	const limit = useStudioStore((s) => s.confirmAbove);
	const { patch: patchKey, setRun, pin, draft: getDraft, consent } = useStudioStore.getState();
	const patch = (p: Parameters<typeof patchKey>[1]) => patchKey(key, p);
	// biome-ignore lint/correctness/useExhaustiveDependencies: drafts/server feed the getter
	const draft = useMemo(() => getDraft(key), [drafts, key, server, getDraft]);
	const fal = useFal((s) => s.status);

	useEffect(() => {
		void refreshServer();
		void useFal.getState().refresh();
	}, []);

	// The clip shown here is the lipsync clip of the project (it stays chosen after the selection is cleared).
	useEffect(() => {
		if (projectId && clipId && pins[projectId] !== clipId) pin(projectId, clipId);
	}, [projectId, clipId, pins, pin]);

	// Only the clip's own voice or one of «My voices» speak here: an older draft with a ready voice goes back to the clip's.
	// biome-ignore lint/correctness/useExhaustiveDependencies: patch writes this clip's draft
	useEffect(() => {
		if (projectId && draft.voice !== "clone" && draft.voice !== "file" && draft.voice !== "timeline" && !draft.voice.startsWith("local:") && !(server?.voices ?? []).some((v) => v.id === draft.voice) && !draft.speech) patch({ voice: "clone" });
	}, [projectId, key, draft.voice]);

	// Lipsync works like an effect on the selected clip: an old "whole edit" draft goes back to the clip.
	// biome-ignore lint/correctness/useExhaustiveDependencies: patch writes this clip's draft
	useEffect(() => {
		if (projectId && draft.source !== "clip") patch({ source: "clip" });
	}, [projectId, key, draft.source]);

	const voiceRun = clipRuns[`voiceover|${key}`];
	const ownLip = clipRuns[`lipsync|${key}`];
	// The result clip shows the card of the run that made it (the clip it came from is gone from the timeline).
	const madeHere = clipId && !ownLip?.done ? Object.values(clipRuns).find((r) => r.kind === "lipsync" && r.done && r.result?.elementId === clipId) : undefined;
	const lipRun = ownLip;
	const cardRun = lipRun?.done ? lipRun : madeHere;
	// lip5: the clip's sample (rule E) is a run of its own: it plays in the panel, nothing lands on the timeline
	const sampleRun = clipRuns[`lipsync|${sampleKey(key)}`];
	const busyVoice = isRunning(voiceRun);
	const busyLip = isRunning(lipRun);
	const busySample = isRunning(sampleRun);
	const busy = busyVoice || busyLip || busySample;

	const settings = server?.settings;
	const text = draft.text.trim();
	const audioOnly = !!draft.audioOnly;
	// biome-ignore lint/correctness/useExhaustiveDependencies: the plan reads the timeline and the draft
	const plan = useMemo(() => (projectId ? lipsyncPlan(editor, projectId, clipId) : null), [editor, projectId, clip, draft]);
	// The magnet as the timeline button shows it now (the editor's own flag follows it a moment later).
	const magnetOn = useTimelineStore((s) => s.rippleEditingEnabled);
	const lastPlace = useStudioStore((s) => s.lastPlace);
	const lastFit = useStudioStore((s) => s.lastFit);
	const videoSeconds = plan?.videoSeconds ?? 0;
	const estimateSeconds = estimateSpeechSeconds(text.length, settings?.speechSpeed ?? 1);
	const cloning = draft.voice === "clone";
	const source: SoundSource = draft.voice === "timeline" ? "timeline" : draft.voice === "file" ? "file" : "text";
	const lang = useLang((s) => s.code);
	const money = (usd: number) => cents(usd, lang === "en" ? "en" : "ru");
	const current = speechIsCurrent(key) && !!draft.speech;
	const speech = draft.speech;
	// New words still to be voiced: the button voices them first (one run), the price includes the voice.
	const needVoice = source === "text" && !current;
	const speechSeconds = speech && current ? speech.seconds : text ? estimateSeconds : videoSeconds || 5;
	// biome-ignore lint/correctness/useExhaustiveDependencies: drafts and the fal choices feed the model
	const model = useMemo(() => chosenModel(key, speechSeconds), [key, speechSeconds, drafts, fal]);
	const keys = useKeys();
	const anyKey = !!keys && (keys.fal || keys.kie || !!keys.argo);
	const onApis = onOffer(keys);
	// The lipsync model alone decides the API; the voice has its own model (and API), see `tts` below.
	const models = modelsFor("lipsync", keys);
	const lipApi = apiOf(falModel(model.id));
	const savedVoices = server?.voices ?? [];
	const own = useMemo(() => (clip?.asset.file ? URL.createObjectURL(clip.asset.file) : null), [clip]);
	useEffect(() => () => (own ? URL.revokeObjectURL(own) : undefined), [own]);
	const voiceCards = useMemo<VoiceCard[]>(
		() => [
			// The person's own voice (cloned from the selected clip) and the user's saved voices: nothing else speaks here.
			{ id: "clone", name: "Original voice", hint: "The person's own voice, cloned from the clip (once)", sample: own, groups: [] },
			...myCards(savedVoices),
		],
		[own, savedVoices],
	);
	const audioInput = useRef<HTMLInputElement>(null);
	const chooseVoice = (v: string) => {
		if (v === "pick-file") return audioInput.current?.click();
		if (v === "timeline") {
			if (!clip) return toast.error(t("Select the video clip on the timeline first"));
			// The marked In/Out piece when there is one: its own sound, not the whole clip's.
			const span = plan?.piece ?? { start: clip.at, end: clip.at + clip.length };
			// The list shows the chosen sound: no toast (it would sit over the Lipsync button).
			setVoiceFromTimeline(editor, key, span.start, span.end).catch((err) => toast.error(sayStudio((err as Error).message)));
			return;
		}
		if (v.startsWith("media:")) {
			const asset = editor.media.getAssets().find((a) => a.id === v.slice(6));
			if (!asset) return;
			setVoiceFromAsset(key, asset).catch((err) => toast.error(sayStudio((err as Error).message)));
			return;
		}
		patch({ voice: v, voiceName: savedVoices.find((x) => x.id === v)?.name ?? trendVoice(v.slice(6))?.name ?? VOICES.find((x) => x.id === v)?.name ?? "" });
	};
	const fit = plan?.fit ?? "loop";
	const fitChoices = current ? plan?.options : null;
	const noKey = !!fal && !(lipApi === "kie" ? fal.kie.key : fal.key);
	// kie.ai has no voice clones: the clip's own voice is cloned on fal, whatever model the lipsync runs on.
	const cloneNeedsFal = draft.voice === "clone" && !!fal && !fal.key && fal.kie.key;

	// Every price comes from the pre-flight (the server's table, the run's own plan — lipc, 14.11): the page computes none.
	// A cloned voice speaks on fal's speech model whatever voice model is picked: kie.ai has no clones.
	const picked = falChoice("tts");
	const falTts = useFalTts();
	const viaFal = isCloneVoice(draft.voice);
	const tts = viaFal ? falTts : picked;
	// A lipsync of this clip paid before the window reloaded and not picked up yet: it comes back, nothing is charged again.
	const heldLip = useStudioStore((s) => Object.values(s.pending).some((j) => j.kind === "lipsync" && j.projectId === projectId && ((j.meta as { key?: string }).key === key || (j.meta as { clip?: { elementId?: string } }).clip?.elementId === clipId)));
	// What goes to fal (and is paid): as long as the speech — the clip is cut to it, or made as long — except the whole
	// clip (pad), the voice fitted to the clip (speed) or cut to it (cut). Before the voice exists: its estimated length.
	const sentVideo = needVoice
		? (lastFit === "pad" && estimateSeconds < videoSeconds ? videoSeconds : estimateSeconds)
		: fit === "pad" || fit === "speed" || fit === "cut"
			? videoSeconds
			: speech
				? speechSeconds
				: videoSeconds;
	// biome-ignore lint/correctness/useExhaustiveDependencies: lastPlace is read by placeOf
	const place: LipPlace = useMemo(() => placeOf(draft, magnetOn), [draft, magnetOn, lastPlace]);
	const magnetic = !!clip && magnetOn && clip.trackId === editor.scenes.getActiveScene().tracks.main.id;
	const trims = fit === "trim" || (needVoice && estimateSeconds < videoSeconds - 0.4 && (lastFit ?? "trim") === "trim");
	const placeHint =
		place === "above"
			? trims
				? "A new track above · the clip is trimmed to it and muted"
				: "A new track above, same start · the clip is muted under it"
			: trims
				? magnetic || place === "insert"
					? "The clip takes the voice's length · what follows moves up"
					: "The clip takes the voice's length · a gap stays after it"
				: place === "insert" || magnetic
					? magnetic && place === "replace"
						? "Magnetic main track: what follows moves along, no gaps"
						: "What follows moves by the difference"
					: "Same start · the rest of the clip follows · nothing is covered";

	// Pre-flight: re-checked whenever the clip, the words, the speech or the model changes. It holds THE price: the voice
	// still to make (typed words) and the lipsync of what goes — the run's own plan (only the speech, in pieces).
	// «estimate»: the words are not voiced yet (the lipsync priced on their estimated length); «voice»: the voice under the
	// clip only; «real»: the sound exists.
	const checkMode: "real" | "estimate" | "voice" | null = !projectId || !clip ? null : needVoice ? (audioOnly ? (text.trim() ? "voice" : null) : "estimate") : speech && current && !audioOnly ? "real" : null;
	const [check, setCheck] = useState<{ loading: boolean; result?: Preflight | null; error?: string; for?: string }>({ loading: false });
	const voiceAsk = needVoice && text.trim() ? { chars: text.trim().length, clone: cloning } : undefined;
	// no words yet: every model's price for the whole clip (the list compares them); the button stays without a price
	const askSeconds = text.trim() ? estimateSeconds : videoSeconds || 5;
	const estimateFit = needVoice && lastFit === "pad" ? "pad" : "trim";
	// A finished lipsync is checked again: the same one now comes from the cache (free), and the price must say so.
	const checkKey = [key, checkMode, speech?.fileId, current, model.id, audioOnly, fal?.key, fal?.kie.key, draft.kieMode, draft.kieVocals, plan?.sent?.start, plan?.sent?.end, cardRun?.result?.assetId ?? "", sampleRun?.sample?.fileId ?? "", needVoice ? `${voiceAsk?.chars}:${cloning}:${draft.voice}:${askSeconds.toFixed(2)}:${estimateFit}:${tts.id}` : "", ...clipKey].join("|");
	// biome-ignore lint/correctness/useExhaustiveDependencies: checkKey lists everything the pre-flight depends on
	useEffect(() => {
		if (!checkMode) {
			setCheck({ loading: false });
			return;
		}
		const abort = new AbortController();
		setCheck({ loading: true, for: checkKey });
		const timer = setTimeout(() => {
			preflight(editor, projectId, abort.signal, clipId, checkMode === "real" ? {} : { voice: voiceAsk, estimateSeconds: askSeconds, voiceOnly: checkMode === "voice", fit: estimateFit })
				.then((result) => !abort.signal.aborted && setCheck({ loading: false, result, for: checkKey }))
				.catch((e) => !abort.signal.aborted && setCheck({ loading: false, error: (e as Error).message, for: checkKey }));
		}, 300);
		return () => {
			clearTimeout(timer);
			abort.abort();
		};
	}, [checkKey]);

	// The new voice plays once as soon as it is ready — listen while the lipsync runs.
	const audio = useRef<HTMLAudioElement>(null);
	useEffect(() => {
		if (!voiceRun?.done || !speech?.fileId || autoplayed.has(speech.fileId)) return;
		autoplayed.add(speech.fileId);
		if (voiceRun.chain) return; // «voice → lipsync»: the result plays, not the voice alone
		void audio.current?.play().catch(() => {});
	}, [voiceRun?.done, speech?.fileId]);

	type Press = { fresh?: boolean; voiceOnly?: boolean; sample?: boolean; seed?: number; guidance?: number };
	const [confirm, setConfirm] = useState<null | Press>(null);
	const [queued, setQueued] = useState<null | Press>(null);
	const [ladderOpen, setLadderOpen] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a press waiting for its price belongs to this clip only
	useEffect(() => setQueued(null), [key]);
	const [fitting, setFitting] = useState(false);

	// The versions of this piece (the clip's original media and where the piece starts in it).
	const pieceStart = clip ? clip.start + (plan?.piece ? plan.piece.start - clip.at : 0) : 0;
	// A clip that shows a version already belongs to that piece's list; else the list of the clip's own piece.
	const vKey = clip ? (Object.keys(versionsAll).find((k) => k.startsWith(`${projectId}|`) && versionsAll[k].some((v) => v.assetId === clip.asset.id)) ?? versionKey(projectId, clip.asset.id, pieceStart)) : "";
	const versions = versionsAll[vKey] ?? [];
	const showing = clip?.asset.id;
	// Cloning consent is asked once per cloned voice (its source footage): the press of the button gives it.
	const consentFor = clip ? originalOf(editor, projectId, clip).asset.id : "";
	const askConsent = cloning && needVoice && !!clip && !consents[consentFor];

	// The bar with the run button lives at the inspector's bottom edge (pinned, never scrolled away) — but only while the
	// person looks at the Lipsync section: folded tools, a folded section or the section scrolled out of the inspector →
	// no bar (the owner, 14.11: lipsync is a tool, never among the basics). Outside the inspector it stays at the bottom
	// of this view. Hysteresis: while hidden the section must show above the bar's height at the bottom edge, so the bar
	// that then takes that space cannot push it back out (no flicker).
	const root = useRef<HTMLDivElement>(null);
	const [dock, setDock] = useState<HTMLElement | null>(null);
	const [shown, setShown] = useState(false);
	const dockHeight = useRef(96);
	useEffect(() => {
		if (!embedded) return;
		const el = root.current;
		const body = el?.closest("[data-inspector-body]");
		if (!el || !body || typeof IntersectionObserver === "undefined") return;
		const io = new IntersectionObserver(
			(entries) => {
				const e = entries[entries.length - 1];
				setShown(!!e && e.isIntersecting && e.intersectionRect.height > 0 && el.getClientRects().length > 0);
			},
			{ root: body, rootMargin: shown ? "0px" : `0px 0px -${Math.round(dockHeight.current + 12)}px 0px`, threshold: [0, 0.01] },
		);
		io.observe(el);
		return () => io.disconnect();
	}, [embedded, shown]);
	useLayoutEffect(() => {
		if (!embedded || !shown) return;
		const body = root.current?.closest("[data-inspector-body]");
		const panel = body?.parentElement;
		if (!body || !panel) return;
		const host = document.createElement("div");
		host.setAttribute("data-lipsync-dock", "");
		host.style.order = "9999";
		host.className = "shrink-0";
		panel.appendChild(host);
		setDock(host);
		const measure = requestAnimationFrame(() => {
			if (host.offsetHeight > 0) dockHeight.current = host.offsetHeight;
		});
		return () => {
			cancelAnimationFrame(measure);
			if (host.offsetHeight > 0) dockHeight.current = host.offsetHeight;
			host.remove();
			setDock(null);
		};
	}, [embedded, shown]);

	if (!projectId) return null;

	const shorten = async () => {
		if (!settings?.agent) {
			toast.error(t("The AI agent needs the fal.ai key: Settings → AI."));
			return;
		}
		setFitting(true);
		try {
			await aiScript(key, { kind: "fit" }, { seconds: videoSeconds, context: clip?.asset.name ?? "clip" });
		} catch (e) {
			const line = (e as Error).message.split("\n\nDetails:")[0];
			toast.error(sayStudio(line), { action: { label: t("Retry"), onClick: () => void shorten() } });
		} finally {
			setFitting(false);
		}
	};

	const addKey = lipApi === "kie" ? "Add your kie.ai key first" : "Add your fal.ai key first";
	const pf = check.result && check.for === checkKey ? check.result : null;
	const checked = !checkMode || (!check.loading && check.for === checkKey && (!!check.result || !!check.error));
	const problem: string | null = noKey
		? addKey
		: !clip
			? "Select a video clip on the timeline"
			: cloneNeedsFal && needVoice
				? "Cloning a voice runs on fal.ai: add a fal.ai key, or pick a sound file"
				: source === "text" && !text && !current
					? audioBelow === 0
						? "No sound under the clip — type the words or choose a sound"
						: "Type what they say"
					: source !== "text" && !speech
						? "Choose the sound first"
						: source !== "text" && !current
							? "The sound changed — choose it again"
							: checkMode && checked && !pf && check.error
								? sayStudio(check.error)
								: audioOnly
									? null
									: (pf?.blocking ?? null);
	// the answered pre-flight, for the department's walk (test/lipsync-walk.mjs compares the panel with it)
	useEffect(() => {
		if (pf) (window as unknown as { __lipsyncPreflight?: unknown }).__lipsyncPreflight = pf;
	}, [pf]);
	// The same piece, voice and model were lipsynced before: it comes back free.
	const remade = !!pf?.cached;
	const pfChecks = (pf?.checks ?? []).filter((c) => !(fitChoices && /^Speech ≈/.test(c.text)));
	const pfWarnings = pfChecks.filter((c) => c.level !== "ok");

	// One total for what this press sends, as the server states it: the voice still to make, plus the lipsync (none when
	// it was made before). The same number goes to the limit check and is what the run is charged.
	const voiceUsd = pf?.voiceUsd ?? 0;
	const lipUsd = pf?.usd ?? 0;
	const total = heldLip ? 0 : (pf?.total ?? 0);
	const exact = !!pf && !pf.estimated;
	const priced = !checkMode ? !needVoice : !!pf && !(needVoice && !text.trim());
	const priceText = !checked || !priced ? "" : heldLip ? t("paid") : total <= 0 ? (remade ? t("free · made before") : t("free")) : `${exact ? "" : "≈ "}${money(total)}`;
	const ready = !problem && checked && priced && !busy;
	/** What a press costs, as the server states it: a sample its `sample.usd`; a new take the lipsync again. */
	const pressSum = (o: Press) => (o.voiceOnly ? voiceUsd : o.sample ? (sampleOffer?.usd ?? 0) : o.fresh ? (needVoice ? voiceUsd : 0) + lipUsd : total);
	// lip5: the result's length as the run will make it — the pre-flight's plan (its frames + the tail it bills), not a guess
	const planSeconds = pf?.plan && pf.plan.wholeSeconds > (falModel(model.id)?.minSeconds ?? 0) + LIPSYNC_TAIL_SECONDS ? pf.plan.wholeSeconds - LIPSYNC_TAIL_SECONDS : undefined;
	const resultSeconds = planSeconds ?? pf?.seconds ?? 0;
	const serverSample = !audioOnly && !remade && !needVoice && pf?.sample && pf.sample.usd > 0 ? pf.sample : null;
	// lip5 A2: the sample answers «will MY run look good» — a per-second model is sampled itself (3 s of it is cheap, priced by
	// the same table the run bills by); a flat-priced one (LatentSync: 20 ¢ up to 40 s) falls back to the server's pick, and says so
	const chosenFal = falModel(model.id);
	const sampleOffer = serverSample
		? chosenFal?.unit === "second" && !chosenFal.api
			? { ...serverSample, model: chosenFal.id, usd: price(chosenFal, serverSample.seconds), own: true }
			: { ...serverSample, own: serverSample.model === model.id }
		: null;
	const sampleTitle = (id: string) => falModel(id)?.title ?? id;
	const sampleShown = sampleRun?.sample && !busy ? sampleRun : undefined;
	// a reason in place of the label when the press can't run for want of words or sound (the button never lies)
	const reasonOnButton = problem === "No sound under the clip — type the words or choose a sound";

	const watch = () => {
		editor.playback.seek({ time: mediaTimeFromSeconds({ seconds: cardRun?.resultAt ?? 0 }) });
		editor.playback.play();
	};
	const hideCard = () => cardRun && setRun("lipsync", undefined, cardRun.key);
	const undo = () => {
		// The panel shows the button again and the timeline the original: no toast over that button.
		editor.command.undo();
		hideCard();
	};
	const tryAnother = () => {
		if (cardRun?.result?.replaced && editor.media.getAssets().some((a) => a.id === cardRun.result?.assetId)) editor.command.undo();
		hideCard();
	};

	/** The press: the consent of a first clone, then the run (voice → lipsync, or the voice under the clip). `agreed`:
	 * the total the press consented to (the lipsync after a new voice may not cost more than that or the limit). */
	const run = (o: Press = {}, agreed = 0) => {
		if (!clip) return;
		if (askConsent) consent(consentFor);
		const id = clip.elementId;
		if (o.sample) {
			void lipsyncSample(editor, projectId, id, undefined, { sampleModel: sampleOffer?.own && sampleOffer.model !== pf?.sample?.model ? sampleOffer.model : undefined });
			return;
		}
		if (o.voiceOnly) {
			void voiceover(editor, projectId, undefined, { clipId: id });
			return;
		}
		if (audioOnly) {
			void (async () => {
				if (needVoice) {
					const v = await voiceover(editor, projectId, undefined, { clipId: id });
					if (!v?.done) return;
				}
				voiceOnly(editor, projectId, id);
			})();
			return;
		}
		void speakAndLipsync(editor, projectId, id, { fresh: o.fresh, seed: o.seed, guidance: o.guidance, agreedUsd: needVoice ? Math.max(limit, agreed) : undefined });
	};
	/** The button: no question under the limit of Settings → AI; above it, one dialog with the total. A press while the
	 * pre-flight is still answering waits for its price (⌘↵ right after the typing is never lost, never unpriced). */
	const go = (o: Press = {}) => {
		if (!checked && !busy) {
			setQueued(o);
			return;
		}
		if (o.voiceOnly ? !pf : !ready) return;
		if (o.sample && !sampleOffer) return;
		const sum = pressSum(o);
		if (sum > limit + 1e-9) {
			setConfirm(o);
			return;
		}
		run(o, sum);
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: go reads the answered pre-flight
	useEffect(() => {
		if (!queued || !checked) return;
		setQueued(null);
		go(queued);
	}, [queued, checked]);

	const footerRun: Run | undefined = busyVoice ? voiceRun : busyLip ? lipRun : busySample ? sampleRun : lipRun?.error ? lipRun : sampleRun?.error ? sampleRun : voiceRun?.error ? voiceRun : undefined;
	const hint =
		problem ??
		(audioOnly
			? needVoice
				? "The voice goes on a track under the clip · one ⌘Z"
				: "Free · the voice goes on a track under the clip · one ⌘Z"
			: !checked
				? "Checking the clip…"
				: remade
					? "Made before · the earlier result comes back"
					: needVoice
						? t(lipApi === "kie" ? "Voice, then {model} on kie.ai · ⌘↵" : "Voice, then {model} on fal.ai · ⌘↵", { model: model.title })
						: t(lipApi === "kie" ? "{model} on kie.ai · ⌘↵" : "{model} on fal.ai · ⌘↵", { model: model.title }));
	const label = audioOnly ? (needVoice ? "Voice it under the clip" : "Put the voice under the clip") : needVoice ? "Voice and lipsync" : "Lipsync";
	// «voice → lipsync» as one run: the voice's steps first, then the lipsync's
	const chainSteps = (r: Run) => (r.kind === "voiceover" ? (r.chain ? { offset: 0, total: (r.job?.stages.length ?? 3) + 2 } : undefined) : voiceRun?.chain && voiceRun.done ? { offset: voiceRun.job?.stages.length ?? 3, total: (voiceRun.job?.stages.length ?? 3) + (r.job?.stages.length ?? 2) } : undefined);

	const piece = plan?.piece;
	const pieceLine = clip ? (piece ? `${t("In/Out piece")} ${tc(piece.start)}–${tc(piece.end)} · ${sec(piece.end - piece.start)}` : `${t("Whole clip")} · ${sec(clip.length)}`) : "";

	// Sound: one list — the clip's own voice (cloned), my voices, the audio under the clip, an audio file.
	const soundValue = source === "timeline" ? "timeline" : source === "file" ? (speech?.mediaId ? `media:${speech.mediaId}` : "file") : draft.voice;
	const fileName = source === "file" ? draft.voiceName || t("Audio file") : "";
	const sample = voiceCards.find((c) => c.id === draft.voice)?.sample ?? null;
	const toggles: Array<{ id: string; on: boolean; label: string; set: (v: boolean) => void; show: boolean }> = [
		{ id: "mute", on: draft.muteOriginal, label: "Mute the original", set: (v) => patch({ muteOriginal: v }), show: audioOnly || place === "above" },
		{ id: "captions", on: draft.captions, label: "Captions", set: (v) => patch({ captions: v }), show: source === "text" },
		{ id: "vocals", on: !!draft.kieVocals, label: "Separate the voice", set: (v) => patch({ kieVocals: v }), show: !audioOnly && model.id.startsWith("volcengine/") },
	];

	const footer = (
		<div className={cn("bg-background flex flex-col gap-2 border-t p-3", !dock && "shrink-0")} data-lipsync-footer>
			{footerRun && isRunning(footerRun) && <RunProgress run={footerRun} eta={footerRun.kind === "lipsync" ? undefined : t("10–30 s")} steps={chainSteps(footerRun)} />}
			{footerRun?.error && !busy && (
				<RunStatus run={footerRun} onDismiss={() => setRun(footerRun.kind, undefined, footerRun === sampleRun ? sampleKey(key) : key)} onRetry={() => (footerRun === sampleRun ? go({ sample: true }) : footerRun.kind === "voiceover" && !footerRun.chain ? go({ voiceOnly: true }) : go())} />
			)}
			{!busy && (
				<>
					<Button data-testid="lipsync-go" className="h-auto min-h-10 w-full justify-between gap-2 whitespace-normal py-1.5" disabled={!ready && !(checkMode && !checked && !problem)} onClick={() => go()}>
						<span className="min-w-0 text-left leading-tight" data-lipsync-reason={reasonOnButton ? "" : undefined}>{t(reasonOnButton && problem ? problem : label)}</span>
						{!reasonOnButton && (
							<span className="shrink-0 tabular-nums opacity-80" data-testid="lipsync-price" data-usd={pf && checked ? String(total) : undefined}>
								{checked || !checkMode ? priceText : <Spinner className="size-3" />}
							</span>
						)}
					</Button>
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
						<span className="text-muted-foreground min-w-0 flex-1 [overflow-wrap:anywhere]" data-testid="footer-hint">
							{reasonOnButton ? "" : t(hint)}
							{/* the browser edition has no Settings → AI: its key goes in the banner above (and the AI tab's panel) */}
							{noKey && !DEMO && (
								<button type="button" className="text-foreground ml-1.5 underline underline-offset-2" onClick={openFalSettings} data-ai-open-settings>
									{t("Settings → AI")}
								</button>
							)}
						</span>
						{/* the second, quiet action: the words voiced only (listen first) */}
						{source === "text" && !audioOnly && needVoice && text && !problem && (
							<button type="button" className="text-muted-foreground hover:text-foreground shrink-0 tabular-nums underline-offset-2 hover:underline" data-testid="voice-go" onClick={() => go({ voiceOnly: true })}>
								{t("Voice only")} <span data-testid="voice-price">{pf ? money(voiceUsd) : ""}</span>
							</button>
						)}
						{/* lip5: a sample of the hardest ~3 s first (rule E) — its price is the server's */}
						{sampleOffer && ready && (
							<button type="button" className="text-muted-foreground hover:text-foreground shrink-0 tabular-nums underline-offset-2 hover:underline" data-testid="sample-go" data-usd={String(sampleOffer.usd)} onClick={() => go({ sample: true })}>
								{t("Sample · {s} s ≈ {sum}", { s: formatNumber(Math.max(1, Math.round(sampleOffer.to - sampleOffer.from)), 0), sum: money(sampleOffer.usd) })}
							</button>
						)}
						{remade && !audioOnly && ready && !cardRun?.done && (
							<button type="button" className="text-muted-foreground hover:text-foreground shrink-0 tabular-nums underline-offset-2 hover:underline" data-confirm-fresh onClick={() => go({ fresh: true, seed: Math.floor(Math.random() * 2 ** 31) })}>
								{t("Another take")} {money(lipUsd)}
							</button>
						)}
					</div>
					{sampleOffer && ready && !sampleOffer.own && (
						<span className="text-muted-foreground text-[11px] leading-snug" data-sample-model-note>
							{t("With")} <span data-no-translate>{model.title}</span> {t("a sample costs as much as the whole clip — the sample is made by")} <span data-no-translate>{sampleTitle(sampleOffer.model)}</span>
						</span>
					)}
					{askConsent && ready && (
						<span className="text-muted-foreground text-[11px] leading-snug" data-lipsync-consent>
							{t("Pressing it confirms: the person on camera agreed to have their voice cloned")}
						</span>
					)}
				</>
			)}
		</div>
	);

	return (
		<div ref={root} className="flex h-full min-h-0 flex-col" data-lipsync-window data-lipsync-key={key}>
			<input
				ref={audioInput}
				type="file"
				accept="audio/*,.mp3,.wav,.m4a"
				className="hidden"
				data-testid="voice-file"
				onChange={(e) => {
					const f = e.target.files?.[0];
					e.target.value = "";
					if (!f) return;
					setVoiceFromFile(editor, key, f).catch((err) => toast.error(sayStudio((err as Error).message)));
				}}
			/>
			<div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 py-2">
				{noKey && (
					<button type="button" onClick={openFalSettings} className="bg-primary/10 ring-primary/25 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs ring-1" data-lipsync-nokey>
						<HugeiconsIcon icon={Settings01Icon} className="size-3.5 shrink-0" />
						<span className="flex-1">{t(lipApi === "kie" ? "Lipsync and voices run on your kie.ai key." : "Lipsync and voices run on your fal.ai key.")}</span>
						<span className="font-medium">{t("Add key")}</span>
					</button>
				)}

				{/* The result of THIS clip (never another clip's): Before / After, another take, ⌘Z, watch. */}
				{cardRun?.done && !busy && <ResultCard run={cardRun} onTryAnother={tryAnother} onUndo={undo} onWatch={watch} onHide={hideCard} />}
				{cardRun?.done && !busy && !audioOnly && (
					<TakeButton modelId={model.id} price={checked && pf?.usd != null ? money(lipUsd) : ""} disabled={!ready} onTake={(o) => go({ fresh: true, ...o })} />
				)}
				{sampleShown && (
					<SamplePlayer
						run={sampleShown}
						wholePrice={checked && priced && !problem ? priceText : ""}
						reuse={!!pf?.sample?.reuse && pf.sample.model === model.id}
						wholeModel={model.title}
						onWhole={() => go()}
						onOtherModel={() => {
							root.current?.querySelector("[data-lipsync-ladder]")?.scrollIntoView({ block: "nearest" });
							setLadderOpen(true);
						}}
						onHide={() => setRun("lipsync", undefined, sampleKey(key))}
					/>
				)}

				{/* Sound, then the words: first on screen, the caret goes here (⌥L, the menu, ⌘K). */}
				<Field label="Sound">
					<div className="flex min-w-0 items-center gap-1.5">
						<Select value={soundValue} onValueChange={chooseVoice}>
							<SelectTrigger className="h-8 min-w-0 flex-1 text-xs" data-lipsync-sound>
								<SelectValue>
									<span className="block min-w-0 [overflow-wrap:anywhere] whitespace-normal" data-no-translate={source === "file" || (source === "text" && draft.voice !== "clone") ? true : undefined}>
										{source === "file" ? fileName : draft.voice === "clone" ? t("Voice of this clip") : source === "timeline" ? t("Audio under the clip") : (voiceCards.find((c) => c.id === draft.voice)?.name ?? draft.voiceName)}
									</span>
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									<SelectLabel>{t("A voice says the text")}</SelectLabel>
									{voiceCards.map((c) => (
										<SelectItem key={c.id} value={c.id} className="text-xs" data-lipsync-sound-option={c.id}>
											{c.id === "clone" ? t("Voice of this clip (cloned)") : c.name}
											{c.hint && c.id !== "clone" ? <span className="text-muted-foreground ml-1.5">{t(c.hint)}</span> : null}
										</SelectItem>
									))}
								</SelectGroup>
								<SelectSeparator />
								<SelectGroup>
									<SelectLabel>{t("A recording")}</SelectLabel>
									<SelectItem value="timeline" disabled={!clip || audioBelow === 0} className="text-xs" data-lipsync-sound-option="timeline">
										{t("Audio under the clip")}
										{audioBelow > 0 ? <span className="text-muted-foreground ml-1.5">· {audioBelow}</span> : null}
									</SelectItem>
									{audioFiles
										.map((x) => x.split("\t"))
										.map(([id, name]) => (
											<SelectItem key={id} value={`media:${id}`} className="text-xs" data-lipsync-sound-option={`media:${id}`}>
												<span data-no-translate>{name}</span>
											</SelectItem>
										))}
									<SelectItem value="pick-file" className="text-xs" data-lipsync-sound-option="pick-file">
										{t("Choose a file…")}
									</SelectItem>
								</SelectGroup>
							</SelectContent>
						</Select>
						{source === "text" && sample && <SampleButton url={sample} />}
					</div>
				</Field>
				{source === "text" && (
					<div className="flex flex-col gap-1.5">
						<Textarea
							rows={3}
							className="min-h-16 resize-none text-sm"
							aria-label={t("Voice-over text")}
							placeholder={t("What they say")}
							data-lipsync-text
							value={draft.text}
							onChange={(e) => patch({ text: e.target.value })}
							onKeyDown={(e) => {
								// ⌘↵ (Ctrl+Enter): the one button
								if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
									e.preventDefault();
									e.stopPropagation();
									go();
								}
							}}
						/>
						<div className="flex flex-wrap items-center justify-end gap-1.5">
							<span className="text-muted-foreground min-w-[5rem] flex-1 text-[11px] tabular-nums" data-testid="text-length">
								{text ? `${text.length} · ≈ ${sec(estimateSeconds)}${videoSeconds > 0 ? ` / ${sec(videoSeconds)}` : ""}` : t("Any length")}
							</span>
							{text && videoSeconds > 0 && estimateSeconds > videoSeconds + 0.4 && (
								<Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={fitting} onClick={() => void shorten()}>
									{fitting && <Spinner className="size-3" />}
									{t("Shorten")}
								</Button>
							)}
							<ScriptButton projectId={key} seconds={videoSeconds || 10} context={clip?.asset.name ?? ""} />
						</div>
					</div>
				)}
				{speech && (
					<div className="flex items-center gap-2" data-speech>
						{/* biome-ignore lint/a11y/useMediaCaption: speech preview */}
						<audio ref={audio} controls src={studioApi.fileUrl(speech.fileId)} className="h-8 min-w-0 flex-1 [color-scheme:dark]" preload="metadata" />
						<span className={cn("shrink-0 text-[11px] tabular-nums", current ? "text-muted-foreground" : "text-amber-500")}>{current ? sec(speech.seconds) : t("outdated")}</span>
					</div>
				)}

				{/* The clip: one line — its preview, name and piece; Lipsync or Voice only. */}
				<ClipLine clip={clip} piece={pieceLine} empty={videoCount === 0 ? "Put a video on the timeline, then select it" : hasSelection ? "Pick a video clip on the timeline" : "Select a video clip on the timeline"}>
					<Segmented
						value={audioOnly ? "audio" : "lipsync"}
						options={[
							{ value: "lipsync", label: t("Lipsync") },
							{ value: "audio", label: t("Voice under the clip") },
						]}
						onChange={(v) => patch({ audioOnly: v === "audio" })}
					/>
				</ClipLine>
				{source === "text" && (
					<Field label="Voice">
						<VoiceModelSelect className="h-auto min-h-8 py-1 [&_.truncate]:whitespace-normal" />
					</Field>
				)}

				{/* Model and length */}
				{!audioOnly && (
					<Field label="Model">
						<ModelLadder
							models={models}
							chosen={{ id: model.id, title: model.title }}
							pf={pf}
							checked={checked}
							sentSeconds={sentVideo}
							money={money}
							exact={exact}
							remade={remade}
							open={ladderOpen}
							onOpenChange={setLadderOpen}
							onChoose={(id) => patch({ model: id })}
							missingKey={(m) => (anyKey && !onApis.includes(apiOf(m)) ? apiOf(m) : undefined)}
						/>
					</Field>
				)}
				{!audioOnly && model.id.startsWith("volcengine/") && (
					<Field label="Mode">
						<div className="flex min-w-0 flex-col gap-1">
							<Segmented id="kie-mode" value={draft.kieMode ?? "lite"} options={[{ value: "lite", label: "Lite" }, { value: "basic", label: "Basic" }]} onChange={(v) => patch({ kieMode: v as "lite" | "basic" })} />
							<span className="text-muted-foreground text-[10.5px] leading-tight">{t((draft.kieMode ?? "lite") === "lite" ? "One person facing the camera, up to 240 s" : "Harder scenes, up to 210 s")}</span>
						</div>
					</Field>
				)}
				{!audioOnly && fitChoices && speech && (
					<Field label="Length">
						<Select value={fit} onValueChange={(v) => patch({ fit: v as FitChoice })}>
							<SelectTrigger className="h-auto min-h-8 py-1 text-xs" data-testid="fit">
								<SelectValue>
									<span className="block min-w-0 text-left whitespace-normal">{t(fitChoices.find((o) => o.id === fit)?.label ?? "")}</span>
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								{fitChoices.map((o) => (
									<SelectItem key={o.id} value={o.id} className="text-xs" data-fit-option={o.id}>
										{t(o.label)} <span className="text-muted-foreground ml-1.5">{t(o.hint, Object.fromEntries(Object.entries(o.vars ?? {}).map(([k, v]) => [k, k === "n" ? v : sec(v)])))}</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
				)}

				{/* What goes to fal: the clip and the voice as two bars, the sent piece lit; its start on a slider. */}
				{!audioOnly && clip && speech && current && plan?.base && (
					<LengthBars
						clipSeconds={plan.base.end - plan.base.start}
						speechSeconds={speech.seconds}
						sentFrom={plan.offset}
						sentSeconds={sentVideo}
						api={lipApi}
						fit={fit}
						maxOffset={plan.maxOffset}
						step={1 / projectFps(editor)}
						onOffset={(v) => patch({ offset: v })}
					/>
				)}

				{/* Where the result goes */}
				{!audioOnly && clip && (
					<Field label="Where">
						<div className="flex min-w-0 flex-col gap-1">
							<Segmented
								id="place"
								value={place}
								options={[
									{ value: "replace", label: t("In place") },
									{ value: "above", label: t("Above the clip") },
									{ value: "insert", label: t("Insert, shift") },
								]}
								onChange={(v) => patch({ place: v as LipPlace, replaceClip: v !== "above" })}
							/>
							<span className="text-muted-foreground text-[10.5px] leading-tight" data-testid="place-hint">
								{t(placeHint)}
							</span>
						</div>
					</Field>
				)}

				{/* Mute and captions */}
				<div className="flex flex-wrap gap-1.5 empty:hidden" data-lipsync-toggles>
					{toggles
						.filter((x) => x.show)
						.map((x) => (
							<button
								key={x.id}
								type="button"
								aria-pressed={x.on}
								data-lipsync-toggle={x.id}
								onClick={() => x.set(!x.on)}
								className={cn("rounded-full border px-2.5 py-1 text-[11px] transition-colors", x.on ? "border-primary/60 bg-primary/15 text-foreground" : "text-muted-foreground hover:text-foreground border-border")}
							>
								{x.on ? "✓ " : ""}
								{t(x.label)}
							</button>
						))}
				</div>

				{/* The checks: one line when all is well, the warnings otherwise */}
				{speech && current && !audioOnly && (
					<div className="flex flex-col gap-1 text-[11px]" data-testid="preflight">
						{!checked && (
							<span className="text-muted-foreground flex items-center gap-1.5">
								<Spinner className="size-3" /> {t("Checking the clip…")}
							</span>
						)}
						{check.error && checked && <span className="text-destructive">{sayStudio(check.error)}</span>}
						{pf && checked && (
							<span className="text-muted-foreground" data-testid="result-seconds" data-seconds={String(resultSeconds)}>
								{pfWarnings.length ? t("Result ≈ {s}", { s: sec(resultSeconds) }) : `✓ ${t("All good · result ≈ {s}", { s: sec(resultSeconds) })}`}
							</span>
						)}
						{pf &&
							checked &&
							pfWarnings.map((c) => (
								<span key={c.text} className={cn(c.level === "warn" ? "text-amber-500" : "text-destructive")}>
									{c.level === "warn" ? "! " : "✕ "}
									{sayStudio(c.text)}
								</span>
							))}
					</div>
				)}

				{/* Versions of this piece: chips, the one on the timeline marked */}
				{versions.length > 0 && (
					<div className="flex flex-wrap items-center gap-1.5" data-lipsync-versions>
						<span className="text-muted-foreground text-[11px]">{t("Versions")}</span>
						{versions.map((v, i) => (
							<button
								key={v.assetId}
								type="button"
								data-lipsync-version={v.assetId}
								data-no-translate
								title={`${v.name} · ${sec(v.length)}${v.cost ? ` · ${money(v.cost)}` : ""}`}
								onClick={() => showing !== v.assetId && applyLipVersion(editor, vKey, v.assetId)}
								className={cn("rounded-md border px-2 py-0.5 text-[11px] tabular-nums", showing === v.assetId ? "border-primary bg-primary/15" : "hover:bg-accent border-border")}
							>
								{t("v{n}", { n: versions.length - i })} · {v.model || "—"}
							</button>
						))}
					</div>
				)}
			</div>

			{dock ? createPortal(footer, dock) : footer}

			<AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("Spend {sum}?", { sum: money(pressSum(confirm ?? {})) })}</AlertDialogTitle>
						<AlertDialogDescription asChild>
							<div className="flex flex-col gap-1.5 text-sm" data-lipsync-confirm>
								{needVoice && <span>{t("Voice: {n} characters, {model} · {sum}", { n: text.length, model: tts.title, sum: money(voiceUsd) })}</span>}
								{!confirm?.voiceOnly && !confirm?.sample && !audioOnly && <span>{t("Lipsync: {s} of video, {model} · {sum}", { s: sec(pf?.plan?.secondsSent ?? pf?.seconds ?? sentVideo), model: model.title, sum: money(lipUsd) })}</span>}
								<span className="text-muted-foreground text-xs">{t("Above the limit of Settings → AI ({sum})", { sum: money(limit) })}</span>
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							data-confirm-go
							onClick={() => {
								const o = confirm ?? {};
								setConfirm(null);
								run(o);
							}}
						>
							{t(confirm?.voiceOnly ? "Voice only" : confirm?.sample ? "Sample" : label)}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

/** A labelled row: the label on the left, its control on the right (one line each, no tall steps). */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
	const t = useT();
	return (
		<div className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2">
			<span className="text-muted-foreground text-[11px]">{t(label)}</span>
			{children}
		</div>
	);
}

/** The clip in one line: a small preview that plays only the piece, its name and piece, and the mode. */
function ClipLine({ clip, piece, empty, children }: { clip: ClipRef | null; piece: string; empty: string; children: React.ReactNode }) {
	const t = useT();
	if (!clip) {
		return (
			<div className="text-muted-foreground rounded-md border border-dashed px-3 py-3 text-center text-xs" data-testid="clip-empty">
				{t(empty)}
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-2" data-testid="clip-card">
			<div className="flex min-w-0 items-center gap-2.5">
				<div className="w-24 shrink-0">
					<ClipPreview url={clip.asset.url} poster={clip.asset.thumbnailUrl} start={clip.start} length={clip.length} compact />
				</div>
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="truncate text-xs font-medium" data-no-translate title={clip.asset.name}>
						{clip.asset.name}
					</span>
					<span className="text-muted-foreground text-[11px] tabular-nums [overflow-wrap:anywhere]">
						{tc(clip.at)}–{tc(clip.at + clip.length)} · {piece}
					</span>
				</div>
			</div>
			{children}
		</div>
	);
}

/** ▶ for the chosen voice's sample. */
function SampleButton({ url }: { url: string }) {
	const [playing, setPlaying] = useState(false);
	const player = useRef<HTMLAudioElement | null>(null);
	useEffect(() => () => player.current?.pause(), []);
	return (
		<Button
			type="button"
			size="icon"
			variant="ghost"
			className="size-8 shrink-0"
			aria-label={playing ? "Stop the sample" : "Play the sample"}
			onClick={() => {
				if (playing) {
					player.current?.pause();
					setPlaying(false);
					return;
				}
				const a = new Audio(url);
				player.current = a;
				a.onended = () => setPlaying(false);
				void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
			}}
		>
			<HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} className="size-3.5" />
		</Button>
	);
}

/** The trimmed piece of the clip: click to play it with sound, it stops at the clip's end. */
function ClipPreview({ url, poster, start, length, compact = false }: { url?: string; poster?: string; start: number; length: number; compact?: boolean }) {
	const video = useRef<HTMLVideoElement>(null);
	const [playing, setPlaying] = useState(false);
	const [at, setAt] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new length reloads the preview
	useEffect(() => {
		const v = video.current;
		if (!v || !url) return;
		v.pause();
		setAt(0);
		const seek = () => {
			v.currentTime = start + 0.001;
		};
		if (v.readyState >= 1) seek();
		else v.addEventListener("loadedmetadata", seek, { once: true });
	}, [url, start, length]);
	const toggle = () => {
		const v = video.current;
		if (!v) return;
		if (v.paused) {
			if (v.currentTime < start || v.currentTime >= start + length - 0.05) v.currentTime = start;
			void v.play().catch(() => {});
		} else v.pause();
	};
	if (!url) return null;
	return (
		<div className="relative overflow-hidden rounded-lg bg-black">
			{/* biome-ignore lint/a11y/useMediaCaption: clip preview */}
			<video
				ref={video}
				src={url}
				poster={poster}
				playsInline
				preload="auto"
				data-testid="clip-preview"
				className={cn("w-full cursor-pointer object-contain", compact ? "aspect-video h-auto" : "h-44")}
				onClick={toggle}
				onPlay={() => setPlaying(true)}
				onPause={() => setPlaying(false)}
				onTimeUpdate={(e) => {
					const v = e.currentTarget;
					setAt(Math.max(0, v.currentTime - start));
					if (v.currentTime >= start + length) {
						v.pause();
						v.currentTime = start;
					}
				}}
			/>
			<div className={cn("pointer-events-none absolute flex items-center justify-between", compact ? "right-1 bottom-1 left-1" : "right-2 bottom-2 left-2")}>
				<button
					type="button"
					aria-label={playing ? "Pause the clip" : "Play the clip"}
					className={cn("pointer-events-auto flex items-center justify-center rounded-full bg-black/60 text-white", compact ? "size-5" : "size-7")}
					onClick={toggle}
				>
					<HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} className={compact ? "size-3" : "size-3.5"} />
				</button>
				{!compact && (
					<span className="rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white tabular-nums">
						{tc(Math.min(at, length))} / {tc(length)}
					</span>
				)}
			</div>
		</div>
	);
}

/** A quiet segmented control (same look as the editor's toggles). */
function Segmented({
	id,
	value,
	options,
	onChange,
}: {
	id?: string;
	value: string;
	options: Array<{ value: string; label: string; hint?: string }>;
	onChange: (v: string) => void;
}) {
	return (
		<div className="bg-accent flex flex-wrap gap-0.5 rounded-md p-0.5" role="radiogroup" data-segmented={id}>
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					role="radio"
					aria-checked={value === o.value}
					data-option={o.value}
					title={o.hint}
					className={cn(
						"flex min-w-fit flex-1 flex-col items-center rounded-sm px-1.5 py-1 text-center text-xs leading-tight transition-colors",
						value === o.value ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
					)}
					onClick={() => onChange(o.value)}
				>
					<span>{o.label}</span>
					{o.hint && <span className="text-muted-foreground text-[10px] tabular-nums">{o.hint}</span>}
				</button>
			))}
		</div>
	);
}

/**
 * The clip and the voice as two bars on one scale: the part of the clip that goes to fal is lit (with the slider for
 * where it starts when the voice is shorter); a longer voice shows the video's made-up part (loop, ping-pong, still)
 * or, for «Cut the voice», the voice's cut-off part dimmed.
 */
function LengthBars({
	clipSeconds,
	speechSeconds,
	sentFrom,
	sentSeconds,
	api,
	fit,
	maxOffset,
	step,
	onOffset,
}: {
	clipSeconds: number;
	speechSeconds: number;
	sentFrom: number;
	sentSeconds: number;
	api: string;
	fit: FitChoice;
	maxOffset: number;
	step: number;
	onOffset: (v: number) => void;
}) {
	const t = useT();
	const total = Math.max(clipSeconds, speechSeconds, 0.1);
	const pct = (s: number) => `${Math.max(0, Math.min(100, (s / total) * 100))}%`;
	const longer = speechSeconds > clipSeconds + 0.05;
	const made = longer && fit !== "cut" && fit !== "speed" && fit !== "extend";
	const cut = longer && fit === "cut";
	const lit = Math.min(sentSeconds, clipSeconds);
	return (
		<div className="flex flex-col gap-1.5 rounded-md border px-2.5 py-2" data-testid="length-bars">
			<div className="grid grid-cols-[3rem_minmax(0,1fr)_3.25rem] items-center gap-2 text-[11px]">
				<span className="text-muted-foreground">{t("Clip")}</span>
				<div className="bg-accent/50 relative h-3 overflow-hidden rounded-sm">
					<div className="bg-muted-foreground/25 absolute inset-y-0 left-0 rounded-sm" style={{ width: pct(clipSeconds) }} />
					<div className="bg-primary/80 absolute inset-y-0 rounded-sm" style={{ left: pct(sentFrom), width: pct(lit) }} data-testid="sent-window" />
					{made && <div className="bg-primary/35 absolute inset-y-0 rounded-sm [background-image:repeating-linear-gradient(45deg,transparent_0_3px,rgba(0,0,0,.25)_3px_6px)]" style={{ left: pct(clipSeconds), width: pct(speechSeconds - clipSeconds) }} />}
				</div>
				<span className="text-muted-foreground text-right tabular-nums">{sec(clipSeconds)}</span>
				<span className="text-muted-foreground">{t("Voice")}</span>
				<div className="bg-accent/50 relative h-3 overflow-hidden rounded-sm">
					<div className="absolute inset-y-0 rounded-sm bg-emerald-500/70" style={{ left: pct(sentFrom), width: pct(cut ? clipSeconds : speechSeconds) }} />
					{cut && <div className="absolute inset-y-0 rounded-sm bg-emerald-500/20" style={{ left: pct(clipSeconds), width: pct(speechSeconds - clipSeconds) }} />}
				</div>
				<span className="text-muted-foreground text-right tabular-nums">{sec(speechSeconds)}</span>
			</div>
			<span className="text-muted-foreground text-[10.5px] tabular-nums" data-testid="sent-line">
				{t("Goes to {api}: {s} of video", { api: api === "kie" ? "kie.ai" : "fal.ai", s: sec(sentSeconds) })}
				{maxOffset > 0 ? ` · ${t("from {t} of the clip", { t: sec(sentFrom) })}` : ""}
			</span>
			{maxOffset > 0 && (
				<div className="flex items-center gap-2" data-testid="offset">
					<span className="text-muted-foreground shrink-0 text-[11px]">{t("Start")}</span>
					<Slider
						min={0}
						max={maxOffset}
						step={step}
						value={[sentFrom]}
						onValueChange={([v]) => onOffset(v)}
						aria-label={t("Start of the piece")}
						className="flex-1"
					/>
				</div>
			)}
		</div>
	);
}
