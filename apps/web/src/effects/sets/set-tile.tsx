"use client";

// An effect set's tile (Effects → Sets): its shaders on the photo, its graphic drawn over that still (both playing
// while hovered). A double-click, ↵ or «+» puts the set on the selected clips (or the clip under the playhead); a drag
// puts it on the clip it is dropped on. One ⌘Z each.
import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { EFFECT_TARGET_ELEMENT_TYPES, effectsRegistry, resolveEffectPasses } from "@/effects";
import { FxThumbnail } from "@/effects/components/fx-thumbnail";
import { useT } from "@/i18n";
import { MOGRAPH_BY_KIND } from "@/montage/mograph";
import { buildDefaultParamValues } from "@/params/registry";
import { applyEffectSet, applyEffectSetTo } from "./apply";
import { type EffectSet, setEffectType } from "./catalog";

const MographPreview = lazy(() => import("@/montage/components/mograph-preview"));

export function SetTile({ set, photo }: { set: EffectSet; photo?: string }) {
	const t = useT();
	const [hovered, setHovered] = useState(false);
	const definitions = useMemo(
		() =>
			set.effects
				.filter((effect) => effectsRegistry.has(setEffectType(effect)))
				.map((effect) => ({ definition: effectsRegistry.get(setEffectType(effect)), params: typeof effect === "string" ? {} : effect.params })),
		[set],
	);
	const buildPasses = useCallback(
		(time: Parameters<typeof resolveEffectPasses>[0]["time"]) =>
			definitions.flatMap(({ definition, params }) =>
				resolveEffectPasses({
					definition,
					effectParams: { ...buildDefaultParamValues(definition.params), ...(definition.thumbnailParams ?? {}), ...params },
					width: 160,
					height: 160,
					time,
				}),
			),
		[definitions],
	);
	const graphic = MOGRAPH_BY_KIND.get(set.layers[0]?.kind ?? "");
	const apply = useCallback(() => {
		if (applyEffectSet(set) > 0) toast.success(t("{name} applied", { name: t(set.name) }), { duration: 1500 });
		else toast.info(t("Select a clip to apply {name}", { name: t(set.name) }));
	}, [set, t]);

	return (
		<DraggableItem
			name={t(set.name)}
			preview={
				// biome-ignore lint: tile is a gesture surface; the label is the accessible name
				<div
					role="button"
					tabIndex={-1}
					aria-label={t("Apply {name}", { name: t(set.name) })}
					data-effect-set={set.id}
					// the live preview shows the set's sample words (BREAKING NEWS, LIVE…): content, not interface text
					data-no-translate
					className="relative size-full cursor-pointer"
					onMouseEnter={() => setHovered(true)}
					onMouseLeave={() => setHovered(false)}
				>
					<FxThumbnail cacheKey={`set:${set.id}`} buildPasses={buildPasses} restTime={0.3} loopSeconds={1.5} hovered={hovered} photo={photo} />
					{graphic ? (
						<div className="pointer-events-none absolute inset-0">
							<Suspense fallback={null}>
								<MographPreview kind={graphic} playing={hovered} background="transparent" />
							</Suspense>
						</div>
					) : null}
				</div>
			}
			dragData={{
				id: `set:${set.id}`,
				name: set.name,
				type: "effect",
				effectType: setEffectType(set.effects[0]),
				targetElementTypes: EFFECT_TARGET_ELEMENT_TYPES,
				applyTo: (clip) => applyEffectSetTo(set, clip),
			}}
			onAddToTimeline={apply}
			aspectRatio={1}
			isRounded
			variant="card"
			containerClassName="w-full"
		/>
	);
}
