"use client";

// Inspector → the effect layer's one tab (docs/EDITOR-MAP.md «Effect layer»): the transition dropped on an adjustment
// layer (transitions/layer.ts) — its name and kind, its length (the layer's: trim the layer to change it), where its
// middle falls, its options, a swap for another one and Remove. Every change is one ⌘Z.
import { registerInspectorSection } from "@/components/editor/panels/properties/slots";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import type { EffectElement, SceneTracks } from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";
import { getTransitionDefinition, LIBRARY_TRANSITIONS, TRANSITION_CATEGORY_ORDER } from "../definitions";
import { layerTransitionMode, layerTransitionWindow, tracksBelowLayer } from "../layer";
import { applyLayerTransition, removeLayerTransition } from "../layer-commands";

const byCategory = () => {
	const groups = new Map<string, typeof LIBRARY_TRANSITIONS>();
	for (const definition of LIBRARY_TRANSITIONS) {
		const list = groups.get(definition.category) ?? [];
		list.push(definition);
		groups.set(definition.category, list);
	}
	const rank = (c: string) => {
		const i = TRANSITION_CATEGORY_ORDER.indexOf(c);
		return i < 0 ? 99 : i;
	};
	return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
};

function LayerTransitionSection({ element, trackId }: { element: EffectElement; trackId: string }) {
	const t = useT();
	const tracks = useEditor((editor) => editor.timeline.getPreviewTracks()) as SceneTracks | null;
	const layer = { trackId, elementId: element.id };
	const transition = element.transition;
	const definition = transition ? getTransitionDefinition(transition.type) : undefined;
	const window = tracks ? layerTransitionWindow({ layer: element, tracksBelow: tracksBelowLayer(tracks, trackId) }) : null;
	const seconds = element.duration / TICKS_PER_SECOND;

	const picker = (
		<select
			data-layer-transition-swap=""
			aria-label={t(transition ? "Swap for" : "Add a transition")}
			className="bg-background border-input h-7 min-w-0 flex-1 rounded-md border px-1.5 text-[11px]"
			value={transition?.type ?? ""}
			onChange={(event) => {
				if (event.target.value) applyLayerTransition({ layer, type: event.target.value });
			}}
		>
			{!transition && <option value="">{t("Choose a transition…")}</option>}
			{transition && !LIBRARY_TRANSITIONS.some((d) => d.type === transition.type) && (
				<option value={transition.type}>{definition ? t(definition.name) : transition.type}</option>
			)}
			{byCategory().map(([category, list]) => (
				<optgroup key={category} label={t(category)}>
					{list.map((d) => (
						<option key={d.type} value={d.type}>
							{t(d.name)}
						</option>
					))}
				</optgroup>
			))}
		</select>
	);

	if (!transition || !definition) {
		return (
			<div data-layer-transition-section="" className="flex flex-col gap-2 py-1">
				<p className="text-muted-foreground text-[11px] leading-snug">
					{t("Drop a transition from Effects → Transitions on this layer: it transitions everything under the layer, nothing above it.")}
				</p>
				<div className="flex items-center gap-2">{picker}</div>
			</div>
		);
	}

	const single = layerTransitionMode(transition.type) === "single";
	const where =
		window?.cut != null
			? t("Its middle is on the cut at {s} s", { s: (window.cut / TICKS_PER_SECOND).toFixed(2) })
			: t("No cut under the layer: it runs across the layer");
	return (
		<div data-layer-transition-section={transition.type} className="flex flex-col gap-2 py-1">
			<div className="flex items-center justify-between gap-2">
				<span className="truncate text-xs font-medium" data-layer-transition-name="">
					{t(definition.name)}
				</span>
				<span className="text-muted-foreground shrink-0 text-[11px]" title={t(single ? "One picture: the composite under the layer is warped" : "Two pictures: the composite under the layer before the cut and after it")}>
					{t(single ? "One picture" : "Before → after")}
				</span>
			</div>
			<div className="flex items-center gap-2">
				<span className="text-muted-foreground w-16 text-[11px]">{t("Duration")}</span>
				<span className="text-[11px] tabular-nums" data-layer-transition-duration={seconds.toFixed(2)}>
					{t("{s} s — the layer's length", { s: seconds.toFixed(2) })}
				</span>
			</div>
			<p className="text-muted-foreground text-[11px] leading-snug">
				{where}. {t("Trim the layer to change its length.")}
			</p>
			{definition.params?.map((param) => (
				<div key={param.key} className="flex items-center gap-2">
					<span className="text-muted-foreground w-16 text-[11px]">{t(param.label)}</span>
					<div className="flex flex-1 gap-1">
						{param.options.map((option) => (
							<Button
								key={option.value}
								size="sm"
								variant={(transition.params?.[param.key] ?? param.default) === option.value ? "default" : "outline"}
								className="h-6 flex-1 px-1 text-[11px]"
								onClick={() =>
									applyLayerTransition({ layer, type: transition.type, params: { ...transition.params, [param.key]: option.value } })
								}
							>
								{t(option.label)}
							</Button>
						))}
					</div>
				</div>
			))}
			<div className="flex items-center gap-2">
				<span className="text-muted-foreground w-16 text-[11px]">{t("Swap for")}</span>
				{picker}
			</div>
			<Button size="sm" variant="outline" className="h-7" data-layer-transition-remove="" onClick={() => removeLayerTransition(layer)}>
				{t("Remove transition")}
			</Button>
		</div>
	);
}

registerInspectorSection({
	id: "layer.transition",
	tab: "effects",
	title: "Transition",
	order: 200,
	appliesTo: (element) => element.type === "effect",
	render: ({ element, trackId }) => <LayerTransitionSection element={element as EffectElement} trackId={trackId} />,
});
