import type { EditorCore } from "@/core";
import {
	BatchCommand,
	DeleteElementsCommand,
	InsertElementCommand,
	type Command,
} from "@/commands";
import { primeFont } from "@/fonts/bundled";
import { getTextWordStarts } from "@/text/measure-element";
import type { TextElement, TimelineElement } from "@/timeline";
import type { CaptionWord } from "@/transcription/types";
import { TICKS_PER_SECOND } from "@/wasm";
import {
	buildStyledCaptionElement,
	captionStyleParams,
	resolveCaptionCenterY,
} from "./build-subtitle-text-element";
import { chunkCaptionWords } from "./chunk";
import { getCaptionStyle, stripCaptionPunctuation, type CaptionStyleId } from "./styles";

/** Caption elements: made by the Captions tab, the voice-over or older builds. */
export function isCaptionElement(element: TimelineElement): element is TextElement {
	if (element.type !== "text") return false;
	const style = element.params["caption.style"];
	return (typeof style === "string" && style !== "") || /^Caption \d+$/.test(element.name);
}

/** Timeline-timed words of a caption clip (stored timings, or spread like the renderer does). */
function captionClipWords(element: TextElement): CaptionWord[] {
	const tokens = String(element.params.content ?? "").split(/\s+/).filter(Boolean);
	const start = element.startTime / TICKS_PER_SECOND;
	const end = start + element.duration / TICKS_PER_SECOND;
	const starts = getTextWordStarts({ element, wordCount: tokens.length });
	return tokens.map((text, index) => {
		const wordStart = start + (starts[index] ?? 0);
		const wordEnd = index + 1 < tokens.length ? start + (starts[index + 1] ?? 0) : end - 0.25;
		return { text, startTime: wordStart, endTime: Math.max(wordStart + 0.05, wordEnd) };
	});
}

/**
 * Restyles captions in one undo step.
 * - "selected": the selected caption clips get the look; text and timing stay.
 * - "all": every caption track is re-cut into the style's chunk size (Hormozi
 *   1–3 words, Karaoke 3–6, One word …) with the Russian rules, keeping words,
 *   their timings and a hand-moved height.
 * Returns how many caption clips the result has.
 */
/** Styles being applied now (their font still loading): the second click of a double-click must not apply it again. */
const applying = new Set<string>();

export async function applyCaptionStyle({
	editor,
	styleId,
	scope,
}: {
	editor: EditorCore;
	styleId: CaptionStyleId;
	scope: "all" | "selected";
}): Promise<number> {
	const style = getCaptionStyle(styleId);
	if (scope === "all") {
		// Clicking the style the captions already have (or are getting) changes nothing and adds no ⌘Z step.
		const captions = () => [...editor.scenes.getActiveScene().tracks.overlay, editor.scenes.getActiveScene().tracks.main].flatMap((track) => track.elements.filter(isCaptionElement));
		const already = () => {
			const clips = captions();
			return clips.length > 0 && clips.every((clip) => clip.params["caption.style"] === styleId);
		};
		if (applying.has(styleId) || already()) return captions().length;
		applying.add(styleId);
		try {
			await primeFont(String(style.params.fontFamily));
		} finally {
			applying.delete(styleId);
		}
		if (already()) return captions().length;
	} else {
		await primeFont(String(style.params.fontFamily));
	}
	const canvasSize = editor.project.getActive().settings.canvasSize;
	const tracks = editor.scenes.getActiveScene().tracks;
	const textTracks = [...tracks.overlay, tracks.main];

	if (scope === "selected") {
		const selected = new Set(editor.selection.getSelectedElements().map((ref) => ref.elementId));
		const updates: Array<{ trackId: string; elementId: string; patch: Partial<TimelineElement> }> = [];
		for (const track of textTracks) {
			for (const element of track.elements) {
				if (!selected.has(element.id) || !isCaptionElement(element)) continue;
				const content = String(element.params.content ?? "")
					.split(/\s+/)
					.filter(Boolean)
					.map((word) => (style.stripPunctuation ? stripCaptionPunctuation(word) : word))
					.join(" ");
				updates.push({
					trackId: track.id,
					elementId: element.id,
					patch: {
						params: {
							...element.params,
							...captionStyleParams({ style, canvasHeight: canvasSize.height }),
							content,
						},
					},
				});
			}
		}
		editor.timeline.updateElements({ updates });
		return updates.length;
	}

	const commands: Command[] = [];
	let count = 0;
	const defaultY = resolveCaptionCenterY({
		canvasHeight: canvasSize.height,
		canvasWidth: canvasSize.width,
		fontSize: Number(style.params.fontSize) || 5,
	});
	for (const track of textTracks) {
		const clips = track.elements
			.filter((element): element is TextElement => isCaptionElement(element))
			.sort((a, b) => a.startTime - b.startTime);
		if (clips.length === 0) continue;
		const words = clips.flatMap(captionClipWords);
		const chunks = chunkCaptionWords({ words, limits: style.limits });
		// Keep a height the user chose by hand (same on every clip of a styled track).
		const heights = new Set(clips.map((clip) => clip.params["transform.positionY"]));
		const styled = clips.every((clip) => typeof clip.params["caption.style"] === "string" && clip.params["caption.style"] !== "");
		const keepY = styled && heights.size === 1 ? Number([...heights][0]) : defaultY;
		commands.push(
			new DeleteElementsCommand({
				elements: clips.map((clip) => ({ trackId: track.id, elementId: clip.id })),
			}),
		);
		chunks.forEach((chunk, index) => {
			const element = buildStyledCaptionElement({ index, caption: chunk, canvasSize, style });
			element.params["transform.positionY"] = Number.isFinite(keepY) ? keepY : defaultY;
			commands.push(
				new InsertElementCommand({ placement: { mode: "explicit", trackId: track.id }, element }),
			);
		});
		count += chunks.length;
	}
	if (commands.length) {
		editor.command.execute({ command: new BatchCommand(commands) });
		editor.selection.clearSelection();
	}
	return count;
}
