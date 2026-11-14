"use client";

// Effects → Generators (the fourth tab: Effects · Transitions · Filters · Generators; the owner, 14.11). The same
// library as the other three: the families down the left, one search, the same tiles. What a family holds
// (../library.ts): the generators drawn here (solids, gradients), ready ones made of the editor's own effects over a
// plain ground (snow, a light leak, grain…; a gradient moved by a distortion), an outside palette of gradients, and the
// editor's own motion graphics that are generators by nature (Camera REC, VHS play, the film countdown, confetti…).
// A tile is one still, drawn once and kept — nothing plays at rest.
import { useEffect, useMemo, useState } from "react";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { DEMO } from "@/demo/flag";
import { effectsRegistry, resolveEffectPasses } from "@/effects";
import { FxBrowser } from "@/effects/components/fx-browser";
import { timeAt } from "@/effects/components/fx-thumbnail";
import { useEditor } from "@/editor/use-editor";
import { buildGraphicPreviewUrl } from "@/graphics";
import { useT } from "@/i18n";
import { ru } from "@/i18n/ru";
import { MographTile } from "@/montage/components/mograph-browser";
import { MOGRAPH_BY_KIND, type MographKind } from "@/montage/mograph";
import { whenShadersReady } from "@/services/renderer/compositor/pipeline-warmup";
import { gpuRenderer, isGpuAvailable } from "@/services/renderer/gpu-renderer";
import { GENERATOR_PRESETS, generatorSpec, presetParams } from "../catalog";
import { generatorDefinitionId } from "../document";
import { GENERATOR_DURATION, insertGenerator, presetEffects } from "../insert";
import { GENERATOR_MOGRAPH } from "../library";
import { GEN_FAMILIES, type GenFamily, type GeneratorPreset } from "../types";

const TILE_PX = 152;

type Item =
	| { key: string; kind: "preset"; family: GenFamily; preset: GeneratorPreset }
	| { key: string; kind: "mograph"; family: GenFamily; mograph: MographKind };

const familyOf = (preset: GeneratorPreset): GenFamily => preset.family ?? generatorSpec(preset.generator)?.family ?? "Solids";

/** Every tile, family by family: in a family the motion graphics first (the richest), then the presets in their order. */
function allItems(): Item[] {
	const presets = GENERATOR_PRESETS.filter((p) => generatorSpec(p.generator));
	// the browser edition has no motion-graphics renderer (a stand-in): its tiles would add clips that draw nothing
	const graphics = DEMO ? [] : GENERATOR_MOGRAPH.flatMap(({ kind, family }) => (MOGRAPH_BY_KIND.get(kind) ? [{ kind: MOGRAPH_BY_KIND.get(kind) as MographKind, family }] : []));
	return GEN_FAMILIES.flatMap((family): Item[] => [
		...graphics.filter((g) => g.family === family).map((g): Item => ({ key: `mg:${g.kind.kind}`, kind: "mograph", family, mograph: g.kind })),
		...presets.filter((p) => familyOf(p) === family).map((p): Item => ({ key: p.id, kind: "preset", family, preset: p })),
	]);
}

export function GeneratorsView() {
	const t = useT();
	const items = useMemo(allItems, []);
	const nameOf = (item: Item) => (item.kind === "mograph" ? t(item.mograph.label) : item.preset.proper ? item.preset.name : t(item.preset.name));
	return (
		<PanelView title="Generators">
			<FxBrowser
				items={items}
				getKey={(item) => item.key}
				getName={nameOf}
				getCategory={(item) => item.family}
				getKeywords={(item) => {
					if (item.kind === "mograph") return [item.mograph.label, ru(item.mograph.label), item.family, ru(item.family), ...item.mograph.themes];
					const spec = generatorSpec(item.preset.generator);
					const effects = presetEffects(item.preset).map((effect) => effectsRegistry.get(effect.type).name);
					return [item.preset.name, ru(item.preset.name), item.family, ru(item.family), spec?.name ?? "", ru(spec?.name ?? ""), ...(spec?.keywords ?? []), ...effects, ...effects.map((name) => ru(name))];
				}}
				categoryOrder={[...GEN_FAMILIES]}
				placeholder={t("Search generators")}
				renderTile={(item) => (item.kind === "mograph" ? <MographTile kind={item.mograph} /> : <GeneratorTile preset={item.preset} />)}
			/>
		</PanelView>
	);
}

// ── stills of the ready generators: the generator's own picture through its effects, on the GPU, one after another ──
const stills = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();

function effectStill(preset: GeneratorPreset): Promise<string | null> {
	const known = stills.get(preset.id);
	if (known) return Promise.resolve(known);
	const job = queue.then(async (): Promise<string | null> => {
		const again = stills.get(preset.id);
		if (again) return again;
		const spec = generatorSpec(preset.generator);
		if (!spec || !isGpuAvailable() || typeof OffscreenCanvas === "undefined") return null;
		const source = new OffscreenCanvas(TILE_PX, TILE_PX);
		const context = source.getContext("2d");
		if (!context) return null;
		const image = context.createImageData(TILE_PX, TILE_PX);
		spec.pixels({ data: image.data, width: TILE_PX, height: TILE_PX }, presetParams(preset), { frame: 36, fps: 30 });
		context.putImageData(image, 0, 0);
		// a moment into the clip: rain has fallen, a leak has come in
		const time = timeAt(1.2, GENERATOR_DURATION);
		const passes = presetEffects(preset).flatMap((effect) => resolveEffectPasses({ definition: effectsRegistry.get(effect.type), effectParams: effect.params, width: TILE_PX, height: TILE_PX, time }));
		if (passes.length === 0) return null;
		await whenShadersReady(passes.map((pass) => pass.shader));
		const bitmap = await createImageBitmap(gpuRenderer.applyEffect({ source, width: TILE_PX, height: TILE_PX, passes }));
		const flat = document.createElement("canvas");
		flat.width = TILE_PX;
		flat.height = TILE_PX;
		const out = flat.getContext("2d");
		if (!out) return null;
		out.fillStyle = "#000";
		out.fillRect(0, 0, TILE_PX, TILE_PX);
		out.drawImage(bitmap, 0, 0);
		bitmap.close();
		const url = flat.toDataURL("image/png");
		stills.set(preset.id, url);
		return url;
	});
	queue = job.catch(() => null);
	return job.catch(() => null);
}

function GeneratorTile({ preset }: { preset: GeneratorPreset }) {
	const t = useT();
	const editor = useEditor();
	const name = preset.proper ? preset.name : t(preset.name);
	// the generator's own picture at once; a ready generator's effects are drawn over it when the GPU has a moment
	const plain = useMemo(
		() => buildGraphicPreviewUrl({ definitionId: generatorDefinitionId(preset.generator), params: presetParams(preset), size: TILE_PX }),
		[preset],
	);
	const [ready, setReady] = useState<string | null>(() => stills.get(preset.id) ?? null);
	useEffect(() => {
		if (!preset.effects?.length || stills.has(preset.id)) return;
		let alive = true;
		void effectStill(preset).then((url) => {
			if (alive && url) setReady(url);
		});
		return () => {
			alive = false;
		};
	}, [preset]);
	return (
		<DraggableItem
			name={name}
			preview={
				// biome-ignore lint/performance/noImgElement: a data URL drawn once
				<img src={ready ?? plain} alt="" draggable={false} data-gen-tile={preset.id} data-gen-still={preset.effects?.length ? (ready ? "ready" : "plain") : undefined} className="size-full object-cover" />
			}
			dragData={{
				type: "deferred",
				id: `gen:${preset.id}`,
				name,
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
