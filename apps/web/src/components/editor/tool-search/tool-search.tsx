"use client";

// ⌘K «Find a tool» (docs/EDITOR-MAP.md): type a name in Russian or English — blur, размытие, маска, трекинг, хромакей,
// удалить фон, мерцание… — and Enter opens it where it lives: the section of the selected clip's inspector (the clip
// under the playhead when nothing is selected), the Media tab and section, or applies the effect.
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { revealInspectorSection } from "@/components/editor/panels/properties/reveal";
import { getInspectorSection, sectionAppliesTo } from "@/components/editor/panels/properties/slots";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { invokeAction } from "@/actions/registry";
import { sayWhy, whyNot } from "@/actions/preconditions";
import { withoutNote } from "@/actions/names";
import { getActionShortcutLabel, useKeybindingsStore } from "@/actions/keybindings-store";
import type { TAction, TActionWithOptionalArgs } from "@/actions/types";
import { EditorCore } from "@/core";
import { applyEffectToSelection } from "@/effects/components/apply-effect";
import { useT, t as translate } from "@/i18n";
import { useNeuralSettings } from "@/neural/settings-store";
import type { NeuralFamilyId } from "@/neural/catalog";
import { buildEffectElement, getElementsAtTime } from "@/timeline/element-utils";
import type { TimelineElement } from "@/timeline";
import { cn } from "@/utils/ui";
import { create } from "zustand";
import { findTools, type Tool } from "./tools";

export const useToolSearch = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

type Ref = { trackId: string; elementId: string };

/** The clip a clip tool works on: the selected one, else the clip under the playhead that has the section (top first). */
function clipFor(sections: string[]): { ref: Ref; section: string } | null {
	const editor = EditorCore.getInstance();
	const selected = editor.selection.getSelectedElements();
	const candidates: Ref[] =
		selected.length === 1
			? selected
			: selected.length === 0
				? getElementsAtTime({ tracks: editor.scenes.getActiveScene().tracks, time: editor.playback.getCurrentTime() })
				: [];
	for (const ref of candidates) {
		const [found] = editor.timeline.getElementsWithTracks({ elements: [ref] });
		if (!found) continue;
		for (const id of sections) {
			const section = getInspectorSection(id);
			if (section && sectionAppliesTo(section, found.element as TimelineElement)) return { ref, section: id };
		}
	}
	return null;
}

/** What Enter does with a tool; false when it can't here (the reason is toasted). */
export function runTool(tool: Tool): boolean {
	const editor = EditorCore.getInstance();
	const target = tool.target;
	if (target.kind === "media") {
		const panel = useAssetsPanelStore.getState();
		if (target.section) panel.openSection(target.tab, target.section);
		else panel.setActiveTab(target.tab);
		return true;
	}
	if (target.kind === "run") return target.run();
	if (target.kind === "action") {
		// the same gate as its key: a reason instead of a silent nothing, and ⌘K stays open
		const why = whyNot(target.action as TAction);
		if (why) {
			sayWhy(why);
			return false;
		}
		// run after ⌘K has closed, so the action sees the editor (its focus, its panels) as its key would
		requestAnimationFrame(() => invokeAction(target.action as TActionWithOptionalArgs));
		return true;
	}
	if (target.kind === "effect") {
		if (!editor.project.getActiveOrNull()) return false;
		const applied = applyEffectToSelection({ effectType: target.effectType });
		if (applied > 0) {
			const [ref] = editor.selection.getSelectedElements();
			if (ref) revealInspectorSection("effects", ref);
			toast.success(translate("{name} applied", { name: translate(tool.title) }), { duration: 2000 });
			return true;
		}
		const element = buildEffectElement({ effectType: target.effectType, startTime: editor.playback.getCurrentTime() });
		editor.timeline.insertElement({ placement: { mode: "auto", trackType: "effect", newTrack: true }, element: { ...element, name: tool.title } });
		toast.success(translate("{name} added as an effect layer at the playhead", { name: translate(tool.title) }), { duration: 2000 });
		return true;
	}
	const hit = clipFor(target.sections);
	if (!hit) {
		toast.info(translate("Select a clip first: {name}", { name: translate(tool.title) }));
		return false;
	}
	if (target.neural) {
		const settings = useNeuralSettings.getState();
		settings.pick(target.neural.family as NeuralFamilyId);
		if (target.neural.preset) settings.setValues(target.neural.family as NeuralFamilyId, target.neural.preset);
	}
	return revealInspectorSection(hit.section, hit.ref);
}

export function ToolSearch() {
	const open = useToolSearch((s) => s.open);
	const setOpen = useToolSearch((s) => s.setOpen);
	useEffect(() => {
		// ⌘K anywhere in the editor, also while typing in a field (Slack, Figma, Linear)
		const onKey = (event: KeyboardEvent) => {
			if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey || event.key.toLowerCase() !== "k") return;
			event.preventDefault();
			event.stopPropagation();
			setOpen(!useToolSearch.getState().open);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [setOpen]);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="top-[14vh] max-w-lg translate-y-0 gap-0 overflow-hidden p-0 [&>button:last-child]:hidden" data-tool-search="">
				<DialogTitle className="sr-only">Find a tool</DialogTitle>
				{open && <SearchBody onDone={() => setOpen(false)} />}
			</DialogContent>
		</Dialog>
	);
}

function SearchBody({ onDone }: { onDone: () => void }) {
	const t = useT();
	useKeybindingsStore((state) => state.keybindings);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);
	const results = useMemo(() => (query.trim() ? findTools(query) : []), [query]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new query starts at the best hit
	useEffect(() => setActive(0), [query]);
	useEffect(() => {
		listRef.current?.querySelector<HTMLElement>(`[data-tool-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
	}, [active]);
	const pick = (tool: Tool | undefined) => {
		if (!tool) return;
		if (runTool(tool)) onDone();
	};
	return (
		<div className="flex flex-col">
			<div className="flex items-center gap-2 border-b px-3">
				<HugeiconsIcon icon={Search01Icon} className="text-muted-foreground size-4 shrink-0" />
				<input
					autoFocus
					data-tool-search-input=""
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "ArrowDown") {
							event.preventDefault();
							setActive((i) => Math.min(results.length - 1, i + 1));
						} else if (event.key === "ArrowUp") {
							event.preventDefault();
							setActive((i) => Math.max(0, i - 1));
						} else if (event.key === "Enter") {
							event.preventDefault();
							pick(results[active]);
						}
					}}
					placeholder={t("Find a tool: blur, mask, tracking, chroma key…")}
					className="placeholder:text-muted-foreground h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
				/>
				<kbd className="text-muted-foreground shrink-0 text-[10px]">esc</kbd>
			</div>
			<div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1" role="listbox" aria-label={t("Tools")} data-tool-results={results.length}>
				{query.trim() && results.length === 0 && <p className="text-muted-foreground px-3 py-3 text-xs">{t("Nothing with that name")}</p>}
				{!query.trim() && <p className="text-muted-foreground px-3 py-3 text-xs">{t("Every tool, effect and template by name, in Russian or English.")}</p>}
				{results.map((tool, index) => {
					// a command: its one name, its key, greyed with the reason when it can't run now (actions/preconditions.ts)
					const action = tool.target.kind === "action" ? (tool.target.action as TAction) : null;
					const why = action ? whyNot(action) : null;
					const key = action ? getActionShortcutLabel({ action: action as TActionWithOptionalArgs }) : "";
					return (
						<button
							key={tool.id}
							type="button"
							role="option"
							aria-selected={index === active}
							aria-disabled={why ? true : undefined}
							title={why ? t(why) : undefined}
							data-tool-index={index}
							data-tool-result={tool.id}
							data-tool-action={action ?? undefined}
							onMouseMove={() => setActive(index)}
							onClick={() => pick(tool)}
							className={cn("flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm", index === active && "bg-accent", why && "text-muted-foreground")}
						>
							<span className="min-w-0 truncate">{action ? withoutNote(t(tool.title)) : t(tool.title)}</span>
							<span className="text-muted-foreground shrink-0 text-[11px]">
								{t(tool.where)}
								{key && <kbd className="ml-2 font-sans">{key}</kbd>}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

/** The header's magnifier: the same search, for those who don't know ⌘K. */
export function ToolSearchButton() {
	const t = useT();
	return (
		<button
			type="button"
			data-tool-search-button=""
			title={t("Find a tool (⌘K)")}
			aria-label={t("Find a tool (⌘K)")}
			onClick={() => useToolSearch.getState().setOpen(true)}
			className="text-muted-foreground hover:text-foreground hover:bg-accent flex h-6 items-center gap-1 rounded-sm px-1.5 text-[11px]"
		>
			<HugeiconsIcon icon={Search01Icon} className="size-3.5" />
			<span className="hidden @min-[900px]:inline">⌘K</span>
		</button>
	);
}
