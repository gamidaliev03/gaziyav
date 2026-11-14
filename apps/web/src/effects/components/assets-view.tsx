"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import {
	effectsRegistry,
	EFFECT_TARGET_ELEMENT_TYPES,
	resolveEffectPasses,
} from "@/effects";
import { buildDefaultParamValues } from "@/params/registry";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import { ru } from "@/i18n/ru";
import { buildEffectElement } from "@/timeline/element-utils";
import type { EffectDefinition } from "@/effects/types";
import { FxThumbnail, thumbnailModeFor } from "./fx-thumbnail";
import { EFFECT_CATEGORY_ORDER, EFFECT_TRENDING } from "@/effects/definitions";
import { FxBrowser } from "./fx-browser";
import { applyEffectToSelection } from "./apply-effect";
import type { NeuralEffect } from "@/neural/catalog";
import { AI_CATEGORY, AiEffectTile } from "@/neural/components/ai-tiles";
import { EFFECT_SETS, type EffectSet } from "@/effects/sets/catalog";
import { SetTile } from "@/effects/sets/set-tile";
import { MOGRAPH_BY_KIND } from "@/montage/mograph";
import { ThemeChips } from "@/montage/components/mograph-browser";
import { previewPhotoFor, type Theme, themesOf } from "@/effects/themes";

/** Effects → Sets: shaders and a graphic over the clip in one tile (VHS, camcorder REC, film, TV, glitch, dreams). */
const SETS_CATEGORY = "Sets";

// Trending → Sets → the rest
const CATEGORY_ORDER = [EFFECT_TRENDING, SETS_CATEGORY, ...EFFECT_CATEGORY_ORDER.filter((name) => name !== EFFECT_TRENDING)];

/** Idle still: the most telling moment of each effect (seconds). */
const REST_TIME: Record<string, number> = {
	"studio.flash": 0.04,
	"studio.shake": 0.05,
	"studio.handheld": 0.9,
	// the punch is done (no motion blur): the same still as the clip's own 0.12 s punch
	"studio.zoomPunch": 0.6,
	"studio.kenBurns": 1.4,
	"studio.glitch": 0.27,
	// the pro pack's moving ones: a flash while it is lit, a sweep mid-frame, weather and party once their particles
	// and lights have come in (at 0.3 s the tile was the untouched photo)
	"pro.fx.cameraFlash": 0.06,
	"pro.fx.lightSweep": 0.5,
	"pro.fx.flickerLight": 0.2,
	"pro.fx.rainbowLeak": 0.6,
	"pro.fx.cornerBurn": 0.6,
	"pro.fx.rain": 2,
	"pro.fx.snow": 2,
	"pro.fx.dust": 2,
	"pro.fx.sparkles": 2,
	"pro.fx.bokehLights": 2,
	"pro.fx.fog": 2,
	"pro.fx.disco": 0.7,
	"pro.fx.neonPulse": 0.7,
	"pro.fx.colorCycle": 0.7,
	"pro.fx.lasers": 0.7,
	"pro.fx.colorStrobe": 0.06,
	"pro.fx.heartbeat": 0.12,
	"pro.fx.beatPulse": 0.1,
	"pro.fx.zoomBounce": 0.15,
	"pro.fx.bounce": 0.15,
	"pro.fx.stepShake": 0.08,
	"pro.fx.drunk": 0.6,
	"pro.fx.gateWeave": 0.4,
};

type Item = { kind: "fx"; effect: EffectDefinition } | { kind: "ai"; effect: NeuralEffect } | { kind: "set"; set: EffectSet };

const setKeywords = (set: EffectSet) => [set.family, ...set.themes, ...set.layers.map((layer) => MOGRAPH_BY_KIND.get(layer.kind)?.label ?? "")];
const itemKey = (i: Item) => (i.kind === "set" ? `set:${i.set.id}` : i.kind === "ai" ? i.effect.id : i.effect.type);
const itemThemes = (i: Item): Theme[] =>
	i.kind === "set"
		? i.set.themes
		: i.kind === "ai"
			? themesOf({ name: i.effect.name, category: "AI" })
			: themesOf({ name: i.effect.name, category: i.effect.category ?? "Style", keywords: i.effect.keywords });

export function EffectsView() {
	const t = useT();
	const [theme, setTheme] = useState<Theme | null>(null);
	const effects = useMemo(() => effectsRegistry.getAll().filter((effect) => !effect.hidden), []);
	// On-device video AI (Remove Background, Enhance, Denoise, Upscale) and the shader effects; CATEGORY_ORDER sorts them.
	const items = useMemo<Item[]>(
		// The AI tools (Remove background, Enhance, Remove flickers…) change the selected clip: they live in its inspector
		// (Cutout, Fix, Retouch, AI) and ⌘K finds them; the library holds what is added — effects and sets.
		() => [
			...EFFECT_SETS.map((set) => ({ kind: "set" as const, set })),
			...effects.map((effect) => ({ kind: "fx" as const, effect })),
		],
		[effects],
	);
	const themes = useMemo(() => new Map(items.map((i) => [itemKey(i), itemThemes(i)])), [items]);
	const shown = useMemo(() => (theme ? items.filter((i) => themes.get(itemKey(i))?.includes(theme)) : items), [items, theme, themes]);
	const photoOf = (i: Item) => previewPhotoFor(themes.get(itemKey(i)) ?? [], theme);
	return (
		<PanelView title="Effects">
			<ThemeChips theme={theme} onTheme={setTheme} />
			<FxBrowser
				groupLabel="Video effects"
				items={shown}
				getKey={itemKey}
				getName={(i) => t(i.kind === "set" ? i.set.name : i.effect.name)}
				getCategory={(i) => (i.kind === "set" ? SETS_CATEGORY : i.kind === "ai" ? AI_CATEGORY : (i.effect.category ?? "Style"))}
				// the search finds a tile by its English and its Russian name, whatever the interface language
				getKeywords={(i) => (i.kind === "set" ? [i.set.name, ru(i.set.name), ...setKeywords(i.set)] : [i.effect.name, ru(i.effect.name), ...(i.effect.keywords ?? [])])}
				categoryOrder={CATEGORY_ORDER}
				placeholder={`Search ${shown.length} effects`}
				renderTile={(i) =>
					i.kind === "set" ? (
						<SetTile set={i.set} photo={photoOf(i)} />
					) : i.kind === "ai" ? (
						<AiEffectTile effect={i.effect} />
					) : (
						<EffectItem effect={i.effect} photo={photoOf(i)} />
					)
				}
			/>
		</PanelView>
	);
}

function EffectItem({ effect, photo }: { effect: EffectDefinition; photo: string }) {
	const t = useT();
	const editor = useEditor();
	const [hovered, setHovered] = useState(false);
	const defaults = useMemo(
		() => ({ ...buildDefaultParamValues(effect.params), ...(effect.thumbnailParams ?? {}) }),
		[effect],
	);

	const addAsLayer = useCallback(() => {
		const element = buildEffectElement({
			effectType: effect.type,
			startTime: editor.playback.getCurrentTime(),
		});
		editor.timeline.insertElement({
			placement: { mode: "auto", trackType: "effect", newTrack: true },
			element: { ...element, name: effect.name },
		});
	}, [editor, effect]);

	const apply = useCallback(() => {
		const applied = applyEffectToSelection({ effectType: effect.type });
		if (applied > 0) {
			toast.success(`${effect.name} applied`, { duration: 1500 });
			return;
		}
		addAsLayer();
		toast.success(`${effect.name} added as an effect layer at the playhead`, { duration: 2000 });
	}, [effect, addAsLayer]);

	// time-based effects play on hover; static ones (grades, styles) show a before → after wipe
	const mode = useMemo(() => thumbnailModeFor((effect.shaders ?? []).map((shader) => shader.wgsl)), [effect]);

	const buildPasses = useCallback(
		(time: Parameters<typeof resolveEffectPasses>[0]["time"]) =>
			resolveEffectPasses({ definition: effect, effectParams: defaults, width: 160, height: 160, time }),
		[effect, defaults],
	);

	return (
		<DraggableItem
			name={t(effect.name)}
			preview={
				// biome-ignore lint: tile is a gesture surface; the label is the accessible name
				<div
					role="button"
					tabIndex={-1}
					aria-label={`Apply ${effect.name}`}
					className="size-full cursor-pointer"
					onMouseEnter={() => setHovered(true)}
					onMouseLeave={() => setHovered(false)}
				>
					<FxThumbnail
						cacheKey={effect.type}
						buildPasses={buildPasses}
						restTime={REST_TIME[effect.type] ?? 0.3}
						loopSeconds={1.5}
						hovered={hovered}
						mode={effect.type === "blur" ? "wipe" : mode}
						photo={photo}
					/>
				</div>
			}
			dragData={{
				id: effect.type,
				name: effect.name,
				type: "effect",
				effectType: effect.type,
				targetElementTypes: EFFECT_TARGET_ELEMENT_TYPES,
			}}
			onAddToTimeline={apply}
			aspectRatio={1}
			isRounded
			variant="card"
			containerClassName="w-full"
		/>
	);
}
