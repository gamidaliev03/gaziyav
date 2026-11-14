"use client";

// Effects → Filters: «Custom adjustment» first (an adjustment layer, its sliders in the inspector), then «Import LUT»
// (a .cube file) and the looks as tiles with categories and search. A filter or LUT goes onto the selected clip; with
// nothing selected it becomes a filter layer at the playhead that colours everything under it, like CapCut's filter track.
import { toast } from "sonner";
import { revealClipColor } from "@/components/editor/panels/properties/reveal";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { COLOR_EFFECT_TYPE } from "@/effects/definitions/studio/color";
import { LOOKS } from "@/effects/luts/looks";
import { useT } from "@/i18n";
import { ru } from "@/i18n/ru";
import { buildEffectElement } from "@/timeline/element-utils";
import { addColorLayer, applyParams, LookTile, resolveTarget, targetParams } from "./adjustment-view";
import { materialGrid, TileAddButton } from "@/components/editor/panels/assets/material-grid";
import { tileActivation } from "@/components/editor/panels/assets/tile-activation";
import { EFFECT_TARGET_ELEMENT_TYPES } from "@/effects";
import { encodeCube, parseCube } from "@/effects/luts/cube";
import type { ParamValues } from "@/params";
import { FxBrowser } from "./fx-browser";
import { useMemo, useRef, useState } from "react";
import { previewPhotoFor, type Theme, themesOf } from "@/effects/themes";

/** CapCut's filter groups for the base looks; a designer grade carries its own (grades.ts); else «Life». */
const CATEGORY: Record<string, string> = {
	warmPhone: "Trending",
	juicy: "Trending",
	tealOrange: "Movies",
	film90s: "Movies",
	night: "Movies",
	bwContrast: "Mono",
};
const ORDER = ["Trending", "Life", "Movies", "Film", "Retro", "Mood", "Food", "Travel", "Night", "Mono"];

const categoryOf = (look: (typeof LOOKS)[number]) => CATEGORY[look.id] ?? (look as { category?: string }).category ?? "Life";

export function FiltersView() {
	const t = useT();
	// no theme chips (polish3 D, 13.11): they said again what the category column says («Новости», «Еда», «Путешествия»)
	const [theme] = useState<Theme | null>(null);
	const themes = useMemo(() => new Map(LOOKS.map((look) => [look.id, themesOf({ name: look.name, category: categoryOf(look) })])), []);
	const shown = useMemo(() => (theme ? LOOKS.filter((look) => themes.get(look.id)?.includes(theme)) : [...LOOKS]), [theme, themes]);
	useEditor((editor) => editor.selection.getSelectedElements());
	useEditor((editor) => editor.timeline.getPreviewTracks());
	const target = resolveTarget();
	const current = target ? String(targetParams(target).look ?? "none") : null;
	const apply = (look: ParamValues, name: string) => {
		if (target) {
			applyParams(target, { ...targetParams(target), ...look });
			// where it is edited: the clip's Colour section opens on the filter (its name, strength, «Remove»)
			if (target.kind === "clip") revealClipColor({ trackId: target.trackId, elementId: target.element.id });
			return;
		}
		const editor = EditorCore.getInstance();
		const element = buildEffectElement({ effectType: COLOR_EFFECT_TYPE, startTime: editor.playback.getCurrentTime() });
		editor.timeline.insertElement({
			placement: { mode: "auto", trackType: "effect", newTrack: true },
			element: { ...element, name, params: { ...element.params, ...look } },
		});
		toast.success(t("Filter layer added — it colours everything under it."), { duration: 2000 });
	};
	const pick = (id: string, name: string) => apply({ look: id }, t(name));
	const importLut = async (file: File) => {
		try {
			const cube = parseCube(await file.text());
			const name = file.name.replace(/\.cube$/i, "");
			apply({ look: "custom", lutData: encodeCube(cube), lutName: name, lookIntensity: 100 }, name);
		} catch (error) {
			toast.error(t("Couldn't import {file}: {reason}", { file: file.name, reason: error instanceof Error ? error.message : t("unknown format") }));
		}
	};
	return (
		<PanelView title={t("Filters")}>
			<AdjustTiles onImport={importLut} />
			<FxBrowser
				groupLabel="Filters"
				items={shown}
				getKey={(look) => look.id}
				getName={(look) => t(look.name)}
				getKeywords={(look) => [look.name, ru(look.name), categoryOf(look), ru(categoryOf(look))]}
				getCategory={categoryOf}
				categoryOrder={ORDER}
				placeholder={t("Search filters")}
				renderTile={(look) => (
					<LookTile
						id={look.id}
						name={t(look.name)}
						active={current === look.id}
						onPick={() => pick(look.id, look.name)}
						photo={previewPhotoFor(themes.get(look.id) ?? [], theme)}
					/>
				)}
			/>
		</PanelView>
	);
}

// One click only selects a tile (tile-activation.ts); the other tiles answer with their preview, this one has none:
// the first click says how it is added.
let hinted = false;
function hintOnce() {
	if (hinted) return;
	hinted = true;
	toast.info("Double-click to add it", { duration: 3000 });
}

/** The first two tiles: «Custom adjustment» (an adjustment layer at the playhead, or dropped on the timeline) and
 * «Import LUT» (a .cube onto the selected clip, else as a filter layer). */
function AdjustTiles({ onImport }: { onImport: (file: File) => void }) {
	const t = useT();
	const input = useRef<HTMLInputElement>(null);
	const tile = "bg-foreground/[0.08] group-hover:bg-foreground/[0.12] flex aspect-square w-full items-center justify-center rounded-md px-2 text-center text-[12px] leading-tight font-medium transition-colors";
	return (
		<div className="px-3 pb-2" style={materialGrid()} data-material-grid>
			<div className="group relative">
				<button
					type="button"
					data-adjustment-tile
					title={t("Custom adjustment — double-click to add at the playhead, or drag it onto the timeline")}
					{...tileActivation(() => addColorLayer())}
				data-no-translate
					onClick={hintOnce}
					draggable
					onDragStart={(event) =>
						EditorCore.getInstance().timeline.dragSource.begin({
							dataTransfer: event.dataTransfer,
							// the color effect as a layer: on empty space it becomes one, on a clip it grades that clip
							dragData: { id: "custom-adjustment", type: "effect", name: "Adjustment", effectType: COLOR_EFFECT_TYPE, targetElementTypes: EFFECT_TARGET_ELEMENT_TYPES },
						})
					}
					onDragEnd={() => EditorCore.getInstance().timeline.dragSource.end()}
					className="flex w-full min-w-0 flex-col gap-1 text-left"
				>
					<span className={tile}>{t("Custom adjustment")}</span>
				</button>
				<TileAddButton onAdd={() => addColorLayer()} />
			</div>
			<div className="group relative">
				<button type="button" data-lut-import title={t("Import a .cube LUT")} onClick={() => input.current?.click()} className="flex w-full min-w-0 flex-col gap-1 text-left">
					<span className={tile}>{t("Import LUT")}</span>
				</button>
				<input
					ref={input}
					type="file"
					accept=".cube"
					hidden
					onChange={(event) => {
						const file = event.target.files?.[0];
						event.target.value = "";
						if (file) onImport(file);
					}}
				/>
			</div>
		</div>
	);
}
