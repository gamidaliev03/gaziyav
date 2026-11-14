"use client";

// Left panel → Templates (CapCut): ready-made multi-layer layouts (src/templates/catalog.ts) made of the motion
// graphics and overlays and our text presets — a double-click puts every layer on the timeline at its moment (an
// intro at the start, a CTA ending with the video, an overlay across it), as one ⌘Z step. Each card is the template
// drawn on its theme's photo; the search narrows the list. «Motion graphics» shows the single animated graphics,
// «My templates» the user's own and «Create with AI».
import { MyTemplates } from "@/presets/components/text-presets-section";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { InsertElementCommand } from "@/commands";
import { TracksSnapshotCommand } from "@/commands/timeline";
import { useWhenStill } from "@/components/editor/panels/assets/list-scroll";
import { TileAddButton } from "@/components/editor/panels/assets/material-grid";
import { tileActivation } from "@/components/editor/panels/assets/tile-activation";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { EditorCore } from "@/core";
import { FxBrowser } from "@/effects/components/fx-browser";
import { useT } from "@/i18n";
import { ru } from "@/i18n/ru";
import { MographBrowser } from "@/montage/components/mograph-browser";
import { MOGRAPH_BY_KIND, themeName } from "@/montage/mograph";
import { mographElement } from "@/montage/mograph-insert";
import { buildPresetElement } from "@/text/insert-preset";
import { TEXT_PRESETS } from "@/text/presets";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";
import { layerParams, placeTemplate, TEMPLATE_CATEGORIES, TEMPLATES, type Template, templateSeconds } from "../catalog";
import { coverData, presetSeconds } from "../cover";

export { TEMPLATES };

const TemplatePreview = dynamic(() => import("./template-preview"), { ssr: false });

/** A template card is 104 pt wide (CapCut's), its 9:16 cover as tall as this. */
const COVER_WIDTH = 104;
const COVER_HEIGHT = Math.round((COVER_WIDTH * 16) / 9);


const partName = (part: Template["parts"][number]) => ("mg" in part ? (MOGRAPH_BY_KIND.get(part.mg)?.label ?? part.mg) : (TEXT_PRESETS.find((p) => p.id === part.text)?.name ?? part.text));

/**
 * The cards' layers (the still, the text, the footer) mount a frame after the covers: the tab's first commit is the
 * photos alone, and the layers follow before the eye sees the difference (Templates opened with a 95 ms first commit).
 */
function useAfterFirstPaint(): boolean {
	const [ready, setReady] = useState(false);
	useEffect(() => {
		const id = requestAnimationFrame(() => setReady(true));
		return () => cancelAnimationFrame(id);
	}, []);
	return ready;
}

/** CapCut's template card: a 9:16 picture with the template's own layers on it, «Featured», layers and length. */
function TemplateCover({ template, selected = false, playing = false }: { template: Template; selected?: boolean; playing?: boolean }) {
	const t = useT();
	const { texts, motion, seconds } = coverData(template);
	// At rest the layers are the prebuilt cover still (public/mograph/covers, scripts/mograph-tiles.mjs); the template
	// plays live only under the pointer, once the list is still.
	const live = useWhenStill(playing);
	const layers = useAfterFirstPaint();
	return (
		<span className={`relative block aspect-[9/16] w-full overflow-hidden rounded-md bg-black ${selected ? "ring-primary ring-2" : ""}`}>
			{/* biome-ignore lint/performance/noImgElement: a 500 px photo the app ships (public/mograph/themes); next/image would only route it through the optimiser */}
			<img src={template.cover} alt="" draggable={false} className="absolute inset-0 size-full object-cover opacity-90 transition-transform duration-300 group-hover:scale-[1.04]" />
			<span aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/50" />
			{layers && motion && (live ? (
				<TemplatePreview template={template} playing />
			) : (
				// biome-ignore lint/performance/noImgElement: a small transparent still the app ships (public/mograph/covers); nothing for next/image to do
				<img src={`/mograph/covers/${template.id}.webp`} alt="" loading="lazy" decoding="async" draggable={false} className="absolute inset-0 size-full" />
			))}
			{layers && template.featured && <span className="absolute top-1.5 left-1.5 rounded-[3px] bg-black/60 px-1.5 py-px text-[10px] font-medium text-white">{t("Featured")}</span>}
			{layers &&
				(!motion || template.coverText) &&
				texts.map(({ key, content, top, style }) => (
					<span key={key} className="absolute inset-x-1.5 flex -translate-y-1/2 justify-center text-center" style={{ top }}>
						<span style={style} className="max-w-full leading-tight whitespace-pre-line">
							{content}
						</span>
					</span>
				))}
			{layers && (
				<span className="absolute inset-x-1.5 bottom-1 flex items-center gap-2 text-[10px] text-white/90 tabular-nums">
					<span>⧉ {template.parts.length}</span>
					<span>{seconds}s</span>
				</span>
			)}
		</span>
	);
}
/** Every layer of the template onto the timeline, each at its moment of the video; one ⌘Z for all of them. */
export async function applyTemplate(template: Template) {
	const editor = EditorCore.getInstance();
	if (!editor.project.getActiveOrNull()) return;
	const before = editor.scenes.getActiveSceneOrNull()?.tracks ?? null;
	const video = editor.timeline.getTotalDuration() / TICKS_PER_SECOND;
	let steps = 0;
	for (const { part, start, dur } of placeTemplate(template, video, presetSeconds)) {
		if ("mg" in part) {
			const kind = MOGRAPH_BY_KIND.get(part.mg);
			if (!kind || start == null) continue;
			const element = mographElement(kind, start);
			element.params = layerParams(template, part);
			if (dur != null) element.duration = mediaTime({ ticks: Math.round(dur * TICKS_PER_SECOND) });
			editor.command.execute({ command: new InsertElementCommand({ element, placement: { mode: "auto" } }) });
			steps++;
			continue;
		}
		const preset = TEXT_PRESETS.find((p) => p.id === part.text);
		if (!preset) continue;
		const { element } = await buildPresetElement({ editor, preset, ...(start != null ? { at: start } : {}), ...(part.content ? { content: part.content } : {}) });
		editor.timeline.insertElement({ element, placement: { mode: "auto" } });
		steps++;
	}
	// one ⌘Z for the whole template: the steps above are folded into one snapshot
	const after = editor.scenes.getActiveSceneOrNull()?.tracks ?? null;
	if (before && after && before !== after) {
		for (let i = 0; i < steps; i++) editor.command.undo();
		editor.command.execute({ command: new TracksSnapshotCommand({ before, after }) });
	}
}

function TemplateCard({ item, selected, onSelect }: { item: Template; selected: boolean; onSelect: () => void }) {
	const t = useT();
	const [hover, setHover] = useState(false);
	return (
		<div className="group relative">
			<button
				type="button"
				data-template={item.id}
				aria-pressed={selected}
				onClick={onSelect}
				onPointerEnter={() => setHover(true)}
				onPointerLeave={() => setHover(false)}
				title={`${t("{name}: {parts} — double-click to add to the timeline, or drag onto it", { name: t(item.name), parts: item.parts.map((p) => t(partName(p))).join(" + ") })}\n${item.themes.map(themeName).join(" · ")}`}
				{...tileActivation(() => void applyTemplate(item))}
				data-no-translate
				draggable
				onDragStart={(event) =>
					EditorCore.getInstance().timeline.dragSource.begin({
						dataTransfer: event.dataTransfer,
						// a template is laid out over the video (its layers sit at its start, end or across it), wherever it is dropped
						dragData: { id: item.id, type: "deferred", name: item.name, elementType: "graphic", dur: templateSeconds(item, presetSeconds), place: () => applyTemplate(item) },
					})
				}
				onDragEnd={() => EditorCore.getInstance().timeline.dragSource.end()}
				className="group focus-visible:ring-primary flex w-full flex-col gap-1 rounded-md text-left outline-none focus-visible:ring-2"
			>
				<TemplateCover template={item} selected={selected} playing={hover} />
				<span className="text-muted-foreground truncate text-[12px]">{t(item.name)}</span>
			</button>
			<TileAddButton onAdd={() => void applyTemplate(item)} thumbHeight={COVER_HEIGHT} />
		</div>
	);
}

/**
 * Templates (multi-layer layouts) · Motion graphics (the ready-made animated titles, counters, frames) · My templates
 * («Create with AI» and the ones kept): the section is the group's switch in the panel header.
 */
export function TemplatesView({ section }: { section: "templates" | "motion" | "mine" }) {
	const t = useT();
	const [selected, setSelected] = useState<string | null>(null);
	if (section === "motion") {
		return (
			<PanelView title={t("Motion graphics")}>
				<div className="flex min-h-0 flex-1 flex-col" data-motion-graphics>
					<MographBrowser />
				</div>
			</PanelView>
		);
	}
	if (section === "mine") {
		return (
			<PanelView title={t("My templates")}>
				<MyTemplates />
			</PanelView>
		);
	}
	const items = TEMPLATES;
	return (
		<PanelView title={t("Templates")}>
			{/* one grid of the packs (polish3 D, 13.11): theme chips and a category column said again what the Styles
			    groups beside them say («Заголовки», «Соцсети», «Бизнес»); the search finds a theme or a category */}
			<FxBrowser
				flat
				items={items}
				getKey={(item) => item.id}
				getName={(item) => t(item.name)}
				getCategory={(item) => item.category}
				getKeywords={(item) => [item.name, ru(item.name), item.category, ru(item.category), ...item.themes, ...item.parts.map(partName)]}
				categoryOrder={TEMPLATE_CATEGORIES}
				placeholder={t("Search templates")}
				tile={COVER_WIDTH}
				renderTile={(item) => <TemplateCard item={item} selected={selected === item.id} onSelect={() => setSelected(item.id)} />}
			/>
		</PanelView>
	);
}
