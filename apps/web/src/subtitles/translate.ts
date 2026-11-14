// CapCut's «Bilingual captions» and «Translate» through the built-in agent (Gaziyav AI, app/api/captions/translate):
// - "bilingual": the captions stay, the translation goes on its own track just above them (CapCut's sub captions);
// - "only": each caption's text becomes its translation (timing kept, words spread over the caption).
// Either is one ⌘Z.
import type { EditorCore } from "@/core";
import { AddTrackCommand, BatchCommand, type Command, InsertElementCommand, UpdateElementsCommand } from "@/commands";
import type { CreateTextElement, TextElement } from "@/timeline";
import { FONT_SIZE_SCALE_REFERENCE } from "@/text/typography";
import { isCaptionElement } from "./apply-style";

export type TranslateMode = "bilingual" | "only";

/** Languages the agent translates into well (CapCut's list, the ones our users ask for first). */
export const TRANSLATE_LANGUAGES = [
	"English",
	"Russian",
	"Spanish",
	"Portuguese",
	"German",
	"French",
	"Italian",
	"Turkish",
	"Ukrainian",
	"Kazakh",
	"Uzbek",
	"Arabic",
	"Hindi",
	"Indonesian",
	"Vietnamese",
	"Chinese",
	"Japanese",
	"Korean",
] as const;

export async function translateLines(lines: string[], to: string, signal?: AbortSignal): Promise<string[]> {
	const response = await fetch("/api/captions/translate", {
		method: "POST",
		headers: { "content-type": "application/json", "x-studio": "1" },
		body: JSON.stringify({ to, lines }),
		signal,
	});
	const result = (await response.json().catch(() => ({}))) as { lines?: string[]; error?: string };
	if (!result.lines || result.lines.length !== lines.length) throw new Error(result.error ?? "Couldn't translate. Try again.");
	return result.lines;
}

/** The caption clips of a track, in time order. */
export function trackCaptions(editor: EditorCore, trackId: string): TextElement[] {
	const track = editor.timeline.getTrackById({ trackId });
	return (track?.elements ?? []).filter((element): element is TextElement => isCaptionElement(element)).sort((a, b) => a.startTime - b.startTime);
}

/** Translates a caption track; returns how many captions were translated. */
export async function translateCaptionTrack({
	editor,
	trackId,
	to,
	mode,
	signal,
}: {
	editor: EditorCore;
	trackId: string;
	to: string;
	mode: TranslateMode;
	signal?: AbortSignal;
}): Promise<number> {
	const captions = trackCaptions(editor, trackId);
	if (captions.length === 0) return 0;
	const lines = await translateLines(
		captions.map((caption) => String(caption.params.content ?? "")),
		to,
		signal,
	);
	if (signal?.aborted) return 0;
	const commands: Command[] = [];
	if (mode === "only") {
		commands.push(
			new UpdateElementsCommand({
				updates: captions.map((caption, index) => ({
					trackId,
					elementId: caption.id,
					patch: { params: { ...caption.params, content: lines[index], "caption.words": "" } },
				})),
			}),
		);
	} else {
		// Sub captions: the same timing, a smaller plain line just above the main caption.
		const addTrack = new AddTrackCommand({ type: "text", index: 0 });
		const subTrackId = addTrack.getTrackId();
		commands.push(addTrack);
		captions.forEach((caption, index) => {
			const fontSize = Number(caption.params.fontSize) || 5;
			const subSize = Math.round(fontSize * 0.72 * 100) / 100;
			const y = Number(caption.params["transform.positionY"]);
			const lift = ((fontSize / FONT_SIZE_SCALE_REFERENCE) * 1.15 + (subSize / FONT_SIZE_SCALE_REFERENCE) * 0.6) * (String(caption.params.content).length > 28 ? 2 : 1);
			const { id: _id, ...rest } = caption;
			const sub: CreateTextElement = {
				...rest,
				name: `Translation ${index + 1}`,
				params: {
					...caption.params,
					content: lines[index],
					fontSize: subSize,
					"caption.words": "",
					"caption.sub": to,
					"highlight.mode": "none",
					"transform.positionY": Number.isFinite(y) ? Math.max(0.05, y - lift) : y,
				},
			};
			commands.push(new InsertElementCommand({ placement: { mode: "explicit", trackId: subTrackId }, element: sub }));
		});
	}
	editor.command.execute({ command: new BatchCommand(commands) });
	return captions.length;
}
