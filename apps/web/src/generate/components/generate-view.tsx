"use client";

// Left panel → Audio → Text to speech: the voice-over generator on this Mac (pictures, video and music come through
// fal.ai). A voice-over goes onto the timeline at the playhead as soon as it is ready (it is made for the cut that is
// open); other takes stay under the form until taken. Describe it, press the button.
import { useEffect, useMemo, useRef } from "react";
import { HugeiconsIcon } from "@/components/ui/icon";
import { AiMagicIcon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { estimate, falChoice, isCloneVoice, openFalSettings, useApiKey, useApiOf, useFal, useFalTts, useKeys } from "@/fal/client";
import { VoiceModelSelect } from "@/fal/components/voice-model-select";
import { apiOf, price, usd } from "@/fal/models";
import { useEditor } from "@/editor/use-editor";
import { currentClip } from "@/studio/client/editor-bridge";
import { resolveKey, useStudioStore } from "@/studio/client/studio-store";
import { ScriptButton } from "@/studio/components/script-button";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cancelGenerate, discardResult, generate, type GeneratorKind, resultUrl, takeResult, useDraft, useGenerateStore } from "../run";
import { SourceResult } from "@/media/source-result";
import { studioApi } from "@/studio/client/api";
import { useT } from "@/i18n";
import { AddYourVoice, removeSavedVoice, useSavedVoices } from "./my-voices";
import { myCards, readyCards, trendCards, useVoiceLang, VoicePicker } from "./voice-picker";

export { VOICES } from "../voices";

function RunButton(props: { kind: GeneratorKind; disabled: boolean; onRun: () => void; label: string; needsFal?: boolean }) {
	return (
		<>
			<RunOrProgress {...props} />
			<LastResult kind={props.kind} />
		</>
	);
}

function RunOrProgress({ kind, disabled, onRun, label, needsFal = false }: { kind: GeneratorKind; disabled: boolean; onRun: () => void; label: string; needsFal?: boolean }) {
	const running = useGenerateStore((s) => s.running[kind]);
	// No key for the voice model yet (or a cloned voice without a fal key): the button stays, off; LocalGenerator says where the key goes.
	const unsupported = useApiKey("tts") === false || needsFal;
	if (running) {
		return (
			<div className="flex flex-col gap-1.5" data-generate-running={kind}>
				<div className="bg-muted relative h-8 overflow-hidden rounded-md">
					<div className="bg-primary/25 absolute inset-y-0 left-0 transition-[width] duration-300" style={{ width: `${Math.round(running.progress * 100)}%` }} />
					<div className="relative flex h-full items-center justify-between px-3 text-xs">
						<span className="truncate">{running.stage}</span>
						<button type="button" aria-label="Cancel" className="text-muted-foreground hover:text-foreground" onClick={() => cancelGenerate(kind)}>
							<HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
						</button>
					</div>
				</div>
			</div>
		);
	}
	return (
		<Button className="h-9 w-full gap-1.5" disabled={disabled || unsupported} onClick={onRun} data-generate-run={kind}>
			<HugeiconsIcon icon={AiMagicIcon} className="size-4" />
			{label}
		</Button>
	);
}

/** The generator's results, newest first, until taken (+ → Media; drag / double-click → timeline) or discarded. */
function LastResult({ kind }: { kind: GeneratorKind }) {
	const all = useGenerateStore((s) => s.results);
	const results = useMemo(() => all.filter((r) => r.kind === kind), [all, kind]);
	// A new take comes into view (it lands under the form, often below the panel's edge).
	const box = useRef<HTMLDivElement>(null);
	const newest = results[0]?.id;
	useEffect(() => {
		if (newest) box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}, [newest]);
	if (!results.length) return null;
	return (
		<div ref={box} className="grid grid-cols-2 gap-2" data-generate-results={kind}>
			{results.map((r) => (
				<SourceResult key={r.id} id={r.id} name={r.name} kind="audio" url={resultUrl(r)} take={() => takeResult(r)} onDiscard={() => discardResult(r.id)} />
			))}
		</div>
	);
}

/** One voice sample at a time (a click on a voice plays its own recording, as in CapCut; a second click stops it). */
function VoiceForm({ projectId, cloneNeedsFal }: { projectId: string; cloneNeedsFal: boolean }) {
	const t = useT();
	// the price on «Create» follows the voice model picked above
	useFal((s) => s.status?.choices.tts);
	const [speaker, setSpeaker] = useDraft("voice.speaker", "ryan");
	const [text, setText] = useDraft("voice.text", "");
	// The script written with Gaziyav AI (here, or in the Lipsync window) is what the voice says: it lands in this box as
	// soon as it is written (check-flow, 06.11: it stayed in the Lipsync box and had to be copied by hand).
	const script = useStudioStore((s) => (projectId ? (s.drafts[resolveKey(s, projectId)]?.text ?? "") : ""));
	const lastScript = useRef<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: only a new script moves into the box (and one written before the panel opened, into an empty box)
	useEffect(() => {
		const first = lastScript.current === null;
		if (script === lastScript.current) return;
		lastScript.current = script;
		if (script.trim() && (!first || !text.trim())) setText(script);
	}, [script]);
	const clipLen = useEditor((e) => currentClip(e)?.length ?? 0);
	const clipName = useEditor((e) => currentClip(e)?.asset.name ?? "");
	// A cloned voice (the clip's own, My voices) speaks on fal's speech model whatever voice model is picked: kie.ai has no
	// clones. The button, the price and the hint say so (check-ai D1, 06.11: the button showed ElevenLabs' price, fal's Qwen ran).
	const cloned = isCloneVoice(speaker);
	const picked = falChoice("tts");
	const falTts = useFalTts();
	const tts = cloned ? falTts : picked;
	const [style, setStyle] = useDraft("voice.style", "");
	// A trending voice (a ready voice + its sound) or "" for a plain ready voice / one of My voices.
	const [trend, setTrend] = useDraft("voice.trend", "");
	const lang = useVoiceLang(text);
	const saved = useSavedVoices();
	const addRef = useRef<HTMLInputElement>(null);
	const cards = useMemo(() => [...trendCards(lang.ui, lang.sample), ...readyCards(), ...myCards(saved)], [lang.ui, lang.sample, saved]);
	const pick = (id: string) => {
		if (id.startsWith("trend:")) setTrend(id.slice(6));
		else {
			setSpeaker(id);
			setTrend("");
		}
	};
	const label = text.trim()
		? `${t("Create")} · ${estimate(tts, text.trim().length)}${cloned ? ` ${t("(+ a one-time clone {p})", { p: usd(price(falChoice("clone"), 30)) })}` : ""}`
		: t("Create");
	return (
		// The text and Create first, the voices under them (check-flow A3, 06.11: they sat below 17 tiles, out of sight); compact
		// enough for the 1024×640 panel: a three-line box, the script button beside the style field.
		<div className="flex flex-col gap-2.5 [@media(max-height:700px)]:gap-2">
			<Textarea
				value={text}
				onChange={(e) => setText(e.target.value)}
				placeholder="What should the voice say?"
				rows={3}
				className="min-h-16 resize-none text-sm [@media(max-height:700px)]:min-h-12"
				data-generate-prompt="voice"
			/>
			<div className="flex items-center gap-1.5">
				{!trend && !cloned && <input
					value={style}
					onChange={(e) => setStyle(e.target.value)}
					placeholder="Style (optional): excited, calm, whisper…"
					className="border-input placeholder:text-muted-foreground h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2.5 text-xs outline-none focus:border-primary"
				/>}
				{projectId && <ScriptButton projectId={projectId} seconds={clipLen || 15} context={clipName || "voice-over"} />}
			</div>
			{cloned && !cloneNeedsFal && apiOf(picked) !== "fal" && (
				<p className="text-muted-foreground text-[11px] leading-snug" data-generate-clone-note>
					{t("A cloned voice speaks on fal.ai with {model} ({price}/1k): kie.ai has no voice clones.", { model: tts.title, price: usd(price(tts, 1000)) })}
				</p>
			)}
			<RunButton
				kind="voice"
				disabled={!text.trim()}
				needsFal={cloned && cloneNeedsFal}
				onRun={() => void generate("voice", trend ? { text, trend } : { text, speaker, style }, { place: true })}
				label={label}
			/>
			<VoicePicker
				label="tts"
				cards={cards}
				value={trend ? `trend:${trend}` : speaker}
				onPick={pick}
				onAdd={() => addRef.current?.click()}
				onRemove={(id) => void removeSavedVoice(id, t).then((gone) => gone && speaker === id && setSpeaker("ryan"))}
			/>
			<AddYourVoice inputRef={addRef} onAdded={pick} />
		</div>
	);
}

/** Text to speech on its own (CapCut's place: Audio → Text to speech), on fal.ai with the user's key. */
export function LocalGenerator({ kind }: { kind: "voice"; onPoint?: () => void }) {
	const t = useT();
	const missing = useApiKey("tts") === false;
	const ai = useApiOf("tts");
	const keys = useKeys();
	const projectId = useEditor((e) => e.project.getActiveOrNull()?.metadata.id ?? "");
	const [speaker] = useDraft("voice.speaker", "ryan");
	// A cloned voice needs the fal key: said before «Create», not after it (check-ai D5, 06.11: with only a kie key the button was on, priced, and failed).
	const cloneNeedsFal = isCloneVoice(speaker) && !!keys && !keys.fal;
	useEffect(() => {
		void useFal.getState().refresh();
	}, []);
	return (
		<div className="flex flex-col gap-3 px-3 py-3" data-local-generator={kind}>
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-medium">{t("Text to speech")}</span>
				<VoiceModelSelect className="h-7 w-auto max-w-[62%]" />
			</div>
			{(missing || cloneNeedsFal) && (
				<div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-generate-unsupported={kind}>
					<span>{t(cloneNeedsFal ? "Cloning a voice runs on fal.ai: add a fal.ai key, or pick a ready voice." : ai === "kie" ? "Add your kie.ai key to voice text." : "Add your fal.ai key to voice text.")}</span>
					<button type="button" className="text-foreground underline underline-offset-2" onClick={openFalSettings}>
						{t("Settings")}
					</button>
				</div>
			)}
			<VoiceForm projectId={projectId} cloneNeedsFal={cloneNeedsFal} />
		</div>
	);
}
