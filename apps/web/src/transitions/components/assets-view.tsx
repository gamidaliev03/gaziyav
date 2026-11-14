"use client";

import { TILE_LABEL, TileAddButton } from "@/components/editor/panels/assets/material-grid";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useEditor } from "@/editor/use-editor";
import { EditorCore } from "@/core";
import type { EffectPass, EffectTimeContext } from "@/effects/types";
import { FxThumbnail } from "@/effects/components/fx-thumbnail";
import { TICKS_PER_SECOND } from "@/wasm";
import { cn } from "@/utils/ui";
import { DEFAULT_TRANSITION_PARAMS, getTransitionDefinition, LIBRARY_TRANSITIONS, TRANSITION_CATEGORY_ORDER } from "../definitions";
import { FxBrowser } from "@/effects/components/fx-browser";
import { tileActivation } from "@/components/editor/panels/assets/tile-activation";
import {
	applyTransition,
	clampTransitionTicks,
	commitTransitionEdit,
	findCut,
	findNearestCut,
	MAX_TRANSITION_SECONDS,
	MIN_TRANSITION_SECONDS,
	previewTransitionPatch,
	removeTransition,
	snapshotTracks,
	type CutRef,
	useSelectedCut,
	type CutInfo,
	listTrackCuts,
} from "../commands";
import type { TransitionDefinition } from "../types";
import { applyLayerTransition } from "../layer-commands";
import { transitionPasteLayers } from "@/commands/timeline/clipboard/paste-transition";
import { applyTransitionToCuts } from "@/actions/apply-to-all";
import { warmShader } from "@/services/renderer/compositor/pipeline-warmup";
import { ThemeChips } from "@/montage/components/mograph-browser";
import { previewPhotoFor, type Theme, themesOf } from "@/effects/themes";
import { useT } from "@/i18n";
import { ru } from "@/i18n/ru";

export const TRANSITION_DRAG_MIME = "application/x-studio-transition";


/** Applies a transition to the clicked cut, else the cut nearest the playhead. */
/**
 * The cut of the selected clip nearer to the playhead (its start or its end), when one video clip is selected: a
 * double-click on a tile put the transition on the cut under the playhead, not on the selected clip's (final-A A6).
 */
function cutOfSelectedClip(): CutInfo | null {
	const editor = EditorCore.getInstance();
	const refs = editor.selection.getSelectedElements();
	if (refs.length !== 1) return null;
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return null;
	const track = [tracks.main, ...tracks.overlay].find((t) => t.id === refs[0].trackId);
	if (!track || track.type !== "video") return null;
	const cuts = listTrackCuts(track).filter((cut) => cut.fromElementId === refs[0].elementId || cut.toElementId === refs[0].elementId);
	const at = currentTime();
	return cuts.sort((a, b) => Math.abs(a.time - at) - Math.abs(b.time - at))[0] ?? null;
}

export function applyTransitionFromPanel(type: string): void {
	const selected = useSelectedCut.getState().cut;
	// A selected adjustment layer takes it (transitions/layer.ts): it transitions everything under the layer.
	const editor = EditorCore.getInstance();
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	const layers = !selected && tracks ? transitionPasteLayers({ tracks, selectedElementIds: editor.selection.getSelectedElements().map((ref) => ref.elementId) }) : [];
	if (layers.length > 0) {
		const definition = getTransitionDefinition(type);
		let applied = 0;
		for (const layer of layers) if (applyLayerTransition({ layer, type })) applied++;
		if (applied > 0 && definition) toast.success(`${definition.name} applied`, { duration: 1500 });
		return;
	}
	const target = (selected && findCut(selected)) || cutOfSelectedClip() || findNearestCut(currentTime());
	const definition = getTransitionDefinition(type);
	if (!target || !definition) {
		toast.info("Put two clips side by side first");
		return;
	}
	if (applyTransition({ cut: target, type })) {
		useSelectedCut.getState().setCut({
			trackId: target.trackId,
			fromElementId: target.fromElementId,
			toElementId: target.toElementId,
		});
		toast.success(`${definition.name} applied`, { duration: 1500 });
	}
}

function applyTransitionEverywhere(cut: CutRef, scope: "track" | "all"): void {
	const changed = applyTransitionToCuts(EditorCore.getInstance(), cut, scope);
	toast[changed > 0 ? "success" : "info"](changed > 0 ? `Transition put on ${changed} more ${changed === 1 ? "cut" : "cuts"}` : "No other cuts to put it on");
}

function currentTime(): number {
	return EditorCore.getInstance().playback.getCurrentTime();
}

export function TransitionsView() {
	const t = useT();
	// One subscription for the whole grid (not one per tile): which transition the selected cut has.
	const selected = useSelectedCut((state) => state.cut);
	useEditor((editor) => editor.timeline.getPreviewTracks());
	const activeType = selected ? (findCut(selected)?.transition?.type ?? null) : null;
	const [theme, setTheme] = useState<Theme | null>(null);
	const themes = useMemo(() => new Map(LIBRARY_TRANSITIONS.map((d) => [d.type, themesOf({ name: d.name, category: d.category })])), []);
	const shown = useMemo(() => (theme ? LIBRARY_TRANSITIONS.filter((d) => themes.get(d.type)?.includes(theme)) : LIBRARY_TRANSITIONS), [theme, themes]);
	return (
		<PanelView title="Transitions">
			<SelectedCutSection />
			<ThemeChips theme={theme} onTheme={setTheme} />
			<FxBrowser
				groupLabel="Transitions"
				items={shown}
				getKey={(d) => d.type}
				getName={(d) => t(d.name)}
				getKeywords={(d) => [d.name, ru(d.name), d.category, ru(d.category)]}
				getCategory={(d) => d.category}
				categoryOrder={TRANSITION_CATEGORY_ORDER}
				placeholder={`Search ${shown.length} transitions`}
				renderTile={(definition) => (
					<TransitionTile
						definition={definition}
						active={activeType === definition.type}
						photo={previewPhotoFor(themes.get(definition.type) ?? [], theme)}
					/>
				)}
			/>
		</PanelView>
	);
}

function transitionPasses(definition: TransitionDefinition, time: EffectTimeContext): EffectPass[] {
	return [
		{
			shader: definition.type,
			uniforms: {
				u_time: time.time,
				u_progress: time.progress,
				u_frame: time.frame,
				u_params: (definition.pack?.(DEFAULT_TRANSITION_PARAMS(definition)) ?? [0]).slice(0, 32),
			},
		},
	];
}

const TransitionTile = memo(function TransitionTile({
	definition,
	active,
	photo,
}: {
	definition: TransitionDefinition;
	active: boolean;
	photo: string;
}) {
	const t = useT();
	const [hovered, setHovered] = useState(false);
	const buildPasses = useCallback((time: EffectTimeContext) => transitionPasses(definition, time), [definition]);

	return (
		<div className="group relative flex flex-col gap-1">
			<button
				type="button"
				draggable
				onDragStart={(event) => {
					event.dataTransfer.setData(TRANSITION_DRAG_MIME, definition.type);
					event.dataTransfer.effectAllowed = "copy";
					warmShader(definition.type);
				}}
				{...tileActivation(() => {
					if (!useSelectedCut.getState().cut) applyTransitionFromPanel(definition.type);
				})}
				// A cut picked with «+» says «Pick a transition below»: one click puts it there (a double-click did nothing more).
				onClick={(event) => {
					if (event.detail <= 1 && useSelectedCut.getState().cut) applyTransitionFromPanel(definition.type);
				}}
				title={`${definition.name} — double-click to apply, or drag onto a cut`}
				// Hovered or dragged, its shader starts compiling in the background: by the drop it is ready.
				onMouseEnter={() => {
					setHovered(true);
					warmShader(definition.type);
				}}
				onMouseLeave={() => setHovered(false)}
				aria-label={`Apply ${definition.name}`}
				className={cn(
					"bg-accent relative aspect-square w-full cursor-pointer overflow-hidden rounded-sm border-2 border-transparent p-0",
					active && "border-primary",
				)}
			>
				<FxThumbnail
					cacheKey={definition.type}
					buildPasses={buildPasses}
					twoInputs
					restTime={definition.defaultDuration * (definition.numberParams?.some((p) => p.type === "color") ? 0.25 : 0.45)}
					loopSeconds={definition.defaultDuration}
					hovered={hovered}
					photo={photo}
				/>
			</button>
			<TileAddButton onAdd={() => applyTransitionFromPanel(definition.type)} label="Apply at the nearest cut" />
			<span className={TILE_LABEL}>{t(definition.name)}</span>
		</div>
	);
});

export function SelectedCutSection() {
	const t = useT();
	const selected = useSelectedCut((state) => state.cut);
	const setCut = useSelectedCut((state) => state.setCut);
	// re-render on timeline changes (stable reference until tracks change)
	useEditor((editor) => editor.timeline.getPreviewTracks());
	const info: CutInfo | null = selected ? findCut(selected) : null;
	// The tracks before a slider edit: taken on its first change (never on a press alone, which may change nothing and
	// would leave a stale snapshot for the next edit) and turned into one undo step after the edit's last value is in
	// (Radix reports a keyboard step's commit before its value); a pointer release ends it too (a drag back to where it
	// started gets no commit from Radix).
	const before = useRef<ReturnType<typeof snapshotTracks>>(null);
	const startEdit = () => {
		before.current ??= snapshotTracks();
	};
	const endEdit = () =>
		queueMicrotask(() => {
			commitTransitionEdit(before.current);
			before.current = null;
		});

	if (!selected || !info) return null;
	const transition = info.transition;
	const definition = transition ? getTransitionDefinition(transition.type) : undefined;
	const seconds = transition ? transition.duration / TICKS_PER_SECOND : 0;

	return (
		<div className="bg-accent/40 mb-3 flex flex-col gap-2 rounded-md p-2.5">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium">
					{definition ? t(definition.name) : t("Cut selected")}
					<span className="text-muted-foreground"> {t("· at {s} s", { s: (info.time / TICKS_PER_SECOND).toFixed(2) })}</span>
				</span>
				<button type="button" className="text-muted-foreground text-[11px]" onClick={() => setCut(null)}>
					Done
				</button>
			</div>
			{transition && definition ? (
				<>
					<div className="flex items-center gap-2">
						<span className="text-muted-foreground w-16 text-[11px]">Duration</span>
						<Slider
							className="flex-1"
							min={MIN_TRANSITION_SECONDS}
							max={MAX_TRANSITION_SECONDS}
							step={0.05}
							value={[seconds]}
							onPointerUp={endEdit}
							onValueChange={([value]) => {
								startEdit();
								previewTransitionPatch(info, {
									duration: clampTransitionTicks(value * TICKS_PER_SECOND, info),
								});
							}}
							onValueCommit={endEdit}
						/>
						<span className="w-10 text-right text-[11px] tabular-nums">{seconds.toFixed(2)} s</span>
					</div>
					{definition.params?.map((param) => (
						<div key={param.key} className="flex items-center gap-2">
							<span className="text-muted-foreground w-16 text-[11px]">{param.label}</span>
							<div className="flex flex-1 gap-1">
								{param.options.map((option) => (
									<Button
										key={option.value}
										size="sm"
										variant={(transition.params?.[param.key] ?? param.default) === option.value ? "default" : "outline"}
										className="h-6 flex-1 px-1 text-[11px]"
										onClick={() => {
											const snapshot = snapshotTracks();
											previewTransitionPatch(info, {
												params: { ...transition.params, [param.key]: option.value },
											});
											commitTransitionEdit(snapshot);
										}}
									>
										{option.label}
									</Button>
								))}
							</div>
						</div>
					))}
					{definition.numberParams?.flatMap((param) => {
						const rows =
							param.type === "vec2"
								? [
										{ key: `${param.key}X`, label: `${param.label} X`, index: 0 },
										{ key: `${param.key}Y`, label: `${param.label} Y`, index: 1 },
									]
								: param.type === "color"
									? []
									: [{ key: param.key, label: param.label, index: 0 }];
						return rows.map((row) => {
							const raw = transition.params?.[row.key];
							if (param.type === "bool") {
								const on = typeof raw === "boolean" ? raw : (param.default[0] ?? 0) > 0.5;
								return (
									<div key={row.key} className="flex items-center gap-2">
										<span className="text-muted-foreground w-16 truncate text-[11px]" title={row.label}>{row.label}</span>
										<Button
											size="sm"
											variant={on ? "default" : "outline"}
											className="h-6 px-2 text-[11px]"
											onClick={() => {
												const snapshot = snapshotTracks();
												previewTransitionPatch(info, { params: { ...transition.params, [row.key]: !on } });
												commitTransitionEdit(snapshot);
											}}
										>
											{on ? "On" : "Off"}
										</Button>
									</div>
								);
							}
							const value = typeof raw === "number" ? raw : (param.default[row.index] ?? 0);
							const lo = param.type === "vec2" ? Math.min(-1, param.min) : param.min;
							const hi = param.type === "vec2" ? Math.max(1, param.max) : param.max;
							return (
								<div key={row.key} className="flex items-center gap-2">
									<span className="text-muted-foreground w-16 truncate text-[11px]" title={row.label}>{row.label}</span>
									<Slider
										className="flex-1"
										min={lo}
										max={hi}
										step={param.type === "int" ? 1 : (hi - lo) / 100}
										value={[value]}
										onPointerUp={endEdit}
										onValueChange={([next]) => {
											startEdit();
											previewTransitionPatch(info, { params: { ...transition.params, [row.key]: next } });
										}}
										onValueCommit={endEdit}
									/>
									<span className="w-10 text-right text-[11px] tabular-nums">
										{param.type === "int" ? Math.round(value) : value.toFixed(2)}
									</span>
								</div>
							);
						});
					})}
					{definition.credit && <span className="text-muted-foreground text-[0.65rem]">{definition.credit}</span>}
					{/* «Apply to all»: this transition (kind, length, settings) on other cuts, one ⌘Z. */}
					<div className="flex flex-wrap gap-1.5">
						<Button size="sm" variant="secondary" className="h-7" data-transition-apply="track" onClick={() => applyTransitionEverywhere(info, "track")}>
							To all cuts on this track
						</Button>
						<Button size="sm" variant="secondary" className="h-7" data-transition-apply="all" onClick={() => applyTransitionEverywhere(info, "all")}>
							To every cut
						</Button>
					</div>
					<Button size="sm" variant="outline" className="h-7" onClick={() => {
						// As ⌫ does: the cut lets go too (its gold «+» stayed lit after the transition came off).
						removeTransition(info);
						useSelectedCut.getState().setCut(null);
					}}>
						Remove transition
					</Button>
				</>
			) : (
				<span className="text-muted-foreground text-[11px]">Pick a transition below.</span>
			)}
		</div>
	);
}
