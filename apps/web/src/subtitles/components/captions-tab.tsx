"use client";

// The Captions tab as in CapCut 9.5 (docs/capcut/compare/captions-*-capcut.*): Auto captions · Templates ▾ (CapCut's
// fifteen groups, a search field, ☆ Favorites) · Auto lyrics · Add captions (Import file → the file's tile, «+» or a drag
// puts its captions on the timeline). Everything runs on this Mac; Bilingual captions are translated by Gaziyav AI.
import { DEMO } from "@/demo/flag";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import type * as React from "react";
import { useContext, useRef, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { materialGrid, TILE_LABEL, TILE_THUMB, TileAddButton } from "@/components/editor/panels/assets/material-grid";
import { MaterialsLayout, type NavItem } from "@/components/editor/panels/assets/materials-nav";
import { tileActivation } from "@/components/editor/panels/assets/tile-activation";
import { PanelSectionTabsContext } from "@/components/editor/panels/assets/views/base-panel";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/ui/panel-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import { TICKS_PER_SECOND } from "@/wasm";
import { insertCaptionChunksAsTextTrack } from "../insert";
import { generateLyrics, hasMusic } from "../lyrics";
import { parseSubtitleFile } from "../parse";
import type { SubtitleCue } from "../types";
import { Captions } from "./assets-view";
import { CaptionsField, CaptionsForm, FooterCheck } from "./captions-form";
import { CaptionStyleGallery, TEMPLATE_GROUPS, type TemplateGroupKey } from "./caption-styles";
import "../inspector";

const ALL_CAPTIONS_NAV: NavItem[] = [
	{ key: "auto", label: "Auto captions" },
	{
		key: "templates",
		label: "Templates",
		collapsed: true,
		select: "tpl-trending",
		children: TEMPLATE_GROUPS.map((group) => ({ key: group.key, label: group.label })),
	},
	{ key: "lyrics", label: "Auto lyrics" },
	{ key: "add", label: "Add captions" },
];
// (the browser edition hears speech in the page; a song's lyrics need the Mac app's models)
const CAPTIONS_NAV: NavItem[] = ALL_CAPTIONS_NAV.filter((item) => !DEMO || item.key !== "lyrics");

/** CapCut's Lyrics language list (its six, in its order), then the other languages the speech model knows. */
const LYRICS_LANGUAGES = [
	["en", "English"],
	["zh", "Chinese"],
	["hi", "Hindi"],
	["id", "Indonesian"],
	["ja", "Japanese"],
	["ko", "Korean"],
	["ru", "Russian"],
	["es", "Spanish"],
	["pt", "Portuguese"],
	["fr", "French"],
	["de", "German"],
	["it", "Italian"],
] as const;

type ImportedCaptionFile = { id: string; name: string; format: string; captions: SubtitleCue[] };

/** The caption files imported in Add captions, per project (CapCut lists them as tiles under «Import file»). */
const useImportedCaptions = create<{ files: Record<string, ImportedCaptionFile[]>; add: (projectId: string, file: ImportedCaptionFile) => void }>((set) => ({
	files: {},
	add: (projectId, file) => set((state) => ({ files: { ...state.files, [projectId]: [file, ...(state.files[projectId] ?? [])] } })),
}));

/** A file's captions on the timeline from `startSeconds` (the file's 0:00 lands there), as one caption track (one ⌘Z). */
export function placeCaptionFile(captions: SubtitleCue[], startSeconds: number): number {
	const shifted = captions.map((cue) => ({
		...cue,
		startTime: cue.startTime + startSeconds,
		...(cue.words ? { words: cue.words.map((word) => ({ ...word, startTime: word.startTime + startSeconds, endTime: word.endTime + startSeconds })) } : {}),
	}));
	const trackId = insertCaptionChunksAsTextTrack({ editor: EditorCore.getInstance(), captions: shifted });
	if (!trackId) throw new Error("No captions were added.");
	return captions.length;
}

/** Reads an SRT / LRC / ASS file into Add captions (not yet onto the timeline). */
export async function importCaptionFile(file: File): Promise<ImportedCaptionFile> {
	if (file.size > 3_000_000) throw new Error("Couldn't import file. File needs to be no more than 3MB.");
	const result = parseSubtitleFile({ fileName: file.name, input: await file.text() });
	if (result.captions.length === 0) throw new Error("No captions were found in this file.");
	const imported = { id: `${Date.now()}-${file.name}`, name: file.name, format: (file.name.split(".").pop() ?? "srt").toUpperCase(), captions: result.captions };
	useImportedCaptions.getState().add(EditorCore.getInstance().project.getActive().metadata.id, imported);
	return imported;
}

function AddCaptions() {
	const t = useT();
	const editor = useEditor();
	const input = useRef<HTMLInputElement>(null);
	const [over, setOver] = useState(false);
	const projectId = useEditor((e) => e.project.getActiveOrNull()?.metadata.id ?? "");
	const files = useImportedCaptions((state) => state.files[projectId]) ?? [];
	const pickFiles = async (picked: File[]) => {
		for (const file of picked) {
			try {
				await importCaptionFile(file);
			} catch (error) {
				toast.error(error instanceof Error ? error.message : "Couldn't import the captions.");
			}
		}
	};
	const place = (file: ImportedCaptionFile, seconds: number) => {
		try {
			const count = placeCaptionFile(file.captions, seconds);
			toast.success(`${count} captions added`, { description: "⌘Z removes them" });
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Couldn't add the captions.");
		}
	};
	const playhead = () => editor.playback.getCurrentTime() / TICKS_PER_SECOND;
	const dropZone = (
		<button
			type="button"
			onClick={() => input.current?.click()}
			onDragOver={(event) => {
				if (!event.dataTransfer.types.includes("Files")) return;
				event.preventDefault();
				setOver(true);
			}}
			onDragLeave={() => setOver(false)}
			onDrop={(event) => {
				event.preventDefault();
				setOver(false);
				void pickFiles([...event.dataTransfer.files]);
			}}
			data-import-captions
			className={
				files.length === 0
					? `bg-foreground/[0.05] hover:bg-foreground/[0.08] flex h-[108px] w-full flex-col items-center justify-center gap-1.5 rounded-lg transition-colors ${over ? "ring-primary ring-2" : ""}`
					: `bg-foreground/[0.06] hover:bg-foreground/[0.1] flex h-7 w-fit items-center gap-1.5 rounded-md px-2.5 transition-colors ${over ? "ring-primary ring-2" : ""}`
			}
		>
			<span className="flex items-center gap-1.5 text-[13px] font-medium">
				<span className="bg-primary text-primary-foreground grid size-4 place-items-center rounded-full text-[13px] leading-none">+</span>
				{t("Import file")}
			</span>
			{files.length === 0 && <span className="text-muted-foreground text-xs">{t("Supported file formats: SRT, LRC, and ASS")}</span>}
		</button>
	);
	return (
		<div className="scrollbar-thin flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-3 pt-3 pb-3" data-captions-add>
			{dropZone}
			<input
				ref={input}
				type="file"
				accept=".srt,.lrc,.ass"
				multiple
				className="hidden"
				data-captions-file
				onChange={(event) => {
					const picked = [...(event.target.files ?? [])];
					event.target.value = "";
					void pickFiles(picked);
				}}
			/>
			{files.length > 0 && (
				<div style={materialGrid()} data-material-grid>
					{files.map((file) => (
						<div key={file.id} className="group relative" data-caption-file={file.name}>
							<button
								type="button"
								title={`${file.name} — ${file.captions.length} captions. Double-click or «+» to add at the playhead, or drag onto the timeline`}
								aria-label={file.name}
								{...tileActivation(() => place(file, playhead()))}
								draggable
								onDragStart={(event) =>
									editor.timeline.dragSource.begin({
										dataTransfer: event.dataTransfer,
										dragData: {
											id: file.id,
											type: "deferred",
											name: file.name,
											elementType: "text",
											dur: Math.max(...file.captions.map((cue) => cue.startTime + cue.duration)),
											place: async (start) => place(file, start),
										},
									})
								}
								onDragEnd={() => editor.timeline.dragSource.end()}
								className="flex w-full flex-col gap-1 text-left"
							>
								<div className={`bg-foreground/[0.06] relative flex items-center justify-center ${TILE_THUMB}`}>
									<span className="text-primary text-2xl font-semibold">T</span>
									<span className="bg-primary text-primary-foreground absolute bottom-3 rounded-[3px] px-1 text-[9px] leading-[13px] font-bold">{file.format}</span>
								</div>
								<span className={TILE_LABEL}>{file.name}</span>
							</button>
							<TileAddButton onAdd={() => place(file, playhead())} label="Add at the playhead" />
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function AutoLyrics() {
	const t = useT();
	const editor = useEditor();
	const [language, setLanguage] = useState("en");
	const [deleteCurrent, setDeleteCurrent] = useState(false);
	const [step, setStep] = useState<string | null>(null);
	const run = useRef<AbortController | null>(null);
	const generate = async () => {
		if (!hasMusic(editor)) {
			toast("Add a song to the timeline first", { description: "Auto lyrics listens to the music on the timeline (Audio or Media)." });
			return;
		}
		const ac = new AbortController();
		run.current = ac;
		setStep("Generating lyrics...");
		try {
			const lines = await generateLyrics({ editor, language, signal: ac.signal, onStep: setStep });
			if (ac.signal.aborted) return;
			insertCaptionChunksAsTextTrack({ editor, captions: lines, style: "karaoke", replace: deleteCurrent, kind: "lyrics" });
			toast.success(`${lines.length} lyric lines`, { description: "⌘Z removes them" });
		} catch (error) {
			if ((error as Error)?.name !== "AbortError") toast.error(error instanceof Error ? error.message : "Couldn't hear the lyrics.");
		} finally {
			setStep(null);
			run.current = null;
		}
	};
	return (
		<CaptionsForm
			data-captions-lyrics
			footer={
				<>
					<FooterCheck id="lyrics-replace" checked={deleteCurrent} onChange={setDeleteCurrent} data-lyrics-replace>
						{t("Delete current lyrics")}
					</FooterCheck>
					<div className="flex shrink-0 items-center gap-1">
						{step && (
							<Button size="sm" variant="ghost" onClick={() => run.current?.abort()} data-lyrics-cancel>
								{t("Cancel")}
							</Button>
						)}
						<Button size="sm" onClick={() => void generate()} disabled={!!step} data-lyrics-generate title={t("Recognizes the sung words of the music on the timeline. Runs on this Mac.")}>
							{step && <Spinner className="mr-1" />}
							{step ?? t("Generate")}
						</Button>
					</div>
				</>
			}
		>
			<CaptionsField label={t("Lyrics language")}>
				<Select value={language} onValueChange={setLanguage}>
					<SelectTrigger data-lyrics-language>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{LYRICS_LANGUAGES.map(([code, name]) => (
							<SelectItem key={code} value={code} data-lyrics-option={code}>
								{t(name)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</CaptionsField>
		</CaptionsForm>
	);
}

function Templates({ group }: { group: TemplateGroupKey }) {
	const t = useT();
	const [query, setQuery] = useState("");
	return (
		<div className="scrollbar-thin flex h-full min-h-0 flex-col gap-2.5 overflow-y-auto px-3 pt-3 pb-3" data-captions-templates>
			<label className="bg-foreground/[0.06] focus-within:ring-primary/60 flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 focus-within:ring-1">
				<HugeiconsIcon icon={Search01Icon} className="text-muted-foreground size-3.5 shrink-0" />
				<input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder={t("Search templates")}
					aria-label={t("Search templates")}
					data-caption-search
					className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-xs outline-none"
				/>
				{query && (
					<button type="button" className="text-muted-foreground hover:text-foreground text-xs" onClick={() => setQuery("")} aria-label={t("Clear")}>
						×
					</button>
				)}
			</label>
			{/* no title: the column names the group (polish3 D, 13.11) */}
			<CaptionStyleGallery group={group} query={query} />
		</div>
	);
}

/**
 * The Text | Captions switch above a Captions section (Text's sections carry it in their panel header): without it,
 * Captions was a dead end — the Text tab reopens on its last sub-tab, so the text presets could not be reached again.
 */
function CaptionsSection({ children }: { children: React.ReactNode }) {
	const sectionTabs = useContext(PanelSectionTabsContext);
	if (!sectionTabs) return children;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<PanelHeader className="pr-2" tabs={sectionTabs} />
			<div className="min-h-0 flex-1">{children}</div>
		</div>
	);
}

export function CaptionsTab() {
	return (
		<MaterialsLayout
			tab="captions"
			items={CAPTIONS_NAV}
			render={(section) => (
				<CaptionsSection>
					{section === "add" ? (
						<AddCaptions />
					) : section === "lyrics" ? (
						<AutoLyrics />
					) : section.startsWith("tpl-") ? (
						<Templates group={section as TemplateGroupKey} />
					) : (
						<Captions />
					)}
				</CaptionsSection>
			)}
		/>
	);
}
