import {
	env,
	pipeline,
	type AutomaticSpeechRecognitionPipeline,
	type AutomaticSpeechRecognitionOutput,
} from "@huggingface/transformers";
import type { TranscriptionSegment } from "@/transcription/types";
import {
	DEFAULT_CHUNK_LENGTH_SECONDS,
	DEFAULT_STRIDE_SECONDS,
} from "@/transcription/audio";

export type WorkerMessage =
	/**
	 * `wasmBase`: where the recogniser's WebAssembly runtime is served from (the browser edition: the site itself).
	 * `words`: the model variant that times every word («<model>_timestamped»); without it words are spread over a phrase.
	 */
	| { type: "init"; modelId: string; wasmBase?: string; words?: boolean }
	| { type: "transcribe"; audio: Float32Array; language: string }
	| { type: "cancel" };

export type WorkerResponse =
	| { type: "init-progress"; progress: number }
	| { type: "init-complete" }
	| { type: "init-error"; error: string }
	| { type: "transcribe-progress"; progress: number }
	| {
			type: "transcribe-complete";
			text: string;
			segments: TranscriptionSegment[];
	  }
	| { type: "transcribe-error"; error: string }
	| { type: "cancelled" };

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let cancelled = false;
/** The loaded model times each word. */
let wordTimes = false;
let lastReportedProgress = -1;
const fileBytes = new Map<string, { loaded: number; total: number }>();

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
	const message = event.data;

	switch (message.type) {
		case "init":
			await handleInit({ modelId: message.modelId, wasmBase: message.wasmBase, words: message.words });
			break;
		case "transcribe":
			await handleTranscribe({
				audio: message.audio,
				language: message.language,
			});
			break;
		case "cancel":
			cancelled = true;
			self.postMessage({ type: "cancelled" } satisfies WorkerResponse);
			break;
	}
};

async function handleInit({ modelId, wasmBase, words }: { modelId: string; wasmBase?: string; words?: boolean }) {
	lastReportedProgress = -1;
	fileBytes.clear();
	// (the browser edition's page loads no code from another host: the runtime's two files lie beside the editor)
	if (wasmBase && env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = wasmBase;
	wordTimes = !!words;

	try {
		transcriber = (await pipeline("automatic-speech-recognition", words ? `${modelId}_timestamped` : modelId, {
			dtype: "q4",
			device: "auto",
			progress_callback: (progressInfo: {
				status?: string;
				file?: string;
				loaded?: number;
				total?: number;
			}) => {
				const file = progressInfo.file;
				if (!file) return;

				const loaded = progressInfo.loaded ?? 0;
				const total = progressInfo.total ?? 0;

				if (progressInfo.status === "progress" && total > 0) {
					fileBytes.set(file, { loaded, total });
				} else if (progressInfo.status === "done") {
					const existing = fileBytes.get(file);
					if (existing) {
						fileBytes.set(file, {
							loaded: existing.total,
							total: existing.total,
						});
					}
				}

				// sum all bytes
				let totalLoaded = 0;
				let totalSize = 0;
				for (const { loaded, total } of fileBytes.values()) {
					totalLoaded += loaded;
					totalSize += total;
				}

				if (totalSize === 0) return;

				const overallProgress = (totalLoaded / totalSize) * 100;
				const roundedProgress = Math.floor(overallProgress);

				if (roundedProgress !== lastReportedProgress) {
					lastReportedProgress = roundedProgress;
					self.postMessage({
						type: "init-progress",
						progress: roundedProgress,
					} satisfies WorkerResponse);
				}
			},
		})) as unknown as AutomaticSpeechRecognitionPipeline;

		self.postMessage({ type: "init-complete" } satisfies WorkerResponse);
	} catch (error) {
		self.postMessage({
			type: "init-error",
			error: error instanceof Error ? error.message : "Failed to load model",
		} satisfies WorkerResponse);
	}
}

async function handleTranscribe({
	audio,
	language,
}: {
	audio: Float32Array;
	language: string;
}) {
	if (!transcriber) {
		self.postMessage({
			type: "transcribe-error",
			error: "Model not initialized",
		} satisfies WorkerResponse);
		return;
	}

	cancelled = false;

	try {
		const rawResult = await transcriber(audio, {
			chunk_length_s: DEFAULT_CHUNK_LENGTH_SECONDS,
			stride_length_s: DEFAULT_STRIDE_SECONDS,
			language: language === "auto" ? undefined : language,
			task: "transcribe", // never translate (auto-detect otherwise turned Russian speech into English)
			return_timestamps: wordTimes ? "word" : true,
		});

		if (cancelled) return;

		const result: AutomaticSpeechRecognitionOutput = Array.isArray(rawResult)
			? rawResult[0]
			: rawResult;

		let segments: TranscriptionSegment[] = [];

		if (result.chunks && wordTimes) {
			segments = phrasesOf(
				result.chunks.flatMap((chunk) => {
					const start = chunk.timestamp?.[0];
					const text = chunk.text.trim();
					return typeof start === "number" && text ? [{ text, start, end: Math.max(start + 0.05, chunk.timestamp?.[1] ?? start + 0.3) }] : [];
				}),
			);
		} else if (result.chunks) {
			for (const chunk of result.chunks) {
				if (chunk.timestamp && chunk.timestamp.length >= 2) {
					segments.push({
						text: chunk.text,
						start: chunk.timestamp[0] ?? 0,
						end: chunk.timestamp[1] ?? chunk.timestamp[0] ?? 0,
					});
				}
			}
		}

		self.postMessage({
			type: "transcribe-complete",
			text: result.text,
			segments,
		} satisfies WorkerResponse);
	} catch (error) {
		if (cancelled) return;
		self.postMessage({
			type: "transcribe-error",
			error: error instanceof Error ? error.message : "Transcription failed",
		} satisfies WorkerResponse);
	}
}

/**
 * Words with their own times → phrases, as the phrase-timed model gives them: a new phrase after a sentence's end, a
 * pause of 0.7 s, or twelve words (the caption styles cut them into lines themselves).
 */
function phrasesOf(words: Array<{ text: string; start: number; end: number }>): TranscriptionSegment[] {
	const phrases: TranscriptionSegment[] = [];
	let current: Array<{ text: string; start: number; end: number }> = [];
	const close = () => {
		if (current.length === 0) return;
		phrases.push({ text: current.map((w) => w.text).join(" "), start: current[0].start, end: current[current.length - 1].end, words: current });
		current = [];
	};
	for (const word of words) {
		const last = current[current.length - 1];
		if (last && (word.start - last.end > 0.7 || /[.!?…]$/.test(last.text) || current.length >= 12)) close();
		current.push(word);
	}
	close();
	return phrases;
}
