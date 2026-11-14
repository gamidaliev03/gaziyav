"use client";

// Effects → Generators (the fourth tab: Effects · Transitions · Filters · Generators; the owner, 14.11). The same
// library as the other three: the families down the left, one search, the same tiles. A tile is one still of its
// preset, drawn once and kept (graphics' preview cache) — nothing plays at rest.
import { useMemo } from "react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { FxBrowser } from "@/effects/components/fx-browser";
import { useEditor } from "@/editor/use-editor";
import { buildGraphicPreviewUrl } from "@/graphics";
import { useT } from "@/i18n";
import { ru } from "@/i18n/ru";
import { GENERATOR_PRESETS, generatorSpec, presetParams } from "../catalog";
import { generatorDefinitionId } from "../document";
import { GENERATOR_DURATION, insertGenerator } from "../insert";
import { GEN_FAMILIES, type GeneratorPreset } from "../types";

const TILE_PX = 152;

const familyOf = (preset: GeneratorPreset) => generatorSpec(preset.generator)?.family ?? "Solids";

export function GeneratorsView() {
	const t = useT();
	const presets = useMemo(() => GENERATOR_PRESETS.filter((p) => generatorSpec(p.generator)), []);
	return (
		<PanelView title="Generators">
			<FxBrowser
				items={presets as GeneratorPreset[]}
				getKey={(p) => p.id}
				getName={(p) => t(p.name)}
				getCategory={familyOf}
				getKeywords={(p) => {
					const spec = generatorSpec(p.generator);
					return [p.name, ru(p.name), spec?.name ?? "", ru(spec?.name ?? ""), ...(spec?.keywords ?? [])];
				}}
				categoryOrder={[...GEN_FAMILIES]}
				placeholder={t("Search generators")}
				renderTile={(p) => <GeneratorTile preset={p} />}
			/>
		</PanelView>
	);
}

function GeneratorTile({ preset }: { preset: GeneratorPreset }) {
	const t = useT();
	const editor = useEditor();
	const src = useMemo(
		() => buildGraphicPreviewUrl({ definitionId: generatorDefinitionId(preset.generator), params: presetParams(preset), size: TILE_PX }),
		[preset],
	);
	return (
		<DraggableItem
			name={t(preset.name)}
			preview={
				// biome-ignore lint/performance/noImgElement: a data URL drawn once
				<img src={src} alt="" draggable={false} data-gen-tile={preset.id} className="size-full object-cover" />
			}
			dragData={{
				type: "deferred",
				id: `gen:${preset.id}`,
				name: t(preset.name),
				elementType: "graphic",
				dur: GENERATOR_DURATION,
				place: async (start, hint) => {
					insertGenerator(editor, preset, start, hint);
				},
			}}
			onAddToTimeline={() => insertGenerator(editor, preset)}
			aspectRatio={1}
			isRounded
			variant="card"
			containerClassName="w-full"
		/>
	);
}
