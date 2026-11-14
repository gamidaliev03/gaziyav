"use client";

// AI avatar → Video translator, as in CapCut: the selected clip's speech is heard on this Mac (Whisper) and translated
// by Gaziyav AI; the translation can be corrected; then it is spoken in the person's own voice (cloned on this Mac, with
// their consent) and — with Lipsync on — the lips follow the new words, otherwise the new voice goes under the clip.
// The result lands on the timeline as one ⌘Z. The Lipsync panel's own pipeline (assist/dub.ts, studio/client/actions.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import { applyDubText, type DubText, translateClipSpeech } from "@/assist/dub";
import { DUB_LANGUAGES, dubLanguage } from "@/assist/languages";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { falChoice, isCloneVoice, unitPrice, useFal, useFalTts } from "@/fal/client";
import { apiOf, falModel, price, usd } from "@/fal/models";
import { estimateSpeechSeconds, LIPSYNC_TAIL_SECONDS } from "@/studio/shared/models";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import { chosenModel, lipsync, refreshServer, voiceOnly, voiceover } from "@/studio/client/actions";
import { currentClip, selectedVideoId } from "@/studio/client/editor-bridge";
import { isRunning, resolveKey, useStudioStore } from "@/studio/client/studio-store";
import { RunProgress } from "@/studio/components/run-status";
import { AddYourVoice, useSavedVoices } from "./my-voices";
import { myCards, readyCards, trendCards, useVoiceLang, type VoiceCard, VoicePicker } from "./voice-picker";

const LANG_KEY = "gaziyav.dub.language";
const LANGUAGES = DUB_LANGUAGES.filter((l) => l.local);

function savedLanguage(): string {
	try {
		const v = localStorage.getItem(LANG_KEY);
		if (v && dubLanguage(v)?.local) return v;
	} catch {}
	return "en";
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const lipsyncOnNow = (draft: { audioOnly?: boolean } | undefined) => !draft?.audioOnly;

export function VideoTranslator() {
	const t = useT();
	const editor = useEditor();
	const projectId = useEditor((e) => e.project.getActiveOrNull()?.metadata.id ?? "");
	const clipKey = useEditor((e) => {
		const c = currentClip(e);
		return c ? `${c.elementId}|${c.asset.id}|${c.at}|${c.length}` : "";
	});
	const selectedVideo = useEditor((e) => selectedVideoId(e) ?? "");
	const clip = useMemo(() => (clipKey ? currentClip(editor) : null), [clipKey, editor]);
	const runs = useStudioStore((s) => s.runs);
	const voiceRun = runs.voiceover?.projectId === projectId ? runs.voiceover : undefined;
	const lipRun = runs.lipsync?.projectId === projectId ? runs.lipsync : undefined;
	const draft = useStudioStore((s) => s.drafts[resolveKey(s, projectId)]);
	const { patch, pin } = useStudioStore.getState();

	const [language, setLanguage] = useState(savedLanguage);
	const [stage, setStage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [heard, setHeard] = useState<DubText | null>(null);
	const [text, setText] = useState("");
	const [consent, setConsent] = useState(false);
	// The voice of the dub: the person's own (cloned from the clip, with consent) or any voice of the picker.
	const [voice, setVoice] = useState("clone");
	const saved = useSavedVoices();
	const addRef = useRef<HTMLInputElement>(null);
	const lang = useVoiceLang();
	const own = useMemo(() => (clip?.asset.file ? URL.createObjectURL(clip.asset.file) : null), [clip]);
	useEffect(() => () => (own ? URL.revokeObjectURL(own) : undefined), [own]);
	const cards = useMemo<VoiceCard[]>(
		() => [
			{ id: "clone", name: t("Original voice"), hint: "The person's own voice, cloned from the clip", sample: own, groups: [] },
			...trendCards(lang.ui),
			...readyCards(),
			...myCards(saved),
		],
		[own, lang.ui, saved, t],
	);
	const cloning = voice === "clone";
	const [dubbing, setDubbing] = useState(false);
	const [confirm, setConfirm] = useState(false);
	// The price before anything is spent (check-ai D2, 06.11: the dub ran for ≈ $0.20 with no price and no question): the
	// voice (a cloned voice speaks on fal's speech model whatever voice model is picked), the clone once, the lipsync of
	// as much video as the new speech lasts (plus the tail after the last word), on the model picked in the Lipsync window.
	useFal((s) => s.status?.choices);
	const falTts = useFalTts();
	const ttsModel = isCloneVoice(voice) ? falTts : falChoice("tts");
	const chars = text.trim().length;
	const speechSeconds = chars ? estimateSpeechSeconds(chars, useStudioStore.getState().server?.settings.speechSpeed ?? 1) : (clip?.length ?? 0);
	const lipModel = chosenModel(projectId, speechSeconds);
	const lipCatalog = falModel(lipModel.id);
	const billSeconds = Math.min(lipCatalog?.maxSeconds ?? Number.POSITIVE_INFINITY, Math.max(1, speechSeconds + LIPSYNC_TAIL_SECONDS));
	const voiceUsd = chars ? price(ttsModel, chars, unitPrice(ttsModel)) : 0;
	const cloneUsd = cloning ? price(falChoice("clone")) : 0;
	const lipUsd = lipsyncOnNow(draft) && lipCatalog ? price(lipCatalog, billSeconds, unitPrice(lipCatalog)) : 0;
	const totalUsd = voiceUsd + cloneUsd + lipUsd;
	const abort = useRef<AbortController | null>(null);
	const lipsyncOn = !draft?.audioOnly;
	const replaceSpeech = draft?.muteOriginal ?? true;
	const busy = !!stage || dubbing || isRunning(voiceRun) || isRunning(lipRun);

	useEffect(() => {
		void refreshServer();
	}, []);
	// The clip picked on the timeline stays the one to translate after the selection is cleared (as in Lipsync).
	useEffect(() => {
		if (projectId && selectedVideo) pin(projectId, selectedVideo);
	}, [projectId, selectedVideo, pin]);
	// Another clip: its own translation.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when the clip changes
	useEffect(() => {
		setHeard(null);
		setText("");
		setError(null);
	}, [clipKey]);

	const pick = (v: string) => {
		setLanguage(v);
		try {
			localStorage.setItem(LANG_KEY, v);
		} catch {}
	};

	const translate = async () => {
		if (!clip || busy) return;
		const ctl = new AbortController();
		abort.current = ctl;
		setError(null);
		setStage(t("Hearing the speech"));
		try {
			const r = await translateClipSpeech({
				editor,
				clip,
				language,
				signal: ctl.signal,
				onStage: (s, p) => setStage(`${s}${p != null && p > 0 && p < 1 ? ` ${Math.round(p * 100)}%` : "…"}`),
			});
			if (ctl.signal.aborted) return;
			setHeard(r);
			setText(r.text);
		} catch (e) {
			const err = e as Error;
			setError(err.name === "AbortError" || ctl.signal.aborted ? t("Cancelled") : err.message.split("\n\nDetails:")[0]);
		} finally {
			if (abort.current === ctl) abort.current = null;
			setStage(null);
		}
	};

	const dub = async () => {
		if (!heard || !clip || !text.trim() || (cloning && !consent) || busy) return;
		setDubbing(true);
		setError(null);
		try {
			// The voice: the person's own (cloned from this clip) or the one picked; the corrected translation is what it says.
			patch(projectId, { source: "clip", voice });
			applyDubText(projectId, { ...heard, text: text.trim() });
			await voiceover(editor, projectId);
			const after = useStudioStore.getState();
			const run = after.runs.voiceover;
			if (run?.error) throw new Error(run.error);
			if (after.draft(projectId).speech?.text !== text.trim()) return; // cancelled or replaced meanwhile
			if (lipsyncOn) await lipsync(editor, projectId);
			else voiceOnly(editor, projectId);
			const lip = useStudioStore.getState().runs.lipsync;
			if (lipsyncOn && lip?.error) throw new Error(lip.error);
		} catch (e) {
			const err = e as Error;
			if (err.name !== "AbortError") setError(err.message.split("\n\nDetails:")[0]);
		} finally {
			setDubbing(false);
		}
	};

	const target = dubLanguage(language);
	const running = isRunning(lipRun) ? lipRun : isRunning(voiceRun) ? voiceRun : undefined;

	return (
		<PanelView title={t("Video translator")}>
			<div className="flex flex-col gap-3 px-3 pt-1 pb-4" data-video-translator>
				{/* no paragraph about how it works (the owner, 12.11): the price is on its button */}
				<div className="bg-accent/50 rounded-md px-2.5 py-2 text-xs" data-translator-clip>
					{clip ? (
						<span>
							{clip.asset.name} · {fmt(clip.length)}
						</span>
					) : (
						<span className="text-muted-foreground">{t("Select the clip with the person talking on the timeline")}</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs">{t("Translate into")}</span>
					<Select value={language} onValueChange={pick} disabled={busy}>
						<SelectTrigger aria-label={t("Language")} className="h-8 flex-1 text-xs" data-translator-language>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{LANGUAGES.map((l) => (
								<SelectItem key={l.code} value={l.code} className="text-xs">
									{l.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<Button size="sm" variant={heard ? "outline" : "default"} disabled={!clip || busy} onClick={() => void translate()} data-translator-run>
					{stage && <Spinner className="mr-1.5 size-3" />}
					{heard ? t("Translate again") : t("Translate")}
				</Button>
				{stage && (
					<div className="flex items-center justify-between gap-2 text-xs">
						<span className="text-muted-foreground truncate" data-translator-stage>
							{stage}
						</span>
						<Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>
							{t("Cancel")}
						</Button>
					</div>
				)}
				{heard && (
					<>
						<div className="text-muted-foreground text-[11px] leading-snug" data-translator-original>
							{t("Heard")}: {heard.original}
						</div>
						<Textarea
							value={text}
							onChange={(e) => setText(e.target.value)}
							className="min-h-24 resize-none text-sm"
							aria-label={t("Translation (you can correct it)")}
							data-translator-text
						/>
						<label htmlFor="translator-lipsync" className="flex items-center gap-2 text-xs">
							<Checkbox id="translator-lipsync" checked={lipsyncOn} onCheckedChange={(v) => patch(projectId, { audioOnly: v !== true })} data-translator-lipsync />
							{t("Lipsync: the lips follow the new words")}
						</label>
						{!lipsyncOn && (
							<label htmlFor="translator-replace" className="flex items-start gap-2 text-xs leading-snug">
								<Checkbox id="translator-replace" checked={replaceSpeech} onCheckedChange={(v) => patch(projectId, { muteOriginal: v === true })} className="mt-px" />
								{t("Replace the original speech (off: it plays quieter under the new voice)")}
							</label>
						)}
						<span className="text-xs font-medium">{t("Voice")}</span>
						<VoicePicker label="translator" cards={cards} value={voice} onPick={setVoice} onAdd={() => addRef.current?.click()} />
						<AddYourVoice inputRef={addRef} onAdded={setVoice} />
						{cloning && (
							<label htmlFor="translator-consent" className="flex items-start gap-2 text-xs leading-snug">
								<Checkbox id="translator-consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-px" data-translator-consent />
								{t("The person in the clip agreed to have their voice cloned")}
							</label>
						)}
						<Button size="sm" className="h-auto min-h-8 justify-between gap-2 whitespace-normal py-1" disabled={busy || !text.trim() || (cloning && !consent)} onClick={() => setConfirm(true)} data-translator-dub>
							<span className="flex items-center">
								{dubbing && <Spinner className="mr-1.5 size-3" />}
								{t(`Dub into ${target?.name ?? "the language"}`)}
							</span>
							<span className="shrink-0 tabular-nums opacity-80" data-translator-price={totalUsd.toFixed(4)}>
								≈ {usd(totalUsd)}
							</span>
						</Button>
					</>
				)}
				{running && <RunProgress run={running} part={lipsyncOn ? (running === lipRun ? { from: 0.3, span: 0.7 } : { from: 0, span: 0.3 }) : undefined} />}
				{error && (
					<p className="text-destructive text-xs whitespace-pre-wrap" data-translator-error>
						{error}
					</p>
				)}
			</div>
			<AlertDialog open={confirm} onOpenChange={setConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("Dub into {lang}?", { lang: target?.name ?? "" })}</AlertDialogTitle>
						<AlertDialogDescription asChild>
							<div className="flex flex-col gap-1.5 text-sm" data-translator-confirm>
								<span>{t("{n} characters with {model} on {api}: ≈ {usd}.", { n: chars, model: ttsModel.title, api: apiOf(ttsModel) === "kie" ? "kie.ai" : "fal.ai", usd: usd(voiceUsd) })}</span>
								{cloning && <span>{t("The voice of «{clip}» is cloned once ({usd}) and reused for free afterwards.", { clip: clip?.asset.name ?? "", usd: usd(cloneUsd) })}</span>}
								{lipsyncOn && lipCatalog && (
									<span>{t("Lipsync with {model} on {api}, about {s} s of video: ≈ {usd}.", { model: lipModel.title, api: apiOf(lipCatalog) === "kie" ? "kie.ai" : "fal.ai", s: billSeconds.toFixed(1), usd: usd(lipUsd) })}</span>
								)}
								<span className="text-muted-foreground">{t("The result lands on the timeline as one step (⌘Z brings the clip back).")}</span>
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							data-confirm-go
							onClick={() => {
								setConfirm(false);
								void dub();
							}}
						>
							{`${t("Dub")} · ≈ ${usd(totalUsd)}`}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PanelView>
	);
}
