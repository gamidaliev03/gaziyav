"use client";

// CapCut's caption editor (right panel → Captions): every caption of the selected caption's track in time order.
// Click a line → that caption is selected and the playhead goes to it. Type → the text changes when the line is left
// (one ⌘Z per line, nothing re-renders while typing). Return splits the caption at the cursor, ⌘Return starts a new
// line, Backspace at the start merges it into the one before, × deletes it. Find & replace, and Translate ("Gaziyav AI": // Bilingual or Translation only).
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BatchCommand, DeleteElementsCommand, InsertElementCommand, UpdateElementsCommand } from "@/commands";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import type { CreateTextElement, TextElement } from "@/timeline";
import { type MediaTime, TICKS_PER_SECOND } from "@/wasm";
import { isCaptionElement } from "../apply-style";
import { TRANSLATE_LANGUAGES, type TranslateMode, translateCaptionTrack } from "../translate";

const clock = (ticks: number) => {
	const s = ticks / TICKS_PER_SECOND;
	return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`;
};

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

/** Word starts (seconds into the caption) kept when the words stay; else the renderer spreads them. */
function keptWordStarts(caption: TextElement, content: string): string {
	const before = wordsOf(String(caption.params.content ?? ""));
	return wordsOf(content).length === before.length ? String(caption.params["caption.words"] ?? "") : "";
}

function commitText(editor: EditorCore, trackId: string, caption: TextElement, content: string) {
	if (content === caption.params.content) return;
	editor.command.execute({
		command: new UpdateElementsCommand({
			updates: [{ trackId, elementId: caption.id, patch: { params: { ...caption.params, content, "caption.words": keptWordStarts(caption, content) } } }],
		}),
	});
}

/** Return in a caption: the text before the cursor stays, the rest becomes a new caption from the matching moment. */
export function splitCaption(editor: EditorCore, trackId: string, caption: TextElement, text: string, at: number): boolean {
	const left = text.slice(0, at).trim();
	const right = text.slice(at).trim();
	if (!left || !right) return false;
	const leftWords = wordsOf(left).length;
	const starts = String(caption.params["caption.words"] ?? "")
		.trim()
		.split(/\s+/)
		.map(Number)
		.filter(Number.isFinite);
	const total = wordsOf(text).length;
	// The moment the first word of the new caption is spoken; without word timings, by the share of the text.
	const offsetSeconds =
		starts.length === total && starts[leftWords] != null ? starts[leftWords] : (caption.duration / TICKS_PER_SECOND) * (left.length / (left.length + right.length));
	const offset = Math.round(Math.min(caption.duration - TICKS_PER_SECOND / 20, Math.max(TICKS_PER_SECOND / 20, offsetSeconds * TICKS_PER_SECOND)));
	const timed = starts.length === total;
	const { id: _id, ...rest } = caption;
	const second: CreateTextElement = {
		...rest,
		name: `${caption.name} b`,
		startTime: (caption.startTime + offset) as MediaTime,
		duration: (caption.duration - offset) as MediaTime,
		trimStart: 0 as MediaTime,
		params: {
			...caption.params,
			content: right,
			"caption.words": timed ? starts.slice(leftWords).map((s) => Math.max(0, s - offset / TICKS_PER_SECOND).toFixed(3)).join(" ") : "",
		},
	};
	editor.command.execute({
		command: new BatchCommand([
			new UpdateElementsCommand({
				updates: [
					{
						trackId,
						elementId: caption.id,
						patch: { duration: offset as MediaTime, params: { ...caption.params, content: left, "caption.words": timed ? starts.slice(0, leftWords).join(" ") : "" } },
					},
				],
			}),
			new InsertElementCommand({ placement: { mode: "explicit", trackId }, element: second }),
		]),
	});
	return true;
}

/** Backspace at the start of a caption: it joins the caption before it (CapCut: «Can't merge here» for the first). */
export function mergeIntoPrevious(editor: EditorCore, trackId: string, previous: TextElement, caption: TextElement, text: string) {
	const end = caption.startTime + caption.duration;
	const content = `${String(previous.params.content ?? "").trim()} ${text.trim()}`.trim();
	editor.command.execute({
		command: new BatchCommand([
			new DeleteElementsCommand({ elements: [{ trackId, elementId: caption.id }] }),
			new UpdateElementsCommand({
				updates: [{ trackId, elementId: previous.id, patch: { duration: (end - previous.startTime) as MediaTime, params: { ...previous.params, content, "caption.words": "" } } }],
			}),
		]),
	});
	// The caption that was selected is gone: the one it joined is selected (the panel keeps showing the track).
	editor.selection.setSelectedElements({ elements: [{ trackId, elementId: previous.id }] });
}

/** Find & replace over the captions of a track (one undo step); returns how many captions changed. */
export function replaceInCaptions(editor: EditorCore, trackId: string, captions: TextElement[], find: string, replacement: string): number {
	if (!find) return 0;
	const pattern = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
	const updates = captions
		.filter((caption) => pattern.test(String(caption.params.content ?? "")))
		.map((caption) => {
			const content = String(caption.params.content ?? "").replace(pattern, replacement);
			return { trackId, elementId: caption.id, patch: { params: { ...caption.params, content, "caption.words": keptWordStarts(caption, content) } } };
		});
	if (updates.length) editor.command.execute({ command: new UpdateElementsCommand({ updates }) });
	return updates.length;
}

export function CaptionEditor({ element, trackId }: { element: TextElement; trackId: string }) {
	const editor = useEditor();
	const captions = useEditor(
		(e) =>
			(e.timeline.getTrackById({ trackId })?.elements ?? [])
				.filter((item): item is TextElement => isCaptionElement(item))
				.sort((a, b) => a.startTime - b.startTime),
		["timeline", "scenes"],
	);
	const [find, setFind] = useState("");
	const [replacement, setReplacement] = useState("");
	const [language, setLanguage] = useState<string>("English");
	const [mode, setMode] = useState<TranslateMode>("bilingual");
	const [translating, setTranslating] = useState(false);
	const list = useRef<HTMLDivElement>(null);
	const matches = useMemo(() => {
		const needle = find.trim().toLowerCase();
		return needle ? new Set(captions.filter((c) => String(c.params.content ?? "").toLowerCase().includes(needle)).map((c) => c.id)) : null;
	}, [captions, find]);

	const focusCaption = (caption: TextElement) => {
		editor.selection.setSelectedElements({ elements: [{ trackId, elementId: caption.id }] });
		editor.playback.seek({ time: caption.startTime });
	};

	const translate = async () => {
		setTranslating(true);
		try {
			const count = await translateCaptionTrack({ editor, trackId, to: language, mode });
			toast.success(`${count} captions translated into ${language}`, { description: "⌘Z undoes" });
		} catch (error) {
			toast.error("Couldn't translate. Try again.", { description: error instanceof Error ? error.message : undefined });
		} finally {
			setTranslating(false);
		}
	};

	return (
		<div className="flex flex-col gap-2" data-caption-editor>
			<div className="flex items-center gap-1.5">
				<Input size="sm" containerClassName="min-w-0 flex-1" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find" aria-label="Find in captions" data-caption-find />
				<Input size="sm" containerClassName="min-w-0 flex-1" value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="Replace with" aria-label="Replace with" data-caption-replace />
				<Button
					size="sm"
					variant="outline"
					className="h-7 shrink-0 px-2 text-xs"
					disabled={!find.trim()}
					data-caption-replace-all
					onClick={() => {
						const changed = replaceInCaptions(editor, trackId, captions, find.trim(), replacement);
						toast(changed ? `Replaced in ${changed} ${changed === 1 ? "caption" : "captions"}` : "Nothing found");
					}}
				>
					Replace
				</Button>
			</div>
			<div className="flex items-center gap-1.5">
				<Select value={language} onValueChange={setLanguage}>
					<SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Translate to" data-caption-translate-language>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{TRANSLATE_LANGUAGES.map((item) => (
							<SelectItem key={item} value={item}>
								{item}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Select value={mode} onValueChange={(value) => setMode(value as TranslateMode)}>
					<SelectTrigger size="sm" className="w-[7.5rem] shrink-0" aria-label="Translation" data-caption-translate-mode>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="bilingual">Bilingual</SelectItem>
						<SelectItem value="only">Translation only</SelectItem>
					</SelectContent>
				</Select>
				<Button size="sm" className="h-7 shrink-0 px-2 text-xs" disabled={translating} onClick={() => void translate()} data-caption-translate>
					{translating ? "Translating..." : "Translate"}
				</Button>
			</div>
			<div ref={list} className="flex max-h-[22rem] flex-col gap-0.5 overflow-y-auto pr-0.5" data-caption-list>
				{captions.map((caption, index) => (
					<CaptionLine
						key={`${caption.id}:${String(caption.params.content)}`}
						caption={caption}
						active={caption.id === element.id}
						dimmed={!!matches && !matches.has(caption.id)}
						onFocus={() => focusCaption(caption)}
						onCommit={(text) => commitText(editor, trackId, caption, text)}
						onSplit={(text, at) => splitCaption(editor, trackId, caption, text, at)}
						onMerge={(text) => {
							const previous = captions[index - 1];
							if (!previous) {
								toast("Can't merge here");
								return;
							}
							mergeIntoPrevious(editor, trackId, previous, caption, text);
						}}
						onDelete={() => {
							const neighbour = captions[index + 1] ?? captions[index - 1];
							editor.command.execute({ command: new DeleteElementsCommand({ elements: [{ trackId, elementId: caption.id }] }) });
							if (neighbour) editor.selection.setSelectedElements({ elements: [{ trackId, elementId: neighbour.id }] });
						}}
					/>
				))}
			</div>
			<p className="text-muted-foreground text-[11px] leading-tight">Return splits a caption at the cursor · ⌘Return new line · ⌫ at the start merges</p>
		</div>
	);
}

function CaptionLine({
	caption,
	active,
	dimmed,
	onFocus,
	onCommit,
	onSplit,
	onMerge,
	onDelete,
}: {
	caption: TextElement;
	active: boolean;
	dimmed: boolean;
	onFocus: () => void;
	onCommit: (text: string) => void;
	onSplit: (text: string, at: number) => boolean;
	onMerge: (text: string) => void;
	onDelete: () => void;
}) {
	const done = useRef(false);
	return (
		<div
			className={`group flex items-start gap-1.5 rounded px-1 py-0.5 ${active ? "bg-primary/10" : "hover:bg-foreground/[0.04]"} ${dimmed ? "opacity-40" : ""}`}
			data-caption-line={caption.id}
		>
			<span className="text-muted-foreground w-[3.6rem] shrink-0 pt-1 font-mono text-[10px] tabular-nums">{clock(caption.startTime)}</span>
			<textarea
				defaultValue={String(caption.params.content ?? "")}
				rows={1}
				spellCheck={false}
				aria-label={`Caption at ${clock(caption.startTime)}`}
				className="field-sizing-content min-h-6 min-w-0 flex-1 resize-none rounded bg-transparent px-1 py-0.5 text-xs leading-snug outline-none focus:bg-foreground/[0.06]"
				onFocus={onFocus}
				onBlur={(event) => {
					if (done.current) return;
					onCommit(event.currentTarget.value);
				}}
				onKeyDown={(event) => {
					// Keys typed here never reach the timeline (Space, ⌫, B …).
					event.stopPropagation();
					const box = event.currentTarget;
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						const at = box.selectionStart;
						box.setRangeText("\n", at, box.selectionEnd, "end");
						return;
					}
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						done.current = true;
						if (!onSplit(box.value, box.selectionStart)) {
							done.current = false;
							onCommit(box.value);
						}
						return;
					}
					if (event.key === "Backspace" && box.selectionStart === 0 && box.selectionEnd === 0) {
						event.preventDefault();
						done.current = true;
						onMerge(box.value);
						done.current = false;
						return;
					}
					if (event.key === "Escape") box.blur();
				}}
			/>
			<button
				type="button"
				aria-label="Delete caption"
				title="Delete caption"
				onClick={onDelete}
				className="text-muted-foreground hover:text-foreground shrink-0 px-1 pt-0.5 text-xs opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
			>
				×
			</button>
		</div>
	);
}
