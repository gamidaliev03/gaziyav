import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { extractTimelineAudio } from "@/media/mediabunny";
import { useEditor } from "@/editor/use-editor";
import { TRANSCRIPTION_DIAGNOSTICS_SCOPE } from "@/transcription/diagnostics";
import { DEFAULT_TRANSCRIPTION_SAMPLE_RATE } from "@/transcription/audio";
import { TRANSCRIPTION_LANGUAGES } from "@/transcription/supported-languages";
import type {
	CaptionChunk,
	TranscriptionLanguage,
	TranscriptionProgress,
} from "@/transcription/types";
import { transcriptionService } from "@/services/transcription/service";
import { decodeAudioToFloat32 } from "@/media/audio";
import { insertCaptionChunksAsTextTrack } from "@/subtitles/insert";
import { spreadPhraseWords } from "@/subtitles/chunk";
import { getCaptionStyle, useCaptionStyleStore } from "@/subtitles/styles";
import { TRANSLATE_LANGUAGES, translateCaptionTrack } from "@/subtitles/translate";
import { Spinner } from "@/components/ui/spinner";
import { generateLocalCaptions } from "@/transcribe/captions";
import { loadLanguage, loadWordsPerLine, MAX_WORDS_PER_LINE, saveLanguage, saveWordsPerLine } from "@/transcribe/prefs";
import { selectedSpeechClip, speechTargetLabel } from "@/transcribe/timeline";
import { RemovePauses } from "@/silence/components/remove-pauses";
import { CaptionsField, CaptionsForm, FooterCheck } from "./captions-form";

type ProcessingState =
	| { status: "idle"; error: string | null; warnings: string[] }
	| { status: "processing"; step: string };

type ProcessingAction =
	| { type: "start"; step: string }
	| { type: "update_step"; step: string }
	| { type: "succeed"; warnings: string[] }
	| { type: "fail"; error: string };

const IDLE_STATE: ProcessingState = {
	status: "idle",
	error: null,
	warnings: [],
};

/* eslint-disable opencut/prefer-object-params -- React reducers must accept (state, action). */
/** The captions run in progress (module scope: the tab can be closed and opened again while it runs). */
let captionRun: AbortController | null = null;

function processingReducer(
	state: ProcessingState,
	action: ProcessingAction,
): ProcessingState {
	switch (action.type) {
		case "start":
			return { status: "processing", step: action.step };
		case "update_step":
			if (state.status !== "processing") return state;
			return { status: "processing", step: action.step };
		case "succeed":
			return { status: "idle", error: null, warnings: action.warnings };
		case "fail":
			return { status: "idle", error: action.error, warnings: [] };
	}
}
/* eslint-enable opencut/prefer-object-params */

export function Captions() {
	const [selectedLanguage, setSelectedLanguageState] = useState<TranscriptionLanguage>(
		() => loadLanguage() as TranscriptionLanguage,
	);
	const setSelectedLanguage = (code: TranscriptionLanguage) => {
		setSelectedLanguageState(code);
		saveLanguage(code);
	};
	const [processing, dispatch] = useReducer(processingReducer, IDLE_STATE);
	// CapCut: «Bilingual captions» (None or a language: Gaziyav AI translates) and «Delete current captions».
	const [bilingual, setBilingual] = useState("none");
	// «Words per line»: 1–6 words on screen at once (the split was 1–3 words with nothing to change it).
	const [wordsPerLine, setWordsPerLineState] = useState(() => loadWordsPerLine());
	const setWordsPerLine = (n: number) => {
		setWordsPerLineState(n);
		saveWordsPerLine(n);
	};
	const [replaceCurrent, setReplaceCurrent] = useState(false);
	const templateName = useCaptionStyleStore((s) => getCaptionStyle(s.styleId).name);
	const localRun = useRef<AbortController | null>(null);
	const editor = useEditor();
	const targetLabel = useEditor((e) => speechTargetLabel(e));

	const isProcessing = processing.status === "processing";

	const activeDiagnostics = useEditor((e) =>
		e.diagnostics.getActive({ scope: TRANSCRIPTION_DIAGNOSTICS_SCOPE }),
	);

	const handleProgress = (progress: TranscriptionProgress) => {
		if (progress.status === "loading-model") {
			dispatch({
				type: "update_step",
				step: `Loading the speech model ${Math.round(progress.progress)}%`,
			});
		} else if (progress.status === "transcribing") {
			dispatch({ type: "update_step", step: "Transcribing..." });
		}
	};

	const insertCaptions = ({
		captions,
		replace = false,
		source,
	}: {
		captions: CaptionChunk[];
		replace?: boolean;
		/** The clip the speech was heard in: the captions follow it wherever it goes (timeline/linkage.ts). */
		source?: string;
	}): string | null => insertCaptionChunksAsTextTrack({ editor, captions, replace, maxWords: wordsPerLine, source });

	/** The generated track, then its translation just above it (Bilingual captions). */
	const finishCaptions = async (captions: CaptionChunk[], signal: AbortSignal, sceneId: string | null, source?: string): Promise<boolean> => {
		// Another timeline opened while the speech was heard: the captions go on the timeline they were made from.
		if (sceneId && !editor.scenes.returnTo({ sceneId })) return false;
		const trackId = insertCaptions({ captions, replace: replaceCurrent, source });
		if (!trackId) return false;
		if (bilingual !== "none") {
			dispatch({ type: "update_step", step: "Translating..." });
			try {
				await translateCaptionTrack({ editor, trackId, to: bilingual, mode: "bilingual", signal });
			} catch (error) {
				toast.error("Couldn't translate. Try again.", { description: error instanceof Error ? error.message : undefined });
			}
		}
		return true;
	};

	const handleGenerateTranscript = async () => {
		dispatch({ type: "start", step: "Extracting audio..." });
		// The clip whose speech is heard (final-A W1, 07.11): its captions follow it wherever it goes, even the first
		// one that Whisper puts a few hundredths before the clip's start.
		const source = selectedSpeechClip(editor)?.id;
		// One run at a time, also across a re-opened tab: a new run stops the old one.
		captionRun?.abort();
		const ac = new AbortController();
		captionRun = ac;
		localRun.current = ac;
		const sceneId = editor.scenes.getActiveSceneOrNull()?.id ?? null;
		// Cancel can't stop a model download or the in-browser fallback mid-way: their result is dropped instead.
		const cancelled = () => {
			if (!ac.signal.aborted) return false;
			dispatch({ type: "succeed", warnings: [] });
			return true;
		};
		try {
			// Default engine: local whisper-cli (offline, ~5 s per minute). In-browser Whisper is the fallback.
			const local = await generateLocalCaptions({
				editor,
				language: selectedLanguage,
				signal: ac.signal,
				maxWords: wordsPerLine,
				onStep: (step) => dispatch({ type: "update_step", step }),
			});
			if (cancelled()) return;
			if (local) {
				if (!(await finishCaptions(local, ac.signal, sceneId, source))) {
					dispatch({ type: "fail", error: "No captions were generated" });
					return;
				}
				dispatch({ type: "succeed", warnings: [] });
				return;
			}
			const audioBlob = await extractTimelineAudio({
				tracks: editor.scenes.getActiveScene().tracks,
				mediaAssets: editor.media.getAssets(),
				totalDuration: editor.timeline.getTotalDuration(),
			});

			dispatch({ type: "update_step", step: "Preparing audio..." });
			const { samples } = await decodeAudioToFloat32({
				audioBlob,
				sampleRate: DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
			});

			const result = await transcriptionService.transcribe({
				audioData: samples,
				language: selectedLanguage === "auto" ? undefined : selectedLanguage,
				onProgress: handleProgress,
			});

			if (cancelled()) return;
			dispatch({ type: "update_step", step: "Generating captions..." });
			// Phrase timings only: spread words over each phrase so the chosen
			// style can re-chunk them (Russian rules) and highlight words.
			const captionChunks: CaptionChunk[] = result.segments
				.filter((segment) => segment.text.trim())
				.map((segment) => ({
					text: segment.text.trim(),
					startTime: segment.start,
					duration: Math.max(0.3, segment.end - segment.start),
					words: spreadPhraseWords({
						text: segment.text.trim(),
						startTime: segment.start,
						duration: Math.max(0.3, segment.end - segment.start),
					}),
				}));

			if (!(await finishCaptions(captionChunks, ac.signal, sceneId))) {
				dispatch({ type: "fail", error: "No captions were generated" });
				return;
			}

			dispatch({ type: "succeed", warnings: [] });
		} catch (error) {
			if ((error as Error)?.name === "AbortError") {
				dispatch({ type: "succeed", warnings: [] });
				return;
			}
			console.error("Transcription failed:", error);
			// craft B: the failed speech job (on the clip, in the activity list) gets ↻ — the same Generate again
			void import("@/jobs/store").then(({ jobCenter, useJobsStore }) => {
				const failed = useJobsStore.getState().jobs.find((j) => j.kind === "transcribe" && j.status === "error" && !j.retry);
				if (failed) jobCenter.update(failed.id, { retry: () => void handleGenerateTranscript() });
			});
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: "An unexpected error occurred",
			});
		} finally {
			if (localRun.current === ac) localRun.current = null;
			if (captionRun === ac) captionRun = null;
		}
	};

	const handleLanguageChange = ({ value }: { value: string }) => {
		if (value === "auto") {
			setSelectedLanguage("auto");
			return;
		}

		const matchedLanguage = TRANSCRIPTION_LANGUAGES.find(
			(language) => language.code === value,
		);
		if (!matchedLanguage) return;
		setSelectedLanguage(matchedLanguage.code);
	};

	const error = processing.status === "idle" ? processing.error : null;
	const warnings = processing.status === "idle" ? processing.warnings : [];

	return (
		<CaptionsForm
			data-captions-auto
			footer={
				<>
					<FooterCheck id="captions-replace" checked={replaceCurrent} onChange={setReplaceCurrent} data-captions-replace>
						Delete current captions
					</FooterCheck>
					<div className="flex shrink-0 items-center gap-1">
						{isProcessing && localRun.current && (
							<Button type="button" size="sm" variant="ghost" onClick={() => localRun.current?.abort()} data-captions-cancel>
								Cancel
							</Button>
						)}
						<Button
							type="button"
							size="sm"
							onClick={handleGenerateTranscript}
							disabled={isProcessing || activeDiagnostics.length > 0}
							title={activeDiagnostics.length > 0 ? "Add a clip with speech to the timeline" : targetLabel}
							data-captions-generate
						>
							{isProcessing && <Spinner className="mr-1" />}
							{isProcessing ? processing.step : "Generate"}
						</Button>
					</div>
				</>
			}
		>
			<CaptionsField label="Spoken language">
				<Select value={selectedLanguage} onValueChange={(value) => handleLanguageChange({ value })}>
					<SelectTrigger data-captions-language>
						<SelectValue placeholder="Select a language" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="auto">Auto detect</SelectItem>
						{TRANSCRIPTION_LANGUAGES.map((language) => (
							<SelectItem key={language.code} value={language.code}>
								{language.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</CaptionsField>
			<CaptionsField label="Words per line">
				<Select value={String(wordsPerLine)} onValueChange={(value) => setWordsPerLine(Number(value))}>
					<SelectTrigger data-captions-words title="How many words a caption shows at once">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{Array.from({ length: MAX_WORDS_PER_LINE }, (_, i) => i + 1).map((n) => (
							<SelectItem key={n} value={String(n)} data-words-option={n}>
								{n}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</CaptionsField>
			<CaptionsField label="Bilingual captions">
				<Select value={bilingual} onValueChange={setBilingual}>
					<SelectTrigger data-captions-bilingual title="The translation is written by Gaziyav AI">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="none">None</SelectItem>
						{TRANSLATE_LANGUAGES.map((language) => (
							<SelectItem key={language} value={language} data-bilingual-option={language}>
								{language}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</CaptionsField>
			{/* craft B: the empty first state says what to do, in one line, with the gesture */}
			{!isProcessing && activeDiagnostics.length > 0 && (
				<p className="text-muted-foreground text-xs" data-empty-line>
					Drag a clip with speech onto the timeline
				</p>
			)}
			{error && (
				<div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
					<p className="text-destructive text-sm">{error}</p>
				</div>
			)}
			{warnings.length > 0 && (
				<div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3">
					<ul className="space-y-1 text-sm text-amber-700">
						{warnings.map((warning) => (
							<li key={warning}>{warning}</li>
						))}
					</ul>
				</div>
			)}
			<div className="-mx-3 mt-auto">
				<RemovePauses language={selectedLanguage} />
			</div>
		</CaptionsForm>
	);
}
